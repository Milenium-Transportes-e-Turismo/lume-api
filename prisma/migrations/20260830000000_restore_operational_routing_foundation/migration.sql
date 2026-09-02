-- Restores the operational routing foundation after
-- 20260825000000_remove_legacy_contract_routing intentionally removed the
-- earlier experimental objects. Keep these sections in dependency order so
-- fresh databases and databases that applied the cleanup converge before the
-- operational trip migrations run.
CREATE TYPE "PassengerStatus" AS ENUM (
    'active', 'on-leave', 'vacation', 'temporarily-off-route', 'unlinked'
);
CREATE TYPE "PassengerRegistrationStatus" AS ENUM ('ready', 'pending');
CREATE TYPE "RoutingDataOrigin" AS ENUM (
    'company', 'agent', 'operations', 'import', 'system'
);
CREATE TYPE "PassengerIssueStatus" AS ENUM ('open', 'resolved');
CREATE TYPE "PassengerImportBatchStatus" AS ENUM (
    'processing', 'completed', 'review-required', 'failed'
);
CREATE TYPE "PassengerImportAction" AS ENUM (
    'created', 'updated', 'kept', 'conflict', 'pending'
);

CREATE TABLE "passengers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "routing_company_id" UUID NOT NULL,
    "external_reference" VARCHAR(120),
    "identity_fingerprint" CHAR(64) NOT NULL,
    "full_name" VARCHAR(160) NOT NULL,
    "normalized_name" VARCHAR(160) NOT NULL,
    "shift" VARCHAR(80),
    "required_arrival_time" CHAR(5),
    "sector" VARCHAR(120),
    "accessibility_required" BOOLEAN NOT NULL DEFAULT false,
    "accessibility_notes" VARCHAR(1000),
    "residence_street" VARCHAR(160),
    "residence_number" VARCHAR(30),
    "residence_complement" VARCHAR(120),
    "residence_district" VARCHAR(120),
    "residence_postal_code" VARCHAR(8),
    "residence_city" VARCHAR(120),
    "residence_state" CHAR(2),
    "residence_latitude" DECIMAL(10,7),
    "residence_longitude" DECIMAL(10,7),
    "predefined_boarding_label" VARCHAR(160),
    "predefined_boarding_street" VARCHAR(160),
    "predefined_boarding_number" VARCHAR(30),
    "predefined_boarding_complement" VARCHAR(120),
    "predefined_boarding_district" VARCHAR(120),
    "predefined_boarding_postal_code" VARCHAR(8),
    "predefined_boarding_city" VARCHAR(120),
    "predefined_boarding_state" CHAR(2),
    "predefined_boarding_latitude" DECIMAL(10,7),
    "predefined_boarding_longitude" DECIMAL(10,7),
    "predefined_boarding_origin" "RoutingDataOrigin",
    "status" "PassengerStatus" NOT NULL DEFAULT 'active',
    "registration_status" "PassengerRegistrationStatus" NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "passengers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "passenger_document_data" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "document_type_code" VARCHAR(80) NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "origin" "RoutingDataOrigin" NOT NULL DEFAULT 'company',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "passenger_document_data_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "passenger_issues" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "field" VARCHAR(100) NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "resolution_action" VARCHAR(500) NOT NULL,
    "blocks_routing" BOOLEAN NOT NULL DEFAULT true,
    "status" "PassengerIssueStatus" NOT NULL DEFAULT 'open',
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "passenger_issues_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "passenger_history" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "command_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "before_snapshot" JSONB,
    "after_snapshot" JSONB NOT NULL,
    "reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "passenger_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "passenger_import_batches" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "command_id" UUID NOT NULL,
    "route_id" UUID,
    "source_file_name" VARCHAR(255) NOT NULL,
    "source_sha256" CHAR(64) NOT NULL,
    "status" "PassengerImportBatchStatus" NOT NULL DEFAULT 'processing',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "kept_count" INTEGER NOT NULL DEFAULT 0,
    "pending_count" INTEGER NOT NULL DEFAULT 0,
    "conflict_count" INTEGER NOT NULL DEFAULT 0,
    "requires_rerouting" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "passenger_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "passenger_import_records" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "routing_company_id" UUID,
    "passenger_id" UUID,
    "action" "PassengerImportAction" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "problems" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "passenger_import_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "passengers_id_company_id_key" ON "passengers"("id", "company_id");
