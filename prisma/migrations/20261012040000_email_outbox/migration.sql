CREATE TABLE "email_outbox" ("id" TEXT PRIMARY KEY, "to" TEXT NOT NULL, "subject" TEXT NOT NULL, "html" TEXT NOT NULL, "enqueuedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "email_outbox_enqueuedAt_createdAt_idx" ON "email_outbox"("enqueuedAt", "createdAt");
