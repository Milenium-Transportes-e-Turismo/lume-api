CREATE TYPE "CommercialClosureClassification" AS ENUM (
  'opportunity-abandoned',
  'quote-rejected',
  'acceptance-cancelled',
  'superseded',
  'legacy-unclassified'
);

ALTER TABLE "quote_requests"
  ADD COLUMN "closure_classification" "CommercialClosureClassification";

UPDATE "quote_requests"
SET "closure_classification" = 'legacy-unclassified'
WHERE "status" = 'cancelled';

UPDATE "quote_requests"
SET "closure_classification" = 'quote-rejected'
WHERE "status" = 'rejected';

-- A constraint de consistência será adicionada em uma etapa posterior do
-- rollout, depois que não houver instâncias antigas capazes de gravar o status
-- sem a nova classificação. Até lá, a aplicação nova apresenta qualquer
-- cancelamento sem classificação como legado não classificado.

CREATE INDEX "quote_requests_company_id_closure_classification_updated_at_idx"
  ON "quote_requests"("company_id", "closure_classification", "updated_at");
