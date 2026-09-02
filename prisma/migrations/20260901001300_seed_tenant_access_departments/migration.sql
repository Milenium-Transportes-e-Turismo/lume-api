INSERT INTO "tenant_departments" (
  "id",
  "company_id",
  "code",
  "name",
  "is_default",
  "created_at",
  "updated_at"
)
SELECT
  md5(company."id"::text || ':' || department."code")::uuid,
  company."id",
  department."code"::"DepartmentCode",
  department."name",
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "companies" AS company
CROSS JOIN (
  VALUES
    ('human-resources', 'Recursos Humanos'),
    ('directorate', 'Diretoria')
) AS department("code", "name")
ON CONFLICT ("company_id", "code")
DO UPDATE SET
  "name" = EXCLUDED."name",
  "updated_at" = CURRENT_TIMESTAMP;
