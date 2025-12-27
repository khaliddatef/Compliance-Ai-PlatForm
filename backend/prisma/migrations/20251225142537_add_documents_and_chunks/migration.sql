/*
  Warnings:

  - You are about to drop the column `filename` on the `Document` table. All the data in the column will be lost.
  - You are about to drop the column `size` on the `Document` table. All the data in the column will be lost.
  - You are about to drop the column `storedPath` on the `Document` table. All the data in the column will be lost.
  - Added the required column `conversationId` to the `Document` table without a default value. This is not possible if the table is not empty.
  - Added the required column `originalName` to the `Document` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sizeBytes` to the `Document` table without a default value. This is not possible if the table is not empty.
  - Added the required column `standard` to the `Document` table without a default value. This is not possible if the table is not empty.
  - Added the required column `storagePath` to the `Document` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "standard" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Document" ("createdAt", "id", "mimeType") SELECT "createdAt", "id", "mimeType" FROM "Document";
DROP TABLE "Document";
ALTER TABLE "new_Document" RENAME TO "Document";
CREATE INDEX "Document_conversationId_idx" ON "Document"("conversationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");
