import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const accessDepartmentSeedMigrationName =
  '20260901001300_seed_tenant_access_departments';
const publicIdentifierRepairMigrationName =
  '20260904000100_repair_tenant_department_public_identifiers';
const publicIdentifierRepairMigrationPath = resolve(
  process.cwd(),
  'prisma/migrations',
  publicIdentifierRepairMigrationName,
  'migration.sql',
);

describe('tenant department public identifiers', () => {
  it('repairs non-RFC UUID values after the access department seed', () => {
    expect(existsSync(publicIdentifierRepairMigrationPath)).toBe(true);
    expect(
      [
        accessDepartmentSeedMigrationName,
        publicIdentifierRepairMigrationName,
      ].sort(),
    ).toEqual([
      accessDepartmentSeedMigrationName,
      publicIdentifierRepairMigrationName,
    ]);

    const migration = readFileSync(publicIdentifierRepairMigrationPath, 'utf8');

    expect(migration).toContain('UPDATE "tenant_departments"');
    expect(migration).toContain('gen_random_uuid()');
    expect(migration).toContain("!~* '^[0-9a-f]{8}-");
    expect(migration).toContain("confupdtype <> 'c'");
    expect(migration).toContain('"updated_at" = CURRENT_TIMESTAMP');
    expect(migration).toContain('tenant_departments_id_rfc4122_check');
    expect(migration).not.toMatch(/\b(?:DELETE|TRUNCATE)\b/i);
  });
});