CREATE UNIQUE INDEX "passengers_company_id_routing_company_id_external_reference_key" ON "passengers"("company_id", "routing_company_id", "external_reference");
CREATE INDEX "passengers_company_id_routing_company_id_status_registration_status_idx" ON "passengers"("company_id", "routing_company_id", "status", "registration_status");
CREATE INDEX "passengers_company_id_routing_company_id_identity_fingerprint_idx" ON "passengers"("company_id", "routing_company_id", "identity_fingerprint");
CREATE INDEX "passengers_company_id_normalized_name_idx" ON "passengers"("company_id", "normalized_name");
CREATE UNIQUE INDEX "passenger_document_data_company_id_passenger_id_document_type_code_key" ON "passenger_document_data"("company_id", "passenger_id", "document_type_code");
CREATE INDEX "passenger_document_data_company_id_document_type_code_idx" ON "passenger_document_data"("company_id", "document_type_code");
CREATE UNIQUE INDEX "passenger_issues_company_id_passenger_id_code_status_key" ON "passenger_issues"("company_id", "passenger_id", "code", "status");
CREATE INDEX "passenger_issues_company_id_status_blocks_routing_idx" ON "passenger_issues"("company_id", "status", "blocks_routing");
CREATE UNIQUE INDEX "passenger_history_company_id_command_id_key" ON "passenger_history"("company_id", "command_id");
CREATE INDEX "passenger_history_company_id_passenger_id_created_at_idx" ON "passenger_history"("company_id", "passenger_id", "created_at");
CREATE UNIQUE INDEX "passenger_import_batches_id_company_id_key" ON "passenger_import_batches"("id", "company_id");
CREATE UNIQUE INDEX "passenger_import_batches_company_id_command_id_key" ON "passenger_import_batches"("company_id", "command_id");
CREATE UNIQUE INDEX "passenger_import_batches_company_id_source_sha256_command_id_key" ON "passenger_import_batches"("company_id", "source_sha256", "command_id");
CREATE INDEX "passenger_import_batches_company_id_status_created_at_idx" ON "passenger_import_batches"("company_id", "status", "created_at");
CREATE INDEX "passenger_import_batches_company_id_route_id_created_at_idx" ON "passenger_import_batches"("company_id", "route_id", "created_at");
CREATE UNIQUE INDEX "passenger_import_records_batch_id_row_number_key" ON "passenger_import_records"("batch_id", "row_number");
CREATE INDEX "passenger_import_records_company_id_routing_company_id_action_idx" ON "passenger_import_records"("company_id", "routing_company_id", "action");
CREATE INDEX "passenger_import_records_company_id_passenger_id_idx" ON "passenger_import_records"("company_id", "passenger_id");

ALTER TABLE "passengers" ADD CONSTRAINT "passengers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "passengers" ADD CONSTRAINT "passengers_routing_company_id_company_id_fkey" FOREIGN KEY ("routing_company_id", "company_id") REFERENCES "routing_companies"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "passengers" ADD CONSTRAINT "passengers_created_by_user_id_company_id_fkey" FOREIGN KEY ("created_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "passenger_document_data" ADD CONSTRAINT "passenger_document_data_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "passenger_document_data" ADD CONSTRAINT "passenger_document_data_passenger_id_company_id_fkey" FOREIGN KEY ("passenger_id", "company_id") REFERENCES "passengers"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "passenger_issues" ADD CONSTRAINT "passenger_issues_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "passenger_issues" ADD CONSTRAINT "passenger_issues_passenger_id_company_id_fkey" FOREIGN KEY ("passenger_id", "company_id") REFERENCES "passengers"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "passenger_history" ADD CONSTRAINT "passenger_history_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "passenger_history" ADD CONSTRAINT "passenger_history_passenger_id_company_id_fkey" FOREIGN KEY ("passenger_id", "company_id") REFERENCES "passengers"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "passenger_history" ADD CONSTRAINT "passenger_history_actor_user_id_company_id_fkey" FOREIGN KEY ("actor_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "passenger_import_batches" ADD CONSTRAINT "passenger_import_batches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "passenger_import_batches" ADD CONSTRAINT "passenger_import_batches_actor_user_id_company_id_fkey" FOREIGN KEY ("actor_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "passenger_import_records" ADD CONSTRAINT "passenger_import_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "passenger_import_records" ADD CONSTRAINT "passenger_import_records_batch_id_company_id_fkey" FOREIGN KEY ("batch_id", "company_id") REFERENCES "passenger_import_batches"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "passenger_import_records" ADD CONSTRAINT "passenger_import_records_routing_company_id_company_id_fkey" FOREIGN KEY ("routing_company_id", "company_id") REFERENCES "routing_companies"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "passenger_import_records" ADD CONSTRAINT "passenger_import_records_passenger_id_company_id_fkey" FOREIGN KEY ("passenger_id", "company_id") REFERENCES "passengers"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE TYPE "RoutingRouteType" AS ENUM ('municipal', 'intermunicipal');
CREATE TYPE "RoutingContractStatus" AS ENUM ('draft', 'active', 'suspended', 'ended');
CREATE TYPE "RoutingContractPeriodicity" AS ENUM ('monthly', 'weekly', 'daily', 'per-route');

