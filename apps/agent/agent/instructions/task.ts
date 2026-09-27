import { defineDynamic, defineInstructions } from "eve/instructions";
import { ATLAS_RUNTIME_INSTRUCTIONS } from "../lib/atlas-playbook";
import { focusOn, setBudget } from "../lib/focus";
import { sessionPreamble } from "../lib/preamble";
import { RESEARCH_INSTRUCTIONS } from "../lib/research-instructions";
import { attribute, purposeOf } from "../lib/session-purpose";

export default defineDynamic({
	events: {
		"session.started": async (_event, ctx) => {
			const purpose = purposeOf(ctx);
			if (purpose === "builder") {
				return builderInstructions(ctx);
			}

			if (purpose === "team-agent") {
				return defineInstructions({
					markdown: `This is one background run of a deployed team agent. Call agent_runner exactly once and pass the run id from your user message. Do not call research tools or perform work yourself. Relay the specialist's structured factual completion summary. Never claim an external action that the specialist did not log.`,
				});
			}

			if (purpose === "atlas-outreach") {
				return defineInstructions({
					markdown: `${ATLAS_RUNTIME_INSTRUCTIONS}\n\nThis is an authenticated Atlas outreach run. Call list_atlas_outreach_queue before deciding. If and only if every safety gate is satisfied, compose one concise, personalized email in English, Dutch, or Turkish and call send_atlas_email exactly once. Never include pricing, quote a fee, contact a lead through LinkedIn, Instagram, WhatsApp, or phone, or send to a lead with NEEDS_IHSAN, WITH_IHSAN, PARKED, SUPPRESSED, PROTECTED, or DO_NOT_CONTACT state.`,
				});
			}

			if (purpose === "atlas-daily-report") {
				return defineInstructions({
					markdown:
						"This is the weekday Atlas operating-report run. Call write_atlas_daily_report exactly once. Do not send email, contact anyone, or mutate leads, drafts, follow-ups, or calendar state.",
				});
			}

			if (purpose === "atlas-commercial-enrichment") {
				return defineInstructions({
					markdown:
						"This is a background Atlas commercial-quality enrichment run. Research only the lead named by the task. Use cited public evidence and never invent a current club, why-now event, language, or rating. Call enrich_atlas_commercial_quality once with the evidence you actually observed. Do not send email, create drafts, contact anyone, or change outreach state.",
				});
			}

			if (attribute(ctx, "researchRequestId")) {
				return defineInstructions({
					markdown: `${RESEARCH_INSTRUCTIONS}\n\nThis is an authenticated IBL research request. Begin with inspect_ibl_research. Work only inside the returned identity envelope and CRM target. Every finding must cite a record_ibl_evidence result. You may create only DRAFT artifacts and submit findings for human review. You cannot approve, queue, or send outreach. Finish with submit_ibl_research_review.`,
				});
			}

			const attributes = ctx.session.auth.current?.attributes ?? {};
			const budget = asNumber(attributes.budget);
			const kind = asString(attributes.taskKind);

			if (budget) setBudget(budget);

			const { markdown, focus } = await sessionPreamble(
				{
					contactId: asString(attributes.contactId),
					companyId: asString(attributes.companyId),
					dealId: asString(attributes.dealId),
				},
				{
					dispatched: Boolean(kind),
					kind,
					reason: asString(attributes.reason),
					budget,
				},
			);

			focusOn({ ...focus, sessionId: ctx.session.id });

			return defineInstructions({
				markdown: `${RESEARCH_INSTRUCTIONS}\n\n${markdown}`,
			});
		},
		"turn.started": (_event, ctx) =>
			purposeOf(ctx) === "builder" ? builderInstructions(ctx) : null,
	},
});

function builderInstructions(ctx: Parameters<typeof purposeOf>[0]) {
	return defineInstructions({
		markdown: builderTaskMarkdown(
			attribute(ctx, "commandType"),
			attribute(ctx, "needsTitle") === "true",
		),
	});
}

export function builderTaskMarkdown(
	commandType: string | null,
	needsTitle = false,
): string {
	const task =
		commandType === "CREATE_AGENT"
			? `This private CRM chat turn is authorized to create or revise an agent. Call agent_builder exactly once. Pass the complete request, the conversation's relevant decisions, every tagged resource, and your understanding of any attachment. Do not call research tools or mutate CRM records yourself. The specialist asks any essential clarification directly through ask_question and returns only when the draft is ready. Never retry agent_builder in the same turn. If the specialist fails, explain that the build could not finish and ask the user to try again instead of delegating again. If the specialist returns draft_ready, relay its concise summary and explain that the draft is ready for human review and is not deployed yet.`
			: `This is a private CRM assistant chat. Answer the user's question directly. Use tagged records as scope and use available read-only CRM and research tools when evidence is needed. Use list_deals for pipeline-wide, open-deal, or inactivity questions and follow its pagination until the requested scope is complete. The chat renders list_deals output as a structured deal list. Do not restate or enumerate individual deal rows in prose, bullets, or tables; the structured list is the sole row-level presentation. Give only a concise synthesis, caveats, and useful next actions after the tool results. If one materially necessary decision is missing, call ask_question with one focused follow-up instead of guessing; do not interrupt for optional detail. Do not call agent_builder, create an agent draft, or mutate CRM records on this turn. Agent creation begins only from an explicit request to create or build one. Be concise, distinguish CRM evidence from inference, and say when the CRM does not contain the answer.`;

	return needsTitle
		? `Before any other work, call set_chat_title once. Summarize the user's first message as a polished title of three to seven words in sentence case. Capture the intent, remove slash-command syntax and filler, and do not use quotation marks or ending punctuation.\n\n${task}`
		: task;
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
	const parsed = typeof value === "string" ? Number(value) : value;
	return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}
