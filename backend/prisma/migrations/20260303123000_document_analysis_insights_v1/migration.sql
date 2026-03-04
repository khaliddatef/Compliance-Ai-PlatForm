-- Add structured document analysis insights (12 extraction dimensions).
ALTER TABLE "Document" ADD COLUMN "analysisJson" JSON;
ALTER TABLE "Document" ADD COLUMN "analysisVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Document" ADD COLUMN "analysisComputedAt" DATETIME;

CREATE INDEX "Document_analysisComputedAt_idx" ON "Document"("analysisComputedAt");
