CREATE TYPE "CommercialServiceRequirementOutcome" AS ENUM (
  'satisfied',
  'not-applicable'
);

ALTER TABLE "commercial_service_requirement_attestations"
ADD COLUMN "outcome" "CommercialServiceRequirementOutcome" NOT NULL DEFAULT 'satisfied',
ADD COLUMN "reason" VARCHAR(500);

ALTER TABLE "commercial_service_requirement_attestations"
ADD CONSTRAINT "commercial_service_attestations_outcome_reason_check" CHECK (
  "outcome" <> 'not-applicable'
  OR (
    "reason" IS NOT NULL
    AND length(btrim("reason")) BETWEEN 3 AND 500
    AND length(btrim("evidence")) BETWEEN 3 AND 500
  )
);
