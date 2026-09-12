CREATE SEQUENCE "transport_catalog_code_seq";
ALTER TABLE "transport_catalog_items"
  ADD COLUMN "legacy_code" VARCHAR(60),
  ADD COLUMN "seed_key" VARCHAR(60);
UPDATE "transport_catalog_items" SET "legacy_code" = "code";
UPDATE "transport_catalog_items" AS item SET "seed_key" = initial.code
FROM (VALUES
('service-type','vehicle-type','category'),
('service-type','continuous','Contínuo (operacional)'),
('service-type','occasional','Eventual (turístico)'),
('service-type','rental','Locação (eventual/curta distância)'),
('vehicle-type','bus','Ônibus'),
('vehicle-type','van','Van'),
('vehicle-type','mini-van','Mini Van'),
('vehicle-type','car','Carro'),
('vehicle-type','minibus','Micro-ônibus'),
('category','conventional','Convencional'),
('category','executive','Executivo'),
('category','executive-dd','Executivo/DD'),
('category','commercial','Comercial')
) AS initial(kind, code, name)
WHERE item.kind=initial.kind AND item.code=initial.code AND item.name=initial.name;
-- Temporarily remove uniqueness while replacing legacy text with generated numbers.
DROP INDEX "transport_catalog_items_company_id_kind_code_key";
WITH numbered AS (
 SELECT id, nextval('transport_catalog_code_seq')::text AS generated
 FROM transport_catalog_items ORDER BY company_id,kind,name,id
)
UPDATE transport_catalog_items AS item
SET code=numbered.generated, version=item.version+1
FROM numbered WHERE item.id=numbered.id;
ALTER TABLE "transport_catalog_items"
  ALTER COLUMN "code" SET DEFAULT nextval('transport_catalog_code_seq')::text,
  ADD CONSTRAINT "transport_catalog_items_numeric_code_check" CHECK (code ~ '^[0-9]+$');
ALTER SEQUENCE "transport_catalog_code_seq" OWNED BY "transport_catalog_items"."code";
CREATE UNIQUE INDEX "transport_catalog_items_company_id_kind_code_key"
 ON "transport_catalog_items" ("company_id","kind","code");
CREATE UNIQUE INDEX "transport_catalog_items_company_id_kind_seed_key_key"
 ON "transport_catalog_items" ("company_id","kind","seed_key");
