-- O banco operacional continua sendo o mesmo PostgreSQL do tenant. A extensão
-- adiciona tipos e índices geográficos sem criar um segundo banco.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE "TollPointType" AS ENUM ('PHYSICAL_PLAZA', 'FREE_FLOW');
CREATE TYPE "TollDirection" AS ENUM ('BOTH', 'NORTHBOUND', 'EASTBOUND', 'SOUTHBOUND', 'WESTBOUND');
CREATE TYPE "TollDataKind" AS ENUM ('OFFICIAL', 'MANUAL', 'DEVELOPMENT_FIXTURE');

CREATE TABLE "toll_concessionaires" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(160) NOT NULL,
  "legal_name" VARCHAR(200),
  "tax_id" VARCHAR(14),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "data_kind" "TollDataKind" NOT NULL DEFAULT 'OFFICIAL',
  "source" VARCHAR(160) NOT NULL,
  "source_reference" VARCHAR(500),
  "source_updated_at" TIMESTAMPTZ(3),
  "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "toll_concessionaires_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "toll_concessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "concessionaire_id" UUID NOT NULL,
  "name" VARCHAR(180) NOT NULL,
  "valid_from" DATE NOT NULL,
  "valid_until" DATE,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "data_kind" "TollDataKind" NOT NULL DEFAULT 'OFFICIAL',
  "source" VARCHAR(160) NOT NULL,
  "source_reference" VARCHAR(500),
  "source_updated_at" TIMESTAMPTZ(3),
  "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "toll_concessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "toll_concessions_validity_check" CHECK ("valid_until" IS NULL OR "valid_until" >= "valid_from")
);

CREATE TABLE "toll_roads" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(180) NOT NULL,
  "state" CHAR(2),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "data_kind" "TollDataKind" NOT NULL DEFAULT 'OFFICIAL',
  "source" VARCHAR(160) NOT NULL,
  "source_reference" VARCHAR(500),
  "source_updated_at" TIMESTAMPTZ(3),
  "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "toll_roads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "toll_points" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "road_id" UUID NOT NULL,
  "concession_id" UUID,
  "name" VARCHAR(180) NOT NULL,
  "type" "TollPointType" NOT NULL,
  "kilometer" DECIMAL(8,3),
  "state" CHAR(2) NOT NULL,
  "direction" "TollDirection" NOT NULL DEFAULT 'BOTH',
  "location" geography(Point, 4326) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "data_kind" "TollDataKind" NOT NULL DEFAULT 'OFFICIAL',
  "source" VARCHAR(160) NOT NULL,
  "source_reference" VARCHAR(500),
  "source_updated_at" TIMESTAMPTZ(3),
  "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "toll_points_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "toll_vehicle_categories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "minimum_axles" INTEGER NOT NULL,
  "maximum_axles" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "toll_vehicle_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "toll_vehicle_categories_axles_check" CHECK (
    "minimum_axles" > 0 AND ("maximum_axles" IS NULL OR "maximum_axles" >= "minimum_axles")
  )
);

CREATE TABLE "toll_tariffs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "toll_point_id" UUID NOT NULL,
  "vehicle_category_id" UUID NOT NULL,
  "axles" INTEGER,
  "price" DECIMAL(12,2) NOT NULL,
  "valid_from" DATE NOT NULL,
  "valid_until" DATE,
  "data_kind" "TollDataKind" NOT NULL DEFAULT 'OFFICIAL',
  "source" VARCHAR(160) NOT NULL,
  "source_reference" VARCHAR(500),
  "source_updated_at" TIMESTAMPTZ(3),
  "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "toll_tariffs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "toll_tariffs_price_check" CHECK ("price" >= 0),
  CONSTRAINT "toll_tariffs_axles_check" CHECK ("axles" IS NULL OR "axles" > 0),
  CONSTRAINT "toll_tariffs_validity_check" CHECK ("valid_until" IS NULL OR "valid_until" >= "valid_from")
);

CREATE UNIQUE INDEX "toll_concessionaires_tax_id_key" ON "toll_concessionaires"("tax_id");
CREATE INDEX "toll_concessionaires_active_name_idx" ON "toll_concessionaires"("active", "name");
CREATE INDEX "toll_concessions_concessionaire_id_active_idx" ON "toll_concessions"("concessionaire_id", "active");
CREATE INDEX "toll_concessions_valid_from_valid_until_idx" ON "toll_concessions"("valid_from", "valid_until");
CREATE UNIQUE INDEX "toll_roads_code_state_key" ON "toll_roads"("code", "state");
CREATE INDEX "toll_roads_active_code_idx" ON "toll_roads"("active", "code");
CREATE INDEX "toll_points_road_id_active_idx" ON "toll_points"("road_id", "active");
CREATE INDEX "toll_points_concession_id_active_idx" ON "toll_points"("concession_id", "active");
CREATE INDEX "toll_points_state_active_idx" ON "toll_points"("state", "active");
CREATE INDEX "toll_points_location_gist_idx" ON "toll_points" USING GIST ("location");
CREATE UNIQUE INDEX "toll_vehicle_categories_code_key" ON "toll_vehicle_categories"("code");
CREATE INDEX "toll_vehicle_categories_active_axles_idx" ON "toll_vehicle_categories"("active", "minimum_axles", "maximum_axles");
CREATE UNIQUE INDEX "toll_tariffs_point_category_axles_from_key" ON "toll_tariffs"("toll_point_id", "vehicle_category_id", "axles", "valid_from") NULLS NOT DISTINCT;
CREATE INDEX "toll_tariffs_point_validity_idx" ON "toll_tariffs"("toll_point_id", "valid_from", "valid_until");
CREATE INDEX "toll_tariffs_category_axles_from_idx" ON "toll_tariffs"("vehicle_category_id", "axles", "valid_from");

ALTER TABLE "toll_concessions" ADD CONSTRAINT "toll_concessions_concessionaire_id_fkey"
  FOREIGN KEY ("concessionaire_id") REFERENCES "toll_concessionaires"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "toll_points" ADD CONSTRAINT "toll_points_road_id_fkey"
  FOREIGN KEY ("road_id") REFERENCES "toll_roads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "toll_points" ADD CONSTRAINT "toll_points_concession_id_fkey"
  FOREIGN KEY ("concession_id") REFERENCES "toll_concessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "toll_tariffs" ADD CONSTRAINT "toll_tariffs_toll_point_id_fkey"
  FOREIGN KEY ("toll_point_id") REFERENCES "toll_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "toll_tariffs" ADD CONSTRAINT "toll_tariffs_vehicle_category_id_fkey"
  FOREIGN KEY ("vehicle_category_id") REFERENCES "toll_vehicle_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Não há seed de produção nesta migration. Dados oficiais entram por processo
-- de ingestão auditável; fixtures usam data_kind=DEVELOPMENT_FIXTURE.
