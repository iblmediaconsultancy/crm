SELECT
  current_user,
  session_user,
  rolsuper,
  rolcreatedb,
  rolcreaterole,
  rolbypassrls,
  rolreplication,
  rolcanlogin,
  rolconnlimit
FROM pg_catalog.pg_roles
WHERE rolname = current_user;

SELECT
  has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database_objects,
  has_database_privilege(current_user, current_database(), 'TEMP') AS inherited_temp_allowed,
  has_database_privilege('public'::name, current_database(), 'TEMP') AS public_temp_informational,
  has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public_objects,
  has_schema_privilege(current_user, 'auth', 'USAGE') AS can_use_auth_schema;

SELECT table_name, privilege_type
FROM information_schema.table_privileges
WHERE grantee = current_user
  AND privilege_type <> 'SELECT';

SELECT table_name, column_name, privilege_type
FROM information_schema.column_privileges
WHERE grantee = current_user
  AND privilege_type <> 'SELECT';

SELECT table_name, column_name
FROM information_schema.column_privileges
WHERE grantee = current_user
  AND privilege_type = 'SELECT'
  AND (
    column_name ~* '(^|_)(password|password_hash|encrypted_password|encrypted_secret|api_key|secret|session|token|oauth_token|access_token|refresh_token|iv|auth_tag|credential|credentials|encryption_key|encryption_material)(_|$)'
    OR (table_name = 'email_messages' AND column_name = 'provider_payload')
    OR (table_name = 'football_import_change_proposals' AND column_name IN ('incoming_record', 'current_record', 'field_differences'))
    OR (table_name IN ('football_import_external_refs', 'football_route_external_ids', 'football_source_records') AND column_name = 'raw_record')
  );

SELECT table_name, column_name
FROM (
  VALUES
    ('mailbox_credentials', 'encrypted_password'),
    ('mailbox_credentials', 'iv'),
    ('mailbox_credentials', 'auth_tag'),
    ('email_messages', 'provider_payload'),
    ('football_import_change_proposals', 'incoming_record'),
    ('football_import_change_proposals', 'current_record'),
    ('football_import_change_proposals', 'field_differences'),
    ('football_import_external_refs', 'raw_record'),
    ('football_route_external_ids', 'raw_record'),
    ('football_source_records', 'raw_record')
) AS denied(table_name, column_name)
WHERE has_column_privilege(
  current_user,
  format('public.%I', table_name),
  column_name,
  'SELECT'
);

SELECT
  n.nspname AS sequence_schema,
  c.relname AS sequence_name
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'S'
  AND (
    has_sequence_privilege(current_user, c.oid, 'USAGE')
    OR has_sequence_privilege(current_user, c.oid, 'SELECT')
    OR has_sequence_privilege(current_user, c.oid, 'UPDATE')
  );

SELECT
  current_setting('transaction_read_only') AS transaction_read_only,
  current_setting('row_security') AS row_security;

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_setting('transaction_read_only') AS transaction_read_only_in_transaction;
SELECT count(*) FROM public.templates;
SELECT id, name, channel, body, active FROM public.templates ORDER BY id LIMIT 1;
SELECT mailbox_id, updated_at FROM public.mailbox_credentials ORDER BY mailbox_id LIMIT 1;
ROLLBACK;

SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  r.rolbypassrls AS role_bypasses_rls
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_roles r ON r.rolname = current_user
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'f')
ORDER BY c.relname;
