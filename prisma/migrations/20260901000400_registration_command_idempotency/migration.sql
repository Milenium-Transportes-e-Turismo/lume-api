ALTER TABLE "routing_company_history"
  ADD COLUMN "command_fingerprint" CHAR(64);

COMMENT ON COLUMN "routing_company_history"."command_fingerprint" IS
  'SHA-256 do tenant, alvo, ator, operação e payload. NULL identifica histórico legado não reproduzível.';