CREATE TABLE "routing_contracts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "routing_company_id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "operation_type" VARCHAR(120) NOT NULL,
    "route_type" "RoutingRouteType" NOT NULL,
    "status" "RoutingContractStatus" NOT NULL DEFAULT 'draft',
    "periodicity" "RoutingContractPeriodicity" NOT NULL,
    "contracted_vehicle_count" INTEGER NOT NULL,
    "predicted_vehicle_name" VARCHAR(160) NOT NULL,
    "predicted_vehicle_reference" VARCHAR(120),
    "predicted_vehicle_capacity" INTEGER NOT NULL,
    "contracted_km" DECIMAL(12,3),
    "planned_km" DECIMAL(12,3),
    "max_walking_distance_meters" INTEGER NOT NULL,
    "requires_documentation" BOOLEAN NOT NULL DEFAULT false,
    "required_document_type_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unit_name" VARCHAR(160) NOT NULL,
    "origin_label" VARCHAR(160) NOT NULL,
    "origin_street" VARCHAR(160) NOT NULL,
    "origin_number" VARCHAR(30) NOT NULL,
    "origin_complement" VARCHAR(120),
    "origin_district" VARCHAR(120) NOT NULL,
    "origin_postal_code" VARCHAR(8) NOT NULL,
    "origin_city" VARCHAR(120) NOT NULL,
    "origin_state" CHAR(2) NOT NULL,
    "origin_latitude" DECIMAL(10,7),
    "origin_longitude" DECIMAL(10,7),
    "destination_label" VARCHAR(160) NOT NULL,
    "destination_street" VARCHAR(160) NOT NULL,
    "destination_number" VARCHAR(30) NOT NULL,
    "destination_complement" VARCHAR(120),
    "destination_district" VARCHAR(120) NOT NULL,
    "destination_postal_code" VARCHAR(8) NOT NULL,
    "destination_city" VARCHAR(120) NOT NULL,
    "destination_state" CHAR(2) NOT NULL,
    "destination_latitude" DECIMAL(10,7),
    "destination_longitude" DECIMAL(10,7),
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "notes" VARCHAR(2000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "routing_contracts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "routing_contracts_vehicle_count_check" CHECK ("contracted_vehicle_count" > 0),
    CONSTRAINT "routing_contracts_vehicle_capacity_check" CHECK ("predicted_vehicle_capacity" > 0),
    CONSTRAINT "routing_contracts_walk_distance_check" CHECK ("max_walking_distance_meters" >= 0),
    CONSTRAINT "routing_contracts_validity_check" CHECK ("valid_until" IS NULL OR "valid_until" >= "valid_from"),
    CONSTRAINT "routing_contracts_document_rule_check" CHECK (
        NOT "requires_documentation" OR cardinality("required_document_type_codes") > 0
    )
);

CREATE TABLE "routing_contract_cost_centers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "routing_contract_cost_centers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "routing_contract_shifts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "required_arrival_time" CHAR(5) NOT NULL,
    "vehicle_count" INTEGER,
    "vehicle_capacity" INTEGER,
    "active_weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "routing_contract_shifts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "routing_contract_shifts_vehicle_count_check" CHECK ("vehicle_count" IS NULL OR "vehicle_count" > 0),
    CONSTRAINT "routing_contract_shifts_capacity_check" CHECK ("vehicle_capacity" IS NULL OR "vehicle_capacity" > 0),
    CONSTRAINT "routing_contract_shifts_weekdays_check" CHECK (
        "active_weekdays" <@ ARRAY[0,1,2,3,4,5,6]::INTEGER[]
    )
);

