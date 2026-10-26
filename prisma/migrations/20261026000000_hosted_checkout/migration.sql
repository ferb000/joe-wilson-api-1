ALTER TABLE "payments" ADD COLUMN "checkoutSessionId" TEXT;
CREATE UNIQUE INDEX "payments_checkoutSessionId_key" ON "payments"("checkoutSessionId");
