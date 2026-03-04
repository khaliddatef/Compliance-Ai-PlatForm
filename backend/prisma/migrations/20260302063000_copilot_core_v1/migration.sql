-- Copilot Core V1 additive schema rollout

-- Message structured response support
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

ALTER TABLE "Message" RENAME TO "_Message_old";

CREATE TABLE IF NOT EXISTS "Message" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "messageType" TEXT NOT NULL DEFAULT 'TEXT',
  "cardsJson" JSON,
  "actionsJson" JSON,
  "sourcesJson" JSON,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "Message" (
  "id",
  "conversationId",
  "role",
  "content",
  "createdAt",
  "messageType"
)
SELECT
  "id",
  "conversationId",
  "role",
  "content",
  "createdAt",
  'TEXT'
FROM "_Message_old";

DROP TABLE "_Message_old";
CREATE INDEX IF NOT EXISTS "Message_conversationId_idx" ON "Message"("conversationId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Evidence domain
CREATE TABLE IF NOT EXISTS "Evidence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "documentId" TEXT,
  "url" TEXT,
  "createdById" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "reviewedById" TEXT,
  "reviewedAt" DATETIME,
  "reviewComment" TEXT,
  "validFrom" DATETIME,
  "validTo" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Evidence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "EvidenceControlLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "evidenceId" TEXT NOT NULL,
  "controlId" TEXT NOT NULL,
  "linkedById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvidenceControlLink_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EvidenceControlLink_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ControlDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ControlEvidenceRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "controlId" TEXT NOT NULL,
  "testComponentId" TEXT,
  "ownerId" TEXT NOT NULL,
  "dueDate" DATETIME NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdById" TEXT NOT NULL,
  "dedupKey" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "closedAt" DATETIME,
  CONSTRAINT "ControlEvidenceRequest_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ControlDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ControlEvidenceRequest_testComponentId_fkey" FOREIGN KEY ("testComponentId") REFERENCES "TestComponent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "EvidenceRequestFulfillment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requestId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvidenceRequestFulfillment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ControlEvidenceRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EvidenceRequestFulfillment_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Evidence_documentId_key" ON "Evidence"("documentId");
CREATE INDEX IF NOT EXISTS "Evidence_status_idx" ON "Evidence"("status");
CREATE INDEX IF NOT EXISTS "Evidence_validTo_idx" ON "Evidence"("validTo");
CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceControlLink_evidenceId_controlId_key" ON "EvidenceControlLink"("evidenceId", "controlId");
CREATE INDEX IF NOT EXISTS "EvidenceControlLink_controlId_idx" ON "EvidenceControlLink"("controlId");
CREATE UNIQUE INDEX IF NOT EXISTS "ControlEvidenceRequest_dedupKey_key" ON "ControlEvidenceRequest"("dedupKey");
CREATE INDEX IF NOT EXISTS "ControlEvidenceRequest_status_idx" ON "ControlEvidenceRequest"("status");
CREATE INDEX IF NOT EXISTS "ControlEvidenceRequest_ownerId_idx" ON "ControlEvidenceRequest"("ownerId");
CREATE INDEX IF NOT EXISTS "ControlEvidenceRequest_controlId_idx" ON "ControlEvidenceRequest"("controlId");
CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceRequestFulfillment_requestId_evidenceId_key" ON "EvidenceRequestFulfillment"("requestId", "evidenceId");
CREATE INDEX IF NOT EXISTS "EvidenceRequestFulfillment_requestId_idx" ON "EvidenceRequestFulfillment"("requestId");

-- Audit + idempotency
CREATE TABLE IF NOT EXISTS "AuditEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actorId" TEXT,
  "actorRole" TEXT,
  "actionType" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "beforeJson" TEXT,
  "afterJson" TEXT,
  "reason" TEXT,
  "requestId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "IdempotencyRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "responseJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME
);

CREATE INDEX IF NOT EXISTS "AuditEvent_entity_idx" ON "AuditEvent"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "AuditEvent_actor_idx" ON "AuditEvent"("actorId");
CREATE INDEX IF NOT EXISTS "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyRecord_key_actor_action_key" ON "IdempotencyRecord"("key", "actorId", "actionType");
CREATE INDEX IF NOT EXISTS "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");

-- Control operational status + remediation
CREATE TABLE IF NOT EXISTS "ControlAssessment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "controlId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "confidence" REAL,
  "summary" TEXT,
  "assessedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assessedById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ControlAssessment_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ControlDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ControlSchedule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "controlId" TEXT NOT NULL,
  "frequencyDays" INTEGER NOT NULL DEFAULT 90,
  "startFrom" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ControlSchedule_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ControlDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "RemediationTask" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "controlId" TEXT,
  "ownerId" TEXT,
  "dueDate" DATETIME,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RemediationTask_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ControlDefinition" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ControlAssessment_controlId_assessedAt_idx" ON "ControlAssessment"("controlId", "assessedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ControlSchedule_controlId_key" ON "ControlSchedule"("controlId");
CREATE INDEX IF NOT EXISTS "ControlSchedule_controlId_idx" ON "ControlSchedule"("controlId");
CREATE INDEX IF NOT EXISTS "RemediationTask_controlId_status_idx" ON "RemediationTask"("controlId", "status");

-- Audit pack snapshot
CREATE TABLE IF NOT EXISTS "AuditPack" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "frameworkId" TEXT,
  "periodStart" DATETIME NOT NULL,
  "periodEnd" DATETIME NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "AuditPackItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "auditPackId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "refId" TEXT NOT NULL,
  "snapshotData" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditPackItem_auditPackId_fkey" FOREIGN KEY ("auditPackId") REFERENCES "AuditPack" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AuditPack_createdAt_idx" ON "AuditPack"("createdAt");
CREATE INDEX IF NOT EXISTS "AuditPackItem_auditPackId_idx" ON "AuditPackItem"("auditPackId");

-- Connectors
CREATE TABLE IF NOT EXISTS "Connector" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "configJson" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "ConnectorRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "connectorId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" DATETIME NOT NULL,
  "endedAt" DATETIME,
  "statsJson" TEXT,
  "errorText" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConnectorRun_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ConnectorArtifact" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "connectorId" TEXT NOT NULL,
  "runId" TEXT,
  "type" TEXT NOT NULL,
  "source" TEXT,
  "timestamp" DATETIME NOT NULL,
  "rawPayloadRef" TEXT,
  "parsedSummaryJson" TEXT,
  "evidenceId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConnectorArtifact_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConnectorArtifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ConnectorRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ConnectorArtifact_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Connector_type_idx" ON "Connector"("type");
CREATE INDEX IF NOT EXISTS "ConnectorRun_connectorId_startedAt_idx" ON "ConnectorRun"("connectorId", "startedAt");
CREATE INDEX IF NOT EXISTS "ConnectorArtifact_connectorId_createdAt_idx" ON "ConnectorArtifact"("connectorId", "createdAt");
CREATE INDEX IF NOT EXISTS "ConnectorArtifact_evidenceId_idx" ON "ConnectorArtifact"("evidenceId");
