CREATE TYPE "RegistrationImportBatchStatus" AS ENUM (
  'processing',
  'completed',
  'completed-with-errors',
  'failed'
);

CREATE TYPE "RegistrationCandidateStatus" AS ENUM (
  'imported',
  'processing',
  'insufficient-data',
  'ready-for-decision',
  'ambiguous',
  'in-review',
  'unidentified',
  'ignored',
  'approved',
  'promoted',
  'error'
);

CREATE TYPE "RegistrationExternalRecordKind" AS ENUM (
  'pdf-customer',
  'whatsapp-contact'
);

CREATE TYPE "RegistrationDecisionAction" AS ENUM (
  'start-review',
  'save-review',
  'mark-unidentified',
  'ignore',
  'approve',
  'promote'
);

ALTER TABLE "routing_companies"
  ADD COLUMN "first_name" VARCHAR(80),
  ADD COLUMN "last_name" VARCHAR(120);

UPDATE "routing_companies"
SET "first_name" = "individual_name"
WHERE "client_type" = 'pf' AND "first_name" IS NULL;

CREATE TABLE "registration_roles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "code" VARCHAR(48) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registration_roles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registration_roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "registration_roles_id_company_id_key" ON "registration_roles"("id", "company_id");
CREATE UNIQUE INDEX "registration_roles_company_id_code_key" ON "registration_roles"("company_id", "code");
CREATE INDEX "registration_roles_company_id_active_name_idx" ON "registration_roles"("company_id", "active", "name");

CREATE TABLE "registration_role_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "registration_id" UUID NOT NULL,
  "role_id" UUID NOT NULL,
  "assigned_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registration_role_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registration_role_assignments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_role_assignments_registration_id_company_id_fkey" FOREIGN KEY ("registration_id", "company_id") REFERENCES "routing_companies"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_role_assignments_role_id_company_id_fkey" FOREIGN KEY ("role_id", "company_id") REFERENCES "registration_roles"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "registration_role_assignments_company_registration_role_key" ON "registration_role_assignments"("company_id", "registration_id", "role_id");
CREATE INDEX "registration_role_assignments_company_role_registration_idx" ON "registration_role_assignments"("company_id", "role_id", "registration_id");

CREATE TABLE "registration_tags" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "color" VARCHAR(24),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registration_tags_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registration_tags_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "registration_tags_id_company_id_key" ON "registration_tags"("id", "company_id");
CREATE UNIQUE INDEX "registration_tags_company_id_code_key" ON "registration_tags"("company_id", "code");
CREATE INDEX "registration_tags_company_id_active_name_idx" ON "registration_tags"("company_id", "active", "name");

CREATE TABLE "registration_tag_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "registration_id" UUID NOT NULL,
  "tag_id" UUID NOT NULL,
  "assigned_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registration_tag_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registration_tag_assignments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_tag_assignments_registration_id_company_id_fkey" FOREIGN KEY ("registration_id", "company_id") REFERENCES "routing_companies"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_tag_assignments_tag_id_company_id_fkey" FOREIGN KEY ("tag_id", "company_id") REFERENCES "registration_tags"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "registration_tag_assignments_company_registration_tag_key" ON "registration_tag_assignments"("company_id", "registration_id", "tag_id");
CREATE INDEX "registration_tag_assignments_company_tag_registration_idx" ON "registration_tag_assignments"("company_id", "tag_id", "registration_id");

CREATE TABLE "registration_phones" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "registration_id" UUID NOT NULL,
  "original_value" VARCHAR(40),
  "normalized_value" VARCHAR(16) NOT NULL,
  "country_code" VARCHAR(4) NOT NULL DEFAULT '55',
  "area_code" VARCHAR(4),
  "number" VARCHAR(14) NOT NULL,
  "type" VARCHAR(30) NOT NULL DEFAULT 'mobile',
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "has_whatsapp" BOOLEAN NOT NULL DEFAULT false,
  "whatsapp_contact_id" UUID,
  "active_from" DATE DEFAULT CURRENT_DATE,
  "active_until" DATE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registration_phones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registration_phones_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_phones_registration_id_company_id_fkey" FOREIGN KEY ("registration_id", "company_id") REFERENCES "routing_companies"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "registration_phones_company_registration_normalized_key" ON "registration_phones"("company_id", "registration_id", "normalized_value");
