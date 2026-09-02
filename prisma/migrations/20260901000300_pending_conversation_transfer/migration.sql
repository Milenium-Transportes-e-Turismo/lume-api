ALTER TABLE "whatsapp_conversations"
  ADD COLUMN "pending_transfer_department" "DepartmentCode",
  ADD COLUMN "pending_transfer_reason" VARCHAR(500),
  ADD COLUMN "pending_transfer_requested_by_user_id" UUID,
  ADD COLUMN "pending_transfer_requested_at" TIMESTAMPTZ(3);

ALTER TABLE "whatsapp_conversations"
  ADD CONSTRAINT "whatsapp_conversations_pending_transfer_complete_check"
  CHECK (
    (
      "pending_transfer_department" IS NULL
      AND "pending_transfer_reason" IS NULL
      AND "pending_transfer_requested_by_user_id" IS NULL
      AND "pending_transfer_requested_at" IS NULL
    )
    OR (
      "pending_transfer_department" IS NOT NULL
      AND "pending_transfer_department" <> "department"
      AND "pending_transfer_reason" IS NOT NULL
      AND length(btrim("pending_transfer_reason")) BETWEEN 3 AND 500
      AND "pending_transfer_requested_by_user_id" IS NOT NULL
      AND "pending_transfer_requested_at" IS NOT NULL
    )
  );

CREATE INDEX "whatsapp_conversations_company_pending_transfer_updated_idx"
  ON "whatsapp_conversations"(
    "company_id",
    "pending_transfer_department",
    "updated_at"
  );

ALTER TABLE "whatsapp_conversations"
  ADD CONSTRAINT "whatsapp_conversations_pending_transfer_requester_company_fkey"
  FOREIGN KEY ("pending_transfer_requested_by_user_id", "company_id")
  REFERENCES "users"("id", "company_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
