CREATE FUNCTION ibl_reject_financial_event_change() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD."actorUserId" IS NOT NULL
    AND NEW."actorUserId" IS NULL
    AND OLD."id" = NEW."id"
    AND OLD."financialProfileId" = NEW."financialProfileId"
    AND OLD."type" = NEW."type"
    AND OLD."occurredAt" = NEW."occurredAt"
    AND OLD."payload" IS NOT DISTINCT FROM NEW."payload"
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'financialEvent is append-only' USING ERRCODE = '55000';
END
$$;

DROP TRIGGER financial_event_immutable ON "financialEvent";
CREATE TRIGGER financial_event_immutable
  BEFORE UPDATE OR DELETE ON "financialEvent"
  FOR EACH ROW EXECUTE FUNCTION ibl_reject_financial_event_change();
