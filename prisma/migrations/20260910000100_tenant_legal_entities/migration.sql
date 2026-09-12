-- Tenant-owned legal entities are independent from client/employee registrations.
-- Preserve all existing IDs, downstream references and the original audit history.
ALTER TABLE "transport_supplier_profiles"
  ADD COLUMN "cnpj" VARCHAR(14),
  ADD COLUMN "legal_name" VARCHAR(160),
  ADD COLUMN "trade_name" VARCHAR(120),
  ADD COLUMN "legacy_registration_id" UUID;

UPDATE "transport_supplier_profiles" AS own
SET "cnpj" = person."cnpj",
    "legal_name" = person."legal_name",
    "trade_name" = person."trade_name",
    "legacy_registration_id" = person."id",
    "version" = person."version"
FROM "routing_companies" AS person
WHERE person."id" = own."registration_id"
  AND person."company_id" = own."company_id";

ALTER TABLE "transport_supplier_profiles"
  ALTER COLUMN "cnpj" SET NOT NULL,
  ALTER COLUMN "legal_name" SET NOT NULL;

ALTER TABLE "transport_supplier_profiles"
  DROP CONSTRAINT "transport_supplier_profiles_registration_id_company_id_fkey";
CREATE UNIQUE INDEX "transport_supplier_profiles_company_id_cnpj_key"
  ON "transport_supplier_profiles" ("company_id", "cnpj");
CREATE UNIQUE INDEX "transport_supplier_profiles_legacy_registration_id_key"
  ON "transport_supplier_profiles" ("legacy_registration_id");
ALTER TABLE "transport_supplier_profiles"
  ADD CONSTRAINT "transport_supplier_profiles_legacy_registration_fkey"
  FOREIGN KEY ("legacy_registration_id", "company_id")
  REFERENCES "routing_companies" ("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "transport_supplier_profiles_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "transport_supplier_profiles_legacy_tenant_key"
  ON "transport_supplier_profiles" ("legacy_registration_id", "company_id");
