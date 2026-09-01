ALTER TABLE "routing_companies"
  ADD COLUMN "is_temporary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "temporary_reason" VARCHAR(500),
  ADD COLUMN "regularization_due_at" TIMESTAMPTZ(3),
  ADD COLUMN "regularized_at" TIMESTAMPTZ(3),
  ADD COLUMN "regularization_requirements" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "temporary_responsible_user_id" UUID;

ALTER TABLE "routing_companies"
  ADD CONSTRAINT "routing_companies_temporary_data_check"
  CHECK (
    NOT "is_temporary"
    OR (
      "temporary_reason" IS NOT NULL
      AND length(btrim("temporary_reason")) > 0
      AND "regularization_due_at" IS NOT NULL
      AND "temporary_responsible_user_id" IS NOT NULL
    )
  );

CREATE INDEX "routing_companies_company_temporary_due_idx"
  ON "routing_companies"("company_id", "is_temporary", "regularization_due_at");

ALTER TABLE "routing_companies"
  ADD CONSTRAINT "routing_companies_temporary_responsible_company_fkey"
  FOREIGN KEY ("temporary_responsible_user_id", "company_id")
  REFERENCES "users"("id", "company_id")
  ON DELETE NO ACTION
  ON UPDATE CASCADE;
