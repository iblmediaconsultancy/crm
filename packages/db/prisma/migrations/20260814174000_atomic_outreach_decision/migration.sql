-- Decide the approval, transition its draft, and append the audit record in one
-- server-side statement. This remains atomic even when the Prisma adapter uses
-- separate protocol operations inside an interactive transaction.
CREATE FUNCTION ibl_decide_outreach_approval(
  target_approval_id TEXT,
  target_status TEXT,
  target_reason TEXT,
  target_decided_at TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  current_user_id TEXT := ibl_current_user_id();
  approval_row "outreachApproval"%ROWTYPE;
  route_id TEXT;
BEGIN
  IF current_user_id IS NULL OR ibl_current_workspace_role() NOT IN ('admin', 'team') THEN
    RAISE EXCEPTION 'Only an active Team or Admin reviewer can decide outreach' USING ERRCODE = '42501';
  END IF;
  IF target_status NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'Unsupported outreach decision' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(BTRIM(target_reason), '') IS NULL THEN
    RAISE EXCEPTION 'An outreach decision reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO approval_row
  FROM "outreachApproval"
  WHERE "id" = target_approval_id
  FOR UPDATE;

  IF NOT FOUND OR approval_row."status" <> 'PENDING' OR approval_row."requestedById" = current_user_id THEN
    RAISE EXCEPTION 'The requester cannot decide this approval' USING ERRCODE = '42501';
  END IF;

  SELECT "recipientRouteId" INTO route_id FROM "draft" WHERE "id" = approval_row."draftId" FOR UPDATE;
  IF target_status = 'APPROVED' AND NOT ibl_route_allows_outreach(route_id) THEN
    RAISE EXCEPTION 'DNC or archive state prevents approval' USING ERRCODE = '42501';
  END IF;

  UPDATE "outreachApproval"
  SET "status" = target_status::"OutreachApprovalStatus",
      "decidedById" = current_user_id,
      "decidedAt" = target_decided_at,
      "decisionReason" = target_reason
  WHERE "id" = target_approval_id;

  UPDATE "draft"
  SET "status" = CASE WHEN target_status = 'APPROVED' THEN 'APPROVED'::"DraftStatus" ELSE 'REJECTED'::"DraftStatus" END,
      "approvedAt" = CASE WHEN target_status = 'APPROVED' THEN target_decided_at ELSE NULL END,
      "updatedAt" = target_decided_at
  WHERE "id" = approval_row."draftId";

  INSERT INTO "domainAuditEvent" (
    "id", "actorUserId", "action", "entityType", "entityId", "outcome", "requestId", "metadata", "createdAt"
  ) VALUES (
    gen_random_uuid()::text,
    current_user_id,
    'OUTREACH_APPROVAL_DECIDED',
    'DRAFT',
    approval_row."draftId",
    target_status,
    'approval-decision:' || target_approval_id,
    jsonb_build_object('reason', target_reason),
    target_decided_at
  );
END
$$;

REVOKE ALL ON FUNCTION ibl_decide_outreach_approval(TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_api') THEN
    GRANT EXECUTE ON FUNCTION ibl_decide_outreach_approval(TEXT, TEXT, TEXT, TIMESTAMPTZ) TO ibl_v2_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_app') THEN
    GRANT EXECUTE ON FUNCTION ibl_decide_outreach_approval(TEXT, TEXT, TEXT, TIMESTAMPTZ) TO ibl_v2_app;
  END IF;
END
$$;
