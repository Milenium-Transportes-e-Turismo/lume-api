CREATE TYPE "OperationalTripSourceKind" AS ENUM (
  'continuous-contract',
  'confirmed-service'
);

ALTER TABLE "operational_trips"
  ADD COLUMN "source_kind" "OperationalTripSourceKind" NOT NULL DEFAULT 'continuous-contract',
  ADD COLUMN "confirmed_service_id" UUID,
  ALTER COLUMN "contract_id" DROP NOT NULL;

ALTER TABLE "operational_trips"
  ADD CONSTRAINT "operational_trips_source_exactly_one_check" CHECK (
    (
      "source_kind" = 'continuous-contract'
      AND "contract_id" IS NOT NULL
      AND "confirmed_service_id" IS NULL
    )
    OR
    (
      "source_kind" = 'confirmed-service'
      AND "contract_id" IS NULL
      AND "confirmed_service_id" IS NOT NULL
    )
  );

CREATE INDEX "operational_trips_company_id_confirmed_service_id_service_d_idx"
ON "operational_trips"("company_id", "confirmed_service_id", "service_date");

ALTER TABLE "operational_trips"
  ADD CONSTRAINT "operational_trips_confirmed_service_id_company_id_fkey"
  FOREIGN KEY ("confirmed_service_id", "company_id")
  REFERENCES "confirmed_services"("id", "company_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