CREATE INDEX "registration_phones_company_normalized_idx" ON "registration_phones"("company_id", "normalized_value");
CREATE INDEX "registration_phones_company_whatsapp_contact_idx" ON "registration_phones"("company_id", "whatsapp_contact_id");

CREATE TABLE "registration_emails" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "registration_id" UUID NOT NULL,
  "address" VARCHAR(254) NOT NULL,
  "type" VARCHAR(30) NOT NULL DEFAULT 'personal',
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registration_emails_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registration_emails_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_emails_registration_id_company_id_fkey" FOREIGN KEY ("registration_id", "company_id") REFERENCES "routing_companies"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "registration_emails_company_registration_address_key" ON "registration_emails"("company_id", "registration_id", "address");
CREATE INDEX "registration_emails_company_address_idx" ON "registration_emails"("company_id", "address");

CREATE TABLE "registration_relationships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "source_registration_id" UUID NOT NULL,
  "target_registration_id" UUID NOT NULL,
  "type" VARCHAR(60) NOT NULL,
  "job_title" VARCHAR(120),
  "department" VARCHAR(120),
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registration_relationships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registration_relationships_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_relationships_source_company_fkey" FOREIGN KEY ("source_registration_id", "company_id") REFERENCES "routing_companies"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_relationships_target_company_fkey" FOREIGN KEY ("target_registration_id", "company_id") REFERENCES "routing_companies"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_relationships_distinct_check" CHECK ("source_registration_id" <> "target_registration_id")
);

CREATE UNIQUE INDEX "registration_relationships_company_source_target_type_key" ON "registration_relationships"("company_id", "source_registration_id", "target_registration_id", "type");
CREATE INDEX "registration_relationships_company_target_active_idx" ON "registration_relationships"("company_id", "target_registration_id", "active");

CREATE TABLE "registration_external_references" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "registration_id" UUID NOT NULL,
  "provider" VARCHAR(40) NOT NULL,
  "resource_type" VARCHAR(60) NOT NULL,
  "external_resource_id" VARCHAR(200) NOT NULL,
  "external_etag" VARCHAR(200),
  "sync_status" VARCHAR(40),
  "last_synced_at" TIMESTAMPTZ(3),
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registration_external_references_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registration_external_references_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_external_references_registration_company_fkey" FOREIGN KEY ("registration_id", "company_id") REFERENCES "routing_companies"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "registration_external_references_provider_resource_key" ON "registration_external_references"("company_id", "provider", "resource_type", "external_resource_id");
CREATE INDEX "registration_external_references_registration_provider_idx" ON "registration_external_references"("company_id", "registration_id", "provider");

INSERT INTO "registration_external_references" (
  "company_id", "registration_id", "provider", "resource_type", "external_resource_id", "sync_status"
)
SELECT
  "company_id", "id", 'AVIC', 'registration', "avic_external_id", 'reference-only'
FROM "routing_companies"
WHERE "avic_external_id" IS NOT NULL;

CREATE TABLE "registration_import_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "file_sha256" CHAR(64) NOT NULL,
  "source" VARCHAR(80) NOT NULL DEFAULT 'whatsapp-analysis-workbook',
  "status" "RegistrationImportBatchStatus" NOT NULL DEFAULT 'processing',
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "counts" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "imported_rows" INTEGER NOT NULL DEFAULT 0,
  "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
  "ignored_rows" INTEGER NOT NULL DEFAULT 0,
  "error_rows" INTEGER NOT NULL DEFAULT 0,
  "error_message" VARCHAR(1000),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registration_import_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registration_import_batches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_import_batches_actor_company_fkey" FOREIGN KEY ("actor_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "registration_import_batches_id_company_id_key" ON "registration_import_batches"("id", "company_id");
CREATE UNIQUE INDEX "registration_import_batches_company_file_sha_key" ON "registration_import_batches"("company_id", "file_sha256");
CREATE INDEX "registration_import_batches_company_status_created_idx" ON "registration_import_batches"("company_id", "status", "created_at");

CREATE TABLE "registration_external_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "kind" "RegistrationExternalRecordKind" NOT NULL,
  "source_sheet" VARCHAR(80) NOT NULL,
  "source_row" INTEGER NOT NULL,
  "external_id" VARCHAR(200) NOT NULL,
  "fingerprint" CHAR(64) NOT NULL,
  "raw_payload" JSONB NOT NULL,
  "normalized_payload" JSONB NOT NULL,
  "technical_record" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registration_external_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registration_external_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_external_records_batch_company_fkey" FOREIGN KEY ("batch_id", "company_id") REFERENCES "registration_import_batches"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "registration_external_records_id_company_id_key" ON "registration_external_records"("id", "company_id");
