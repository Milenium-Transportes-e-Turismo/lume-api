import { describe, expect, it } from 'vitest';

import {
  PLATFORM_AGENT_CATALOG,
  PLATFORM_AGENT_TOOL_DEFINITIONS,
} from './platform-agent-catalog';

describe('PLATFORM_AGENT_CATALOG', () => {
  it('covers every platform agent type with an independent OpenAI credential', () => {
    const codes = PLATFORM_AGENT_CATALOG.map((agent) => agent.code);
    const credentialKeys = PLATFORM_AGENT_CATALOG.map(
      (agent) => agent.credentialEnvironmentKey,
    );

    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(credentialKeys).size).toBe(credentialKeys.length);
    expect(PLATFORM_AGENT_CATALOG.map((agent) => agent.type)).toEqual(
      expect.arrayContaining([
        'orchestrator',
        'customer-service',
        'specialist',
        'silent-classifier',
        'supervisor',
      ]),
    );
    expect(credentialKeys).not.toContain('OPENAI_API_KEY');
    expect(credentialKeys).not.toContain('WHATSAPP_AI_OPENAI_API_KEY');
    expect(
      credentialKeys.every((key) => /^LUME_AGENT_.+_OPENAI_API_KEY$/.test(key)),
    ).toBe(true);
  });

  it('has a single customer-facing agent and keeps orchestration/specialists silent', () => {
    const customerFacing = PLATFORM_AGENT_CATALOG.filter(
      (agent) => agent.customerFacing,
    );
    expect(customerFacing.map((agent) => agent.code)).toEqual([
      'customer-service',
    ]);
    expect(customerFacing[0]?.platformPrompt.toLowerCase()).toContain(
      'sem menus numéricos obrigatórios',
    );
  });

  it('assigns only tools registered in the platform-owned catalog', () => {
    const knownTools = new Set<string>(
      PLATFORM_AGENT_TOOL_DEFINITIONS.map((tool) => tool.code),
    );
    expect(
      PLATFORM_AGENT_CATALOG.every((agent) =>
        agent.toolCodes.every((tool) => knownTools.has(tool)),
      ),
    ).toBe(true);
  });

  it('offers customer profile observation only as a pending safe-write tool', () => {
    const customerService = PLATFORM_AGENT_CATALOG.find(
      (agent) => agent.code === 'customer-service',
    );
    const tool = PLATFORM_AGENT_TOOL_DEFINITIONS.find(
      (definition) => definition.code === 'customer-profile.suggest',
    );

    expect(customerService?.toolCodes).toContain('customer-profile.suggest');
    expect(tool).toMatchObject({
      autonomyLevel: 'safe-write',
      outputSchema: expect.objectContaining({
        properties: expect.objectContaining({
          status: { type: 'string', enum: ['pending'] },
        }),
      }),
    });
    expect(JSON.stringify(tool)).not.toMatch(/approve|ignore|decision/iu);
  });

  it('grants structured knowledge observations only to the knowledge specialist', () => {
    const specialist = PLATFORM_AGENT_CATALOG.find(
      (agent) => agent.code === 'knowledge-specialist',
    );
    const otherAgents = PLATFORM_AGENT_CATALOG.filter(
      (agent) => agent.code !== 'knowledge-specialist',
    );
    const definitions = PLATFORM_AGENT_TOOL_DEFINITIONS.filter((tool) =>
      tool.code.startsWith('knowledge.'),
    );

    expect(specialist?.capabilities).toContain('safe-write');
    expect(specialist?.toolCodes).toEqual([
      'knowledge.gap.observe',
      'knowledge.suggestion.create',
    ]);
    expect(
      otherAgents.every(
        (agent) =>
          !agent.toolCodes.some((code) => code.startsWith('knowledge.')),
      ),
    ).toBe(true);
    expect(definitions).toHaveLength(2);
    expect(
      definitions.every((tool) => tool.autonomyLevel === 'safe-write'),
    ).toBe(true);
    const serialized = JSON.stringify(definitions);
    expect(serialized).not.toMatch(
      /companyId|tenantId|serviceSessionId|agentExecutionId|serviceIdentityId|evidenceMessageIds/iu,
    );
    expect(serialized).toContain('pending');
    expect(serialized).toContain('automaticPublication');
    expect(specialist?.platformPrompt).toContain('knowledge_gap_observe');
    expect(specialist?.platformPrompt).toContain('knowledge_suggestion_create');
    expect(specialist?.platformPrompt).toContain('revisão humana');
  });

  it('offers the complete versioned registration draft lifecycle without caller-supplied tenant context or decorative tokens', () => {
    const specialist = PLATFORM_AGENT_CATALOG.find(
      (agent) => agent.code === 'registration-specialist',
    );
    expect(specialist?.toolCodes).toEqual([
      'registration.draft.start',
      'registration.draft.patch',
      'registration.read',
      'registration.update',
      'registration.draft.abandon',
    ]);
    const definitions = PLATFORM_AGENT_TOOL_DEFINITIONS.filter((tool) =>
      specialist?.toolCodes.includes(tool.code),
    );
    const serialized = JSON.stringify(definitions);
    expect(serialized).not.toMatch(
      /companyId|tenantId|serviceSessionId|whatsappContactId|confirmationToken/u,
    );
    expect(serialized).toContain('expectedDraftVersion');
    expect(serialized).toContain('confirmationMessageId');
    expect(serialized).toContain('abandonmentMessageId');
    expect(
      definitions.every((tool) =>
        ['read', 'safe-write'].includes(tool.autonomyLevel),
      ),
    ).toBe(true);
  });
});
