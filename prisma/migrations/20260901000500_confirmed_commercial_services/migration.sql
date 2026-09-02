CREATE TABLE "confirmed_services" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "source_quote_request_id" UUID NOT NULL,
  "source_quote_version" INTEGER NOT NULL,
  "source_item_key" VARCHAR(80) NOT NULL,
  "service_snapshot" JSONB NOT NULL,
  "requirements_snapshot" JSONB NOT NULL,
  "confirmation_basis" VARCHAR(500) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "confirmed_by_user_id" UUID NOT NULL,
  "confirmed_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "confirmed_services_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "confirmed_services_versions_check"
    CHECK ("source_quote_version" >= 1 AND "version" >= 1),
  CONSTRAINT "confirmed_services_source_item_key_check"
    CHECK (length(btrim("source_item_key")) BETWEEN 1 AND 80),
  CONSTRAINT "confirmed_services_confirmation_basis_check"
    CHECK (length(btrim("confirmation_basis")) BETWEEN 3 AND 500)
);

CREATE TABLE "confirmed_service_history" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "confirmed_service_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "command_id" UUID NOT NULL,
  "command_fingerprint" CHAR(64) NOT NULL,
  "action" VARCHAR(40) NOT NULL,
  "expected_version" INTEGER NOT NULL,
  "resulting_version" INTEGER NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "confirmed_service_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "confirmed_service_history_versions_check"
    CHECK ("expected_version" >= 1 AND "resulting_version" >= 1)
);

CREATE UNIQUE INDEX "confirmed_services_id_company_id_key"
  ON "confirmed_services"("id", "company_id");

CREATE UNIQUE INDEX "confirmed_services_company_source_quote_item_key"
  ON "confirmed_services"(
    "company_id",
    "source_quote_request_id",
    "source_item_key"
  );

CREATE INDEX "confirmed_services_company_confirmed_at_idx"
  ON "confirmed_services"("company_id", "confirmed_at");

CREATE INDEX "confirmed_services_company_quote_version_idx"
  ON "confirmed_services"(
    "company_id",
    "source_quote_request_id",
    "source_quote_version"
  );

CREATE UNIQUE INDEX "confirmed_service_history_company_command_key"
  ON "confirmed_service_history"("company_id", "command_id");

CREATE INDEX "confirmed_service_history_company_service_version_idx"
  ON "confirmed_service_history"(
    "company_id",
    "confirmed_service_id",
    "resulting_version"
  );

CREATE INDEX "confirmed_service_history_actor_company_created_idx"
  ON "confirmed_service_history"("actor_user_id", "company_id", "created_at");

ALTER TABLE "confirmed_services"
  ADD CONSTRAINT "confirmed_services_company_id_fkey"
  FOREIGN KEY ("company_id")
  REFERENCES "companies"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "confirmed_services"
  ADD CONSTRAINT "confirmed_services_source_quote_company_fkey"
  FOREIGN KEY ("source_quote_request_id", "company_id")
  REFERENCES "quote_requests"("id", "company_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "confirmed_services"
  ADD CONSTRAINT "confirmed_services_confirmer_company_fkey"
  FOREIGN KEY ("confirmed_by_user_id", "company_id")
  REFERENCES "users"("id", "company_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "confirmed_service_history"
  ADD CONSTRAINT "confirmed_service_history_company_id_fkey"
  FOREIGN KEY ("company_id")
  REFERENCES "companies"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "confirmed_service_history"
  ADD CONSTRAINT "confirmed_service_history_service_company_fkey"
  FOREIGN KEY ("confirmed_service_id", "company_id")
  REFERENCES "confirmed_services"("id", "company_id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "confirmed_service_history"
  ADD CONSTRAINT "confirmed_service_history_actor_company_fkey"
  FOREIGN KEY ("actor_user_id", "company_id")
  REFERENCES "users"("id", "company_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

COMMENT ON TABLE "confirmed_services" IS
  'Confirmação comercial explícita e imutável. A aprovação do orçamento não cria este registro automaticamente.';

COMMENT ON COLUMN "confirmed_services"."requirements_snapshot" IS
  'Checklist com aceite comprovado pelo orçamento e declarações manuais financeira/operacional, sempre com proveniência.';
