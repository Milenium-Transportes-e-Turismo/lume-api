CREATE TABLE "operational_trip_route_plan_selections" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "source_route_id" UUID NOT NULL,
    "source_route_version" INTEGER NOT NULL,
    "source_plan_version" INTEGER NOT NULL,
    "route_aggregate_version_at_selection" INTEGER NOT NULL,
    "source_snapshot" JSONB NOT NULL,
    "command_id" UUID NOT NULL,
    "selected_by_user_id" UUID NOT NULL,
    "reason" VARCHAR(1000),
    "selected_at" TIMESTAMPTZ(3) NOT NULL,
    "superseded_at" TIMESTAMPTZ(3),
    "used_for_execution_at" TIMESTAMPTZ(3),

    CONSTRAINT "operational_trip_route_plan_selections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "operational_trip_route_plan_positive_versions_check" CHECK (
      "source_route_version" > 0
      AND "source_plan_version" > 0
      AND "route_aggregate_version_at_selection" > 0
    ),
    CONSTRAINT "operational_trip_route_plan_superseded_at_check" CHECK (
      "superseded_at" IS NULL OR "superseded_at" >= "selected_at"
    ),
    CONSTRAINT "operational_trip_route_plan_used_at_check" CHECK (
      "used_for_execution_at" IS NULL OR "used_for_execution_at" >= "selected_at"
    ),
    CONSTRAINT "operational_trip_route_plan_used_not_superseded_check" CHECK (
      NOT ("used_for_execution_at" IS NOT NULL AND "superseded_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "operational_trip_route_plan_selections_id_company_id_key"
ON "operational_trip_route_plan_selections"("id", "company_id");

CREATE UNIQUE INDEX "operational_trip_route_plan_selections_company_id_command_i_key"
ON "operational_trip_route_plan_selections"("company_id", "command_id");

CREATE UNIQUE INDEX "operational_trip_route_plan_current_key"
ON "operational_trip_route_plan_selections"("company_id", "trip_id")
WHERE "superseded_at" IS NULL;

CREATE UNIQUE INDEX "operational_trip_route_plan_execution_key"
ON "operational_trip_route_plan_selections"("company_id", "trip_id")
WHERE "used_for_execution_at" IS NOT NULL;

CREATE INDEX "operational_trip_route_plan_selections_company_id_trip_id_s_idx"
ON "operational_trip_route_plan_selections"("company_id", "trip_id", "selected_at");

CREATE INDEX "operational_trip_route_plan_selections_company_id_source_ro_idx"
ON "operational_trip_route_plan_selections"("company_id", "source_route_id", "source_route_version");

ALTER TABLE "operational_trip_route_plan_selections"
ADD CONSTRAINT "operational_trip_route_plan_selections_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "operational_trip_route_plan_selections"
ADD CONSTRAINT "operational_trip_route_plan_selections_trip_id_company_id_fkey"
FOREIGN KEY ("trip_id", "company_id") REFERENCES "operational_trips"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "operational_trip_route_plan_selections"
ADD CONSTRAINT "operational_trip_route_plan_selections_selected_by_user_id_fkey"
FOREIGN KEY ("selected_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "operational_trip_route_plan_selections"
ADD CONSTRAINT "operational_trip_route_plan_selections_source_version_fkey"
FOREIGN KEY ("company_id", "source_route_id", "source_route_version")
REFERENCES "routing_route_versions"("company_id", "route_id", "version") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "operational_trip_route_plan_selections"
ADD CONSTRAINT "operational_trip_route_plan_selections_source_approval_fkey"
FOREIGN KEY ("company_id", "source_route_id", "source_route_version")
REFERENCES "routing_route_approvals"("company_id", "route_id", "approved_version") ON DELETE NO ACTION ON UPDATE CASCADE;
