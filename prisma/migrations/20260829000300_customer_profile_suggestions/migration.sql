-- Customer profile memory is intentionally two-step: an agent may only create
-- a suggestion; an authenticated human must approve it before it becomes part
-- of CustomerContext. This migration is additive and preserves all history.

CREATE TYPE "CustomerProfileSuggestionStatus" AS ENUM (
  'pending',
  'approved',
  'ignored'
);

CREATE TABLE "customer_profile_suggestions" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "whatsapp_contact_id" UUID NOT NULL,
  "registration_id" UUID,
  "service_session_id" UUID,
  "agent_execution_id" UUID,
  "profile_key" VARCHAR(80) NOT NULL,
  "suggested_value" VARCHAR(1000) NOT NULL,
  "rationale" VARCHAR(1000),
  "origin" JSONB NOT NULL DEFAULT '{}',
  "status" "CustomerProfileSuggestionStatus" NOT NULL DEFAULT 'pending',
  "reviewed_by_user_id" UUID,
  "reviewed_at" TIMESTAMPTZ(3),
  "review_reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "customer_profile_suggestions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_profile_suggestions_id_company_key" UNIQUE ("id", "company_id"),
  CONSTRAINT "customer_profile_suggestions_review_check" CHECK (
    (
      "status" = 'pending'
      AND "reviewed_by_user_id" IS NULL
      AND "reviewed_at" IS NULL
    ) OR (
      "status" IN ('approved', 'ignored')
      AND "reviewed_by_user_id" IS NOT NULL
      AND "reviewed_at" IS NOT NULL
    )
  ),
  CONSTRAINT "customer_profile_suggestions_origin_check" CHECK (
    "service_session_id" IS NOT NULL
    OR "agent_execution_id" IS NOT NULL
    OR "origin" <> '{}'::jsonb
  )
);

CREATE INDEX "customer_profile_suggestions_contact_status_created_idx"
  ON "customer_profile_suggestions" ("company_id", "whatsapp_contact_id", "status", "created_at");
CREATE INDEX "customer_profile_suggestions_registration_status_created_idx"
  ON "customer_profile_suggestions" ("company_id", "registration_id", "status", "created_at");
CREATE INDEX "customer_profile_suggestions_session_company_idx"
  ON "customer_profile_suggestions" ("service_session_id", "company_id");
CREATE INDEX "customer_profile_suggestions_execution_company_idx"
  ON "customer_profile_suggestions" ("agent_execution_id", "company_id");
CREATE INDEX "customer_profile_suggestions_reviewer_company_idx"
  ON "customer_profile_suggestions" ("reviewed_by_user_id", "company_id");
CREATE UNIQUE INDEX "customer_profile_suggestions_execution_key_unique"
  ON "customer_profile_suggestions" ("company_id", "agent_execution_id", "profile_key")
  WHERE "agent_execution_id" IS NOT NULL;

ALTER TABLE "customer_profile_suggestions"
  ADD CONSTRAINT "customer_profile_suggestions_company_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_profile_suggestions"
  ADD CONSTRAINT "customer_profile_suggestions_contact_fkey"
  FOREIGN KEY ("whatsapp_contact_id", "company_id")
  REFERENCES "whatsapp_contacts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_profile_suggestions"
  ADD CONSTRAINT "customer_profile_suggestions_registration_fkey"
  FOREIGN KEY ("registration_id", "company_id")
  REFERENCES "routing_companies"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_profile_suggestions"
  ADD CONSTRAINT "customer_profile_suggestions_session_fkey"
  FOREIGN KEY ("service_session_id", "company_id")
  REFERENCES "service_sessions"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_profile_suggestions"
  ADD CONSTRAINT "customer_profile_suggestions_execution_fkey"
  FOREIGN KEY ("agent_execution_id", "company_id")
  REFERENCES "agent_executions"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_profile_suggestions"
  ADD CONSTRAINT "customer_profile_suggestions_reviewer_fkey"
  FOREIGN KEY ("reviewed_by_user_id", "company_id")
  REFERENCES "users"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION protect_customer_profile_suggestion_source()
RETURNS trigger AS $$
BEGIN
  IF NEW."company_id" IS DISTINCT FROM OLD."company_id"
    OR NEW."whatsapp_contact_id" IS DISTINCT FROM OLD."whatsapp_contact_id"
    OR NEW."registration_id" IS DISTINCT FROM OLD."registration_id"
    OR NEW."service_session_id" IS DISTINCT FROM OLD."service_session_id"
    OR NEW."agent_execution_id" IS DISTINCT FROM OLD."agent_execution_id"
    OR NEW."profile_key" IS DISTINCT FROM OLD."profile_key"
    OR NEW."suggested_value" IS DISTINCT FROM OLD."suggested_value"
    OR NEW."rationale" IS DISTINCT FROM OLD."rationale"
    OR NEW."origin" IS DISTINCT FROM OLD."origin"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'customer profile suggestion source is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "customer_profile_suggestions_protect_source"
BEFORE UPDATE ON "customer_profile_suggestions"
FOR EACH ROW EXECUTE FUNCTION protect_customer_profile_suggestion_source();