CREATE TABLE "routing_contract_history" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "command_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "before_snapshot" JSONB,
    "after_snapshot" JSONB NOT NULL,
    "reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "routing_contract_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "routing_contracts_id_company_id_key" ON "routing_contracts"("id", "company_id");
CREATE UNIQUE INDEX "routing_contracts_company_id_routing_company_id_code_key" ON "routing_contracts"("company_id", "routing_company_id", "code");
CREATE INDEX "routing_contracts_company_id_routing_company_id_status_valid_from_idx" ON "routing_contracts"("company_id", "routing_company_id", "status", "valid_from");
CREATE UNIQUE INDEX "routing_contract_cost_centers_company_id_contract_id_code_key" ON "routing_contract_cost_centers"("company_id", "contract_id", "code");
CREATE INDEX "routing_contract_cost_centers_company_id_code_idx" ON "routing_contract_cost_centers"("company_id", "code");
CREATE UNIQUE INDEX "routing_contract_shifts_company_id_contract_id_name_required_arrival_time_key" ON "routing_contract_shifts"("company_id", "contract_id", "name", "required_arrival_time");
CREATE INDEX "routing_contract_shifts_company_id_contract_id_idx" ON "routing_contract_shifts"("company_id", "contract_id");
CREATE UNIQUE INDEX "routing_contract_history_company_id_command_id_key" ON "routing_contract_history"("company_id", "command_id");
CREATE INDEX "routing_contract_history_company_id_contract_id_created_at_idx" ON "routing_contract_history"("company_id", "contract_id", "created_at");

ALTER TABLE "routing_contracts" ADD CONSTRAINT "routing_contracts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_contracts" ADD CONSTRAINT "routing_contracts_routing_company_id_company_id_fkey" FOREIGN KEY ("routing_company_id", "company_id") REFERENCES "routing_companies"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "routing_contracts" ADD CONSTRAINT "routing_contracts_created_by_user_id_company_id_fkey" FOREIGN KEY ("created_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "routing_contract_cost_centers" ADD CONSTRAINT "routing_contract_cost_centers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_contract_cost_centers" ADD CONSTRAINT "routing_contract_cost_centers_contract_id_company_id_fkey" FOREIGN KEY ("contract_id", "company_id") REFERENCES "routing_contracts"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_contract_shifts" ADD CONSTRAINT "routing_contract_shifts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_contract_shifts" ADD CONSTRAINT "routing_contract_shifts_contract_id_company_id_fkey" FOREIGN KEY ("contract_id", "company_id") REFERENCES "routing_contracts"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_contract_history" ADD CONSTRAINT "routing_contract_history_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_contract_history" ADD CONSTRAINT "routing_contract_history_contract_id_company_id_fkey" FOREIGN KEY ("contract_id", "company_id") REFERENCES "routing_contracts"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_contract_history" ADD CONSTRAINT "routing_contract_history_actor_user_id_company_id_fkey" FOREIGN KEY ("actor_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE TYPE "RoutingRouteStatus" AS ENUM (
    'draft', 'routed', 'in-review', 'pending-approval', 'approved', 'published'
);
CREATE TYPE "RoutingDirection" AS ENUM ('outbound', 'return');
CREATE TYPE "RoutingAssignmentStatus" AS ENUM (
    'assigned', 'overflow', 'pending-data', 'pending-documents'
);

CREATE TABLE "routing_routes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "routing_company_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "shift" VARCHAR(80) NOT NULL,
    "required_arrival_time" CHAR(5) NOT NULL,
    "type" "RoutingRouteType" NOT NULL,
    "requires_documentation" BOOLEAN NOT NULL DEFAULT false,
    "required_document_type_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "origin_label" VARCHAR(160) NOT NULL,
    "origin_street" VARCHAR(160) NOT NULL,
    "origin_number" VARCHAR(30) NOT NULL,
    "origin_complement" VARCHAR(120),
    "origin_district" VARCHAR(120) NOT NULL,
    "origin_postal_code" VARCHAR(8) NOT NULL,
    "origin_city" VARCHAR(120) NOT NULL,
    "origin_state" CHAR(2) NOT NULL,
    "origin_latitude" DECIMAL(10,7),
    "origin_longitude" DECIMAL(10,7),
    "destination_label" VARCHAR(160) NOT NULL,
    "destination_street" VARCHAR(160) NOT NULL,
    "destination_number" VARCHAR(30) NOT NULL,
    "destination_complement" VARCHAR(120),
    "destination_district" VARCHAR(120) NOT NULL,
    "destination_postal_code" VARCHAR(8) NOT NULL,
    "destination_city" VARCHAR(120) NOT NULL,
    "destination_state" CHAR(2) NOT NULL,
    "destination_latitude" DECIMAL(10,7),
    "destination_longitude" DECIMAL(10,7),
    "predicted_vehicle_reference" VARCHAR(120),
    "predicted_vehicle_name" VARCHAR(160) NOT NULL,
    "predicted_vehicle_capacity" INTEGER NOT NULL,
    "max_walking_distance_meters" INTEGER NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "notes" VARCHAR(2000),
    "status" "RoutingRouteStatus" NOT NULL DEFAULT 'draft',
    "needs_rerouting" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "plan_version" INTEGER NOT NULL DEFAULT 0,
    "approved_version" INTEGER,
    "planned_outbound_km" DECIMAL(10,3),
    "planned_return_km" DECIMAL(10,3),
    "planned_total_km" DECIMAL(10,3),
    "estimated_duration_minutes" INTEGER,
    "overflow_passenger_count" INTEGER NOT NULL DEFAULT 0,
    "additional_route_suggested" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" UUID NOT NULL,
    "published_by_user_id" UUID,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "routing_routes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "routing_routes_capacity_check" CHECK ("predicted_vehicle_capacity" > 0),
    CONSTRAINT "routing_routes_walk_distance_check" CHECK ("max_walking_distance_meters" >= 0),
    CONSTRAINT "routing_routes_validity_check" CHECK ("valid_until" IS NULL OR "valid_until" >= "valid_from"),
    CONSTRAINT "routing_routes_document_rule_check" CHECK (
        NOT "requires_documentation" OR cardinality("required_document_type_codes") > 0
    )
);

