import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  resolve(process.cwd(), 'prisma/schema.prisma'),
  'utf8',
);
const migration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20260829000500_media_interpretation_relational_provenance/migration.sql',
  ),
  'utf8',
);

describe('MediaInterpretation relational provenance schema', () => {
  it('adiciona validationStatus e chunks tenant-scoped preservando uma interpretação por mídia', () => {
    expect(schema).toContain('enum MediaInterpretationValidationStatus');
    expect(schema).toMatch(
      /validationStatus\s+MediaInterpretationValidationStatus\?\s+@map\("validation_status"\)/,
    );
    expect(schema).toContain('model MediaInterpretationChunk');
    expect(schema).toContain(
      '@@unique([companyId, interpretationId, ordinal], map: "media_interpretation_chunks_tenant_ordinal_key")',
    );
    expect(schema).toContain('@@unique([mediaAssetId, companyId])');
    expect(schema).toContain(
      '@relation(fields: [interpretationId, companyId], references: [id, companyId], onDelete: Restrict)',
    );
  });

  it('mantém a migração aditiva, retroalimenta JSON legado e não o reescreve', () => {
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE)\s+(?:TABLE|TYPE)\b/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migration).not.toMatch(/SET\s+"structured_data"/i);
    expect(migration).toContain('ADD COLUMN "validation_status"');
    expect(migration).toContain('CREATE TABLE "media_interpretation_chunks"');
    expect(migration).toContain(
      'FOREIGN KEY ("interpretation_id", "company_id")',
    );
    expect(migration).toContain(
      'ON CONFLICT ("company_id", "interpretation_id", "ordinal") DO NOTHING',
    );
    expect(migration).toContain(
      "JSONB_TYPEOF(interpretation.\"structured_data\"->'chunks') = 'array'",
    );
    expect(migration).toContain("'source', 'legacy-json-backfill'");
    expect(migration).toContain('"content_hash" CHAR(64) NOT NULL');
  });
});
