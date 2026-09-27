import { createHash } from "node:crypto";
import { SQL } from "bun";
import { syntheticV1Rows, type SourceRow } from "../fixtures/synthetic-v1";

export function stableUuid(value: string) {
	const hex = createHash("sha256").update(`ibl-phase0:${value}`).digest("hex").slice(0, 32).split("");
	hex[12] = "4";
	hex[16] = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16);
	return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function row(type: string, id: string) {
	const found = syntheticV1Rows.find((candidate) => candidate.type === type && candidate.id === id);
	if (!found) throw new Error(`missing fixture reference ${type}:${id}`);
	return found;
}

export async function migrateSynthetic(databaseUrl: string) {
	const sql = new SQL(databaseUrl);
	try {
		return await sql.begin(async (tx) => {
			const map = async (source: SourceRow, targetType: string, targetId: string) => {
				await tx`
					INSERT INTO phase0.migration_id_map (source_type, source_id, target_type, target_id, outcome)
					VALUES (${source.type}, ${source.id}, ${targetType}, ${targetId}::uuid, 'MIGRATED')
					ON CONFLICT (source_type, source_id) DO UPDATE
					SET target_type = EXCLUDED.target_type, target_id = EXCLUDED.target_id, outcome = EXCLUDED.outcome, reason = NULL
				`;
			};

			for (const source of syntheticV1Rows.filter((item) => item.type === "user")) {
				const id = stableUuid(`${source.type}:${source.id}`);
				await tx`
					INSERT INTO phase0.users (id, source_id, name, crm_role, language, working_preferences, team_context)
					VALUES (${id}::uuid, ${source.id}, ${source.data.name}, ${source.data.role}, ${source.data.language}, '{"concise":true}'::jsonb, '{"name":"IBL Test"}'::jsonb)
					ON CONFLICT (source_id) DO UPDATE SET name = EXCLUDED.name, crm_role = EXCLUDED.crm_role
				`;
				await tx`
					INSERT INTO phase0.mailboxes (id, owner_user_id, address, display_name, signature)
					VALUES (${stableUuid(`mailbox:${source.id}`)}::uuid, ${id}::uuid, ${`${source.id}@mail.example.test`}, ${source.data.name}, ${`Regards, ${source.data.name}`})
					ON CONFLICT (address) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id, display_name = EXCLUDED.display_name
				`;
				await map(source, "user", id);
			}

			const crmSources = syntheticV1Rows.filter((item) => ["agency", "agent", "player", "lead"].includes(item.type));
			for (const source of crmSources.sort((left, right) => (left.type === "agency" ? -1 : right.type === "agency" ? 1 : 0))) {
				const id = stableUuid(`${source.type}:${source.id}`);
				const agencyId = source.data.agency ? stableUuid(`agency:${source.data.agency}`) : null;
				await tx`
					INSERT INTO phase0.crm_records (id, source_id, kind, owner_user_id, name, status, agency_id)
					VALUES (${id}::uuid, ${source.id}, ${source.type}, ${stableUuid(`user:${source.data.owner}`)}::uuid, ${source.data.name}, ${source.data.status}, ${agencyId}::uuid)
					ON CONFLICT (source_id) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id, name = EXCLUDED.name, status = EXCLUDED.status, agency_id = EXCLUDED.agency_id
				`;
				await map(source, "crm_record", id);
			}

			for (const source of syntheticV1Rows.filter((item) => item.type === "contact_route")) {
				const id = stableUuid(`${source.type}:${source.id}`);
				await tx`
					INSERT INTO phase0.contact_routes (id, source_id, owner_user_id, route_type, route_value, record_id)
					VALUES (${id}::uuid, ${source.id}, ${stableUuid(`user:${source.data.owner}`)}::uuid, ${source.data.routeType}, ${source.data.value}, ${stableUuid(`${source.data.record.startsWith("player") ? "player" : "lead"}:${source.data.record}`)}::uuid)
					ON CONFLICT (source_id) DO UPDATE SET route_value = EXCLUDED.route_value, record_id = EXCLUDED.record_id
				`;
				await map(source, "contact_route", id);
			}

			for (const source of syntheticV1Rows.filter((item) => item.type === "representation")) {
				const id = stableUuid(`${source.type}:${source.id}`);
				await tx`
					INSERT INTO phase0.representations (id, source_id, agent_id, player_id, agency_id, status)
					VALUES (${id}::uuid, ${source.id}, ${stableUuid(`agent:${source.data.agent}`)}::uuid, ${stableUuid(`player:${source.data.player}`)}::uuid, ${stableUuid(`agency:${source.data.agency}`)}::uuid, ${source.data.status})
					ON CONFLICT (source_id) DO UPDATE SET agent_id = EXCLUDED.agent_id, player_id = EXCLUDED.player_id, status = EXCLUDED.status
				`;
				await map(source, "representation", id);
			}

			for (const source of syntheticV1Rows.filter((item) => item.type === "shared_route_policy")) {
				const id = stableUuid(`${source.type}:${source.id}`);
				await tx`INSERT INTO phase0.shared_route_policies (id, source_id, route_id, policy) VALUES (${id}::uuid, ${source.id}, ${stableUuid(`contact_route:${source.data.route}`)}::uuid, ${source.data.policy}) ON CONFLICT (source_id) DO UPDATE SET policy = EXCLUDED.policy`;
				await map(source, "shared_route_policy", id);
			}

			for (const source of syntheticV1Rows.filter((item) => item.type === "contact_log")) {
				const id = stableUuid(`${source.type}:${source.id}`);
				await tx`INSERT INTO phase0.contact_logs (id, source_id, owner_user_id, subject_id, summary) VALUES (${id}::uuid, ${source.id}, ${stableUuid(`user:${source.data.owner}`)}::uuid, ${stableUuid(`player:${source.data.subject}`)}::uuid, ${source.data.summary}) ON CONFLICT (source_id) DO UPDATE SET summary = EXCLUDED.summary`;
				await map(source, "contact_log", id);
			}

			for (const source of syntheticV1Rows.filter((item) => item.type === "task")) {
				const id = stableUuid(`${source.type}:${source.id}`);
				await tx`INSERT INTO phase0.crm_tasks (id, source_id, owner_user_id, subject_id, title, status) VALUES (${id}::uuid, ${source.id}, ${stableUuid(`user:${source.data.owner}`)}::uuid, ${stableUuid(`lead:${source.data.subject}`)}::uuid, ${source.data.title}, ${source.data.status}) ON CONFLICT (source_id) DO UPDATE SET title = EXCLUDED.title, status = EXCLUDED.status`;
				await map(source, "task", id);
			}

			for (const source of syntheticV1Rows.filter((item) => item.type === "template")) {
				const id = stableUuid(`${source.type}:${source.id}`);
				await tx`INSERT INTO phase0.templates (id, source_id, owner_user_id, name, content) VALUES (${id}::uuid, ${source.id}, ${stableUuid(`user:${source.data.owner}`)}::uuid, ${source.data.name}, ${source.data.content}) ON CONFLICT (source_id) DO UPDATE SET name = EXCLUDED.name, content = EXCLUDED.content`;
				await map(source, "template", id);
			}

			for (const source of syntheticV1Rows.filter((item) => item.type === "proof_item")) {
				const id = stableUuid(`${source.type}:${source.id}`);
				await tx`INSERT INTO phase0.proof_items (id, source_id, subject_id, proof_type, reference) VALUES (${id}::uuid, ${source.id}, ${stableUuid(`player:${source.data.subject}`)}::uuid, ${source.data.proofType}, ${source.data.reference}) ON CONFLICT (source_id) DO UPDATE SET reference = EXCLUDED.reference`;
				await map(source, "proof_item", id);
			}

			for (const source of syntheticV1Rows.filter((item) => item.type === "email_thread")) {
				const id = stableUuid(`${source.type}:${source.id}`);
				await tx`INSERT INTO phase0.email_threads (id, source_id, mailbox_id, subject) VALUES (${id}::uuid, ${source.id}, ${stableUuid(`mailbox:${source.data.owner}`)}::uuid, ${source.data.subject}) ON CONFLICT (source_id) DO UPDATE SET mailbox_id = EXCLUDED.mailbox_id, subject = EXCLUDED.subject`;
				await map(source, "email_thread", id);
			}

			for (const source of syntheticV1Rows.filter((item) => item.type === "email_message")) {
				const id = stableUuid(`${source.type}:${source.id}`);
				row("email_thread", source.data.thread);
				await tx`INSERT INTO phase0.email_messages (id, source_id, thread_id, message_id, body, direction) VALUES (${id}::uuid, ${source.id}, ${stableUuid(`email_thread:${source.data.thread}`)}::uuid, ${source.data.messageId}, ${source.data.body}, ${source.data.direction}) ON CONFLICT (source_id) DO UPDATE SET thread_id = EXCLUDED.thread_id, message_id = EXCLUDED.message_id, body = EXCLUDED.body, direction = EXCLUDED.direction`;
				await map(source, "email_message", id);
			}

			await tx`INSERT INTO phase0.duplicate_candidates (candidate_key, candidate_type, source_ids, reason) VALUES ('name:alex morgan', 'NAME', ARRAY['lead-1','player-1'], 'same normalized name across record types') ON CONFLICT (candidate_key) DO UPDATE SET source_ids = EXCLUDED.source_ids`;
			await tx`INSERT INTO phase0.duplicate_candidates (candidate_key, candidate_type, source_ids, reason) VALUES ('route:shared@example.test', 'ROUTE', ARRAY['route-1','route-2'], 'shared route requires explicit policy') ON CONFLICT (candidate_key) DO UPDATE SET source_ids = EXCLUDED.source_ids`;
			await tx`INSERT INTO phase0.duplicate_candidates (candidate_key, candidate_type, source_ids, reason) VALUES ('name:sam taylor', 'NAME', ARRAY['agent-1','agent-2'], 'same normalized name requires review') ON CONFLICT (candidate_key) DO UPDATE SET source_ids = EXCLUDED.source_ids`;

			const [mappingCount] = await tx<Array<{ count: number }>>`SELECT count(*)::int AS count FROM phase0.migration_id_map`;
			const [duplicateCount] = await tx<Array<{ count: number }>>`SELECT count(*)::int AS count FROM phase0.duplicate_candidates`;
			return { sourceCount: syntheticV1Rows.length, mappingCount: mappingCount.count, duplicateCount: duplicateCount.count, rejectedCount: 0 };
		});
	} finally {
		await sql.close();
	}
}
