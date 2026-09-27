export type SourceRow = {
	type: string;
	id: string;
	data: Record<string, string>;
};

const rows: SourceRow[] = [];
const owners = ["user-1", "user-2", "user-3", "user-4"];

for (let index = 1; index <= 4; index += 1) {
	rows.push({
		type: "user",
		id: `user-${index}`,
		data: {
			name: ["Ihsan Test", "Amina Test", "Admin Test", "Scout Test"][index - 1],
			role: index === 3 ? "ADMIN" : "MEMBER",
			language: index === 2 ? "nl" : "en",
		},
	});
}

for (let index = 1; index <= 4; index += 1) {
	rows.push({
		type: "agency",
		id: `agency-${index}`,
		data: { name: `Agency ${index}`, owner: owners[(index - 1) % owners.length], status: index === 4 ? "INACTIVE" : "ACTIVE" },
	});
}

for (let index = 1; index <= 6; index += 1) {
	rows.push({
		type: "agent",
		id: `agent-${index}`,
		data: {
			name: index === 1 || index === 2 ? "Sam Taylor" : `Agent ${index}`,
			owner: owners[index % owners.length],
			status: index % 3 === 0 ? "PROSPECT" : "ACTIVE",
			agency: `agency-${((index - 1) % 4) + 1}`,
		},
	});
}

for (let index = 1; index <= 12; index += 1) {
	rows.push({
		type: "player",
		id: `player-${index}`,
		data: {
			name: index === 1 ? "Alex Morgan" : `Player ${index}`,
			owner: owners[(index + 1) % owners.length],
			status: ["ACTIVE", "MONITOR", "ARCHIVED"][index % 3],
		},
	});
}

for (let index = 1; index <= 15; index += 1) {
	rows.push({
		type: "lead",
		id: `lead-${index}`,
		data: {
			name: index === 1 ? "Alex Morgan" : `Lead ${index}`,
			owner: owners[(index + 2) % owners.length],
			status: ["NEW", "CONTACTED", "QUALIFIED", "LOST"][index % 4],
		},
	});
}

for (let index = 1; index <= 16; index += 1) {
	rows.push({
		type: "contact_route",
		id: `route-${index}`,
		data: {
			owner: owners[index % owners.length],
			routeType: index > 12 ? "PHONE" : "EMAIL",
			value: index === 1 || index === 2 ? "shared@example.test" : index > 12 ? `+31000000${index}` : `route${index}@example.test`,
			record: index <= 12 ? `player-${index}` : `lead-${index - 12}`,
		},
	});
}

for (let index = 1; index <= 10; index += 1) {
	rows.push({
		type: "representation",
		id: `representation-${index}`,
		data: {
			agent: `agent-${index === 2 ? 2 : ((index - 1) % 6) + 1}`,
			player: `player-${index === 2 ? 1 : ((index - 1) % 12) + 1}`,
			agency: `agency-${((index - 1) % 4) + 1}`,
			status: index % 4 === 0 ? "AMBIGUOUS" : "ACTIVE",
		},
	});
}

for (let index = 1; index <= 4; index += 1) {
	rows.push({ type: "shared_route_policy", id: `policy-${index}`, data: { route: `route-${index}`, policy: index === 1 ? "EXPLICIT_SHARED" : "OWNER_REVIEW" } });
}

for (let index = 1; index <= 8; index += 1) {
	rows.push({ type: "contact_log", id: `log-${index}`, data: { owner: owners[index % owners.length], subject: `player-${index}`, summary: `Synthetic contact log ${index}` } });
}

for (let index = 1; index <= 5; index += 1) {
	rows.push({ type: "task", id: `task-${index}`, data: { owner: owners[index % owners.length], subject: `lead-${index}`, title: `Synthetic task ${index}`, status: index === 5 ? "DONE" : "OPEN" } });
}

for (let index = 1; index <= 3; index += 1) {
	rows.push({ type: "template", id: `template-${index}`, data: { owner: owners[index % owners.length], name: `Template ${index}`, content: `Synthetic template content ${index}` } });
	rows.push({ type: "proof_item", id: `proof-${index}`, data: { subject: `player-${index}`, proofType: "PUBLIC_REFERENCE", reference: `fixture://proof/${index}` } });
}

for (let index = 1; index <= 4; index += 1) {
	rows.push({ type: "email_thread", id: `thread-${index}`, data: { owner: owners[index - 1], subject: index === 1 ? "Shared route introduction" : `Synthetic thread ${index}` } });
}

for (let index = 1; index <= 6; index += 1) {
	rows.push({
		type: "email_message",
		id: `message-${index}`,
		data: {
			thread: `thread-${index <= 2 ? 1 : Math.min(index - 1, 4)}`,
			messageId: `<synthetic-${index}@example.test>`,
			body: `Synthetic private message body ${index}`,
			direction: index % 2 === 0 ? "OUTBOUND" : "INBOUND",
		},
	});
}

if (rows.length !== 100) throw new Error(`fixture must contain exactly 100 records, found ${rows.length}`);

export const syntheticV1Rows = Object.freeze(rows);
