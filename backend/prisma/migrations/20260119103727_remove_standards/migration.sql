/*
  Warnings:

  - You are about to drop the column `standard` on the `Document` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ControlTopic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "intent" TEXT,
    "designPrinciple" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'continuous',
    "status" TEXT NOT NULL DEFAULT 'enabled',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ControlDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "controlCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "question" TEXT,
    "isoMappings" JSONB,
    "ownerRole" TEXT,
    "status" TEXT NOT NULL DEFAULT 'enabled',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "weight" REAL,
    "evidenceRequestList" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ControlDefinition_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "ControlTopic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ControlTopicMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "controlId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL DEFAULT 'PRIMARY',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ControlTopicMapping_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ControlDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ControlTopicMapping_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "ControlTopic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ControlFrameworkMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "controlId" TEXT NOT NULL,
    "frameworkId" TEXT,
    "framework" TEXT NOT NULL,
    "frameworkCode" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL DEFAULT 'PRIMARY',
    "priority" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ControlFrameworkMapping_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ControlDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ControlFrameworkMapping_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "Framework" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Framework" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'enabled',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TestComponent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "controlId" TEXT NOT NULL,
    "assessmentObjective" TEXT,
    "requirement" TEXT NOT NULL,
    "collectionMethod" TEXT,
    "procedure" TEXT,
    "expectedResult" TEXT,
    "frequency" TEXT,
    "evidenceTypes" JSONB,
    "acceptanceCriteria" TEXT,
    "partialCriteria" TEXT,
    "rejectCriteria" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestComponent_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ControlDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvidenceType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EvidenceRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rowNumber" INTEGER,
    "areaFocus" TEXT,
    "artifact" TEXT,
    "description" TEXT,
    "mappedControlsRaw" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ControlEvidenceMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "controlId" TEXT NOT NULL,
    "evidenceRequestId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ControlEvidenceMapping_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ControlDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ControlEvidenceMapping_evidenceRequestId_fkey" FOREIGN KEY ("evidenceRequestId") REFERENCES "EvidenceRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ControlRiskContext" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "controlId" TEXT NOT NULL,
    "controlTitle" TEXT,
    "controlDescription" TEXT,
    "securityObjective" TEXT,
    "failureImpact" TEXT,
    "riskThemes" TEXT,
    "severity" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ControlRiskContext_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ControlDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestComponentSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testComponentId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "requirement" TEXT,
    "positiveSignals" TEXT,
    "negativeSignals" TEXT,
    "missingSignals" TEXT,
    "signalWeight" INTEGER,
    "contextOverrideAllowed" BOOLEAN,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestComponentSignal_testComponentId_fkey" FOREIGN KEY ("testComponentId") REFERENCES "TestComponent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestComponentSignal_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ControlDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ControlRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "controlId" TEXT NOT NULL,
    "controlTitle" TEXT,
    "accountableRole" TEXT,
    "responsibleRole" TEXT,
    "evidenceOwnerRole" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ControlRole_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ControlDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImplementationGuidance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "controlId" TEXT NOT NULL,
    "companySizeSegment" TEXT,
    "guidance" TEXT,
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImplementationGuidance_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ControlDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FrameworkSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "frameworkId" TEXT,
    "frameworkName" TEXT,
    "geography" TEXT,
    "source" TEXT,
    "authoritativeSource" TEXT,
    "strm" TEXT,
    "url" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FrameworkSource_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "Framework" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RiskCatalog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "grouping" TEXT,
    "title" TEXT,
    "description" TEXT,
    "nistFunction" TEXT,
    "materialityPreTaxIncome" TEXT,
    "materialityTotalAssets" TEXT,
    "materialityTotalEquity" TEXT,
    "materialityTotalRevenue" TEXT,
    "source" TEXT,
    "text" TEXT,
    "tokens" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ThreatCatalog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "grouping" TEXT,
    "title" TEXT,
    "description" TEXT,
    "materialityPreTaxIncome" TEXT,
    "materialityTotalAssets" TEXT,
    "materialityTotalEquity" TEXT,
    "materialityTotalRevenue" TEXT,
    "source" TEXT,
    "text" TEXT,
    "tokens" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ControlApplicability" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "controlId" TEXT NOT NULL,
    "appliesPeople" BOOLEAN,
    "appliesProcess" BOOLEAN,
    "appliesTechnology" BOOLEAN,
    "appliesData" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ControlApplicability_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ControlDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ControlRiskMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "controlId" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "riskTitle" TEXT,
    "confidence" REAL,
    "relationshipType" TEXT NOT NULL DEFAULT 'RELATED',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ControlRiskMapping_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ControlDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ControlRiskMapping_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "RiskCatalog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ControlThreatMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "controlId" TEXT NOT NULL,
    "threatId" TEXT NOT NULL,
    "threatTitle" TEXT,
    "confidence" REAL,
    "relationshipType" TEXT NOT NULL DEFAULT 'RELATED',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ControlThreatMapping_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ControlDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ControlThreatMapping_threatId_fkey" FOREIGN KEY ("threatId") REFERENCES "ThreatCatalog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvidenceEvaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "satisfied" JSONB,
    "missing" JSONB,
    "recommendations" JSONB,
    "citations" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidenceEvaluation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "customerVectorStoreId" TEXT,
    CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Conversation" ("createdAt", "customerVectorStoreId", "id", "title", "updatedAt") SELECT "createdAt", "customerVectorStoreId", "id", "title", "updatedAt" FROM "Conversation";
DROP TABLE "Conversation";
ALTER TABLE "new_Conversation" RENAME TO "Conversation";
CREATE TABLE "new_Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "openaiFileId" TEXT,
    "docType" TEXT,
    "matchControlId" TEXT,
    "matchStatus" TEXT,
    "matchNote" TEXT,
    "matchRecommendations" JSONB,
    "reviewedAt" DATETIME,
    "submittedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Document" ("conversationId", "createdAt", "id", "kind", "mimeType", "originalName", "sizeBytes", "storagePath") SELECT "conversationId", "createdAt", "id", "kind", "mimeType", "originalName", "sizeBytes", "storagePath" FROM "Document";
DROP TABLE "Document";
ALTER TABLE "new_Document" RENAME TO "Document";
CREATE INDEX "Document_conversationId_idx" ON "Document"("conversationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "ControlDefinition_controlCode_idx" ON "ControlDefinition"("controlCode");

-- CreateIndex
CREATE INDEX "ControlDefinition_topicId_idx" ON "ControlDefinition"("topicId");

-- CreateIndex
CREATE INDEX "ControlTopicMapping_controlId_idx" ON "ControlTopicMapping"("controlId");

-- CreateIndex
CREATE INDEX "ControlTopicMapping_topicId_idx" ON "ControlTopicMapping"("topicId");

-- CreateIndex
CREATE INDEX "ControlTopicMapping_relationshipType_idx" ON "ControlTopicMapping"("relationshipType");

-- CreateIndex
CREATE UNIQUE INDEX "ControlTopicMapping_controlId_topicId_key" ON "ControlTopicMapping"("controlId", "topicId");

-- CreateIndex
CREATE INDEX "ControlFrameworkMapping_controlId_idx" ON "ControlFrameworkMapping"("controlId");

-- CreateIndex
CREATE INDEX "ControlFrameworkMapping_framework_idx" ON "ControlFrameworkMapping"("framework");

-- CreateIndex
CREATE UNIQUE INDEX "Framework_name_key" ON "Framework"("name");

-- CreateIndex
CREATE INDEX "TestComponent_controlId_idx" ON "TestComponent"("controlId");

-- CreateIndex
CREATE INDEX "ControlEvidenceMapping_controlId_idx" ON "ControlEvidenceMapping"("controlId");

-- CreateIndex
CREATE INDEX "ControlEvidenceMapping_evidenceRequestId_idx" ON "ControlEvidenceMapping"("evidenceRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlEvidenceMapping_controlId_evidenceRequestId_key" ON "ControlEvidenceMapping"("controlId", "evidenceRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlRiskContext_controlId_key" ON "ControlRiskContext"("controlId");

-- CreateIndex
CREATE INDEX "TestComponentSignal_controlId_idx" ON "TestComponentSignal"("controlId");

-- CreateIndex
CREATE INDEX "TestComponentSignal_testComponentId_idx" ON "TestComponentSignal"("testComponentId");

-- CreateIndex
CREATE INDEX "ControlRole_controlId_idx" ON "ControlRole"("controlId");

-- CreateIndex
CREATE INDEX "ImplementationGuidance_controlId_idx" ON "ImplementationGuidance"("controlId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlApplicability_controlId_key" ON "ControlApplicability"("controlId");

-- CreateIndex
CREATE INDEX "ControlRiskMapping_controlId_idx" ON "ControlRiskMapping"("controlId");

-- CreateIndex
CREATE INDEX "ControlRiskMapping_riskId_idx" ON "ControlRiskMapping"("riskId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlRiskMapping_controlId_riskId_key" ON "ControlRiskMapping"("controlId", "riskId");

-- CreateIndex
CREATE INDEX "ControlThreatMapping_controlId_idx" ON "ControlThreatMapping"("controlId");

-- CreateIndex
CREATE INDEX "ControlThreatMapping_threatId_idx" ON "ControlThreatMapping"("threatId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlThreatMapping_controlId_threatId_key" ON "ControlThreatMapping"("controlId", "threatId");

-- CreateIndex
CREATE INDEX "EvidenceEvaluation_conversationId_idx" ON "EvidenceEvaluation"("conversationId");

-- CreateIndex
CREATE INDEX "EvidenceEvaluation_controlId_idx" ON "EvidenceEvaluation"("controlId");