CREATE TABLE "routing_route_points" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "direction" "RoutingDirection" NOT NULL DEFAULT 'outbound',
    "sequence" INTEGER NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "street" VARCHAR(160) NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "complement" VARCHAR(120),
    "district" VARCHAR(120) NOT NULL,
    "postal_code" VARCHAR(8) NOT NULL,
    "city" VARCHAR(120) NOT NULL,
    "state" CHAR(2) NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "origin" "RoutingDataOrigin" NOT NULL,
    "scheduled_time" CHAR(5),
    "alerts" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "routing_route_points_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "routing_route_points_sequence_check" CHECK ("sequence" >= 0)
);

CREATE TABLE "routing_route_passengers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "point_id" UUID,
    "status" "RoutingAssignmentStatus" NOT NULL,
    "walking_distance_meters" INTEGER,
    "boarding_order" INTEGER,
    "origin" "RoutingDataOrigin" NOT NULL,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "routing_route_passengers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "routing_route_history" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "command_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "before_snapshot" JSONB,
    "after_snapshot" JSONB NOT NULL,
    "reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "routing_route_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "routing_route_versions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "plan_version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "routing_route_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "routing_route_approvals" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "approved_version" INTEGER NOT NULL,
    "approved_by_user_id" UUID NOT NULL,
    "notes" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "routing_route_approvals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "routing_navigation_links" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "route_version" INTEGER NOT NULL,
    "direction" "RoutingDirection" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "routing_navigation_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "routing_route_executions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "route_version" INTEGER NOT NULL,
    "executed_vehicle_reference" VARCHAR(120),
    "initial_odometer_km" DECIMAL(12,3),
    "final_odometer_km" DECIMAL(12,3),
    "executed_km" DECIMAL(12,3),
    "vehicle_records" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "routing_route_executions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "routing_route_executions_odometer_check" CHECK (
        "initial_odometer_km" IS NULL OR "final_odometer_km" IS NULL OR "final_odometer_km" >= "initial_odometer_km"
    )
);

