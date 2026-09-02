-- CreateTable
CREATE TABLE "pre_admission_accesses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "person_registration_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "token_generation" INTEGER NOT NULL DEFAULT 1,
    "purpose" VARCHAR(64) NOT NULL DEFAULT 'admission-document-upload',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pre_admission_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_admission_access_items" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "pre_admission_access_id" UUID NOT NULL,
    "document_type_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "instructions" VARCHAR(2000),
    "config_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pre_admission_access_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_admission_access_history" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "pre_admission_access_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "command_id" UUID NOT NULL,
    "expected_version" INTEGER NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "result_version" INTEGER NOT NULL,
    "result_token_generation" INTEGER NOT NULL,
    "result_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "result_revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pre_admission_access_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pre_admission_accesses_id_company_id_key" ON "pre_admission_accesses"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "pre_admission_accesses_token_hash_key" ON "pre_admission_accesses"("token_hash");

-- CreateIndex: apenas um link não revogado pode permanecer aberto por Pessoa.
CREATE UNIQUE INDEX "pre_admission_accesses_one_open_per_person_key" ON "pre_admission_accesses"("company_id", "person_registration_id") WHERE "revoked_at" IS NULL;

-- CreateIndex
CREATE INDEX "pre_admission_accesses_company_person_created_idx" ON "pre_admission_accesses"("company_id", "person_registration_id", "created_at");

-- CreateIndex
CREATE INDEX "pre_admission_accesses_company_expiry_idx" ON "pre_admission_accesses"("company_id", "expires_at", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "pre_admission_items_access_document_key" ON "pre_admission_access_items"("company_id", "pre_admission_access_id", "document_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "pre_admission_items_access_position_key" ON "pre_admission_access_items"("company_id", "pre_admission_access_id", "position");

-- CreateIndex
CREATE INDEX "pre_admission_items_company_document_idx" ON "pre_admission_access_items"("company_id", "document_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "pre_admission_history_company_command_key" ON "pre_admission_access_history"("company_id", "command_id");

-- CreateIndex
CREATE INDEX "pre_admission_history_access_created_idx" ON "pre_admission_access_history"("company_id", "pre_admission_access_id", "created_at");

-- AddForeignKey
ALTER TABLE "pre_admission_accesses" ADD CONSTRAINT "pre_admission_accesses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_admission_accesses" ADD CONSTRAINT "pre_admission_accesses_person_fkey" FOREIGN KEY ("person_registration_id", "company_id") REFERENCES "routing_companies"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_admission_accesses" ADD CONSTRAINT "pre_admission_accesses_creator_fkey" FOREIGN KEY ("created_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_admission_access_items" ADD CONSTRAINT "pre_admission_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_admission_access_items" ADD CONSTRAINT "pre_admission_items_access_fkey" FOREIGN KEY ("pre_admission_access_id", "company_id") REFERENCES "pre_admission_accesses"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_admission_access_items" ADD CONSTRAINT "pre_admission_items_document_type_fkey" FOREIGN KEY ("document_type_id", "company_id") REFERENCES "document_types"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_admission_access_history" ADD CONSTRAINT "pre_admission_history_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_admission_access_history" ADD CONSTRAINT "pre_admission_history_access_fkey" FOREIGN KEY ("pre_admission_access_id", "company_id") REFERENCES "pre_admission_accesses"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_admission_access_history" ADD CONSTRAINT "pre_admission_history_actor_fkey" FOREIGN KEY ("actor_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
