-- This migration is additive: the legacy structured_data/provenance JSON remains
-- available while normalized fields become the source for new reads.

-- CreateEnum
CREATE TYPE "MediaInterpretationValidationStatus" AS ENUM ('not-required', 'human-required');

-- AlterTable
ALTER TABLE "media_interpretations"
  ADD COLUMN "validation_status" "MediaInterpretationValidationStatus";

-- Backfill the explicit status from the compatibility JSON. Documents and
-- spreadsheets remain conservative when older rows did not persist the flag.
UPDATE "media_interpretations" AS interpretation
SET "validation_status" = CASE
  WHEN UPPER(COALESCE(interpretation."structured_data"->>'validationStatus', '')) = 'HUMAN_REQUIRED'
    OR asset."type" IN ('document'::"MediaAssetType", 'spreadsheet'::"MediaAssetType")
  THEN 'human-required'::"MediaInterpretationValidationStatus"
  ELSE 'not-required'::"MediaInterpretationValidationStatus"
END
FROM "media_assets" AS asset
WHERE asset."id" = interpretation."media_asset_id"
  AND asset."company_id" = interpretation."company_id"
  AND interpretation."status" = 'succeeded'::"MediaInterpretationStatus"
  AND interpretation."validation_status" IS NULL;

-- CreateTable
CREATE TABLE "media_interpretation_chunks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "interpretation_id" UUID NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "page_number" INTEGER,
  "content" TEXT NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "provenance" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "media_interpretation_chunks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_interpretation_chunks_ordinal_check" CHECK ("ordinal" > 0),
  CONSTRAINT "media_interpretation_chunks_page_number_check" CHECK ("page_number" IS NULL OR "page_number" > 0),
  CONSTRAINT "media_interpretation_chunks_content_check" CHECK (BTRIM("content") <> '')
);

-- Tenant-scoped identity and lookup paths are installed before the replay-safe
-- backfill so a partially imported legacy payload cannot duplicate an ordinal.
CREATE UNIQUE INDEX "media_interpretation_chunks_id_company_id_key"
  ON "media_interpretation_chunks"("id", "company_id");

CREATE UNIQUE INDEX "media_interpretation_chunks_tenant_ordinal_key"
  ON "media_interpretation_chunks"("company_id", "interpretation_id", "ordinal");

CREATE INDEX "media_interpretation_chunks_tenant_page_idx"
  ON "media_interpretation_chunks"("company_id", "interpretation_id", "page_number");

ALTER TABLE "media_interpretation_chunks"
  ADD CONSTRAINT "media_interpretation_chunks_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "media_interpretation_chunks"
  ADD CONSTRAINT "media_interpretation_chunks_interpretation_id_company_id_fkey"
  FOREIGN KEY ("interpretation_id", "company_id")
  REFERENCES "media_interpretations"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Normalize already persisted compatibility chunks without removing or
-- rewriting structured_data. Provenance records both the migration origin and
-- the interpretation-level evidence that existed at ingestion time.
WITH legacy_chunks AS (
  SELECT
    interpretation."company_id",
    interpretation."id" AS "interpretation_id",
    CASE
      WHEN COALESCE(chunk."value"->>'ordinal', '') ~ '^[1-9][0-9]*$'
      THEN (chunk."value"->>'ordinal')::INTEGER
      ELSE chunk."position"::INTEGER
    END AS "ordinal",
    CASE
      WHEN COALESCE(chunk."value"->>'pageNumber', '') ~ '^[1-9][0-9]*$'
      THEN (chunk."value"->>'pageNumber')::INTEGER
      ELSE NULL
    END AS "page_number",
    chunk."value"->>'content' AS "content",
    (
      CASE
        WHEN JSONB_TYPEOF(chunk."value"->'provenance') = 'object'
        THEN chunk."value"->'provenance'
        ELSE '{}'::JSONB
      END
      || JSONB_BUILD_OBJECT(
        'schemaVersion', 1,
        'source', 'legacy-json-backfill',
        'provider', interpretation."provider",
        'model', interpretation."model",
        'modelVersion', interpretation."model_version",
        'interpretationProvenance', interpretation."provenance"
      )
    ) AS "provenance",
    COALESCE(interpretation."completed_at", interpretation."created_at") AS "created_at"
  FROM "media_interpretations" AS interpretation
  CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(
    CASE
      WHEN JSONB_TYPEOF(interpretation."structured_data"->'chunks') = 'array'
      THEN interpretation."structured_data"->'chunks'
      ELSE '[]'::JSONB
    END
  ) WITH ORDINALITY AS chunk("value", "position")
  WHERE JSONB_TYPEOF(chunk."value") = 'object'
)
INSERT INTO "media_interpretation_chunks" (
  "id",
  "company_id",
  "interpretation_id",
  "ordinal",
  "page_number",
  "content",
  "content_hash",
  "provenance",
  "created_at"
)
SELECT
  gen_random_uuid(),
  legacy."company_id",
  legacy."interpretation_id",
  legacy."ordinal",
  legacy."page_number",
  legacy."content",
  ENCODE(SHA256(CONVERT_TO(legacy."content", 'UTF8')), 'hex'),
  legacy."provenance",
  legacy."created_at"
FROM legacy_chunks AS legacy
WHERE BTRIM(COALESCE(legacy."content", '')) <> ''
ON CONFLICT ("company_id", "interpretation_id", "ordinal") DO NOTHING;