CREATE UNIQUE INDEX "routing_routes_id_company_id_key" ON "routing_routes"("id", "company_id");
CREATE UNIQUE INDEX "routing_routes_company_id_routing_company_id_code_key" ON "routing_routes"("company_id", "routing_company_id", "code");
CREATE INDEX "routing_routes_company_id_contract_id_status_idx" ON "routing_routes"("company_id", "contract_id", "status");
CREATE INDEX "routing_routes_company_id_routing_company_id_status_valid_from_idx" ON "routing_routes"("company_id", "routing_company_id", "status", "valid_from");
CREATE INDEX "routing_routes_company_id_status_updated_at_idx" ON "routing_routes"("company_id", "status", "updated_at");
CREATE UNIQUE INDEX "routing_route_points_id_company_id_key" ON "routing_route_points"("id", "company_id");
CREATE UNIQUE INDEX "routing_route_points_company_id_route_id_direction_sequence_key" ON "routing_route_points"("company_id", "route_id", "direction", "sequence");
CREATE INDEX "routing_route_points_company_id_route_id_idx" ON "routing_route_points"("company_id", "route_id");
CREATE UNIQUE INDEX "routing_route_passengers_company_id_route_id_passenger_id_key" ON "routing_route_passengers"("company_id", "route_id", "passenger_id");
CREATE INDEX "routing_route_passengers_company_id_route_id_status_idx" ON "routing_route_passengers"("company_id", "route_id", "status");
CREATE INDEX "routing_route_passengers_company_id_passenger_id_idx" ON "routing_route_passengers"("company_id", "passenger_id");
CREATE UNIQUE INDEX "routing_route_history_company_id_command_id_key" ON "routing_route_history"("company_id", "command_id");
CREATE INDEX "routing_route_history_company_id_route_id_created_at_idx" ON "routing_route_history"("company_id", "route_id", "created_at");
CREATE UNIQUE INDEX "routing_route_versions_company_id_route_id_version_key" ON "routing_route_versions"("company_id", "route_id", "version");
CREATE INDEX "routing_route_versions_company_id_route_id_created_at_idx" ON "routing_route_versions"("company_id", "route_id", "created_at");
CREATE UNIQUE INDEX "routing_route_approvals_company_id_route_id_approved_version_key" ON "routing_route_approvals"("company_id", "route_id", "approved_version");
CREATE INDEX "routing_route_approvals_company_id_approved_by_user_id_created_at_idx" ON "routing_route_approvals"("company_id", "approved_by_user_id", "created_at");
CREATE UNIQUE INDEX "routing_navigation_links_company_id_route_id_route_version_direction_sequence_key" ON "routing_navigation_links"("company_id", "route_id", "route_version", "direction", "sequence");
CREATE INDEX "routing_navigation_links_company_id_route_id_route_version_idx" ON "routing_navigation_links"("company_id", "route_id", "route_version");
CREATE UNIQUE INDEX "routing_route_executions_company_id_route_id_route_version_key" ON "routing_route_executions"("company_id", "route_id", "route_version");
CREATE INDEX "routing_route_executions_company_id_route_id_idx" ON "routing_route_executions"("company_id", "route_id");

