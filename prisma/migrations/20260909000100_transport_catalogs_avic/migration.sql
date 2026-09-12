-- AlterEnum
ALTER TYPE "RoutingRouteType" ADD VALUE 'unspecified';

-- AlterEnum
ALTER TYPE "RoutingContractPeriodicity" ADD VALUE 'unspecified';

-- CreateTable
CREATE TABLE "transport_supplier_profiles" (
    "registration_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transport_supplier_profiles_pkey" PRIMARY KEY ("registration_id")
);

-- CreateTable
CREATE TABLE "transport_catalog_items" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "transport_catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_fleet" (
    "provider" VARCHAR(40),
    "external_vehicle_id" VARCHAR(200),
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "fleet_code" VARCHAR(80) NOT NULL,
    "supplier_registration_id" UUID NOT NULL,
    "plate" VARCHAR(20),
    "service_type_id" UUID,
    "vehicle_type_id" UUID,
    "category_id" UUID,
    "axles" INTEGER,
    "passengers" INTEGER,
    "model" VARCHAR(160),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transport_fleet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_affiliations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "supplier_registration_id" UUID NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "transport_affiliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_contract_profiles" (
    "contract_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "supplier_registration_id" UUID NOT NULL,
    "modality" VARCHAR(24) NOT NULL,

    CONSTRAINT "transport_contract_profiles_pkey" PRIMARY KEY ("contract_id")
);

-- CreateTable
CREATE TABLE "transport_contract_conditions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "period" VARCHAR(12) NOT NULL,
    "allowance_km" DECIMAL(16,3),
    "include_garage" BOOLEAN NOT NULL,
    "transition_month" VARCHAR(7),
    "transition_allowance_km" DECIMAL(16,3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transport_contract_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_external_routes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "external_id" VARCHAR(200),
    "name" VARCHAR(200) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "transport_external_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_route_assignments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "transport_route_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_catalog_commands" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "command_id" UUID NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transport_catalog_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_integrations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL DEFAULT 'avic',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "lease_until" TIMESTAMPTZ(3),
    "last_scheduled_day" VARCHAR(10),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transport_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_imports" (
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL DEFAULT 'avic',
    "from" DATE NOT NULL,
    "to" DATE NOT NULL,
    "vehicle_ids" TEXT[],
    "vehicle_index" INTEGER NOT NULL DEFAULT 0,
    "skip" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    "last_error" VARCHAR(500),
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "schedule_key" VARCHAR(160),
    "verification_issue_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transport_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_records" (
    "driver_external_id" VARCHAR(160),
    "driver_name" VARCHAR(200),
    "customer_external_id" VARCHAR(160),
    "customer_name" VARCHAR(200),
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL DEFAULT 'avic',
    "external_id" VARCHAR(160) NOT NULL,
    "vehicle_external_id" VARCHAR(160) NOT NULL,
    "fleet" VARCHAR(160),
    "route_external_id" VARCHAR(160),
    "route_name" VARCHAR(1000),
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "sort_at" TIMESTAMPTZ(3) NOT NULL,
    "start_km" DECIMAL(16,3),
    "end_km" DECIMAL(16,3),
    "reported_km" DECIMAL(16,3),
    "service_km" DECIMAL(16,3),
    "source" VARCHAR(30) NOT NULL DEFAULT 'DRIVER_REPORTED',
    "source_updated_at" TIMESTAMPTZ(3),
    "raw" JSONB NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "verified_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transport_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_record_history" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transport_record_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_issues" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL DEFAULT 'avic',
    "record_id" UUID NOT NULL,
    "vehicle_external_id" VARCHAR(160) NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "verification_state" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "context" JSONB NOT NULL DEFAULT '{}',
    "guidance" VARCHAR(500) NOT NULL DEFAULT 'Corrija a quilometragem no sistema Avic. O Lume verificará novamente a origem e manterá o histórico.',
    "version" INTEGER NOT NULL DEFAULT 1,
    "detected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_verified_at" TIMESTAMPTZ(3),
    "next_verification_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transport_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_issue_history" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "actor_user_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "text" VARCHAR(4000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transport_issue_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_analyses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vehicle_id" VARCHAR(160) NOT NULL,
    "from" DATE NOT NULL,
    "to" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    "cursor_at" TIMESTAMPTZ(3),
    "cursor_id" UUID,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transport_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_import_commands" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "command_id" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transport_import_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_fleet_ownerships" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "fleet_id" UUID NOT NULL,
    "supplier_registration_id" UUID NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "transport_fleet_ownerships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_period_states" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "period" VARCHAR(10) NOT NULL,
    "state" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transport_period_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_import_rejections" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "import_id" UUID NOT NULL,
    "vehicle_index" INTEGER NOT NULL,
    "page_skip" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "reason" VARCHAR(400) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transport_import_rejections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transport_supplier_profiles_company_id_active_idx" ON "transport_supplier_profiles"("company_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "transport_supplier_profiles_registration_id_company_id_key" ON "transport_supplier_profiles"("registration_id", "company_id");

-- CreateIndex
CREATE INDEX "transport_catalog_items_company_id_kind_active_idx" ON "transport_catalog_items"("company_id", "kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "transport_catalog_items_id_company_id_key" ON "transport_catalog_items"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_catalog_items_company_id_kind_code_key" ON "transport_catalog_items"("company_id", "kind", "code");

-- CreateIndex
CREATE INDEX "transport_fleet_company_id_active_fleet_code_idx" ON "transport_fleet"("company_id", "active", "fleet_code");

-- CreateIndex
CREATE UNIQUE INDEX "transport_fleet_id_company_id_key" ON "transport_fleet"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_fleet_company_id_fleet_code_key" ON "transport_fleet"("company_id", "fleet_code");

-- CreateIndex
CREATE UNIQUE INDEX "transport_fleet_company_id_provider_external_vehicle_id_key" ON "transport_fleet"("company_id", "provider", "external_vehicle_id");

-- CreateIndex
CREATE INDEX "transport_affiliations_company_id_registration_id_role_vali_idx" ON "transport_affiliations"("company_id", "registration_id", "role", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "transport_affiliations_id_company_id_key" ON "transport_affiliations"("id", "company_id");

-- CreateIndex
CREATE INDEX "transport_contract_profiles_company_id_supplier_registratio_idx" ON "transport_contract_profiles"("company_id", "supplier_registration_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_contract_profiles_contract_id_company_id_key" ON "transport_contract_profiles"("contract_id", "company_id");

-- CreateIndex
CREATE INDEX "transport_contract_conditions_company_id_contract_id_valid__idx" ON "transport_contract_conditions"("company_id", "contract_id", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "transport_contract_conditions_id_company_id_key" ON "transport_contract_conditions"("id", "company_id");

-- CreateIndex
CREATE INDEX "transport_external_routes_company_id_provider_name_idx" ON "transport_external_routes"("company_id", "provider", "name");

-- CreateIndex
CREATE UNIQUE INDEX "transport_external_routes_id_company_id_key" ON "transport_external_routes"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_external_routes_company_id_provider_external_id_key" ON "transport_external_routes"("company_id", "provider", "external_id");

-- CreateIndex
CREATE INDEX "transport_route_assignments_company_id_route_id_valid_from_idx" ON "transport_route_assignments"("company_id", "route_id", "valid_from");

-- CreateIndex
CREATE INDEX "transport_route_assignments_company_id_contract_id_valid_fr_idx" ON "transport_route_assignments"("company_id", "contract_id", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "transport_route_assignments_id_company_id_key" ON "transport_route_assignments"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_catalog_commands_company_id_command_id_key" ON "transport_catalog_commands"("company_id", "command_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_integrations_company_id_provider_key" ON "transport_integrations"("company_id", "provider");

-- CreateIndex
CREATE INDEX "transport_imports_company_id_status_next_attempt_at_idx" ON "transport_imports"("company_id", "status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "transport_imports_id_company_id_key" ON "transport_imports"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_imports_company_id_provider_schedule_key_key" ON "transport_imports"("company_id", "provider", "schedule_key");

-- CreateIndex
CREATE INDEX "transport_records_company_id_provider_vehicle_external_id_s_idx" ON "transport_records"("company_id", "provider", "vehicle_external_id", "sort_at", "id");

-- CreateIndex
CREATE INDEX "transport_records_company_id_provider_route_external_id_sor_idx" ON "transport_records"("company_id", "provider", "route_external_id", "sort_at");

-- CreateIndex
CREATE UNIQUE INDEX "transport_records_id_company_id_key" ON "transport_records"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_records_company_id_provider_external_id_key" ON "transport_records"("company_id", "provider", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_record_history_company_id_record_id_version_key" ON "transport_record_history"("company_id", "record_id", "version");

-- CreateIndex
CREATE INDEX "transport_issues_company_id_status_next_verification_at_idx" ON "transport_issues"("company_id", "status", "next_verification_at");

-- CreateIndex
CREATE INDEX "transport_issues_company_id_vehicle_external_id_status_id_idx" ON "transport_issues"("company_id", "vehicle_external_id", "status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_issues_id_company_id_key" ON "transport_issues"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_issues_company_id_provider_record_id_code_key" ON "transport_issues"("company_id", "provider", "record_id", "code");

-- CreateIndex
CREATE INDEX "transport_issue_history_company_id_issue_id_created_at_idx" ON "transport_issue_history"("company_id", "issue_id", "created_at");

-- CreateIndex
CREATE INDEX "transport_analyses_company_id_status_created_at_idx" ON "transport_analyses"("company_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transport_analyses_id_company_id_key" ON "transport_analyses"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_import_commands_company_id_command_id_key" ON "transport_import_commands"("company_id", "command_id");

-- CreateIndex
CREATE INDEX "transport_fleet_ownerships_company_id_fleet_id_valid_from_idx" ON "transport_fleet_ownerships"("company_id", "fleet_id", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "transport_fleet_ownerships_id_company_id_key" ON "transport_fleet_ownerships"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_period_states_company_id_contract_id_period_key" ON "transport_period_states"("company_id", "contract_id", "period");

-- CreateIndex
CREATE INDEX "transport_import_rejections_company_id_import_id_id_idx" ON "transport_import_rejections"("company_id", "import_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_import_rejections_import_id_vehicle_index_page_sk_key" ON "transport_import_rejections"("import_id", "vehicle_index", "page_skip", "position");

-- AddForeignKey
ALTER TABLE "transport_supplier_profiles" ADD CONSTRAINT "transport_supplier_profiles_registration_id_company_id_fkey" FOREIGN KEY ("registration_id", "company_id") REFERENCES "routing_companies"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_catalog_items" ADD CONSTRAINT "transport_catalog_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_fleet" ADD CONSTRAINT "transport_fleet_supplier_registration_id_company_id_fkey" FOREIGN KEY ("supplier_registration_id", "company_id") REFERENCES "transport_supplier_profiles"("registration_id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_fleet" ADD CONSTRAINT "transport_fleet_service_type_id_company_id_fkey" FOREIGN KEY ("service_type_id", "company_id") REFERENCES "transport_catalog_items"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_fleet" ADD CONSTRAINT "transport_fleet_vehicle_type_id_company_id_fkey" FOREIGN KEY ("vehicle_type_id", "company_id") REFERENCES "transport_catalog_items"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_fleet" ADD CONSTRAINT "transport_fleet_category_id_company_id_fkey" FOREIGN KEY ("category_id", "company_id") REFERENCES "transport_catalog_items"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_affiliations" ADD CONSTRAINT "transport_affiliations_registration_id_company_id_fkey" FOREIGN KEY ("registration_id", "company_id") REFERENCES "routing_companies"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_affiliations" ADD CONSTRAINT "transport_affiliations_supplier_registration_id_company_id_fkey" FOREIGN KEY ("supplier_registration_id", "company_id") REFERENCES "transport_supplier_profiles"("registration_id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_contract_profiles" ADD CONSTRAINT "transport_contract_profiles_contract_id_company_id_fkey" FOREIGN KEY ("contract_id", "company_id") REFERENCES "routing_contracts"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_contract_profiles" ADD CONSTRAINT "transport_contract_profiles_supplier_registration_id_compa_fkey" FOREIGN KEY ("supplier_registration_id", "company_id") REFERENCES "transport_supplier_profiles"("registration_id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_contract_conditions" ADD CONSTRAINT "transport_contract_conditions_contract_id_company_id_fkey" FOREIGN KEY ("contract_id", "company_id") REFERENCES "transport_contract_profiles"("contract_id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_external_routes" ADD CONSTRAINT "transport_external_routes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_route_assignments" ADD CONSTRAINT "transport_route_assignments_route_id_company_id_fkey" FOREIGN KEY ("route_id", "company_id") REFERENCES "transport_external_routes"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_route_assignments" ADD CONSTRAINT "transport_route_assignments_contract_id_company_id_fkey" FOREIGN KEY ("contract_id", "company_id") REFERENCES "transport_contract_profiles"("contract_id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_catalog_commands" ADD CONSTRAINT "transport_catalog_commands_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_integrations" ADD CONSTRAINT "transport_integrations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_imports" ADD CONSTRAINT "transport_imports_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_records" ADD CONSTRAINT "transport_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_record_history" ADD CONSTRAINT "transport_record_history_record_id_company_id_fkey" FOREIGN KEY ("record_id", "company_id") REFERENCES "transport_records"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_issues" ADD CONSTRAINT "transport_issues_record_id_company_id_fkey" FOREIGN KEY ("record_id", "company_id") REFERENCES "transport_records"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_issue_history" ADD CONSTRAINT "transport_issue_history_issue_id_company_id_fkey" FOREIGN KEY ("issue_id", "company_id") REFERENCES "transport_issues"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_analyses" ADD CONSTRAINT "transport_analyses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_import_commands" ADD CONSTRAINT "transport_import_commands_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_fleet_ownerships" ADD CONSTRAINT "transport_fleet_ownerships_fleet_id_company_id_fkey" FOREIGN KEY ("fleet_id", "company_id") REFERENCES "transport_fleet"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_fleet_ownerships" ADD CONSTRAINT "transport_fleet_ownerships_supplier_registration_id_compan_fkey" FOREIGN KEY ("supplier_registration_id", "company_id") REFERENCES "transport_supplier_profiles"("registration_id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_period_states" ADD CONSTRAINT "transport_period_states_contract_id_company_id_fkey" FOREIGN KEY ("contract_id", "company_id") REFERENCES "routing_contracts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_import_rejections" ADD CONSTRAINT "transport_import_rejections_import_id_company_id_fkey" FOREIGN KEY ("import_id", "company_id") REFERENCES "transport_imports"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Commercial transport contracts may exist before route planning is configured.
-- Keep the legacy positive-capacity requirements for every configured route type.
ALTER TABLE "routing_contracts" DROP CONSTRAINT "routing_contracts_vehicle_capacity_check";
ALTER TABLE "routing_contracts" ADD CONSTRAINT "routing_contracts_vehicle_capacity_check"
  CHECK (predicted_vehicle_capacity > 0 OR (route_type::text = 'unspecified' AND predicted_vehicle_capacity = 0));
ALTER TABLE "routing_contracts" DROP CONSTRAINT "routing_contracts_vehicle_count_check";
ALTER TABLE "routing_contracts" ADD CONSTRAINT "routing_contracts_vehicle_count_check"
  CHECK (contracted_vehicle_count > 0 OR (route_type::text = 'unspecified' AND contracted_vehicle_count = 0));

-- Preserve rejected originals while a later complete scan supersedes their coverage.
ALTER TABLE "transport_imports" ADD COLUMN "superseded_by_import_id" UUID;
ALTER TABLE "transport_imports" ADD CONSTRAINT "transport_imports_superseded_tenant_fkey"
 FOREIGN KEY ("superseded_by_import_id","company_id") REFERENCES "transport_imports"("id","company_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "transport_issues" ADD COLUMN "verification_unavailable_at" TIMESTAMPTZ(3);

-- Keyset scans by vehicle/date do not require a provider filter to use the index.
CREATE INDEX "transport_record_vehicle_sequence_idx" ON "transport_records"("company_id","vehicle_external_id","sort_at","id");
CREATE INDEX "transport_record_date_idx" ON "transport_records"("company_id","sort_at","id");
CREATE INDEX "transport_issue_status_page_idx" ON "transport_issues"("company_id","status","id");
CREATE INDEX "transport_record_missing_time_idx" ON "transport_records"("company_id","vehicle_external_id") WHERE "started_at" IS NULL;
