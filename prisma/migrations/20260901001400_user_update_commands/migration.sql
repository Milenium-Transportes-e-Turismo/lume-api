ALTER TABLE "users"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "user_update_history" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "command_id" UUID NOT NULL,
  "command_fingerprint" CHAR(64) NOT NULL,
  "action" VARCHAR(40) NOT NULL,
  "expected_version" INTEGER NOT NULL,
  "resulting_version" INTEGER NOT NULL,
  "changed_fields" TEXT[] NOT NULL,
  "before_snapshot" JSONB NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "document_sync_fingerprint" CHAR(64),
  "document_synchronized_at" TIMESTAMPTZ(3),
  "document_request_id" UUID,
  "document_sync_result" JSONB,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_update_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_update_history_company_id_command_id_key"
ON "user_update_history"("company_id", "command_id");

CREATE INDEX "user_update_history_company_id_user_id_resulting_version_idx"
ON "user_update_history"("company_id", "user_id", "resulting_version");

ALTER TABLE "user_update_history"
ADD CONSTRAINT "user_update_history_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_update_history"
ADD CONSTRAINT "user_update_history_user_id_company_id_fkey"
FOREIGN KEY ("user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_update_history"
ADD CONSTRAINT "user_update_history_actor_user_id_company_id_fkey"
FOREIGN KEY ("actor_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