CREATE UNIQUE INDEX "registration_external_records_company_kind_fingerprint_key" ON "registration_external_records"("company_id", "kind", "fingerprint");
CREATE INDEX "registration_external_records_company_kind_external_idx" ON "registration_external_records"("company_id", "kind", "external_id");
CREATE INDEX "registration_external_records_batch_sheet_row_idx" ON "registration_external_records"("batch_id", "source_sheet", "source_row");

CREATE TABLE "registration_candidates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "status" "RegistrationCandidateStatus" NOT NULL DEFAULT 'imported',
  "suggested_type" "RoutingClientType",
  "confirmed_type" "RoutingClientType",
  "display_name" VARCHAR(200),
  "normalized_name" VARCHAR(200),
  "document_original" VARCHAR(40),
  "document_normalized" VARCHAR(14),
  "document_valid" BOOLEAN,
  "phone_original" VARCHAR(40),
  "phone_normalized" VARCHAR(16),
  "city" VARCHAR(120),
  "state" VARCHAR(2),
  "confidence" INTEGER NOT NULL DEFAULT 0,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "suggested_roles" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "suggested_role_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "evidence" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "quality_issues" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "minimum_data_complete" BOOLEAN NOT NULL DEFAULT false,
  "confirmed_payload" JSONB,
  "whatsapp_conversation_id" UUID,
  "reviewer_user_id" UUID,
  "reviewed_at" TIMESTAMPTZ(3),
  "promoted_registration_id" UUID,
  "promoted_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registration_candidates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registration_candidates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_candidates_batch_company_fkey" FOREIGN KEY ("batch_id", "company_id") REFERENCES "registration_import_batches"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_candidates_reviewer_company_fkey" FOREIGN KEY ("reviewer_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "registration_candidates_promoted_registration_company_fkey" FOREIGN KEY ("promoted_registration_id", "company_id") REFERENCES "routing_companies"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "registration_candidates_confidence_check" CHECK ("confidence" BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX "registration_candidates_id_company_id_key" ON "registration_candidates"("id", "company_id");
CREATE INDEX "registration_candidates_company_status_priority_created_idx" ON "registration_candidates"("company_id", "status", "priority", "created_at");
CREATE INDEX "registration_candidates_company_normalized_name_idx" ON "registration_candidates"("company_id", "normalized_name");
CREATE INDEX "registration_candidates_company_phone_idx" ON "registration_candidates"("company_id", "phone_normalized");
CREATE INDEX "registration_candidates_company_document_idx" ON "registration_candidates"("company_id", "document_normalized");
CREATE INDEX "registration_candidates_suggested_role_codes_idx" ON "registration_candidates" USING GIN ("suggested_role_codes");
CREATE INDEX "registration_candidates_company_reviewer_reviewed_idx" ON "registration_candidates"("company_id", "reviewer_user_id", "reviewed_at");
CREATE INDEX "registration_candidates_company_complete_priority_idx" ON "registration_candidates"("company_id", "minimum_data_complete", "priority");

CREATE TABLE "registration_candidate_sources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "candidate_id" UUID NOT NULL,
  "external_record_id" UUID NOT NULL,
  "match_rule" VARCHAR(80),
  "score" INTEGER,
  "evidence" TEXT,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registration_candidate_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registration_candidate_sources_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_candidate_sources_candidate_company_fkey" FOREIGN KEY ("candidate_id", "company_id") REFERENCES "registration_candidates"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_candidate_sources_record_company_fkey" FOREIGN KEY ("external_record_id", "company_id") REFERENCES "registration_external_records"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "registration_candidate_sources_company_candidate_record_key" ON "registration_candidate_sources"("company_id", "candidate_id", "external_record_id");
CREATE INDEX "registration_candidate_sources_company_record_idx" ON "registration_candidate_sources"("company_id", "external_record_id");

CREATE TABLE "registration_review_decisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "candidate_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "command_id" UUID NOT NULL,
  "action" "RegistrationDecisionAction" NOT NULL,
  "before_snapshot" JSONB,
  "after_snapshot" JSONB NOT NULL,
  "note" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registration_review_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registration_review_decisions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_review_decisions_candidate_company_fkey" FOREIGN KEY ("candidate_id", "company_id") REFERENCES "registration_candidates"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_review_decisions_actor_company_fkey" FOREIGN KEY ("actor_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "registration_review_decisions_company_command_key" ON "registration_review_decisions"("company_id", "command_id");
CREATE INDEX "registration_review_decisions_company_candidate_created_idx" ON "registration_review_decisions"("company_id", "candidate_id", "created_at");

INSERT INTO "registration_roles" ("company_id", "code", "name", "is_system")
SELECT c."id", role."code", role."name", true
FROM "companies" c
CROSS JOIN (
  VALUES
    ('client', 'Cliente'),
    ('supplier', 'Fornecedor'),
    ('employee', 'Funcionário'),
    ('service-provider', 'Prestador de serviço'),
    ('partner', 'Parceiro'),
    ('driver', 'Motorista'),
    ('passenger', 'Passageiro')
) AS role("code", "name")
ON CONFLICT ("company_id", "code") DO NOTHING;

INSERT INTO "registration_tags" ("company_id", "code", "name")
SELECT c."id", tag."code", tag."name"
FROM "companies" c
CROSS JOIN (
  VALUES
    ('commercial', 'Comercial'),
    ('operations', 'Operacional'),
    ('financial', 'Financeiro'),
    ('human-resources', 'Recursos Humanos'),
    ('personnel-department', 'Departamento Pessoal'),
    ('maintenance', 'Manutenção'),
    ('passenger', 'Passageiro'),
    ('tourism', 'Turismo')
) AS tag("code", "name")
ON CONFLICT ("company_id", "code") DO NOTHING;

INSERT INTO "registration_role_assignments" ("company_id", "registration_id", "role_id")
SELECT rc."company_id", rc."id", rr."id"
FROM "routing_companies" rc
JOIN "registration_roles" rr
  ON rr."company_id" = rc."company_id" AND rr."code" = 'client'
ON CONFLICT ("company_id", "registration_id", "role_id") DO NOTHING;

INSERT INTO "registration_phones" (
  "company_id",
  "registration_id",
  "original_value",
  "normalized_value",
  "country_code",
  "area_code",
  "number",
  "type",
  "is_primary",
  "has_whatsapp"
)
SELECT
  rc."company_id",
  rc."id",
  CASE WHEN rc."client_type" = 'pf' THEN rc."individual_whatsapp" ELSE rc."legal_whatsapp" END,
  CASE WHEN rc."client_type" = 'pf' THEN rc."individual_whatsapp" ELSE rc."legal_whatsapp" END,
  '55',
  substring(CASE WHEN rc."client_type" = 'pf' THEN rc."individual_whatsapp" ELSE rc."legal_whatsapp" END FROM 3 FOR 2),
  substring(CASE WHEN rc."client_type" = 'pf' THEN rc."individual_whatsapp" ELSE rc."legal_whatsapp" END FROM 5),
  'mobile',
  true,
  true
FROM "routing_companies" rc
WHERE CASE WHEN rc."client_type" = 'pf' THEN rc."individual_whatsapp" ELSE rc."legal_whatsapp" END IS NOT NULL
ON CONFLICT ("company_id", "registration_id", "normalized_value") DO NOTHING;

INSERT INTO "registration_emails" (
  "company_id",
  "registration_id",
  "address",
  "type",
  "is_primary"
)
SELECT
  rc."company_id",
  rc."id",
  lower(CASE WHEN rc."client_type" = 'pf' THEN rc."individual_email" ELSE rc."legal_email" END),
  CASE WHEN rc."client_type" = 'pf' THEN 'personal' ELSE 'commercial' END,
  true
FROM "routing_companies" rc
WHERE CASE WHEN rc."client_type" = 'pf' THEN rc."individual_email" ELSE rc."legal_email" END IS NOT NULL
ON CONFLICT ("company_id", "registration_id", "address") DO NOTHING;

CREATE OR REPLACE FUNCTION "reject_registration_review_decision_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'registration_review_decisions is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "registration_review_decisions_append_only"
BEFORE UPDATE OR DELETE ON "registration_review_decisions"
FOR EACH ROW EXECUTE FUNCTION "reject_registration_review_decision_mutation"();
