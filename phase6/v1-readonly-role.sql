SELECT
  has_schema_privilege('public'::name, 'public', 'CREATE') AS public_can_create_schema,
  has_database_privilege('public'::name, current_database(), 'CREATE') AS public_can_create_database_objects,
  has_database_privilege('public'::name, current_database(), 'TEMP') AS public_can_create_temp_informational;

SELECT
  n.nspname AS schema_name,
  c.relname AS table_name
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'f')
  AND has_table_privilege('public'::name, c.oid, 'SELECT')
ORDER BY n.nspname, c.relname;

SELECT
  has_schema_privilege('public'::name, 'auth', 'USAGE') AS public_can_use_auth_schema;

SELECT
  n.nspname AS schema_name,
  c.relname AS table_name
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'auth'
  AND c.relkind IN ('r', 'p', 'f')
  AND has_table_privilege('public'::name, c.oid, 'SELECT')
ORDER BY n.nspname, c.relname;

SELECT
  n.nspname AS schema_name,
  c.relname AS sequence_name
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'S'
  AND (
    has_sequence_privilege('public'::name, c.oid, 'USAGE')
    OR has_sequence_privilege('public'::name, c.oid, 'SELECT')
    OR has_sequence_privilege('public'::name, c.oid, 'UPDATE')
  )
ORDER BY n.nspname, c.relname;

SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  'PUBLIC_EXECUTABLE_USER_DEFINED_FUNCTION' AS risk
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND has_schema_privilege('public'::name, n.oid, 'USAGE')
  AND has_function_privilege('public'::name, p.oid, 'EXECUTE')
ORDER BY n.nspname, p.proname;

DO $$
BEGIN
  IF has_schema_privilege('public'::name, 'public', 'CREATE')
    OR has_database_privilege('public'::name, current_database(), 'CREATE')
  THEN
    RAISE EXCEPTION 'PUBLIC has a dangerous database or schema privilege; no role was created';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'f')
      AND has_table_privilege('public'::name, c.oid, 'SELECT')
  )
  THEN
    RAISE EXCEPTION 'PUBLIC has SELECT on a public table; no role was created';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'f')
      AND (
        has_table_privilege('public'::name, c.oid, 'INSERT')
        OR has_table_privilege('public'::name, c.oid, 'UPDATE')
        OR has_table_privilege('public'::name, c.oid, 'DELETE')
        OR has_table_privilege('public'::name, c.oid, 'TRUNCATE')
        OR has_table_privilege('public'::name, c.oid, 'REFERENCES')
        OR has_table_privilege('public'::name, c.oid, 'TRIGGER')
      )
  )
  THEN
    RAISE EXCEPTION 'PUBLIC has a write privilege on a public table; no role was created';
  END IF;

  IF has_schema_privilege('public'::name, 'auth', 'USAGE') THEN
    RAISE EXCEPTION 'PUBLIC can use the auth schema; no role was created';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth'
      AND c.relkind IN ('r', 'p', 'f')
      AND has_table_privilege('public'::name, c.oid, 'SELECT')
  )
  THEN
    RAISE EXCEPTION 'PUBLIC can SELECT from an auth table; no role was created';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND (
        has_sequence_privilege('public'::name, c.oid, 'USAGE')
        OR has_sequence_privilege('public'::name, c.oid, 'SELECT')
        OR has_sequence_privilege('public'::name, c.oid, 'UPDATE')
      )
  )
  THEN
    RAISE EXCEPTION 'PUBLIC has sequence privileges; no role was created';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND has_schema_privilege('public'::name, n.oid, 'USAGE')
      AND has_function_privilege('public'::name, p.oid, 'EXECUTE')
  )
  THEN
    RAISE EXCEPTION 'PUBLIC can execute a user-defined function; review the function before creating the role';
  END IF;
END $$;

CREATE ROLE ibl_v1_migration_exporter
  WITH LOGIN
  PASSWORD '<REPLACE_WITH_A_RANDOM_PASSWORD_LOCALLY>'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS
  CONNECTION LIMIT 1;

