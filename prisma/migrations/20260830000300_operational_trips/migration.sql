CREATE TYPE "OperationalTripStatus" AS ENUM (
  'draft',
  'scheduled',
  'in-execution',
  'suspended',
  'interrupted',
  'early-terminated',
  'completed',
  'cancelled'
);

CREATE TABLE "operational_trips" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "contract_id" UUID NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "source_version" INTEGER NOT NULL,
  "status" "OperationalTripStatus" NOT NULL DEFAULT 'draft',
  "service_date" DATE,
  "plan_version" INTEGER NOT NULL DEFAULT 0,
  "scheduled_at" TIMESTAMPTZ(3),
  "started_at" TIMESTAMPTZ(3),
  "ended_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "operational_trips_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "operational_trips_versions_positive" CHECK (
    "source_version" > 0 AND "plan_version" >= 0 AND "version" > 0
  )
);

CREATE TABLE "operational_trip_legs" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "trip_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "label" VARCHAR(160) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "operational_trip_legs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "operational_trip_legs_sequence_positive" CHECK ("sequence" > 0)
);

CREATE TABLE "operational_trip_versions" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "trip_id" UUID NOT NULL,
  "command_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "aggregate_version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "reason" VARCHAR(1000),
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "operational_trip_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "operational_trip_versions_versions_positive" CHECK (
    "version" > 0 AND "aggregate_version" > 0
  )
);

CREATE TABLE "operational_trip_occurrences" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "trip_id" UUID NOT NULL,
  "command_id" UUID NOT NULL,
  "kind" VARCHAR(20) NOT NULL,
  "category" VARCHAR(40),
  "reason" VARCHAR(1000) NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '[]',
  "resulting_version" INTEGER NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "operational_trip_occurrences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "operational_trip_occurrences_kind_check" CHECK (
    "kind" IN ('occurrence', 'deviation')
  ),
  CONSTRAINT "operational_trip_occurrences_version_positive" CHECK (
    "resulting_version" > 0
  )
);

CREATE TABLE "operational_trip_history" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "trip_id" UUID NOT NULL,
  "command_id" UUID NOT NULL,
  "command_fingerprint" CHAR(64) NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "action" VARCHAR(40) NOT NULL,
  "from_status" "OperationalTripStatus",
  "to_status" "OperationalTripStatus" NOT NULL,
  "reason" VARCHAR(1000),
  "expected_version" INTEGER,
  "resulting_version" INTEGER NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "operational_trip_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "operational_trip_history_versions_positive" CHECK (
    ("expected_version" IS NULL OR "expected_version" > 0)
    AND "resulting_version" > 0
  )
);

CREATE UNIQUE INDEX "operational_trips_id_company_id_key"
  ON "operational_trips"("id", "company_id");
CREATE UNIQUE INDEX "operational_trips_company_id_code_key"
  ON "operational_trips"("company_id", "code");
CREATE INDEX "operational_trips_company_id_status_service_date_idx"
  ON "operational_trips"("company_id", "status", "service_date");
CREATE INDEX "operational_trips_company_id_contract_id_service_date_idx"
  ON "operational_trips"("company_id", "contract_id", "service_date");

CREATE UNIQUE INDEX "operational_trip_legs_id_company_id_key"
  ON "operational_trip_legs"("id", "company_id");
CREATE UNIQUE INDEX "operational_trip_legs_company_id_trip_id_sequence_key"
  ON "operational_trip_legs"("company_id", "trip_id", "sequence");
CREATE INDEX "operational_trip_legs_company_id_trip_id_idx"
  ON "operational_trip_legs"("company_id", "trip_id");

CREATE UNIQUE INDEX "operational_trip_versions_company_id_trip_id_version_key"
  ON "operational_trip_versions"("company_id", "trip_id", "version");
CREATE UNIQUE INDEX "operational_trip_versions_company_id_command_id_key"
  ON "operational_trip_versions"("company_id", "command_id");
CREATE INDEX "operational_trip_versions_company_id_trip_id_created_at_idx"
  ON "operational_trip_versions"("company_id", "trip_id", "created_at");

CREATE UNIQUE INDEX "operational_trip_occurrences_company_id_command_id_key"
  ON "operational_trip_occurrences"("company_id", "command_id");
CREATE INDEX "operational_trip_occurrences_company_id_trip_id_occurred_at_idx"
  ON "operational_trip_occurrences"("company_id", "trip_id", "occurred_at");

CREATE UNIQUE INDEX "operational_trip_history_company_id_command_id_key"
  ON "operational_trip_history"("company_id", "command_id");
CREATE INDEX "operational_trip_history_company_id_trip_id_resulting_version_idx"
  ON "operational_trip_history"("company_id", "trip_id", "resulting_version");

ALTER TABLE "operational_trips"
  ADD CONSTRAINT "operational_trips_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_trips"
  ADD CONSTRAINT "operational_trips_contract_id_company_id_fkey"
  FOREIGN KEY ("contract_id", "company_id")
  REFERENCES "routing_contracts"("id", "company_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "operational_trips"
  ADD CONSTRAINT "operational_trips_created_by_user_id_company_id_fkey"
  FOREIGN KEY ("created_by_user_id", "company_id")
  REFERENCES "users"("id", "company_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "operational_trip_legs"
  ADD CONSTRAINT "operational_trip_legs_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_trip_legs"
  ADD CONSTRAINT "operational_trip_legs_trip_id_company_id_fkey"
  FOREIGN KEY ("trip_id", "company_id")
  REFERENCES "operational_trips"("id", "company_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "operational_trip_versions"
  ADD CONSTRAINT "operational_trip_versions_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_trip_versions"
  ADD CONSTRAINT "operational_trip_versions_trip_id_company_id_fkey"
  FOREIGN KEY ("trip_id", "company_id")
  REFERENCES "operational_trips"("id", "company_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_trip_versions"
  ADD CONSTRAINT "operational_trip_versions_created_by_user_id_company_id_fkey"
  FOREIGN KEY ("created_by_user_id", "company_id")
  REFERENCES "users"("id", "company_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "operational_trip_occurrences"
  ADD CONSTRAINT "operational_trip_occurrences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_trip_occurrences"
  ADD CONSTRAINT "operational_trip_occurrences_trip_id_company_id_fkey"
  FOREIGN KEY ("trip_id", "company_id")
  REFERENCES "operational_trips"("id", "company_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_trip_occurrences"
  ADD CONSTRAINT "operational_trip_occurrences_actor_user_id_company_id_fkey"
  FOREIGN KEY ("actor_user_id", "company_id")
  REFERENCES "users"("id", "company_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "operational_trip_history"
  ADD CONSTRAINT "operational_trip_history_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_trip_history"
  ADD CONSTRAINT "operational_trip_history_trip_id_company_id_fkey"
  FOREIGN KEY ("trip_id", "company_id")
  REFERENCES "operational_trips"("id", "company_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_trip_history"
  ADD CONSTRAINT "operational_trip_history_actor_user_id_company_id_fkey"
  FOREIGN KEY ("actor_user_id", "company_id")
  REFERENCES "users"("id", "company_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
