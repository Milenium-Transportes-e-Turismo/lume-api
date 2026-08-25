-- FIXTURE EXCLUSIVA DE DESENVOLVIMENTO.
-- Não representa tarifa, praça, rodovia ou concessionária real.
-- A API só a considera quando TOLL_ALLOW_DEVELOPMENT_FIXTURES=true.

INSERT INTO "toll_concessionaires" (
  "id", "name", "data_kind", "source", "source_reference"
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  'Concessionária de laboratório',
  'DEVELOPMENT_FIXTURE',
  'lume-development-fixture',
  'prisma/fixtures/routing-tolls.development.sql'
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "toll_concessions" (
  "id", "concessionaire_id", "name", "valid_from", "data_kind", "source", "source_reference"
) VALUES (
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  'Concessão de laboratório',
  DATE '2026-01-01',
  'DEVELOPMENT_FIXTURE',
  'lume-development-fixture',
  'prisma/fixtures/routing-tolls.development.sql'
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "toll_roads" (
  "id", "code", "name", "state", "data_kind", "source", "source_reference"
) VALUES (
  '10000000-0000-4000-8000-000000000003',
  'LAB-001',
  'Rodovia de laboratório',
  'MG',
  'DEVELOPMENT_FIXTURE',
  'lume-development-fixture',
  'prisma/fixtures/routing-tolls.development.sql'
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "toll_vehicle_categories" (
  "id", "code", "name", "minimum_axles", "maximum_axles"
) VALUES (
  '10000000-0000-4000-8000-000000000004',
  'LAB-BUS-3',
  'Ônibus de laboratório com três eixos',
  3,
  3
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "toll_points" (
  "id", "road_id", "concession_id", "name", "type", "kilometer", "state",
  "direction", "location", "data_kind", "source", "source_reference"
) VALUES (
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000002',
  'Pórtico de laboratório',
  'FREE_FLOW',
  1,
  'MG',
  'BOTH',
  ST_SetSRID(ST_MakePoint(-48.200000, -18.950000), 4326)::geography,
  'DEVELOPMENT_FIXTURE',
  'lume-development-fixture',
  'prisma/fixtures/routing-tolls.development.sql'
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "toll_tariffs" (
  "id", "toll_point_id", "vehicle_category_id", "axles", "price", "valid_from",
  "data_kind", "source", "source_reference"
) VALUES (
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000004',
  3,
  1.00,
  DATE '2026-01-01',
  'DEVELOPMENT_FIXTURE',
  'lume-development-fixture',
  'prisma/fixtures/routing-tolls.development.sql'
) ON CONFLICT ("id") DO NOTHING;