REVOKE ALL PRIVILEGES ON DATABASE postgres FROM ibl_v1_migration_exporter;
GRANT CONNECT ON DATABASE postgres TO ibl_v1_migration_exporter;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM ibl_v1_migration_exporter;
GRANT USAGE ON SCHEMA public TO ibl_v1_migration_exporter;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ibl_v1_migration_exporter;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ibl_v1_migration_exporter;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM ibl_v1_migration_exporter;
REVOKE ALL PRIVILEGES ON SCHEMA auth FROM ibl_v1_migration_exporter;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth FROM ibl_v1_migration_exporter;
REVOKE ALL PRIVILEGES ON SCHEMA supabase_migrations FROM ibl_v1_migration_exporter;
REVOKE ALL PRIVILEGES ON TABLE supabase_migrations.schema_migrations FROM ibl_v1_migration_exporter;
GRANT USAGE ON SCHEMA supabase_migrations TO ibl_v1_migration_exporter;
GRANT SELECT (version) ON TABLE supabase_migrations.schema_migrations TO ibl_v1_migration_exporter;
ALTER ROLE ibl_v1_migration_exporter SET default_transaction_read_only = on;
ALTER ROLE ibl_v1_migration_exporter SET search_path = pg_catalog, public;

GRANT SELECT ("id", "proposal_id", "item_type", "target_type", "target_id", "target_updated_at_snapshot", "current_value", "proposed_value", "edited_value", "explanation", "confidence", "status", "reviewed_by", "reviewed_at", "applied_at", "failure_reason", "application_idempotency_key", "applied_entity_type", "applied_entity_id", "sort_order", "created_at", "updated_at") ON TABLE public.ai_proposal_items TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "workflow_type", "provider", "model", "created_by", "lead_id", "task_id", "email_message_id", "email_thread_id", "research_request_id", "target_type", "target_id", "target_updated_at_snapshot", "source_summary", "context_snapshot", "explanation", "confidence", "status", "reviewed_by", "reviewed_at", "applied_at", "failure_reason", "idempotency_key", "expires_at", "created_at", "updated_at") ON TABLE public.ai_proposals TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "canonical_entity_id", "reason", "note", "active", "created_by", "lifted_by", "lifted_at", "created_at", "updated_at") ON TABLE public.allocation_entity_exclusions TO ibl_v1_migration_exporter;
GRANT SELECT ("id") ON TABLE public.analytics_events TO ibl_v1_migration_exporter;
GRANT SELECT ("capability") ON TABLE public.app_schema_capabilities TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "actor_id", "action", "entity_type", "entity_id", "details", "created_at") ON TABLE public.audit_logs TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "lead_id", "created_by", "title", "description", "location", "starts_at", "ends_at", "timezone", "attendees", "ics_uid", "ics_text", "created_at") ON TABLE public.calendar_invite_helpers TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "lead_id", "actor_id", "contacted_person", "method", "direction", "occurred_at", "summary", "message_text", "outcome", "next_action", "follow_up_at", "created_at", "updated_at") ON TABLE public.contact_logs TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "lead_id", "route_type", "value", "contact_person", "contact_role", "quality", "is_primary", "notes", "created_at", "updated_at", "football_contact_route_id") ON TABLE public.contact_routes TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "lead_id", "contact_route_id", "checked_by", "route_value", "channel", "status", "reasons", "checked_at", "metadata") ON TABLE public.contact_safety_checks TO ibl_v1_migration_exporter;
GRANT SELECT ("id") ON TABLE public.dashboard_metric_snapshots TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "group_id", "pair_id", "entity_table", "entity_id", "display_name", "normalized_name", "normalized_route", "match_reasons", "score", "metadata", "created_at") ON TABLE public.duplicate_candidates TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "source_table", "operation", "record_id", "row_data", "previous_data", "changed_at") ON TABLE public.duplicate_change_log TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "left_entity_table", "left_entity_id", "right_entity_table", "right_entity_id", "pair_key", "pair_type", "status", "confidence", "match_reasons", "exact_reasons", "possible_reasons", "fuzzy_signals", "shared_route_warning", "active_pipeline_conflict", "explanation", "first_seen_job_id", "last_seen_job_id", "last_detected_at", "closed_at", "assigned_to", "reviewed_by", "reviewed_at", "resolution_note", "created_at", "updated_at") ON TABLE public.duplicate_entity_pairs TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "group_key", "group_type", "status", "confidence", "explanation", "canonical_entity_table", "canonical_entity_id", "reviewed_by", "reviewed_at", "created_by_job_id", "created_at", "updated_at") ON TABLE public.duplicate_groups TO ibl_v1_migration_exporter;
GRANT SELECT ("id") ON TABLE public.duplicate_jobs TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "pair_id", "survivor_table", "survivor_id", "merged_table", "merged_id", "selected_fields", "aliases_preserved", "sources_preserved", "routes_preserved", "relationships_preserved", "outreach_cycles_preserved", "lead_history_preserved", "blocked_by_active_cycles", "merged_by", "created_at") ON TABLE public.duplicate_merge_audit TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "pair_id", "actor_id", "previous_status", "new_status", "resolution_note", "metadata", "created_at") ON TABLE public.duplicate_review_audit TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "pair_id", "actor_id", "comment", "created_at") ON TABLE public.duplicate_review_comments TO ibl_v1_migration_exporter;
GRANT SELECT ("singleton") ON TABLE public.duplicate_scan_state TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "email_message_id", "file_name", "content_type", "size_bytes", "storage_path", "external_id", "disposition", "saved_to_crm", "created_at") ON TABLE public.email_attachments TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "email_message_id", "provider", "provider_event_id", "event_type", "event_timestamp", "payload", "created_at") ON TABLE public.email_events TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "mailbox_id", "thread_id", "lead_id", "contact_route_id", "created_by", "direction", "folder", "imap_uid", "uidvalidity", "message_id", "in_reply_to", "reference_ids", "thread_key", "resend_email_id", "from_email", "from_name", "to_emails", "cc_emails", "bcc_emails", "subject", "text_body", "html_body", "snippet", "sent_at", "received_at", "sync_source", "crm_state", "delivery_status", "first_opened_at", "last_opened_at", "open_count", "first_clicked_at", "last_clicked_at", "click_count", "bounced_at", "complained_at", "created_at", "updated_at", "imap_append_folder", "imap_append_status", "imap_append_error", "imap_append_attempts", "imap_appended_at", "imap_append_last_attempt_at", "read_at", "ignored_at", "ignored_by", "ignore_reason", "matched_by", "matched_at", "send_idempotency_key") ON TABLE public.email_messages TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "thread_key", "mailbox_id", "lead_id", "subject", "participants", "first_message_at", "last_message_at", "created_at", "updated_at") ON TABLE public.email_threads TO ibl_v1_migration_exporter;
GRANT SELECT ("id") ON TABLE public.entity_fingerprints TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "external_id", "route_type", "route_value", "normalized_value", "label_verification", "source_url", "last_verified", "source_rank", "last_import_batch_id", "created_at", "updated_at", "created_import_batch_id") ON TABLE public.football_contact_routes TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "entity_kind", "external_id", "display_name", "normalized_name", "country_region", "active", "archived_at", "merged_into", "last_verified", "provenance", "source_rank", "last_import_batch_id", "created_at", "updated_at", "created_import_batch_id") ON TABLE public.football_entities TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "entity_id", "alias", "normalized_alias", "source", "created_at", "created_import_batch_id") ON TABLE public.football_entity_aliases TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "external_id", "entity_id", "contact_route_id", "use_label", "source_rank", "last_import_batch_id", "created_at", "updated_at", "created_import_batch_id") ON TABLE public.football_entity_contact_routes TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "entity_id", "field_name", "field_value", "source_kind", "source_rank", "source_url", "verified_at", "batch_id", "created_by", "created_at", "created_import_batch_id") ON TABLE public.football_field_provenance TO ibl_v1_migration_exporter;
GRANT SELECT ("id") ON TABLE public.football_import_batches TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "batch_id", "target_table", "target_row_id", "canonical_entity_id", "workbook_sheet", "workbook_external_id", "reason", "proposed_source_rank", "status", "reviewed_by", "reviewed_at", "created_import_batch_id", "created_at") ON TABLE public.football_import_change_proposals TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "object_type", "external_id", "target_row_id", "source_sheet", "created_import_batch_id", "created_at") ON TABLE public.football_import_external_refs TO ibl_v1_migration_exporter;
GRANT SELECT ("id") ON TABLE public.football_import_ledger TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "entity_id", "lead_id", "linked_by", "link_reason", "created_at") ON TABLE public.football_lead_links TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "survivor_entity_id", "merged_entity_id", "merged_by", "merge_reason", "survivor_snapshot", "merged_snapshot", "created_at") ON TABLE public.football_merge_history TO ibl_v1_migration_exporter;
GRANT SELECT ("entity_id", "organization_type", "portfolio", "website", "instagram", "linkedin", "source_url", "notes", "updated_at", "created_import_batch_id") ON TABLE public.football_organization_details TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "entity_id", "lead_id", "owner_id", "cycle_status", "started_at", "ended_at", "created_at") ON TABLE public.football_outreach_cycles TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "source_entity_id", "canonical_entity_id", "lead_type", "lead_name", "country_national_team", "opportunity", "best_public_routes", "readiness", "recommended_approach", "source_url", "linked_lead_id", "queue_status", "last_import_batch_id", "created_at", "updated_at", "created_import_batch_id") ON TABLE public.football_outreach_queue TO ibl_v1_migration_exporter;
GRANT SELECT ("entity_id", "role_title", "agency_relationships", "linkedin", "instagram", "source_url", "notes", "updated_at", "created_import_batch_id") ON TABLE public.football_person_details TO ibl_v1_migration_exporter;
GRANT SELECT ("entity_id", "position", "national_team", "club", "club_listed", "contact_research_status", "legitimate_access_route", "agent_management_search_query", "club_federation_contact_search_query", "official_social_search_query", "source_url", "notes", "updated_at", "created_import_batch_id") ON TABLE public.football_player_details TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "entity_id", "queue_ids", "lead_id", "lead_link_id", "owner_id", "assigned_to", "football_route_ids", "lead_route_ids", "candidate_ids", "relationship_bundle_ids", "outreach_cycle_id", "action_type", "promotion_reason", "actor_id", "idempotency_key", "previous_state", "resulting_state", "created_at") ON TABLE public.football_promotion_audit TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "external_id", "relationship_type", "from_entity_id", "to_entity_id", "role_context", "source_url", "last_import_batch_id", "created_at", "updated_at", "created_import_batch_id") ON TABLE public.football_relationships TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "contact_route_id", "external_id", "source_sheet", "last_import_batch_id", "created_at", "updated_at", "created_import_batch_id") ON TABLE public.football_route_external_ids TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "contact_route_id", "route_type", "route_value", "entity_count", "linked_entities", "outreach_rule", "conflict_severity", "last_import_batch_id", "created_at", "updated_at", "created_import_batch_id") ON TABLE public.football_shared_contact_routes TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "entity_id", "batch_id", "source_sheet", "external_id", "source_url", "imported_at", "created_import_batch_id") ON TABLE public.football_source_records TO ibl_v1_migration_exporter;
GRANT SELECT ("id") ON TABLE public.imports TO ibl_v1_migration_exporter;
GRANT SELECT ("id") ON TABLE public.in_app_notifications TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "lead_id", "actor_id", "activity_type", "title", "result", "next_action", "metadata", "occurred_at", "created_at") ON TABLE public.lead_activity_events TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "run_type", "status", "release_date", "summary", "created_by", "committed_by", "committed_at", "expires_at", "error", "created_at") ON TABLE public.lead_allocation_runs TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "lead_id", "football_queue_id", "canonical_entity_id", "scored_for_user_id", "candidate_name", "candidate_type", "source_entity_id", "readiness", "market", "opportunity", "readiness_score", "user_fit_score", "final_allocation_score", "score_breakdown", "eligibility_blocks", "duplicate_pair_id", "relationship_bundle_id", "allocation_status", "reserved_by_run_id", "reserved_for", "reserved_at", "created_by_run_id", "created_at", "updated_at") ON TABLE public.lead_candidate_scores TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "flag_id", "pair_id", "pack_item_id", "candidate_score_id", "canonical_entity_id", "suspected_entity_id", "previous_status", "new_status", "action", "reason", "note", "actor_id", "idempotency_key", "reopened_from_status", "metadata", "created_at") ON TABLE public.lead_pack_duplicate_flag_audit TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "pack_item_id", "candidate_score_id", "canonical_entity_id", "suspected_entity_id", "duplicate_pair_id", "status", "resolution", "resolution_reason", "resolution_note", "recovery_blocks", "note", "created_by", "resolved_by", "resolved_at", "created_at", "updated_at") ON TABLE public.lead_pack_duplicate_flags TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "pack_item_id", "actor_id", "action", "reason", "note", "suggested_owner_id", "created_lead_id", "research_request_id", "duplicate_pair_id", "duplicate_flag_id", "previous_status", "resulting_status", "idempotency_key", "review_status", "reviewed_by", "reviewed_at", "review_note", "metadata", "created_at") ON TABLE public.lead_pack_item_actions TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "pack_id", "lead_id", "candidate_score_id", "canonical_entity_id", "relationship_bundle_id", "source_entity_id", "title", "recommended_route", "recommended_approach", "readiness_score", "user_fit_score", "final_allocation_score", "status", "action_reason", "action_note", "action_type", "sort_order", "accepted_lead_id", "suggested_owner_id", "research_request_id", "duplicate_pair_id", "duplicate_flag_id", "acted_by", "acted_at", "reassigned_from_pack_id", "created_at") ON TABLE public.lead_pack_items TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "assigned_to", "allocation_run_id", "pack_date", "status", "title", "summary", "expires_at", "created_by", "released_at", "total_item_count", "pending_item_count", "completed_item_count", "expired_item_count", "created_at", "updated_at") ON TABLE public.lead_packs TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "name", "lead_type", "organization", "country", "market", "priority", "status", "owner_id", "assigned_to", "source", "tags", "notes", "last_contact_at", "next_follow_up_at", "created_at", "updated_at") ON TABLE public.leads TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "user_id", "email", "display_name", "signature", "status", "approved_by", "last_successful_sync_at", "last_error", "last_test_at", "sync_lock_at", "sync_cursor", "created_at", "updated_at", "last_attempted_sync_at") ON TABLE public.mailbox_connections TO ibl_v1_migration_exporter;
GRANT SELECT ("mailbox_id", "updated_at") ON TABLE public.mailbox_credentials TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "mailbox_id", "user_id", "status", "started_at", "finished_at", "folders", "imported_count", "matched_count", "unmatched_count", "error", "skipped_count", "failed_count") ON TABLE public.mailbox_sync_runs TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "lead_id", "route_id", "created_by", "channel", "intent", "body", "phone_script", "safety_state", "safety_reasons", "copied_at", "completed_at", "metadata", "created_at", "updated_at") ON TABLE public.manual_communication_drafts TO ibl_v1_migration_exporter;
GRANT SELECT ("user_id", "mailbox_sync_failures", "new_matched_replies", "duplicate_reviews", "lead_pack_releases", "research_reviews", "daily_digest_time", "quiet_hours_start", "quiet_hours_end", "updated_at") ON TABLE public.notification_preferences TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "lead_id", "created_by", "call_direction", "script_used", "outcome", "next_action", "follow_up_at", "created_contact_log_id", "created_at") ON TABLE public.phone_call_notes TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "email", "full_name", "role", "active", "created_at", "updated_at") ON TABLE public.profiles TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "title", "category", "file_url", "external_url", "notes", "tags", "active", "created_at", "updated_at", "description", "proof_type", "player_or_client", "campaign", "service_category", "language", "country_market", "source_url", "storage_bucket", "file_path", "thumbnail_path", "approved_claim", "supporting_evidence", "usage_notes", "internal_notes", "approval_status", "approved_by", "approved_at", "created_by", "usage_rights_status", "rights_expires_at", "archived_at", "embedding_provider", "embedding_model", "embedding_version", "embedding_updated_at") ON TABLE public.proof_items TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "bundle_key", "bundle_type", "title", "route_id", "entity_ids", "lead_ids", "owned_by", "recommended_rule", "status", "created_at", "updated_at") ON TABLE public.relationship_bundles TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "lead_id", "pasted_reply", "classification", "suggested_status", "suggested_next_action", "suggested_reply", "created_by", "created_at", "classification_label", "recommended_follow_up_at", "confidence", "explanation", "applied_to_lead") ON TABLE public.reply_classifications TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "request_id", "lead_id", "field_name", "proposed_value", "source_url", "source_title", "publisher_domain", "evidence_summary", "accessed_at", "confidence", "verification_status", "provider", "researcher_id", "notes", "is_official_source", "approval_state", "approved_by", "approved_at", "applied_at", "created_at", "updated_at", "canonical_entity_id") ON TABLE public.research_findings TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "lead_id", "objective", "requested_fields", "requested_by", "status", "priority", "assigned_to", "lead_updated_at_snapshot", "notes", "completed_at", "created_at", "updated_at", "canonical_entity_id", "candidate_score_id", "lead_pack_item_id", "issue_key") ON TABLE public.research_requests TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "user_id", "lead_id", "output_type", "provider", "model", "prompt_summary", "output", "created_at") ON TABLE public.saved_ai_outputs TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "lead_id", "email_message_id", "created_by", "subject", "body", "channel", "to_emails", "cc_emails", "bcc_emails", "status", "ai_generated", "metadata", "created_at", "updated_at", "imap_append_folder", "imap_append_status", "imap_append_error", "imap_append_attempts", "imap_appended_at", "imap_append_last_attempt_at", "imap_cleanup_status", "imap_cleanup_error", "imap_cleanup_attempts", "imap_cleanup_last_attempt_at", "imap_cleaned_up_at") ON TABLE public.saved_email_drafts TO ibl_v1_migration_exporter;
GRANT SELECT ("id") ON TABLE public.saved_searches TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "lead_id", "title", "description", "assigned_to", "created_by", "task_type", "priority", "status", "due_at", "completed_at", "created_at", "updated_at") ON TABLE public.tasks TO ibl_v1_migration_exporter;
GRANT SELECT ("id", "name", "channel", "lead_type", "stage", "language", "body", "active", "created_at", "updated_at") ON TABLE public.templates TO ibl_v1_migration_exporter;
GRANT SELECT ("user_id", "timezone", "working_days", "work_start_time", "work_end_time", "default_follow_up_time", "allocation_release_time", "primary_markets", "secondary_markets", "learning_markets", "excluded_markets", "language_proficiencies", "preferred_lead_types", "preferred_player_levels", "channel_strengths", "accepts_research_needed_leads", "daily_quota", "weekly_quota", "maximum_active_leads", "capacity_state", "absence_starts_at", "absence_ends_at", "auto_allocation_enabled", "core_market_mix", "adjacent_market_mix", "learning_market_mix", "admin_notes", "professional_notes", "created_at", "updated_at") ON TABLE public.user_work_preferences TO ibl_v1_migration_exporter;
