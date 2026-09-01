CREATE TYPE "CommercialServiceRequirementKind" AS ENUM (
  'financial',
  'operational'
);

CREATE TABLE "commercial_service_requirement_attestations" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "source_quote_request_id" UUID NOT NULL,
  "source_quote_version" INTEGER NOT NULL,
  "source_item_key" VARCHAR(80) NOT NULL,
  "kind" "CommercialServiceRequirementKind" NOT NULL,
  "evidence" VARCHAR(500) NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "command_id" UUID NOT NULL,
  "command_fingerprint" CHAR(64) NOT NULL,
  "attested_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "commercial_service_requirement_attestations_pkey"
    PRIMARY KEY ("id"),
  CONSTRAINT "commercial_service_attestations_values_check" CHECK (
    "source_quote_version" >= 1
    AND length(btrim("source_item_key")) BETWEEN 1 AND 80
    AND length(btrim("evidence")) BETWEEN 3 AND 500
  )
);

CREATE UNIQUE INDEX "commercial_service_attestations_id_company_key"
ON "commercial_service_requirement_attestations"("id", "company_id");

CREATE UNIQUE INDEX "commercial_service_attestations_service_source_key"
ON "commercial_service_requirement_attestations"(
  "id",
  "company_id",
  "source_quote_request_id",
  "source_quote_version",
  "source_item_key"
);

CREATE UNIQUE INDEX "commercial_service_attestations_company_command_key"
ON "commercial_service_requirement_attestations"("company_id", "command_id");

CREATE UNIQUE INDEX "commercial_service_attestations_quote_requirement_key"
ON "commercial_service_requirement_attestations"(
  "company_id",
  "source_quote_request_id",
  "source_quote_version",
  "source_item_key",
  "kind"
);

CREATE INDEX "commercial_service_attestations_actor_created_idx"
ON "commercial_service_requirement_attestations"(
  "actor_user_id",
  "company_id",
  "attested_at"
);

ALTER TABLE "commercial_service_requirement_attestations"
ADD CONSTRAINT "commercial_service_attestations_company_fkey"
FOREIGN KEY ("company_id") REFERENCES "companies"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "commercial_service_requirement_attestations"
ADD CONSTRAINT "commercial_service_attestations_quote_company_fkey"
FOREIGN KEY ("source_quote_request_id", "company_id")
REFERENCES "quote_requests"("id", "company_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_service_requirement_attestations"
ADD CONSTRAINT "commercial_service_attestations_actor_company_fkey"
FOREIGN KEY ("actor_user_id", "company_id")
REFERENCES "users"("id", "company_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "confirmed_services"
ADD COLUMN "financial_attestation_id" UUID,
ADD COLUMN "operational_attestation_id" UUID;

ALTER TABLE "confirmed_services"
ADD CONSTRAINT "confirmed_services_attestations_distinct_check" CHECK (
  "financial_attestation_id" IS NULL
  OR "operational_attestation_id" IS NULL
  OR "financial_attestation_id" <> "operational_attestation_id"
);

ALTER TABLE "confirmed_services"
ADD CONSTRAINT "confirmed_services_financial_attestation_fkey"
FOREIGN KEY (
  "financial_attestation_id",
  "company_id",
  "source_quote_request_id",
  "source_quote_version",
  "source_item_key"
)
REFERENCES "commercial_service_requirement_attestations"(
  "id",
  "company_id",
  "source_quote_request_id",
  "source_quote_version",
  "source_item_key"
)
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "confirmed_services"
ADD CONSTRAINT "confirmed_services_operational_attestation_fkey"
FOREIGN KEY (
  "operational_attestation_id",
  "company_id",
  "source_quote_request_id",
  "source_quote_version",
  "source_item_key"
)
REFERENCES "commercial_service_requirement_attestations"(
  "id",
  "company_id",
  "source_quote_request_id",
  "source_quote_version",
  "source_item_key"
)
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "confirmed_services"
ALTER COLUMN "financial_attestation_id" SET NOT NULL,
ALTER COLUMN "operational_attestation_id" SET NOT NULL;
