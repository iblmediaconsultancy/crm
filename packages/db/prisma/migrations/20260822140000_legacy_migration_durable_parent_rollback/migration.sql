ALTER TABLE "legacyRollbackEntry"
  DROP CONSTRAINT IF EXISTS "legacyRollbackEntry_operation_check";

ALTER TABLE "legacyRollbackEntry"
  ADD CONSTRAINT "legacyRollbackEntry_operation_check"
  CHECK ("operation" IN ('DELETE_INSERTED_ROW', 'RESTORE_BEFORE_IMAGE', 'PRESERVE_APPEND_ONLY', 'PRESERVE_DURABLE_PARENT'));
