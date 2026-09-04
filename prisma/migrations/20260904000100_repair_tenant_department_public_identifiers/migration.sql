-- PostgreSQL accepts every 128-bit value in a UUID column, while the public
-- Tenant API contract requires RFC 4122 variant/version bits. Older
-- department seeds derived the value directly from MD5 and could therefore
-- create identifiers that clients correctly reject as invalid UUIDs.
LOCK TABLE "tenant_departments" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  non_cascading_constraints TEXT;
BEGIN
  SELECT string_agg(constraint_row.conname, ', ' ORDER BY constraint_row.conname)
  INTO non_cascading_constraints
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.contype = 'f'
    AND constraint_row.confrelid = '"tenant_departments"'::regclass
    AND constraint_row.confupdtype <> 'c';

  IF non_cascading_constraints IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot repair tenant department identifiers because these foreign keys do not use ON UPDATE CASCADE: %',
      non_cascading_constraints;
  END IF;
END
$$;

UPDATE "tenant_departments"
SET
  "id" = gen_random_uuid(),
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id"::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

ALTER TABLE "tenant_departments"
  ADD CONSTRAINT "tenant_departments_id_rfc4122_check"
  CHECK (
    "id"::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );
