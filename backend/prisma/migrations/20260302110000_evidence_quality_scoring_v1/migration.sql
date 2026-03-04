-- Evidence Quality Scoring + Explainability (additive)

ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "qualityScore" INTEGER;
ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "qualityGrade" TEXT;
ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "qualityFactors" JSON;
ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "qualityComputedAt" DATETIME;
ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "qualityVersion" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "Evidence_qualityGrade_idx" ON "Evidence"("qualityGrade");
