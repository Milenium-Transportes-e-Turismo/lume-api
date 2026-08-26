ALTER TABLE "whatsapp_conversations"
ADD COLUMN "archived_at" TIMESTAMPTZ,
ADD COLUMN "archive_reason" VARCHAR(40),
ADD COLUMN "archived_by_user_id" UUID,
ADD COLUMN "archive_exempted_at" TIMESTAMPTZ;

CREATE INDEX "whatsapp_conversations_company_archived_updated_idx"
ON "whatsapp_conversations"("company_id", "archived_at", "updated_at");

UPDATE "whatsapp_conversations"
SET
  "archived_at" = CURRENT_TIMESTAMP,
  "archive_reason" = 'automatic-inactivity'
WHERE "archived_at" IS NULL
  AND COALESCE(
    GREATEST("last_inbound_at", "last_outbound_at"),
    "last_inbound_at",
    "last_outbound_at",
    "created_at"
  ) < CURRENT_TIMESTAMP - INTERVAL '5 years';
