-- CreateEnum
CREATE TYPE "RepresentationStatus" AS ENUM ('PENDING', 'ACTIVE', 'FORMER', 'DISPUTED');

-- CreateEnum
CREATE TYPE "ContactRouteType" AS ENUM ('EMAIL', 'PHONE', 'WHATSAPP', 'LINKEDIN', 'SOCIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactRouteVisibility" AS ENUM ('PRIVATE', 'SHARED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'QUALIFIED', 'NURTURING', 'CONVERTED', 'DISQUALIFIED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PipelineStageKind" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "OperationalTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OperationalTaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('EMAIL', 'PROPOSAL', 'RESEARCH', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'QUEUED', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ACCEPTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "OutreachApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "DomainEntityType" AS ENUM ('COMPANY', 'CONTACT', 'PLAYER', 'FOOTBALL_AGENT', 'AGENCY', 'CLUB', 'REPRESENTATION', 'LEAD', 'DEAL', 'TASK', 'NOTE', 'PROOF_ITEM', 'TEMPLATE', 'DRAFT', 'PROPOSAL', 'OUTREACH', 'RESEARCH_REQUEST');

-- CreateEnum
CREATE TYPE "EvidenceSourceKind" AS ENUM ('PUBLIC_URL', 'DOCUMENT', 'MAILBOX_MESSAGE', 'MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "DuplicateCandidateStatus" AS ENUM ('OPEN', 'NOT_DUPLICATE', 'MERGE_APPROVED', 'MERGED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "MergeDecisionStatus" AS ENUM ('APPROVED', 'APPLIED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ResearchRequestStatus" AS ENUM ('QUEUED', 'RUNNING', 'NEEDS_REVIEW', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResearchFindingStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'DISMISSED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "deal" ADD COLUMN     "pipelineStageId" TEXT;

-- CreateTable
CREATE TABLE "footballPlayer" (
    "contactId" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "nationality" TEXT,
    "position" TEXT,
    "preferredFoot" TEXT,
    "currentClubId" TEXT,
    "contractEndsAt" TIMESTAMP(3),
    "marketValue" DECIMAL(14,2),
    "marketCurrency" TEXT,
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "footballPlayer_pkey" PRIMARY KEY ("contactId")
);

-- CreateTable
CREATE TABLE "footballAgent" (
    "contactId" TEXT NOT NULL,
    "agencyId" TEXT,
    "licenseNumber" TEXT,
    "licenseCountry" TEXT,
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "footballAgent_pkey" PRIMARY KEY ("contactId")
);

-- CreateTable
CREATE TABLE "agency" (
    "companyId" TEXT NOT NULL,
    "registrationId" TEXT,
    "jurisdiction" TEXT,
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "club" (
    "companyId" TEXT NOT NULL,
    "association" TEXT,
    "league" TEXT,
    "countryCode" TEXT,
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "contactRoute" (
    "id" TEXT NOT NULL,
    "contactId" TEXT,
    "companyId" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "type" "ContactRouteType" NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "label" TEXT,
    "visibility" "ContactRouteVisibility" NOT NULL DEFAULT 'PRIVATE',
    "verifiedAt" TIMESTAMP(3),
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contactRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sharedRoutePolicy" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "granteeContactId" TEXT,
    "granteeCompanyId" TEXT,
    "useForResearch" BOOLEAN NOT NULL DEFAULT true,
    "useForOutreach" BOOLEAN NOT NULL DEFAULT false,
    "approvedByUserId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "sharedRoutePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "representation" (
    "id" TEXT NOT NULL,
    "playerContactId" TEXT NOT NULL,
    "agentContactId" TEXT NOT NULL,
    "agencyCompanyId" TEXT,
    "status" "RepresentationStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "sourceKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "representation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "representationHistory" (
    "id" TEXT NOT NULL,
    "representationId" TEXT NOT NULL,
    "fromStatus" "RepresentationStatus",
    "toStatus" "RepresentationStatus" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "representationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipelineStage" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PipelineStageKind" NOT NULL DEFAULT 'OPEN',
    "position" INTEGER NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "contactId" TEXT,
    "companyId" TEXT,
    "dealId" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "source" "RecordSource" NOT NULL DEFAULT 'MANUAL',
    "sourceKey" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "disqualifiedAt" TIMESTAMP(3),
    "disqualifyReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operationalTask" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "OperationalTaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "OperationalTaskPriority" NOT NULL DEFAULT 'NORMAL',
    "assigneeUserId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "leadId" TEXT,
    "dealId" TEXT,
    "dueAt" TIMESTAMP(3),
    "reminderAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operationalTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "leadId" TEXT,
    "dealId" TEXT,
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidenceSource" (
    "id" TEXT NOT NULL,
    "kind" "EvidenceSourceKind" NOT NULL,
    "locator" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "title" TEXT,
    "capturedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "mailboxId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidenceSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proofItem" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "proofType" TEXT NOT NULL,
    "reference" TEXT,
    "companyId" TEXT,
    "contactId" TEXT,
    "leadId" TEXT,
    "dealId" TEXT,
    "evidenceSourceId" TEXT,
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proofItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TemplateKind" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ownerUserId" TEXT,
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "mailboxId" TEXT,
    "recipientRouteId" TEXT,
    "templateId" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'DRAFT',
    "idempotencyKey" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "content" JSONB NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerUserId" TEXT NOT NULL,
    "leadId" TEXT,
    "dealId" TEXT,
    "draftId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposalItem" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(14,2),
    "unitAmount" DECIMAL(14,2),
    "currency" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "proposalItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreachApproval" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "status" "OutreachApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "outreachApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment" (
    "id" TEXT NOT NULL,
    "entityType" "DomainEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "assigneeUserId" TEXT NOT NULL,
    "assignedByUserId" TEXT NOT NULL,
    "reason" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lifecycleEvent" (
    "id" TEXT NOT NULL,
    "entityType" "DomainEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "idempotencyKey" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicateCandidate" (
    "id" TEXT NOT NULL,
    "entityType" "DomainEntityType" NOT NULL,
    "leftEntityId" TEXT NOT NULL,
    "rightEntityId" TEXT NOT NULL,
    "score" DECIMAL(5,4) NOT NULL,
    "reasons" JSONB NOT NULL,
    "status" "DuplicateCandidateStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "duplicateCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mergeDecision" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "survivorEntityId" TEXT NOT NULL,
    "duplicateEntityId" TEXT NOT NULL,
    "status" "MergeDecisionStatus" NOT NULL DEFAULT 'APPROVED',
    "decidedByUserId" TEXT NOT NULL,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),

    CONSTRAINT "mergeDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "researchRequest" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "mailboxId" TEXT,
    "targetType" "DomainEntityType" NOT NULL,
    "targetEntityId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" "ResearchRequestStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "researchRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "researchFinding" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "evidenceSourceId" TEXT NOT NULL,
    "field" TEXT,
    "summary" TEXT NOT NULL,
    "value" JSONB,
    "confidence" DECIMAL(5,4) NOT NULL,
    "status" "ResearchFindingStatus" NOT NULL DEFAULT 'PROPOSED',
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "researchFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domainAuditEvent" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" "DomainEntityType" NOT NULL,
    "entityId" TEXT,
    "outcome" TEXT NOT NULL,
    "requestId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domainAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "footballPlayer_sourceKey_key" ON "footballPlayer"("sourceKey");

-- CreateIndex
CREATE INDEX "footballPlayer_currentClubId_idx" ON "footballPlayer"("currentClubId");

-- CreateIndex
CREATE INDEX "footballPlayer_nationality_idx" ON "footballPlayer"("nationality");

-- CreateIndex
CREATE UNIQUE INDEX "footballAgent_sourceKey_key" ON "footballAgent"("sourceKey");

-- CreateIndex
CREATE INDEX "footballAgent_agencyId_idx" ON "footballAgent"("agencyId");

-- CreateIndex
CREATE INDEX "footballAgent_licenseNumber_idx" ON "footballAgent"("licenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "agency_sourceKey_key" ON "agency"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "club_sourceKey_key" ON "club"("sourceKey");

-- CreateIndex
CREATE INDEX "club_association_league_idx" ON "club"("association", "league");

-- CreateIndex
CREATE UNIQUE INDEX "contactRoute_sourceKey_key" ON "contactRoute"("sourceKey");

-- CreateIndex
CREATE INDEX "contactRoute_contactId_idx" ON "contactRoute"("contactId");

-- CreateIndex
CREATE INDEX "contactRoute_companyId_idx" ON "contactRoute"("companyId");

-- CreateIndex
CREATE INDEX "contactRoute_ownerUserId_idx" ON "contactRoute"("ownerUserId");

-- CreateIndex
CREATE INDEX "contactRoute_type_normalizedValue_idx" ON "contactRoute"("type", "normalizedValue");

-- CreateIndex
CREATE INDEX "sharedRoutePolicy_routeId_revokedAt_idx" ON "sharedRoutePolicy"("routeId", "revokedAt");

-- CreateIndex
CREATE INDEX "sharedRoutePolicy_granteeContactId_idx" ON "sharedRoutePolicy"("granteeContactId");

-- CreateIndex
CREATE INDEX "sharedRoutePolicy_granteeCompanyId_idx" ON "sharedRoutePolicy"("granteeCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "representation_sourceKey_key" ON "representation"("sourceKey");

-- CreateIndex
CREATE INDEX "representation_playerContactId_status_idx" ON "representation"("playerContactId", "status");

-- CreateIndex
CREATE INDEX "representation_agentContactId_status_idx" ON "representation"("agentContactId", "status");

-- CreateIndex
CREATE INDEX "representation_agencyCompanyId_idx" ON "representation"("agencyCompanyId");

-- CreateIndex
CREATE INDEX "representation_createdByUserId_idx" ON "representation"("createdByUserId");

-- CreateIndex
CREATE INDEX "representationHistory_representationId_occurredAt_idx" ON "representationHistory"("representationId", "occurredAt");

-- CreateIndex
CREATE INDEX "representationHistory_actorUserId_occurredAt_idx" ON "representationHistory"("actorUserId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "pipelineStage_key_key" ON "pipelineStage"("key");

-- CreateIndex
CREATE INDEX "pipelineStage_kind_active_idx" ON "pipelineStage"("kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "pipelineStage_position_key" ON "pipelineStage"("position");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sourceKey_key" ON "lead"("sourceKey");

-- CreateIndex
CREATE INDEX "lead_ownerUserId_status_idx" ON "lead"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "lead_contactId_idx" ON "lead"("contactId");

-- CreateIndex
CREATE INDEX "lead_companyId_idx" ON "lead"("companyId");

-- CreateIndex
CREATE INDEX "lead_dealId_idx" ON "lead"("dealId");

-- CreateIndex
CREATE INDEX "lead_nextActionAt_idx" ON "lead"("nextActionAt");

-- CreateIndex
CREATE UNIQUE INDEX "operationalTask_idempotencyKey_key" ON "operationalTask"("idempotencyKey");

-- CreateIndex
CREATE INDEX "operationalTask_assigneeUserId_status_dueAt_idx" ON "operationalTask"("assigneeUserId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "operationalTask_createdByUserId_idx" ON "operationalTask"("createdByUserId");

-- CreateIndex
CREATE INDEX "operationalTask_companyId_idx" ON "operationalTask"("companyId");

-- CreateIndex
CREATE INDEX "operationalTask_contactId_idx" ON "operationalTask"("contactId");

-- CreateIndex
CREATE INDEX "operationalTask_leadId_idx" ON "operationalTask"("leadId");

-- CreateIndex
CREATE INDEX "operationalTask_dealId_idx" ON "operationalTask"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "note_sourceKey_key" ON "note"("sourceKey");

-- CreateIndex
CREATE INDEX "note_authorUserId_createdAt_idx" ON "note"("authorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "note_companyId_idx" ON "note"("companyId");

-- CreateIndex
CREATE INDEX "note_contactId_idx" ON "note"("contactId");

-- CreateIndex
CREATE INDEX "note_leadId_idx" ON "note"("leadId");

-- CreateIndex
CREATE INDEX "note_dealId_idx" ON "note"("dealId");

-- CreateIndex
CREATE INDEX "evidenceSource_createdByUserId_createdAt_idx" ON "evidenceSource"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "evidenceSource_mailboxId_createdAt_idx" ON "evidenceSource"("mailboxId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "evidenceSource_kind_locator_checksum_key" ON "evidenceSource"("kind", "locator", "checksum");

-- CreateIndex
CREATE UNIQUE INDEX "proofItem_sourceKey_key" ON "proofItem"("sourceKey");

-- CreateIndex
CREATE INDEX "proofItem_companyId_idx" ON "proofItem"("companyId");

-- CreateIndex
CREATE INDEX "proofItem_contactId_idx" ON "proofItem"("contactId");

-- CreateIndex
CREATE INDEX "proofItem_leadId_idx" ON "proofItem"("leadId");

-- CreateIndex
CREATE INDEX "proofItem_dealId_idx" ON "proofItem"("dealId");

-- CreateIndex
CREATE INDEX "proofItem_evidenceSourceId_idx" ON "proofItem"("evidenceSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "template_sourceKey_key" ON "template"("sourceKey");

-- CreateIndex
CREATE INDEX "template_kind_active_idx" ON "template"("kind", "active");

-- CreateIndex
CREATE INDEX "template_ownerUserId_idx" ON "template"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "template_name_version_key" ON "template"("name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "draft_idempotencyKey_key" ON "draft"("idempotencyKey");

-- CreateIndex
CREATE INDEX "draft_ownerUserId_status_idx" ON "draft"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "draft_mailboxId_status_idx" ON "draft"("mailboxId", "status");

-- CreateIndex
CREATE INDEX "draft_recipientRouteId_idx" ON "draft"("recipientRouteId");

-- CreateIndex
CREATE INDEX "draft_templateId_idx" ON "draft"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_sourceKey_key" ON "proposal"("sourceKey");

-- CreateIndex
CREATE INDEX "proposal_ownerUserId_status_idx" ON "proposal"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "proposal_leadId_idx" ON "proposal"("leadId");

-- CreateIndex
CREATE INDEX "proposal_dealId_idx" ON "proposal"("dealId");

-- CreateIndex
CREATE INDEX "proposal_draftId_idx" ON "proposal"("draftId");

-- CreateIndex
CREATE INDEX "proposalItem_proposalId_idx" ON "proposalItem"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "proposalItem_proposalId_position_key" ON "proposalItem"("proposalId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "outreachApproval_draftId_key" ON "outreachApproval"("draftId");

-- CreateIndex
CREATE UNIQUE INDEX "outreachApproval_idempotencyKey_key" ON "outreachApproval"("idempotencyKey");

-- CreateIndex
CREATE INDEX "outreachApproval_requestedById_status_idx" ON "outreachApproval"("requestedById", "status");

-- CreateIndex
CREATE INDEX "outreachApproval_decidedById_idx" ON "outreachApproval"("decidedById");

-- CreateIndex
CREATE INDEX "assignment_entityType_entityId_revokedAt_idx" ON "assignment"("entityType", "entityId", "revokedAt");

-- CreateIndex
CREATE INDEX "assignment_assigneeUserId_revokedAt_idx" ON "assignment"("assigneeUserId", "revokedAt");

-- CreateIndex
CREATE INDEX "assignment_assignedByUserId_idx" ON "assignment"("assignedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "lifecycleEvent_idempotencyKey_key" ON "lifecycleEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "lifecycleEvent_entityType_entityId_occurredAt_idx" ON "lifecycleEvent"("entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "lifecycleEvent_actorUserId_occurredAt_idx" ON "lifecycleEvent"("actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "duplicateCandidate_entityType_status_score_idx" ON "duplicateCandidate"("entityType", "status", "score");

-- CreateIndex
CREATE INDEX "duplicateCandidate_reviewedById_idx" ON "duplicateCandidate"("reviewedById");

-- CreateIndex
CREATE UNIQUE INDEX "duplicateCandidate_entityType_leftEntityId_rightEntityId_key" ON "duplicateCandidate"("entityType", "leftEntityId", "rightEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "mergeDecision_candidateId_key" ON "mergeDecision"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "mergeDecision_idempotencyKey_key" ON "mergeDecision"("idempotencyKey");

-- CreateIndex
CREATE INDEX "mergeDecision_decidedByUserId_decidedAt_idx" ON "mergeDecision"("decidedByUserId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "researchRequest_idempotencyKey_key" ON "researchRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "researchRequest_ownerUserId_status_idx" ON "researchRequest"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "researchRequest_mailboxId_status_idx" ON "researchRequest"("mailboxId", "status");

-- CreateIndex
CREATE INDEX "researchRequest_targetType_targetEntityId_idx" ON "researchRequest"("targetType", "targetEntityId");

-- CreateIndex
CREATE INDEX "researchFinding_requestId_status_idx" ON "researchFinding"("requestId", "status");

-- CreateIndex
CREATE INDEX "researchFinding_evidenceSourceId_idx" ON "researchFinding"("evidenceSourceId");

-- CreateIndex
CREATE INDEX "domainAuditEvent_actorUserId_createdAt_idx" ON "domainAuditEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "domainAuditEvent_entityType_entityId_createdAt_idx" ON "domainAuditEvent"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "domainAuditEvent_action_requestId_key" ON "domainAuditEvent"("action", "requestId");

-- CreateIndex
CREATE INDEX "deal_pipelineStageId_idx" ON "deal"("pipelineStageId");

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_pipelineStageId_fkey" FOREIGN KEY ("pipelineStageId") REFERENCES "pipelineStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "footballPlayer" ADD CONSTRAINT "footballPlayer_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "footballPlayer" ADD CONSTRAINT "footballPlayer_currentClubId_fkey" FOREIGN KEY ("currentClubId") REFERENCES "club"("companyId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "footballAgent" ADD CONSTRAINT "footballAgent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "footballAgent" ADD CONSTRAINT "footballAgent_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agency"("companyId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency" ADD CONSTRAINT "agency_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club" ADD CONSTRAINT "club_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contactRoute" ADD CONSTRAINT "contactRoute_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contactRoute" ADD CONSTRAINT "contactRoute_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contactRoute" ADD CONSTRAINT "contactRoute_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sharedRoutePolicy" ADD CONSTRAINT "sharedRoutePolicy_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "contactRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sharedRoutePolicy" ADD CONSTRAINT "sharedRoutePolicy_granteeContactId_fkey" FOREIGN KEY ("granteeContactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sharedRoutePolicy" ADD CONSTRAINT "sharedRoutePolicy_granteeCompanyId_fkey" FOREIGN KEY ("granteeCompanyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sharedRoutePolicy" ADD CONSTRAINT "sharedRoutePolicy_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "representation" ADD CONSTRAINT "representation_playerContactId_fkey" FOREIGN KEY ("playerContactId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "representation" ADD CONSTRAINT "representation_agentContactId_fkey" FOREIGN KEY ("agentContactId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "representation" ADD CONSTRAINT "representation_agencyCompanyId_fkey" FOREIGN KEY ("agencyCompanyId") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "representation" ADD CONSTRAINT "representation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "representationHistory" ADD CONSTRAINT "representationHistory_representationId_fkey" FOREIGN KEY ("representationId") REFERENCES "representation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "representationHistory" ADD CONSTRAINT "representationHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operationalTask" ADD CONSTRAINT "operationalTask_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operationalTask" ADD CONSTRAINT "operationalTask_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operationalTask" ADD CONSTRAINT "operationalTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operationalTask" ADD CONSTRAINT "operationalTask_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operationalTask" ADD CONSTRAINT "operationalTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operationalTask" ADD CONSTRAINT "operationalTask_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note" ADD CONSTRAINT "note_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note" ADD CONSTRAINT "note_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note" ADD CONSTRAINT "note_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note" ADD CONSTRAINT "note_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note" ADD CONSTRAINT "note_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidenceSource" ADD CONSTRAINT "evidenceSource_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidenceSource" ADD CONSTRAINT "evidenceSource_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proofItem" ADD CONSTRAINT "proofItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proofItem" ADD CONSTRAINT "proofItem_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proofItem" ADD CONSTRAINT "proofItem_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proofItem" ADD CONSTRAINT "proofItem_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proofItem" ADD CONSTRAINT "proofItem_evidenceSourceId_fkey" FOREIGN KEY ("evidenceSourceId") REFERENCES "evidenceSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template" ADD CONSTRAINT "template_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft" ADD CONSTRAINT "draft_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft" ADD CONSTRAINT "draft_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft" ADD CONSTRAINT "draft_recipientRouteId_fkey" FOREIGN KEY ("recipientRouteId") REFERENCES "contactRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft" ADD CONSTRAINT "draft_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "draft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposalItem" ADD CONSTRAINT "proposalItem_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreachApproval" ADD CONSTRAINT "outreachApproval_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreachApproval" ADD CONSTRAINT "outreachApproval_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreachApproval" ADD CONSTRAINT "outreachApproval_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycleEvent" ADD CONSTRAINT "lifecycleEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicateCandidate" ADD CONSTRAINT "duplicateCandidate_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mergeDecision" ADD CONSTRAINT "mergeDecision_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "duplicateCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mergeDecision" ADD CONSTRAINT "mergeDecision_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "researchRequest" ADD CONSTRAINT "researchRequest_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "researchRequest" ADD CONSTRAINT "researchRequest_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "researchFinding" ADD CONSTRAINT "researchFinding_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "researchRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "researchFinding" ADD CONSTRAINT "researchFinding_evidenceSourceId_fkey" FOREIGN KEY ("evidenceSourceId") REFERENCES "evidenceSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domainAuditEvent" ADD CONSTRAINT "domainAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "contactRoute" ADD CONSTRAINT "contactRoute_subject_check"
  CHECK (("contactId" IS NOT NULL)::integer + ("companyId" IS NOT NULL)::integer = 1);
ALTER TABLE "contactRoute" ADD CONSTRAINT "contactRoute_normalized_value_check"
  CHECK (length(trim("normalizedValue")) > 0);
ALTER TABLE "sharedRoutePolicy" ADD CONSTRAINT "sharedRoutePolicy_grantee_check"
  CHECK (("granteeContactId" IS NOT NULL)::integer + ("granteeCompanyId" IS NOT NULL)::integer = 1);
ALTER TABLE "representation" ADD CONSTRAINT "representation_distinct_people_check"
  CHECK ("playerContactId" <> "agentContactId");
ALTER TABLE "representation" ADD CONSTRAINT "representation_dates_check"
  CHECK ("endedAt" IS NULL OR "startedAt" IS NULL OR "endedAt" >= "startedAt");
ALTER TABLE "pipelineStage" ADD CONSTRAINT "pipelineStage_probability_check"
  CHECK ("probability" BETWEEN 0 AND 100);
ALTER TABLE "lead" ADD CONSTRAINT "lead_subject_check"
  CHECK ("contactId" IS NOT NULL OR "companyId" IS NOT NULL);
ALTER TABLE "operationalTask" ADD CONSTRAINT "operationalTask_subject_check"
  CHECK ("companyId" IS NOT NULL OR "contactId" IS NOT NULL OR "leadId" IS NOT NULL OR "dealId" IS NOT NULL);
ALTER TABLE "note" ADD CONSTRAINT "note_subject_check"
  CHECK ("companyId" IS NOT NULL OR "contactId" IS NOT NULL OR "leadId" IS NOT NULL OR "dealId" IS NOT NULL);
ALTER TABLE "proofItem" ADD CONSTRAINT "proofItem_subject_check"
  CHECK ("companyId" IS NOT NULL OR "contactId" IS NOT NULL OR "leadId" IS NOT NULL OR "dealId" IS NOT NULL);
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_subject_check"
  CHECK ("leadId" IS NOT NULL OR "dealId" IS NOT NULL);
ALTER TABLE "proposalItem" ADD CONSTRAINT "proposalItem_values_check"
  CHECK (("quantity" IS NULL OR "quantity" >= 0) AND ("unitAmount" IS NULL OR "unitAmount" >= 0));
ALTER TABLE "duplicateCandidate" ADD CONSTRAINT "duplicateCandidate_canonical_pair_check"
  CHECK ("leftEntityId" < "rightEntityId");
ALTER TABLE "duplicateCandidate" ADD CONSTRAINT "duplicateCandidate_score_check"
  CHECK ("score" BETWEEN 0 AND 1);
ALTER TABLE "mergeDecision" ADD CONSTRAINT "mergeDecision_distinct_entities_check"
  CHECK ("survivorEntityId" <> "duplicateEntityId");
ALTER TABLE "researchFinding" ADD CONSTRAINT "researchFinding_confidence_check"
  CHECK ("confidence" BETWEEN 0 AND 1);
ALTER TABLE "outreachApproval" ADD CONSTRAINT "outreachApproval_decision_check"
  CHECK (
    ("status" = 'PENDING' AND "decidedById" IS NULL AND "decidedAt" IS NULL)
    OR ("status" <> 'PENDING' AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL)
  );
ALTER TABLE "outreachApproval" ADD CONSTRAINT "outreachApproval_two_person_check"
  CHECK ("decidedById" IS NULL OR "decidedById" <> "requestedById");

CREATE UNIQUE INDEX "representation_one_current_pair"
  ON "representation"("playerContactId", "agentContactId")
  WHERE "status" IN ('PENDING', 'ACTIVE');
CREATE UNIQUE INDEX "sharedRoutePolicy_one_active_grantee"
  ON "sharedRoutePolicy"("routeId", COALESCE("granteeContactId", ''), COALESCE("granteeCompanyId", ''))
  WHERE "revokedAt" IS NULL;
CREATE UNIQUE INDEX "assignment_one_active_entity"
  ON "assignment"("entityType", "entityId")
  WHERE "revokedAt" IS NULL;

INSERT INTO "pipelineStage" ("id", "key", "name", "kind", "position", "probability", "active", "createdAt", "updatedAt") VALUES
  ('ibl-stage-demo-booked', 'DEMO_BOOKED', 'Demo booked', 'OPEN', 10, 15, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ibl-stage-qualified', 'QUALIFIED_TO_BUY', 'Qualified to buy', 'OPEN', 20, 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ibl-stage-unqualified', 'UNQUALIFIED_TO_BUY', 'Unqualified to buy', 'LOST', 30, 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ibl-stage-decision-maker', 'DECISION_MAKER_BOUGHT_IN', 'Decision maker bought in', 'OPEN', 40, 60, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ibl-stage-contract-sent', 'CONTRACT_SENT', 'Contract sent', 'OPEN', 50, 80, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ibl-stage-closed-won', 'CLOSED_WON', 'Closed won', 'WON', 60, 100, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ibl-stage-closed-lost', 'CLOSED_LOST', 'Closed lost', 'LOST', 70, 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

UPDATE "deal" d
SET "pipelineStageId" = s."id"
FROM "pipelineStage" s
WHERE s."key" = d."stage"::text AND d."pipelineStageId" IS NULL;

CREATE FUNCTION ibl_domain_entity_exists(entity_type "DomainEntityType", entity_id TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN CASE entity_type
    WHEN 'COMPANY' THEN EXISTS (SELECT 1 FROM "company" WHERE "id" = entity_id)
    WHEN 'CONTACT' THEN EXISTS (SELECT 1 FROM "contact" WHERE "id" = entity_id)
    WHEN 'PLAYER' THEN EXISTS (SELECT 1 FROM "footballPlayer" WHERE "contactId" = entity_id)
    WHEN 'FOOTBALL_AGENT' THEN EXISTS (SELECT 1 FROM "footballAgent" WHERE "contactId" = entity_id)
    WHEN 'AGENCY' THEN EXISTS (SELECT 1 FROM "agency" WHERE "companyId" = entity_id)
    WHEN 'CLUB' THEN EXISTS (SELECT 1 FROM "club" WHERE "companyId" = entity_id)
    WHEN 'REPRESENTATION' THEN EXISTS (SELECT 1 FROM "representation" WHERE "id" = entity_id)
    WHEN 'LEAD' THEN EXISTS (SELECT 1 FROM "lead" WHERE "id" = entity_id)
    WHEN 'DEAL' THEN EXISTS (SELECT 1 FROM "deal" WHERE "id" = entity_id)
    WHEN 'TASK' THEN EXISTS (SELECT 1 FROM "operationalTask" WHERE "id" = entity_id)
    WHEN 'NOTE' THEN EXISTS (SELECT 1 FROM "note" WHERE "id" = entity_id)
    WHEN 'PROOF_ITEM' THEN EXISTS (SELECT 1 FROM "proofItem" WHERE "id" = entity_id)
    WHEN 'TEMPLATE' THEN EXISTS (SELECT 1 FROM "template" WHERE "id" = entity_id)
    WHEN 'DRAFT' THEN EXISTS (SELECT 1 FROM "draft" WHERE "id" = entity_id)
    WHEN 'PROPOSAL' THEN EXISTS (SELECT 1 FROM "proposal" WHERE "id" = entity_id)
    WHEN 'OUTREACH' THEN EXISTS (SELECT 1 FROM "outreachApproval" WHERE "id" = entity_id)
    WHEN 'RESEARCH_REQUEST' THEN EXISTS (SELECT 1 FROM "researchRequest" WHERE "id" = entity_id)
    ELSE false
  END;
END
$$;

CREATE FUNCTION ibl_assert_domain_reference() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT ibl_domain_entity_exists(NEW."entityType", NEW."entityId") THEN
    RAISE EXCEPTION 'Unknown domain entity %:%', NEW."entityType", NEW."entityId" USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END
$$;

CREATE CONSTRAINT TRIGGER assignment_entity_guard AFTER INSERT OR UPDATE ON "assignment"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ibl_assert_domain_reference();
CREATE CONSTRAINT TRIGGER lifecycle_entity_guard AFTER INSERT OR UPDATE ON "lifecycleEvent"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ibl_assert_domain_reference();

CREATE FUNCTION ibl_assert_research_target() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT ibl_domain_entity_exists(NEW."targetType", NEW."targetEntityId") THEN
    RAISE EXCEPTION 'Unknown research target %:%', NEW."targetType", NEW."targetEntityId" USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END
$$;

CREATE CONSTRAINT TRIGGER research_target_guard AFTER INSERT OR UPDATE ON "researchRequest"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ibl_assert_research_target();

CREATE FUNCTION ibl_assert_duplicate_entities() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT ibl_domain_entity_exists(NEW."entityType", NEW."leftEntityId")
     OR NOT ibl_domain_entity_exists(NEW."entityType", NEW."rightEntityId") THEN
    RAISE EXCEPTION 'Duplicate candidate references an unknown entity' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END
$$;

CREATE CONSTRAINT TRIGGER duplicate_entity_guard AFTER INSERT OR UPDATE ON "duplicateCandidate"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ibl_assert_duplicate_entities();

CREATE FUNCTION ibl_assert_merge_entities() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_type "DomainEntityType";
BEGIN
  SELECT "entityType" INTO candidate_type FROM "duplicateCandidate" WHERE "id" = NEW."candidateId";
  IF candidate_type IS NULL
     OR NOT ibl_domain_entity_exists(candidate_type, NEW."survivorEntityId")
     OR NOT ibl_domain_entity_exists(candidate_type, NEW."duplicateEntityId") THEN
    RAISE EXCEPTION 'Merge decision references an unknown entity' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END
$$;

CREATE CONSTRAINT TRIGGER merge_entity_guard AFTER INSERT OR UPDATE ON "mergeDecision"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ibl_assert_merge_entities();

CREATE FUNCTION ibl_assert_representation_profiles() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "footballPlayer" WHERE "contactId" = NEW."playerContactId")
     OR NOT EXISTS (SELECT 1 FROM "footballAgent" WHERE "contactId" = NEW."agentContactId") THEN
    RAISE EXCEPTION 'Representation requires player and football-agent profiles' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END
$$;

CREATE CONSTRAINT TRIGGER representation_profile_guard AFTER INSERT OR UPDATE ON "representation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ibl_assert_representation_profiles();

CREATE FUNCTION ibl_restrict_domain_entity_delete() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  entity_type "DomainEntityType" := TG_ARGV[0]::"DomainEntityType";
  entity_id TEXT := to_jsonb(OLD) ->> TG_ARGV[1];
BEGIN
  IF EXISTS (SELECT 1 FROM "assignment" WHERE "entityType" = entity_type AND "entityId" = entity_id)
     OR EXISTS (SELECT 1 FROM "lifecycleEvent" WHERE "entityType" = entity_type AND "entityId" = entity_id)
     OR EXISTS (SELECT 1 FROM "researchRequest" WHERE "targetType" = entity_type AND "targetEntityId" = entity_id)
     OR EXISTS (SELECT 1 FROM "duplicateCandidate" WHERE "entityType" = entity_type AND ("leftEntityId" = entity_id OR "rightEntityId" = entity_id))
     OR EXISTS (SELECT 1 FROM "domainAuditEvent" WHERE "entityType" = entity_type AND "entityId" = entity_id)
     OR EXISTS (
       SELECT 1 FROM "mergeDecision" m
       JOIN "duplicateCandidate" c ON c."id" = m."candidateId"
       WHERE c."entityType" = entity_type AND (m."survivorEntityId" = entity_id OR m."duplicateEntityId" = entity_id)
     ) THEN
    RAISE EXCEPTION 'Domain entity %:% is referenced by durable history', entity_type, entity_id USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END
$$;

CREATE TRIGGER company_domain_reference_guard BEFORE DELETE ON "company" FOR EACH ROW EXECUTE FUNCTION ibl_restrict_domain_entity_delete('COMPANY', 'id');
CREATE TRIGGER contact_domain_reference_guard BEFORE DELETE ON "contact" FOR EACH ROW EXECUTE FUNCTION ibl_restrict_domain_entity_delete('CONTACT', 'id');
CREATE TRIGGER player_domain_reference_guard BEFORE DELETE ON "footballPlayer" FOR EACH ROW EXECUTE FUNCTION ibl_restrict_domain_entity_delete('PLAYER', 'contactId');
CREATE TRIGGER football_agent_domain_reference_guard BEFORE DELETE ON "footballAgent" FOR EACH ROW EXECUTE FUNCTION ibl_restrict_domain_entity_delete('FOOTBALL_AGENT', 'contactId');
CREATE TRIGGER agency_domain_reference_guard BEFORE DELETE ON "agency" FOR EACH ROW EXECUTE FUNCTION ibl_restrict_domain_entity_delete('AGENCY', 'companyId');
CREATE TRIGGER club_domain_reference_guard BEFORE DELETE ON "club" FOR EACH ROW EXECUTE FUNCTION ibl_restrict_domain_entity_delete('CLUB', 'companyId');
CREATE TRIGGER representation_domain_reference_guard BEFORE DELETE ON "representation" FOR EACH ROW EXECUTE FUNCTION ibl_restrict_domain_entity_delete('REPRESENTATION', 'id');
CREATE TRIGGER lead_domain_reference_guard BEFORE DELETE ON "lead" FOR EACH ROW EXECUTE FUNCTION ibl_restrict_domain_entity_delete('LEAD', 'id');
CREATE TRIGGER deal_domain_reference_guard BEFORE DELETE ON "deal" FOR EACH ROW EXECUTE FUNCTION ibl_restrict_domain_entity_delete('DEAL', 'id');
CREATE TRIGGER task_domain_reference_guard BEFORE DELETE ON "operationalTask" FOR EACH ROW EXECUTE FUNCTION ibl_restrict_domain_entity_delete('TASK', 'id');
CREATE TRIGGER note_domain_reference_guard BEFORE DELETE ON "note" FOR EACH ROW EXECUTE FUNCTION ibl_restrict_domain_entity_delete('NOTE', 'id');
CREATE TRIGGER proof_item_domain_reference_guard BEFORE DELETE ON "proofItem" FOR EACH ROW EXECUTE FUNCTION ibl_restrict_domain_entity_delete('PROOF_ITEM', 'id');
CREATE TRIGGER template_domain_reference_guard BEFORE DELETE ON "template" FOR EACH ROW EXECUTE FUNCTION ibl_restrict_domain_entity_delete('TEMPLATE', 'id');
CREATE TRIGGER draft_domain_reference_guard BEFORE DELETE ON "draft" FOR EACH ROW EXECUTE FUNCTION ibl_restrict_domain_entity_delete('DRAFT', 'id');
CREATE TRIGGER proposal_domain_reference_guard BEFORE DELETE ON "proposal" FOR EACH ROW EXECUTE FUNCTION ibl_restrict_domain_entity_delete('PROPOSAL', 'id');
CREATE TRIGGER outreach_domain_reference_guard BEFORE DELETE ON "outreachApproval" FOR EACH ROW EXECUTE FUNCTION ibl_restrict_domain_entity_delete('OUTREACH', 'id');
CREATE TRIGGER research_request_domain_reference_guard BEFORE DELETE ON "researchRequest" FOR EACH ROW EXECUTE FUNCTION ibl_restrict_domain_entity_delete('RESEARCH_REQUEST', 'id');

CREATE FUNCTION ibl_current_workspace_role() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT m."role"
  FROM "member" m
  JOIN "userProfile" p ON p."userId" = m."userId"
  WHERE m."organizationId" = 'workspace'
    AND m."userId" = ibl_current_user_id()
    AND p."status" = 'ACTIVE'
  LIMIT 1
$$;

CREATE FUNCTION ibl_can_manage_crm() RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$ SELECT COALESCE(ibl_current_workspace_role() IN ('admin', 'team'), false) $$;

CREATE FUNCTION ibl_mailbox_owned(target_mailbox_id TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "mailbox" m
    WHERE m."id" = target_mailbox_id AND m."ownerUserId" = ibl_current_user_id()
  )
$$;

CREATE FUNCTION ibl_reject_immutable_change() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER representation_history_immutable
  BEFORE UPDATE OR DELETE ON "representationHistory"
  FOR EACH ROW EXECUTE FUNCTION ibl_reject_immutable_change();
CREATE TRIGGER lifecycle_event_immutable
  BEFORE UPDATE OR DELETE ON "lifecycleEvent"
  FOR EACH ROW EXECUTE FUNCTION ibl_reject_immutable_change();
CREATE TRIGGER domain_audit_event_immutable
  BEFORE UPDATE OR DELETE ON "domainAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION ibl_reject_immutable_change();

CREATE FUNCTION ibl_guard_draft_outreach() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW."status" IN ('APPROVED', 'QUEUED', 'SENT') THEN
    IF NEW."mailboxId" IS NULL OR NEW."recipientRouteId" IS NULL OR NEW."approvedAt" IS NULL THEN
      RAISE EXCEPTION 'approved outreach requires a mailbox, recipient route, and approval timestamp' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "outreachApproval" a
      WHERE a."draftId" = NEW."id" AND a."status" = 'APPROVED'
        AND a."decidedById" IS NOT NULL AND a."decidedAt" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'outreach requires an approved human decision' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."status" IN ('QUEUED', 'SENT') AND NOT EXISTS (
    SELECT 1 FROM "providerCapability" p
    WHERE p."key" = 'RESEND_OUTBOUND' AND p."status" = 'VERIFIED'
  ) THEN
    RAISE EXCEPTION 'Resend provider capability is not verified' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" = 'SENT' AND NEW."sentAt" IS NULL THEN
    RAISE EXCEPTION 'sent outreach requires sentAt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER draft_outreach_guard
  BEFORE INSERT OR UPDATE ON "draft"
  FOR EACH ROW EXECUTE FUNCTION ibl_guard_draft_outreach();

CREATE FUNCTION ibl_guard_outreach_approval() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."id" <> OLD."id" OR NEW."draftId" <> OLD."draftId"
       OR NEW."requestedById" <> OLD."requestedById" OR NEW."requestedAt" <> OLD."requestedAt" THEN
      RAISE EXCEPTION 'Outreach approval request identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD."status" <> 'PENDING' THEN
      RAISE EXCEPTION 'A decided outreach approval is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER outreach_approval_guard
  BEFORE UPDATE ON "outreachApproval"
  FOR EACH ROW EXECUTE FUNCTION ibl_guard_outreach_approval();

ALTER TABLE "footballPlayer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "footballPlayer" FORCE ROW LEVEL SECURITY;
ALTER TABLE "footballAgent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "footballAgent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "agency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agency" FORCE ROW LEVEL SECURITY;
ALTER TABLE "club" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "club" FORCE ROW LEVEL SECURITY;
ALTER TABLE "contactRoute" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contactRoute" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sharedRoutePolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sharedRoutePolicy" FORCE ROW LEVEL SECURITY;
ALTER TABLE "representation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "representation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "representationHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "representationHistory" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pipelineStage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipelineStage" FORCE ROW LEVEL SECURITY;
ALTER TABLE "lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead" FORCE ROW LEVEL SECURITY;
ALTER TABLE "operationalTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "operationalTask" FORCE ROW LEVEL SECURITY;
ALTER TABLE "note" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "note" FORCE ROW LEVEL SECURITY;
ALTER TABLE "assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "lifecycleEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lifecycleEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "draft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "draft" FORCE ROW LEVEL SECURITY;
ALTER TABLE "proposal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proposal" FORCE ROW LEVEL SECURITY;
ALTER TABLE "outreachApproval" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreachApproval" FORCE ROW LEVEL SECURITY;
ALTER TABLE "evidenceSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "evidenceSource" FORCE ROW LEVEL SECURITY;
ALTER TABLE "proofItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proofItem" FORCE ROW LEVEL SECURITY;
ALTER TABLE "template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "template" FORCE ROW LEVEL SECURITY;
ALTER TABLE "proposalItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proposalItem" FORCE ROW LEVEL SECURITY;
ALTER TABLE "researchRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "researchRequest" FORCE ROW LEVEL SECURITY;
ALTER TABLE "researchFinding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "researchFinding" FORCE ROW LEVEL SECURITY;
ALTER TABLE "duplicateCandidate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "duplicateCandidate" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mergeDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mergeDecision" FORCE ROW LEVEL SECURITY;
ALTER TABLE "domainAuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "domainAuditEvent" FORCE ROW LEVEL SECURITY;

CREATE POLICY football_player_access ON "footballPlayer" FOR ALL
  USING (ibl_current_workspace_role() IS NOT NULL)
  WITH CHECK (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY football_agent_access ON "footballAgent" FOR ALL
  USING (ibl_current_workspace_role() IS NOT NULL)
  WITH CHECK (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY agency_access ON "agency" FOR ALL
  USING (ibl_current_workspace_role() IS NOT NULL)
  WITH CHECK (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY club_access ON "club" FOR ALL
  USING (ibl_current_workspace_role() IS NOT NULL)
  WITH CHECK (ibl_current_workspace_role() IS NOT NULL);

CREATE POLICY contact_route_read ON "contactRoute" FOR SELECT
  USING ("ownerUserId" = ibl_current_user_id() OR "visibility" = 'SHARED');
CREATE POLICY contact_route_write ON "contactRoute" FOR ALL
  USING ("ownerUserId" = ibl_current_user_id())
  WITH CHECK ("ownerUserId" = ibl_current_user_id());
CREATE POLICY shared_route_policy_read ON "sharedRoutePolicy" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "contactRoute" r
    WHERE r."id" = "routeId"
      AND (r."ownerUserId" = ibl_current_user_id() OR r."visibility" = 'SHARED')
  ));
CREATE POLICY shared_route_policy_write ON "sharedRoutePolicy" FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "contactRoute" r
    WHERE r."id" = "routeId" AND r."ownerUserId" = ibl_current_user_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "contactRoute" r
    WHERE r."id" = "routeId" AND r."ownerUserId" = ibl_current_user_id()
  ));
CREATE POLICY representation_access ON "representation" FOR ALL
  USING (ibl_current_workspace_role() IS NOT NULL)
  WITH CHECK ("createdByUserId" = ibl_current_user_id() OR ibl_can_manage_crm());
CREATE POLICY representation_history_read ON "representationHistory" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY representation_history_insert ON "representationHistory" FOR INSERT
  WITH CHECK ("actorUserId" = ibl_current_user_id());
CREATE POLICY pipeline_stage_read ON "pipelineStage" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY pipeline_stage_manage ON "pipelineStage" FOR ALL
  USING (ibl_can_manage_crm()) WITH CHECK (ibl_can_manage_crm());
CREATE POLICY lead_access ON "lead" FOR ALL
  USING ("ownerUserId" = ibl_current_user_id() OR "createdByUserId" = ibl_current_user_id() OR ibl_can_manage_crm())
  WITH CHECK ("ownerUserId" = ibl_current_user_id() OR "createdByUserId" = ibl_current_user_id() OR ibl_can_manage_crm());
CREATE POLICY operational_task_access ON "operationalTask" FOR ALL
  USING ("assigneeUserId" = ibl_current_user_id() OR "createdByUserId" = ibl_current_user_id() OR ibl_can_manage_crm())
  WITH CHECK ("assigneeUserId" = ibl_current_user_id() OR "createdByUserId" = ibl_current_user_id() OR ibl_can_manage_crm());
CREATE POLICY note_access ON "note" FOR ALL
  USING ("authorUserId" = ibl_current_user_id() OR ibl_can_manage_crm())
  WITH CHECK ("authorUserId" = ibl_current_user_id() OR ibl_can_manage_crm());
CREATE POLICY assignment_access ON "assignment" FOR ALL
  USING ("assigneeUserId" = ibl_current_user_id() OR "assignedByUserId" = ibl_current_user_id() OR ibl_can_manage_crm())
  WITH CHECK ("assignedByUserId" = ibl_current_user_id() OR ibl_can_manage_crm());
CREATE POLICY lifecycle_event_read ON "lifecycleEvent" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY lifecycle_event_insert ON "lifecycleEvent" FOR INSERT
  WITH CHECK ("actorUserId" IS NULL OR "actorUserId" = ibl_current_user_id());
CREATE POLICY draft_read ON "draft" FOR SELECT
  USING (
    ("mailboxId" IS NULL AND "ownerUserId" = ibl_current_user_id())
    OR ("mailboxId" IS NOT NULL AND ibl_can_read_mailbox("mailboxId"))
  );
CREATE POLICY draft_write ON "draft" FOR ALL
  USING ("ownerUserId" = ibl_current_user_id() AND ("mailboxId" IS NULL OR ibl_mailbox_owned("mailboxId")))
  WITH CHECK ("ownerUserId" = ibl_current_user_id() AND ("mailboxId" IS NULL OR ibl_mailbox_owned("mailboxId")));
CREATE POLICY proposal_access ON "proposal" FOR ALL
  USING (
    ("ownerUserId" = ibl_current_user_id() OR ibl_can_manage_crm())
    AND ("draftId" IS NULL OR EXISTS (SELECT 1 FROM "draft" d WHERE d."id" = "draftId"))
  )
  WITH CHECK (
    ("ownerUserId" = ibl_current_user_id() OR ibl_can_manage_crm())
    AND ("draftId" IS NULL OR EXISTS (SELECT 1 FROM "draft" d WHERE d."id" = "draftId"))
  );
CREATE POLICY proposal_item_access ON "proposalItem" FOR ALL
  USING (EXISTS (SELECT 1 FROM "proposal" p WHERE p."id" = "proposalId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "proposal" p WHERE p."id" = "proposalId"));
CREATE POLICY outreach_approval_read ON "outreachApproval" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "draft" d WHERE d."id" = "draftId"));
CREATE POLICY outreach_approval_insert ON "outreachApproval" FOR INSERT
  WITH CHECK ("requestedById" = ibl_current_user_id() AND EXISTS (
    SELECT 1 FROM "draft" d WHERE d."id" = "draftId" AND d."ownerUserId" = ibl_current_user_id()
  ));
CREATE POLICY outreach_approval_decide ON "outreachApproval" FOR UPDATE
  USING ("status" = 'PENDING' AND ibl_current_workspace_role() IS NOT NULL)
  WITH CHECK (
    "status" IN ('APPROVED', 'REJECTED')
    AND "decidedById" = ibl_current_user_id()
    AND "decidedById" <> "requestedById"
    AND "decidedAt" IS NOT NULL
  );
CREATE POLICY evidence_source_read ON "evidenceSource" FOR SELECT
  USING ("mailboxId" IS NULL OR ibl_can_read_mailbox("mailboxId"));
CREATE POLICY evidence_source_write ON "evidenceSource" FOR ALL
  USING (("createdByUserId" IS NULL OR "createdByUserId" = ibl_current_user_id()) AND ("mailboxId" IS NULL OR ibl_mailbox_owned("mailboxId")))
  WITH CHECK (("createdByUserId" IS NULL OR "createdByUserId" = ibl_current_user_id()) AND ("mailboxId" IS NULL OR ibl_mailbox_owned("mailboxId")));
CREATE POLICY proof_item_read ON "proofItem" FOR SELECT
  USING ("evidenceSourceId" IS NULL OR EXISTS (SELECT 1 FROM "evidenceSource" e WHERE e."id" = "evidenceSourceId"));
CREATE POLICY proof_item_write ON "proofItem" FOR ALL
  USING (ibl_current_workspace_role() IS NOT NULL)
  WITH CHECK (ibl_current_workspace_role() IS NOT NULL AND ("evidenceSourceId" IS NULL OR EXISTS (
    SELECT 1 FROM "evidenceSource" e WHERE e."id" = "evidenceSourceId"
  )));
CREATE POLICY template_read ON "template" FOR SELECT
  USING ("ownerUserId" IS NULL OR "ownerUserId" = ibl_current_user_id() OR ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY template_write ON "template" FOR ALL
  USING ("ownerUserId" = ibl_current_user_id() OR ("ownerUserId" IS NULL AND ibl_can_manage_crm()))
  WITH CHECK ("ownerUserId" = ibl_current_user_id() OR ("ownerUserId" IS NULL AND ibl_can_manage_crm()));
CREATE POLICY research_request_read ON "researchRequest" FOR SELECT
  USING (
    ("mailboxId" IS NULL AND "ownerUserId" = ibl_current_user_id())
    OR ("mailboxId" IS NOT NULL AND ibl_can_read_mailbox("mailboxId"))
  );
CREATE POLICY research_request_write ON "researchRequest" FOR ALL
  USING ("ownerUserId" = ibl_current_user_id() AND ("mailboxId" IS NULL OR ibl_mailbox_owned("mailboxId")))
  WITH CHECK ("ownerUserId" = ibl_current_user_id() AND ("mailboxId" IS NULL OR ibl_mailbox_owned("mailboxId")));
CREATE POLICY research_finding_read ON "researchFinding" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "researchRequest" r WHERE r."id" = "requestId"));
CREATE POLICY research_finding_write ON "researchFinding" FOR ALL
  USING (EXISTS (SELECT 1 FROM "researchRequest" r WHERE r."id" = "requestId" AND r."ownerUserId" = ibl_current_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM "researchRequest" r WHERE r."id" = "requestId" AND r."ownerUserId" = ibl_current_user_id()));
CREATE POLICY duplicate_candidate_manage ON "duplicateCandidate" FOR ALL
  USING (ibl_can_manage_crm()) WITH CHECK (ibl_can_manage_crm());
CREATE POLICY merge_decision_manage ON "mergeDecision" FOR ALL
  USING (ibl_can_manage_crm()) WITH CHECK (ibl_can_manage_crm());
CREATE POLICY domain_audit_read ON "domainAuditEvent" FOR SELECT
  USING ("actorUserId" = ibl_current_user_id() OR ibl_can_manage_crm());
CREATE POLICY domain_audit_insert ON "domainAuditEvent" FOR INSERT
  WITH CHECK ("actorUserId" IS NULL OR "actorUserId" = ibl_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "footballPlayer", "footballAgent", "agency", "club", "contactRoute",
      "sharedRoutePolicy", "representation", "representationHistory", "pipelineStage",
      "lead", "operationalTask", "note", "evidenceSource", "proofItem", "template",
      "draft", "proposal", "proposalItem", "outreachApproval", "assignment",
      "lifecycleEvent", "duplicateCandidate", "mergeDecision", "researchRequest",
      "researchFinding", "domainAuditEvent"
    TO ibl_v2_app;
    GRANT EXECUTE ON FUNCTION ibl_current_workspace_role() TO ibl_v2_app;
    GRANT EXECUTE ON FUNCTION ibl_can_manage_crm() TO ibl_v2_app;
    GRANT EXECUTE ON FUNCTION ibl_mailbox_owned(TEXT) TO ibl_v2_app;
    GRANT EXECUTE ON FUNCTION ibl_domain_entity_exists("DomainEntityType", TEXT) TO ibl_v2_app;
    REVOKE ALL ON FUNCTION ibl_current_workspace_role() FROM PUBLIC;
    REVOKE ALL ON FUNCTION ibl_can_manage_crm() FROM PUBLIC;
    REVOKE ALL ON FUNCTION ibl_mailbox_owned(TEXT) FROM PUBLIC;
    REVOKE ALL ON FUNCTION ibl_domain_entity_exists("DomainEntityType", TEXT) FROM PUBLIC;
    REVOKE ALL ON FUNCTION ibl_reject_immutable_change() FROM PUBLIC;
    REVOKE ALL ON FUNCTION ibl_guard_draft_outreach() FROM PUBLIC;
    REVOKE ALL ON FUNCTION ibl_guard_outreach_approval() FROM PUBLIC;
    REVOKE ALL ON FUNCTION ibl_assert_domain_reference() FROM PUBLIC;
    REVOKE ALL ON FUNCTION ibl_assert_research_target() FROM PUBLIC;
    REVOKE ALL ON FUNCTION ibl_assert_duplicate_entities() FROM PUBLIC;
    REVOKE ALL ON FUNCTION ibl_assert_merge_entities() FROM PUBLIC;
    REVOKE ALL ON FUNCTION ibl_assert_representation_profiles() FROM PUBLIC;
    REVOKE ALL ON FUNCTION ibl_restrict_domain_entity_delete() FROM PUBLIC;
  END IF;
END
$$;
