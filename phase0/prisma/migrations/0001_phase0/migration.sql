CREATE SCHEMA IF NOT EXISTS phase0;

CREATE TABLE phase0.users (
  id uuid PRIMARY KEY,
  source_id text NOT NULL UNIQUE,
  name text NOT NULL,
  crm_role text NOT NULL,
  language text NOT NULL DEFAULT 'en',
  working_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  team_context jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE phase0.mailboxes (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES phase0.users(id),
  address text NOT NULL UNIQUE,
  display_name text NOT NULL,
  signature text NOT NULL
);

CREATE TABLE phase0.mailbox_grants (
  mailbox_id uuid NOT NULL REFERENCES phase0.mailboxes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES phase0.users(id) ON DELETE CASCADE,
  permission text NOT NULL CHECK (permission = 'READ'),
  PRIMARY KEY (mailbox_id, user_id)
);

CREATE TABLE phase0.email_threads (
  id uuid PRIMARY KEY,
  source_id text NOT NULL UNIQUE,
  mailbox_id uuid NOT NULL REFERENCES phase0.mailboxes(id),
  subject text NOT NULL
);

CREATE TABLE phase0.email_messages (
  id uuid PRIMARY KEY,
  source_id text NOT NULL UNIQUE,
  thread_id uuid NOT NULL REFERENCES phase0.email_threads(id) ON DELETE CASCADE,
  message_id text NOT NULL UNIQUE,
  body text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND'))
);

CREATE TABLE phase0.work_items (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  due_at timestamptz NOT NULL,
  priority integer NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  leased_until timestamptz,
  lease_owner text,
  completed_at timestamptz,
  failed_at timestamptz
);

CREATE TABLE phase0.crm_records (
  id uuid PRIMARY KEY,
  source_id text NOT NULL UNIQUE,
  kind text NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES phase0.users(id),
  name text NOT NULL,
  status text NOT NULL,
  agency_id uuid REFERENCES phase0.crm_records(id)
);

CREATE TABLE phase0.contact_routes (
  id uuid PRIMARY KEY,
  source_id text NOT NULL UNIQUE,
  owner_user_id uuid NOT NULL REFERENCES phase0.users(id),
  route_type text NOT NULL,
  route_value text NOT NULL,
  record_id uuid REFERENCES phase0.crm_records(id)
);

CREATE TABLE phase0.representations (
  id uuid PRIMARY KEY,
  source_id text NOT NULL UNIQUE,
  agent_id uuid NOT NULL REFERENCES phase0.crm_records(id),
  player_id uuid NOT NULL REFERENCES phase0.crm_records(id),
  agency_id uuid REFERENCES phase0.crm_records(id),
  status text NOT NULL
);

CREATE TABLE phase0.shared_route_policies (
  id uuid PRIMARY KEY,
  source_id text NOT NULL UNIQUE,
  route_id uuid NOT NULL REFERENCES phase0.contact_routes(id),
  policy text NOT NULL
);

CREATE TABLE phase0.contact_logs (
  id uuid PRIMARY KEY,
  source_id text NOT NULL UNIQUE,
  owner_user_id uuid NOT NULL REFERENCES phase0.users(id),
  subject_id uuid NOT NULL REFERENCES phase0.crm_records(id),
  summary text NOT NULL
);

CREATE TABLE phase0.crm_tasks (
  id uuid PRIMARY KEY,
  source_id text NOT NULL UNIQUE,
  owner_user_id uuid NOT NULL REFERENCES phase0.users(id),
  subject_id uuid NOT NULL REFERENCES phase0.crm_records(id),
  title text NOT NULL,
  status text NOT NULL
);

CREATE TABLE phase0.templates (
  id uuid PRIMARY KEY,
  source_id text NOT NULL UNIQUE,
  owner_user_id uuid NOT NULL REFERENCES phase0.users(id),
  name text NOT NULL,
  content text NOT NULL
);

CREATE TABLE phase0.proof_items (
  id uuid PRIMARY KEY,
  source_id text NOT NULL UNIQUE,
  subject_id uuid NOT NULL REFERENCES phase0.crm_records(id),
  proof_type text NOT NULL,
  reference text NOT NULL
);

CREATE TABLE phase0.migration_id_map (
  source_type text NOT NULL,
  source_id text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  outcome text NOT NULL,
  reason text,
  PRIMARY KEY (source_type, source_id)
);

CREATE TABLE phase0.duplicate_candidates (
  candidate_key text PRIMARY KEY,
  candidate_type text NOT NULL,
  source_ids text[] NOT NULL,
  reason text NOT NULL
);

CREATE TABLE phase0.agent_audit_events (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  principal_id text NOT NULL,
  requested_capability text NOT NULL,
  outcome text NOT NULL,
  reason text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_phase0_app') THEN
    CREATE ROLE ibl_phase0_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA phase0 TO ibl_phase0_app;
GRANT SELECT ON phase0.users, phase0.mailboxes, phase0.mailbox_grants, phase0.email_threads, phase0.email_messages TO ibl_phase0_app;
GRANT SELECT, INSERT, UPDATE ON phase0.work_items TO ibl_phase0_app;
GRANT INSERT, SELECT ON phase0.agent_audit_events TO ibl_phase0_app;

CREATE OR REPLACE FUNCTION phase0.can_read_mailbox(candidate uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = phase0, pg_temp
AS $$
  SELECT CASE current_setting('phase0.principal_type', true)
    WHEN 'worker' THEN candidate::text = current_setting('phase0.mailbox_id', true)
    WHEN 'user' THEN EXISTS (
      SELECT 1
      FROM phase0.mailboxes m
      WHERE m.id = candidate
        AND (
          m.owner_user_id::text = current_setting('phase0.user_id', true)
          OR EXISTS (
            SELECT 1 FROM phase0.mailbox_grants g
            WHERE g.mailbox_id = m.id
              AND g.user_id::text = current_setting('phase0.user_id', true)
              AND g.permission = 'READ'
          )
        )
    )
    ELSE false
  END
$$;

REVOKE ALL ON FUNCTION phase0.can_read_mailbox(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION phase0.can_read_mailbox(uuid) TO ibl_phase0_app;

ALTER TABLE phase0.mailboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE phase0.mailboxes FORCE ROW LEVEL SECURITY;
ALTER TABLE phase0.mailbox_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE phase0.mailbox_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE phase0.email_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE phase0.email_threads FORCE ROW LEVEL SECURITY;
ALTER TABLE phase0.email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE phase0.email_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY mailbox_read ON phase0.mailboxes FOR SELECT TO ibl_phase0_app USING (phase0.can_read_mailbox(id));
CREATE POLICY mailbox_grant_read ON phase0.mailbox_grants FOR SELECT TO ibl_phase0_app USING (phase0.can_read_mailbox(mailbox_id));
CREATE POLICY thread_read ON phase0.email_threads FOR SELECT TO ibl_phase0_app USING (phase0.can_read_mailbox(mailbox_id));
CREATE POLICY message_read ON phase0.email_messages FOR SELECT TO ibl_phase0_app USING (
  EXISTS (
    SELECT 1 FROM phase0.email_threads t
    WHERE t.id = thread_id AND phase0.can_read_mailbox(t.mailbox_id)
  )
);

CREATE INDEX work_items_claim_idx ON phase0.work_items (priority DESC, due_at ASC)
WHERE completed_at IS NULL AND failed_at IS NULL;
CREATE INDEX email_threads_mailbox_idx ON phase0.email_threads (mailbox_id);
CREATE INDEX email_messages_thread_idx ON phase0.email_messages (thread_id);
