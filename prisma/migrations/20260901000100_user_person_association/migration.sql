ALTER TABLE "users"
  ADD COLUMN "person_registration_id" UUID,
  ADD COLUMN "person_association_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "users"
  ADD CONSTRAINT "users_person_association_version_positive"
  CHECK ("person_association_version" > 0);

CREATE INDEX "users_company_id_person_registration_id_idx"
  ON "users"("company_id", "person_registration_id");

ALTER TABLE "users"
  ADD CONSTRAINT "users_person_registration_id_company_id_fkey"
  FOREIGN KEY ("person_registration_id", "company_id")
  REFERENCES "routing_companies"("id", "company_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE TABLE "user_person_association_history" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "person_registration_id" UUID NOT NULL,
  "before_person_registration_id" UUID,
  "command_id" UUID NOT NULL,
  "command_fingerprint" CHAR(64) NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "action" VARCHAR(40) NOT NULL,
  "source" VARCHAR(40) NOT NULL,
  "reason" VARCHAR(1000),
  "expected_version" INTEGER NOT NULL,
  "resulting_version" INTEGER NOT NULL,
  "needs_regularization" BOOLEAN NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_person_association_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_person_association_history_versions_positive" CHECK (
    "expected_version" > 0
    AND "resulting_version" = "expected_version" + 1
  ),
  CONSTRAINT "user_person_association_history_source_check" CHECK (
    "source" IN (
      'unique-exact-cpf',
      'human-confirmed-cpf',
      'human-confirmed-email',
      'provisional'
    )
  )
);

CREATE UNIQUE INDEX "user_person_association_history_company_id_command_id_key"
  ON "user_person_association_history"("company_id", "command_id");
CREATE INDEX "user_person_association_history_company_id_user_id_resulting_version_idx"
  ON "user_person_association_history"("company_id", "user_id", "resulting_version");
CREATE INDEX "user_person_association_history_company_id_person_registration_id_created_at_idx"
  ON "user_person_association_history"("company_id", "person_registration_id", "created_at");

ALTER TABLE "user_person_association_history"
  ADD CONSTRAINT "user_person_association_history_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_person_association_history"
  ADD CONSTRAINT "user_person_association_history_user_id_company_id_fkey"
  FOREIGN KEY ("user_id", "company_id")
  REFERENCES "users"("id", "company_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_person_association_history"
  ADD CONSTRAINT "user_person_association_history_person_registration_id_company_id_fkey"
  FOREIGN KEY ("person_registration_id", "company_id")
  REFERENCES "routing_companies"("id", "company_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "user_person_association_history"
  ADD CONSTRAINT "user_person_association_history_actor_user_id_company_id_fkey"
  FOREIGN KEY ("actor_user_id", "company_id")
  REFERENCES "users"("id", "company_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
