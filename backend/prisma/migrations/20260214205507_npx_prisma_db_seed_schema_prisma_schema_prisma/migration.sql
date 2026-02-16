-- CreateTable
CREATE TABLE "ConversationVisibility" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ConversationVisibility_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConversationVisibility_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TopicFrameworkMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "frameworkId" TEXT,
    "framework" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TopicFrameworkMapping_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "ControlTopic" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TopicFrameworkMapping_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "Framework" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ConversationVisibility_userId_idx" ON "ConversationVisibility"("userId");

-- CreateIndex
CREATE INDEX "ConversationVisibility_conversationId_idx" ON "ConversationVisibility"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationVisibility_conversationId_userId_key" ON "ConversationVisibility"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "TopicFrameworkMapping_topicId_idx" ON "TopicFrameworkMapping"("topicId");

-- CreateIndex
CREATE INDEX "TopicFrameworkMapping_framework_idx" ON "TopicFrameworkMapping"("framework");

-- CreateIndex
CREATE INDEX "TopicFrameworkMapping_frameworkId_idx" ON "TopicFrameworkMapping"("frameworkId");

-- CreateIndex
CREATE UNIQUE INDEX "TopicFrameworkMapping_topicId_framework_key" ON "TopicFrameworkMapping"("topicId", "framework");
