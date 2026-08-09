"use client";

import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Field, FieldGroup, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { Textarea } from "@crm/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";

const selectClass =
	"border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function OperationsActions() {
	const trpc = useTRPC();
	const router = useRouter();
	const [kind, setKind] = useState<"PLAYER" | "FOOTBALL_AGENT">("PLAYER");
	const [workKind, setWorkKind] = useState<"TASK" | "RESEARCH">("TASK");
	const [organizationKind, setOrganizationKind] = useState<"AGENCY" | "CLUB">(
		"AGENCY",
	);
	const [approvalKind, setApprovalKind] = useState<
		"REQUEST" | "DECIDE" | "FINALIZE" | "SEND"
	>("REQUEST");
	const contactId = useId();
	const detailId = useId();
	const playerId = useId();
	const agentId = useId();
	const titleId = useId();
	const targetId = useId();
	const bodyId = useId();
	const mailboxId = useId();

	const done = (message: string) => {
		toast.success(message);
		router.refresh();
	};
	const failed = (error: { message: string }) => {
		toast.error(error.message);
	};
	const profile = useMutation(
		trpc.operations.saveFootballProfile.mutationOptions({
			onSuccess: () => done("Football profile saved."),
			onError: failed,
		}),
	);
	const representation = useMutation(
		trpc.operations.createRepresentation.mutationOptions({
			onSuccess: () => done("Representation created."),
			onError: failed,
		}),
	);
	const task = useMutation(
		trpc.operations.createTask.mutationOptions({
			onSuccess: () => done("Task created."),
			onError: failed,
		}),
	);
	const research = useMutation(
		trpc.operations.requestResearch.mutationOptions({
			onSuccess: () => done("Research request queued."),
			onError: failed,
		}),
	);
	const draft = useMutation(
		trpc.operations.createDraft.mutationOptions({
			onSuccess: () => done("Draft created."),
			onError: failed,
		}),
	);
	const organization = useMutation(
		trpc.operations.saveOrganizationProfile.mutationOptions({
			onSuccess: () => done("Organization profile saved."),
			onError: failed,
		}),
	);
	const route = useMutation(
		trpc.operations.createRoute.mutationOptions({
			onSuccess: () => done("Contact route created."),
			onError: failed,
		}),
	);
	const shareRoute = useMutation(
		trpc.operations.shareRoute.mutationOptions({
			onSuccess: () => done("Route sharing policy created."),
			onError: failed,
		}),
	);
	const lead = useMutation(
		trpc.operations.createLead.mutationOptions({
			onSuccess: () => done("Lead created."),
			onError: failed,
		}),
	);
	const note = useMutation(
		trpc.operations.createNote.mutationOptions({
			onSuccess: () => done("Note created."),
			onError: failed,
		}),
	);
	const requestApproval = useMutation(
		trpc.operations.requestApproval.mutationOptions({
			onSuccess: () => done("Approval requested."),
			onError: failed,
		}),
	);
	const decideApproval = useMutation(
		trpc.operations.decideApproval.mutationOptions({
			onSuccess: () => done("Approval decision saved."),
			onError: failed,
		}),
	);
	const approveDraft = useMutation(
		trpc.operations.approveDraft.mutationOptions({
			onSuccess: () => done("Draft approved for controlled outreach."),
			onError: failed,
		}),
	);
	const sendDraft = useMutation(
		trpc.operations.sendApprovedDraft.mutationOptions({
			onSuccess: () => done("Approved draft sent."),
			onError: failed,
		}),
	);
	const proposal = useMutation(
		trpc.operations.createProposal.mutationOptions({
			onSuccess: () => done("Proposal created."),
			onError: failed,
		}),
	);
	const proof = useMutation(
		trpc.operations.createProof.mutationOptions({
			onSuccess: () => done("Proof item created."),
			onError: failed,
		}),
	);

	return (
		<>
			<section
				aria-labelledby="quick-actions"
				className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4"
			>
				<h2 id="quick-actions" className="sr-only">
					Quick actions
				</h2>
				<Card>
					<CardHeader>
						<CardTitle>Football profile</CardTitle>
						<CardDescription className="block">
							Promote an existing contact to a player or agent.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								const form = new FormData(event.currentTarget);
								profile.mutate({
									contactId: String(form.get("contactId")),
									kind,
									position:
										kind === "PLAYER"
											? String(form.get("detail") || "") || null
											: undefined,
									licenseNumber:
										kind === "FOOTBALL_AGENT"
											? String(form.get("detail") || "") || null
											: undefined,
								});
							}}
						>
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor={contactId}>Contact ID</FieldLabel>
									<Input id={contactId} name="contactId" required />
								</Field>
								<Field>
									<FieldLabel>Profile type</FieldLabel>
									<select
										aria-label="Profile type"
										className={selectClass}
										value={kind}
										onChange={(event) =>
											setKind(event.target.value as typeof kind)
										}
									>
										<option value="PLAYER">Player</option>
										<option value="FOOTBALL_AGENT">Football agent</option>
									</select>
								</Field>
								<Field>
									<FieldLabel htmlFor={detailId}>
										{kind === "PLAYER" ? "Position" : "License number"}
									</FieldLabel>
									<Input id={detailId} name="detail" />
								</Field>
								<Button type="submit" disabled={profile.isPending}>
									Save profile
								</Button>
							</FieldGroup>
						</form>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Representation</CardTitle>
						<CardDescription className="block">
							Link a player to a football agent with durable history.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								const form = new FormData(event.currentTarget);
								representation.mutate({
									playerContactId: String(form.get("playerId")),
									agentContactId: String(form.get("agentId")),
									status: "PENDING",
									reason: "Created in Operations",
								});
							}}
						>
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor={playerId}>Player contact ID</FieldLabel>
									<Input id={playerId} name="playerId" required />
								</Field>
								<Field>
									<FieldLabel htmlFor={agentId}>Agent contact ID</FieldLabel>
									<Input id={agentId} name="agentId" required />
								</Field>
								<Button type="submit" disabled={representation.isPending}>
									Create representation
								</Button>
							</FieldGroup>
						</form>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Work queue</CardTitle>
						<CardDescription className="block">
							Create a linked task or evidence-first research request.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								const form = new FormData(event.currentTarget);
								const title = String(form.get("title"));
								const target = String(form.get("target"));
								if (workKind === "TASK")
									task.mutate({
										title,
										assigneeUserId: target,
										contactId: String(form.get("subject")),
										priority: "NORMAL",
									});
								else
									research.mutate({
										targetType: "CONTACT",
										targetEntityId: target,
										prompt: title,
										idempotencyKey: crypto.randomUUID(),
									});
							}}
						>
							<FieldGroup>
								<Field>
									<FieldLabel>Work type</FieldLabel>
									<select
										aria-label="Work type"
										className={selectClass}
										value={workKind}
										onChange={(event) =>
											setWorkKind(event.target.value as typeof workKind)
										}
									>
										<option value="TASK">Task</option>
										<option value="RESEARCH">Research</option>
									</select>
								</Field>
								<Field>
									<FieldLabel htmlFor={titleId}>
										{workKind === "TASK" ? "Task title" : "Research prompt"}
									</FieldLabel>
									<Input id={titleId} name="title" required />
								</Field>
								<Field>
									<FieldLabel htmlFor={targetId}>
										{workKind === "TASK"
											? "Assignee user ID"
											: "Target contact ID"}
									</FieldLabel>
									<Input id={targetId} name="target" required />
								</Field>
								{workKind === "TASK" ? (
									<Field>
										<FieldLabel>Subject contact ID</FieldLabel>
										<Input aria-label="Subject contact ID" name="subject" required />
									</Field>
								) : null}
								<Button
									type="submit"
									disabled={task.isPending || research.isPending}
								>
									Add to queue
								</Button>
							</FieldGroup>
						</form>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Draft</CardTitle>
						<CardDescription className="block">
							Create a mailbox-scoped draft. Approval is a separate human
							action.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								const form = new FormData(event.currentTarget);
								draft.mutate({
									mailboxId: String(form.get("mailboxId")) || null,
									subject: String(form.get("subject")) || null,
									body: String(form.get("body")),
									idempotencyKey: crypto.randomUUID(),
								});
							}}
						>
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor={mailboxId}>Owned mailbox ID</FieldLabel>
									<Input id={mailboxId} name="mailboxId" />
								</Field>
								<Field>
									<FieldLabel>Subject</FieldLabel>
									<Input aria-label="Subject" name="subject" />
								</Field>
								<Field>
									<FieldLabel htmlFor={bodyId}>Body</FieldLabel>
									<Textarea id={bodyId} name="body" required rows={4} />
								</Field>
								<Button type="submit" disabled={draft.isPending}>
									Save draft
								</Button>
							</FieldGroup>
						</form>
					</CardContent>
				</Card>
			</section>
			<section
				aria-labelledby="advanced-actions"
				className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4"
			>
				<h2 id="advanced-actions" className="sr-only">
					Record and review actions
				</h2>
				<Card>
					<CardHeader>
						<CardTitle>Agency or club</CardTitle>
						<CardDescription className="block">
							Promote an existing company to a football organization.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								const form = new FormData(event.currentTarget);
								const companyId = String(form.get("companyId"));
								const detail = String(form.get("detail")) || null;
								organization.mutate(
									organizationKind === "AGENCY"
										? { companyId, kind: "AGENCY", jurisdiction: detail }
										: { companyId, kind: "CLUB", league: detail },
								);
							}}
						>
							<FieldGroup>
								<Field>
									<FieldLabel>Company ID</FieldLabel>
									<Input aria-label="Company ID" name="companyId" required />
								</Field>
								<Field>
									<FieldLabel>Organization type</FieldLabel>
									<select
										aria-label="Organization type"
										className={selectClass}
										value={organizationKind}
										onChange={(event) =>
											setOrganizationKind(
												event.target.value as typeof organizationKind,
											)
										}
									>
										<option value="AGENCY">Agency</option>
										<option value="CLUB">Club</option>
									</select>
								</Field>
								<Field>
									<FieldLabel>
										{organizationKind === "AGENCY" ? "Jurisdiction" : "League"}
									</FieldLabel>
									<Input
										aria-label={
											organizationKind === "AGENCY" ? "Jurisdiction" : "League"
										}
										name="detail"
									/>
								</Field>
								<Button type="submit" disabled={organization.isPending}>
									Save organization
								</Button>
							</FieldGroup>
						</form>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Contact route</CardTitle>
						<CardDescription className="block">
							Create an owned route or explicitly share an existing one.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								const form = new FormData(event.currentTarget);
								const routeId = String(form.get("routeId"));
								const contact = String(form.get("contactId"));
								if (routeId)
									shareRoute.mutate({
										routeId,
										granteeContactId: contact,
										reason: "Shared in Operations",
										useForResearch: true,
										useForOutreach: false,
									});
								else
									route.mutate({
										contactId: contact,
										type: "EMAIL",
										value: String(form.get("value")),
										visibility: "PRIVATE",
									});
							}}
						>
							<FieldGroup>
								<Field>
									<FieldLabel>Contact or grantee contact ID</FieldLabel>
									<Input
										aria-label="Contact or grantee contact ID"
										name="contactId"
										required
									/>
								</Field>
								<Field>
									<FieldLabel>Email value for a new route</FieldLabel>
									<Input
										aria-label="Email value for a new route"
										name="value"
										type="email"
									/>
								</Field>
								<Field>
									<FieldLabel>Existing route ID to share instead</FieldLabel>
									<Input
										aria-label="Existing route ID to share instead"
										name="routeId"
									/>
								</Field>
								<Button
									type="submit"
									disabled={route.isPending || shareRoute.isPending}
								>
									Save route action
								</Button>
							</FieldGroup>
						</form>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Lead or note</CardTitle>
						<CardDescription className="block">
							Create pipeline intake or append a note to an existing lead.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								const form = new FormData(event.currentTarget);
								const leadId = String(form.get("leadId"));
								const text = String(form.get("text"));
								if (leadId) note.mutate({ leadId, body: text });
								else
									lead.mutate({
										name: text,
										contactId: String(form.get("contactId")),
										ownerUserId: String(form.get("ownerId")),
									});
							}}
						>
							<FieldGroup>
								<Field>
									<FieldLabel>Lead name or note body</FieldLabel>
									<Textarea
										aria-label="Lead name or note body"
										name="text"
										required
										rows={3}
									/>
								</Field>
								<Field>
									<FieldLabel>Contact ID for a new lead</FieldLabel>
									<Input
										aria-label="Contact ID for a new lead"
										name="contactId"
									/>
								</Field>
								<Field>
									<FieldLabel>Owner user ID for a new lead</FieldLabel>
									<Input
										aria-label="Owner user ID for a new lead"
										name="ownerId"
									/>
								</Field>
								<Field>
									<FieldLabel>
										Existing lead ID to add a note instead
									</FieldLabel>
									<Input
										aria-label="Existing lead ID to add a note instead"
										name="leadId"
									/>
								</Field>
								<Button
									type="submit"
									disabled={lead.isPending || note.isPending}
								>
									Save pipeline action
								</Button>
							</FieldGroup>
						</form>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Human approval</CardTitle>
						<CardDescription className="block">
							Request, independently decide, or finalize an approved draft.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								const form = new FormData(event.currentTarget);
								const id = String(form.get("id"));
								if (approvalKind === "REQUEST")
									requestApproval.mutate({
										draftId: id,
										idempotencyKey: crypto.randomUUID(),
									});
								else if (approvalKind === "DECIDE")
									decideApproval.mutate({
										id,
										status: "APPROVED",
										reason:
											String(form.get("reason")) || "Approved in Operations",
									});
								else if (approvalKind === "FINALIZE")
									approveDraft.mutate({ draftId: id });
								else sendDraft.mutate({ draftId: id });
							}}
						>
							<FieldGroup>
								<Field>
									<FieldLabel>Approval action</FieldLabel>
									<select
										aria-label="Approval action"
										className={selectClass}
										value={approvalKind}
										onChange={(event) =>
											setApprovalKind(event.target.value as typeof approvalKind)
										}
									>
										<option value="REQUEST">Request review (draft ID)</option>
										<option value="DECIDE">Approve review (approval ID)</option>
										<option value="FINALIZE">Finalize draft (draft ID)</option>
										<option value="SEND">Send approved draft (draft ID)</option>
									</select>
								</Field>
								<Field>
									<FieldLabel>Record ID</FieldLabel>
									<Input aria-label="Record ID" name="id" required />
								</Field>
								<Field>
									<FieldLabel>Decision reason</FieldLabel>
									<Input aria-label="Decision reason" name="reason" />
								</Field>
								<Button
									type="submit"
									disabled={
										requestApproval.isPending ||
										decideApproval.isPending ||
										approveDraft.isPending ||
										sendDraft.isPending
									}
								>
									Save approval action
								</Button>
							</FieldGroup>
						</form>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Proposal</CardTitle>
						<CardDescription className="block">
							Create a proposal linked to a lead.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								const form = new FormData(event.currentTarget);
								proposal.mutate({
									title: String(form.get("title")),
									leadId: String(form.get("leadId")),
									summary: String(form.get("summary")) || null,
									content: {},
									items: [],
								});
							}}
						>
							<FieldGroup>
								<Field>
									<FieldLabel>Title</FieldLabel>
									<Input aria-label="Title" name="title" required />
								</Field>
								<Field>
									<FieldLabel>Lead ID</FieldLabel>
									<Input aria-label="Lead ID" name="leadId" required />
								</Field>
								<Field>
									<FieldLabel>Summary</FieldLabel>
									<Textarea aria-label="Summary" name="summary" rows={3} />
								</Field>
								<Button type="submit" disabled={proposal.isPending}>
									Create proposal
								</Button>
							</FieldGroup>
						</form>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Proof library</CardTitle>
						<CardDescription className="block">
							Attach a traceable proof item to a contact.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								const form = new FormData(event.currentTarget);
								proof.mutate({
									label: String(form.get("label")),
									proofType: "REFERENCE",
									contactId: String(form.get("contactId")),
									reference: String(form.get("reference")) || null,
								});
							}}
						>
							<FieldGroup>
								<Field>
									<FieldLabel>Label</FieldLabel>
									<Input aria-label="Label" name="label" required />
								</Field>
								<Field>
									<FieldLabel>Contact ID</FieldLabel>
									<Input aria-label="Contact ID" name="contactId" required />
								</Field>
								<Field>
									<FieldLabel>Reference</FieldLabel>
									<Input aria-label="Reference" name="reference" />
								</Field>
								<Button type="submit" disabled={proof.isPending}>
									Add proof
								</Button>
							</FieldGroup>
						</form>
					</CardContent>
				</Card>
			</section>
		</>
	);
}
