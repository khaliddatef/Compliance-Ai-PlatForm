-- Add checksum-based dedupe support for conversation uploads.
ALTER TABLE "Document" ADD COLUMN "checksumSha256" TEXT;

CREATE INDEX "Document_checksumSha256_idx" ON "Document"("checksumSha256");
CREATE UNIQUE INDEX "Document_conversationId_kind_checksumSha256_key"
  ON "Document"("conversationId", "kind", "checksumSha256");
