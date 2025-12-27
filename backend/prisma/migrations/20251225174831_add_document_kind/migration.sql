-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "standard" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Document" ("conversationId", "createdAt", "id", "mimeType", "originalName", "sizeBytes", "standard", "storagePath") SELECT "conversationId", "createdAt", "id", "mimeType", "originalName", "sizeBytes", "standard", "storagePath" FROM "Document";
DROP TABLE "Document";
ALTER TABLE "new_Document" RENAME TO "Document";
CREATE INDEX "Document_conversationId_idx" ON "Document"("conversationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
