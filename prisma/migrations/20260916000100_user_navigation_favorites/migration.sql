CREATE TABLE "user_navigation_favorites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "navigation_key" VARCHAR(160) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_navigation_favorites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_navigation_favorites_company_id_user_id_navigation_key_key"
ON "user_navigation_favorites"("company_id", "user_id", "navigation_key");

CREATE INDEX "user_navigation_favorites_company_id_user_id_created_at_id_idx"
ON "user_navigation_favorites"("company_id", "user_id", "created_at", "id");

ALTER TABLE "user_navigation_favorites"
ADD CONSTRAINT "user_navigation_favorites_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_navigation_favorites"
ADD CONSTRAINT "user_navigation_favorites_user_id_company_id_fkey"
FOREIGN KEY ("user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
