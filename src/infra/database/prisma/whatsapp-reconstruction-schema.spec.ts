import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  resolve(process.cwd(), 'prisma/schema.prisma'),
  'utf8',
);
const migration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20260829000100_whatsapp_reconstruction_foundation/migration.sql',
  ),
  'utf8',
);
const platformCatalogMigration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20260829000200_seed_platform_agent_catalog/migration.sql',
  ),
  'utf8',
);
const transitionBackfillPreparationMigrationName =
  '20260829000050_prepare_whatsapp_transition_backfill';
const transitionGuardRestorationMigrationName =
  '20260829000150_restore_whatsapp_transition_append_only';
const transitionBackfillPreparationMigrationPath = resolve(
  process.cwd(),
  'prisma/migrations',
  transitionBackfillPreparationMigrationName,
  'migration.sql',
);
const transitionGuardRestorationMigrationPath = resolve(
  process.cwd(),
  'prisma/migrations',
  transitionGuardRestorationMigrationName,
  'migration.sql',
);

describe('WhatsApp reconstruction schema foundation', () => {
  it('brackets the legacy transition backfill with the append-only guard', () => {
    expect(existsSync(transitionBackfillPreparationMigrationPath)).toBe(true);
    expect(existsSync(transitionGuardRestorationMigrationPath)).toBe(true);
    expect(
      [
        transitionBackfillPreparationMigrationName,
        '20260829000100_whatsapp_reconstruction_foundation',
        transitionGuardRestorationMigrationName,
      ].sort(),
    ).toEqual([
      transitionBackfillPreparationMigrationName,
      '20260829000100_whatsapp_reconstruction_foundation',
      transitionGuardRestorationMigrationName,
    ]);

    const preparationMigration = readFileSync(
      transitionBackfillPreparationMigrationPath,
      'utf8',
    );
    const restorationMigration = readFileSync(
      transitionGuardRestorationMigrationPath,
      'utf8',
    );

    expect(preparationMigration).toContain(
      'DROP TRIGGER IF EXISTS "whatsapp_transitions_append_only"',
    );
    expect(preparationMigration).toContain("column_name = 'thread_id'");
    expect(restorationMigration).toContain(
      'CREATE TRIGGER "whatsapp_transitions_append_only"',
    );
    expect(restorationMigration).toContain(
      'EXECUTE FUNCTION "reject_whatsapp_transition_mutation"()',
    );
  });

  it('keeps the migration additive and projects legacy identifiers', () => {
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE)\s+(?:TABLE|TYPE)\b/i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"whatsapp_/i);
    expect(migration).toContain(
      'SELECT\n  conversation."id",\n  conversation."company_id",',
    );
    expect(migration).toContain('SET "thread_id" = "id"');
    expect(migration).toContain('including milenium-production');
    expect(migration).not.toMatch(
      /CHECK \(jsonb_typeof\("pending_actions"\) = 'array'\)\s*\);/,
    );
  });

  it('backfills the preserved production instance as the Commercial channel without renaming it', () => {
    expect(migration).toContain(
      `channel."instance_name" = 'milenium-production'`,
    );
    expect(migration).toContain(`SET "name" = 'Canal Comercial'`);
    expect(migration).toContain(`department."code" = 'commercial'`);
    expect(migration).not.toMatch(
      /SET\s+"instance_name"\s*=\s*['"]milenium-production['"]/i,
    );
  });

  it('preflights global phone ownership before creating the unique index', () => {
    const preflight = migration.indexOf(
      'Cannot enforce global WhatsApp channel phone uniqueness',
    );
    const uniqueIndex = migration.indexOf(
      'whatsapp_channels_phone_number_global_key',
    );

    expect(preflight).toBeGreaterThan(-1);
    expect(uniqueIndex).toBeGreaterThan(preflight);
    expect(schema).toContain(
      '@@unique([phoneNumber], map: "whatsapp_channels_phone_number_global_key")',
    );
  });

  it('protects technical channel identity and append-only command ledgers', () => {
    expect(schema).toContain('model WhatsAppChannelEvent');
    expect(schema).toContain('model ServiceSessionEvent');
    const channelLedger = schema.match(
      /model WhatsAppChannelEvent \{(?<body>[\s\S]*?)\n\}/,
    );
    const sessionLedger = schema.match(
      /model ServiceSessionEvent \{(?<body>[\s\S]*?)\n\}/,
    );
    expect(channelLedger?.groups?.body).toContain(
      '@@unique([companyId, commandId])',
    );
    expect(sessionLedger?.groups?.body).toContain(
      '@@unique([companyId, commandId])',
    );
    expect(migration).toContain('whatsapp_channels_protect_instance_identity');
    expect(migration).toContain('whatsapp_channel_events_append_only');
    expect(migration).toContain('service_session_events_append_only');
    expect(migration).toContain('"resulting_version" = "expected_version" + 1');
    expect(schema).toContain(
      'ignoreGroups         Boolean                             @default(false)',
    );
    expect(schema).toContain(
      'ignoreFromMe         Boolean                             @default(false)',
    );
    expect(migration).toContain(
      'ALTER COLUMN "ignore_from_me" SET DEFAULT false',
    );
    expect(migration).toContain(
      'ALTER COLUMN "ignore_groups" SET DEFAULT false',
    );
    expect(migration).not.toMatch(
      /UPDATE\s+"whatsapp_channels"[\s\S]{0,300}"ignore_(?:from_me|groups)"/i,
    );
  });

  it('keeps providers extensible while requiring server-side credentials', () => {
    expect(schema).not.toContain('enum AgentProvider');
    expect(schema).toMatch(
      /provider\s+String\s+@default\("openai"\)\s+@db\.VarChar\(50\)/,
    );
    expect(migration).not.toContain('CREATE TYPE "AgentProvider"');
    expect(migration).toContain(
      '"provider" VARCHAR(50) NOT NULL DEFAULT \'openai\'',
    );
    expect(schema).toContain('credentialRef');
    expect(schema).not.toMatch(/apiKey\s+String/i);
    expect(migration).toContain('agent_runtime_configs_credential_ref_check');
    expect(migration).toContain(
      'agent_runtime_configs_active_credential_ref_key',
    );
  });

  it('retains immutable knowledge/media provenance and keeps groups sessionless', () => {
    expect(schema).toContain('model KnowledgeDocumentVersion');
    expect(schema).toContain('model AgentExecutionKnowledgeSource');
    expect(schema).toContain('model MediaInterpretationCorrection');
    expect(migration).toContain('knowledge_versions_immutable_payload');
    expect(migration).toContain(
      'Published knowledge version status cannot move backwards',
    );
    expect(migration).toContain(
      'Archived knowledge version status is terminal',
    );
    expect(migration).toContain('media_interpretations_reject_video_analysis');
    expect(migration).toContain(
      'THEN \'history-import\'::"WhatsAppMessageSource"',
    );
    expect(migration).toContain("'historyImport'");
    expect(schema).toContain('@@index([companyId, storageKey])');
    expect(schema).not.toContain('@@unique([companyId, storageKey])');

    const groupModel = schema.match(
      /model WhatsAppGroup \{(?<body>[\s\S]*?)\n\}/,
    );
    const groupMessageModel = schema.match(
      /model WhatsAppGroupMessage \{(?<body>[\s\S]*?)\n\}/,
    );

    expect(groupModel?.groups?.body).toContain('@default(OFF)');
    expect(groupModel?.groups?.body).not.toContain('ServiceSession');
    expect(groupMessageModel?.groups?.body).not.toContain('serviceSessionId');
  });

  it('enforces the fixed AI closing window and scoped three-digit continuation code', () => {
    expect(schema).toContain('@@unique([companyId, publicContinuationCode])');
    expect(schema).toContain('@@index([status, closingDeadlineAt])');
    expect(migration).toContain('service_sessions_closing_window_check');
    expect(migration).toContain("INTERVAL '30 minutes'");
    expect(migration).toContain("~ '^[0-9]{3}$'");
    expect(migration).toContain("INTERVAL '7 days'");
    expect(migration).toContain(
      'service_sessions_status_closing_deadline_at_idx',
    );
  });

  it('seeds the complete versioned registration tool flow without legacy confirmation tokens', () => {
    for (const toolCode of [
      'registration.draft.start',
      'registration.draft.patch',
      'registration.read',
      'registration.update',
      'registration.draft.abandon',
      'customer-profile.suggest',
      'knowledge.gap.observe',
      'knowledge.suggestion.create',
    ]) {
      expect(platformCatalogMigration).toContain(`'${toolCode}'`);
    }
    expect(platformCatalogMigration).toContain('expectedDraftVersion');
    expect(platformCatalogMigration).toContain('confirmationMessageId');
    expect(platformCatalogMigration).toContain('abandonmentMessageId');
    expect(platformCatalogMigration).not.toContain('confirmationToken');
    expect(platformCatalogMigration).toContain(
      "encode(sha256(convert_to(prompt.content, 'UTF8')), 'hex')",
    );
    expect(platformCatalogMigration).not.toContain('md5(prompt.content)');
    expect(platformCatalogMigration).toContain(
      "('knowledge-specialist', 'autonomy.safe-write')",
    );
    expect(platformCatalogMigration).toContain(
      "('knowledge-specialist', 'knowledge.gap.observe')",
    );
    expect(platformCatalogMigration).toContain(
      "('knowledge-specialist', 'knowledge.suggestion.create')",
    );
    expect(platformCatalogMigration).toContain('knowledge_gap_observe');
    expect(platformCatalogMigration).toContain('knowledge_suggestion_create');
    expect(platformCatalogMigration).toContain('revisão humana');
  });
});