ALTER TABLE "routing_routes" ADD CONSTRAINT "routing_routes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_routes" ADD CONSTRAINT "routing_routes_routing_company_id_company_id_fkey" FOREIGN KEY ("routing_company_id", "company_id") REFERENCES "routing_companies"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "routing_routes" ADD CONSTRAINT "routing_routes_contract_id_company_id_fkey" FOREIGN KEY ("contract_id", "company_id") REFERENCES "routing_contracts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "routing_routes" ADD CONSTRAINT "routing_routes_created_by_user_id_company_id_fkey" FOREIGN KEY ("created_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "routing_routes" ADD CONSTRAINT "routing_routes_published_by_user_id_company_id_fkey" FOREIGN KEY ("published_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "routing_route_points" ADD CONSTRAINT "routing_route_points_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_route_points" ADD CONSTRAINT "routing_route_points_route_id_company_id_fkey" FOREIGN KEY ("route_id", "company_id") REFERENCES "routing_routes"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_route_passengers" ADD CONSTRAINT "routing_route_passengers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_route_passengers" ADD CONSTRAINT "routing_route_passengers_route_id_company_id_fkey" FOREIGN KEY ("route_id", "company_id") REFERENCES "routing_routes"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_route_passengers" ADD CONSTRAINT "routing_route_passengers_passenger_id_company_id_fkey" FOREIGN KEY ("passenger_id", "company_id") REFERENCES "passengers"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "routing_route_passengers" ADD CONSTRAINT "routing_route_passengers_point_id_company_id_fkey" FOREIGN KEY ("point_id", "company_id") REFERENCES "routing_route_points"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "routing_route_history" ADD CONSTRAINT "routing_route_history_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_route_history" ADD CONSTRAINT "routing_route_history_route_id_company_id_fkey" FOREIGN KEY ("route_id", "company_id") REFERENCES "routing_routes"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_route_history" ADD CONSTRAINT "routing_route_history_actor_user_id_company_id_fkey" FOREIGN KEY ("actor_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "routing_route_versions" ADD CONSTRAINT "routing_route_versions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_route_versions" ADD CONSTRAINT "routing_route_versions_route_id_company_id_fkey" FOREIGN KEY ("route_id", "company_id") REFERENCES "routing_routes"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_route_approvals" ADD CONSTRAINT "routing_route_approvals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_route_approvals" ADD CONSTRAINT "routing_route_approvals_route_id_company_id_fkey" FOREIGN KEY ("route_id", "company_id") REFERENCES "routing_routes"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_route_approvals" ADD CONSTRAINT "routing_route_approvals_approved_by_user_id_company_id_fkey" FOREIGN KEY ("approved_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "routing_navigation_links" ADD CONSTRAINT "routing_navigation_links_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_navigation_links" ADD CONSTRAINT "routing_navigation_links_route_id_company_id_fkey" FOREIGN KEY ("route_id", "company_id") REFERENCES "routing_routes"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_route_executions" ADD CONSTRAINT "routing_route_executions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_route_executions" ADD CONSTRAINT "routing_route_executions_route_id_company_id_fkey" FOREIGN KEY ("route_id", "company_id") REFERENCES "routing_routes"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "RoutingFixedPointStatus" AS ENUM ('active', 'inactive');

CREATE TABLE "routing_fixed_points" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "routing_company_id" UUID,
    "code" VARCHAR(24) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "RoutingFixedPointStatus" NOT NULL DEFAULT 'active',
    "street" VARCHAR(160) NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "complement" VARCHAR(120),
    "district" VARCHAR(120) NOT NULL,
    "postal_code" VARCHAR(8) NOT NULL,
    "city" VARCHAR(120) NOT NULL,
    "state" CHAR(2) NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "routing_fixed_points_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "routing_contracts" ADD COLUMN "origin_fixed_point_id" UUID;
ALTER TABLE "routing_contracts" ADD COLUMN "destination_fixed_point_id" UUID;
ALTER TABLE "passengers" ADD COLUMN "predefined_boarding_fixed_point_id" UUID;
ALTER TABLE "routing_route_points" ADD COLUMN "fixed_point_id" UUID;

CREATE UNIQUE INDEX "routing_fixed_points_id_company_id_key" ON "routing_fixed_points"("id", "company_id");
CREATE UNIQUE INDEX "routing_fixed_points_company_id_code_key" ON "routing_fixed_points"("company_id", "code");
CREATE INDEX "routing_fixed_points_company_id_routing_company_id_status_name_idx" ON "routing_fixed_points"("company_id", "routing_company_id", "status", "name");

ALTER TABLE "routing_fixed_points" ADD CONSTRAINT "routing_fixed_points_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routing_fixed_points" ADD CONSTRAINT "routing_fixed_points_routing_company_id_company_id_fkey" FOREIGN KEY ("routing_company_id", "company_id") REFERENCES "routing_companies"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "routing_fixed_points" ADD CONSTRAINT "routing_fixed_points_created_by_user_id_company_id_fkey" FOREIGN KEY ("created_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "routing_contracts" ADD CONSTRAINT "routing_contracts_origin_fixed_point_id_company_id_fkey" FOREIGN KEY ("origin_fixed_point_id", "company_id") REFERENCES "routing_fixed_points"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "routing_contracts" ADD CONSTRAINT "routing_contracts_destination_fixed_point_id_company_id_fkey" FOREIGN KEY ("destination_fixed_point_id", "company_id") REFERENCES "routing_fixed_points"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "passengers" ADD CONSTRAINT "passengers_predefined_boarding_fixed_point_id_company_id_fkey" FOREIGN KEY ("predefined_boarding_fixed_point_id", "company_id") REFERENCES "routing_fixed_points"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "routing_route_points" ADD CONSTRAINT "routing_route_points_fixed_point_id_company_id_fkey" FOREIGN KEY ("fixed_point_id", "company_id") REFERENCES "routing_fixed_points"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
