import { describe, expect, it } from 'vitest';

import {
  assertSafeCredentialReference,
  assertToolInvocationAllowed,
  buildAgentPrompt,
  canAgentCommunicateWithCustomer,
  createExecutionAttemptAudit,
  redactPotentialSecrets,
  validateAgentRuntimeConfig,
  validateOpenAiRuntimeConfig,
  type AgentRuntimeConfig,
  type OpenAiAgentRuntimeConfig,
} from './agent-runtime';

const runtime: OpenAiAgentRuntimeConfig = {
  provider: 'openai',
  model: 'gpt-5.2',
  credentialRef: 'secret://openai/agents/commercial/v3',
  credentialIdentifier: 'commercial-v3',
  temperature: 0.2,
  maxOutputTokens: 4_096,
  status: 'active',
};

describe('current OpenAI agent adapter', () => {
  it('accepts an individual server-side credential reference', () => {
    expect(validateOpenAiRuntimeConfig(runtime)).toEqual(runtime);
    expect(
      assertSafeCredentialReference('env://LUME_AGENT_COMMERCIAL_OPENAI_KEY'),
    ).toBe('env://LUME_AGENT_COMMERCIAL_OPENAI_KEY');
  });

  it('keeps the generic runtime provider-extensible while the OpenAI adapter validates its own input', () => {
    const futureRuntime: AgentRuntimeConfig = {
      ...runtime,
      provider: 'future-provider',
    };
    expect(validateAgentRuntimeConfig(futureRuntime).provider).toBe(
      'future-provider',
    );
    expect(() => validateOpenAiRuntimeConfig(futureRuntime)).toThrow(
      'adapter OpenAI',
    );
    expect(() =>
      assertSafeCredentialReference('sk-proj-secret-value-123456'),
    ).toThrow('nunca informe a API key diretamente');
  });

  it('records the exact runtime without persisting the secret reference', () => {
    const audit = createExecutionAttemptAudit({
      attempt: 1,
      runtime,
      runtimeConfigVersion: 7,
      outcome: 'succeeded',
    });

    expect(audit).toEqual({
      attempt: 1,
      provider: 'openai',
      model: 'gpt-5.2',
      runtimeConfigVersion: 7,
      credentialIdentifier: 'commercial-v3',
      outcome: 'succeeded',
    });
    expect(audit).not.toHaveProperty('credentialRef');
  });

  it('keeps orchestrators and specialists silent to the customer', () => {
    expect(canAgentCommunicateWithCustomer('customer-service')).toBe(true);
    expect(canAgentCommunicateWithCustomer('orchestrator')).toBe(false);
    expect(canAgentCommunicateWithCustomer('specialist')).toBe(false);
    expect(canAgentCommunicateWithCustomer('silent-classifier')).toBe(false);
    expect(canAgentCommunicateWithCustomer('supervisor')).toBe(false);
  });
});

describe('agent prompt and tool policy', () => {
  it('assembles immutable platform layers before tenant and runtime context', () => {
    const prompt = buildAgentPrompt({
      systemPrompt: 'Proteja dados e obedeça às policies server-side.',
      platformAgentPrompt: 'Atue como agente de atendimento.',
      tenantInstructions: 'Use linguagem direta e acolhedora.',
      runtimeContext: 'Sessão autorizada para consulta de orçamento.',
      platformPromptVersion: 3,
      tenantInstructionsVersion: 5,
    });

    expect(prompt.indexOf('<system>')).toBeLessThan(
      prompt.indexOf('<platform-agent'),
    );
    expect(prompt.indexOf('<platform-agent')).toBeLessThan(
      prompt.indexOf('<tenant-instructions'),
    );
    expect(prompt.indexOf('<tenant-instructions')).toBeLessThan(
      prompt.indexOf('<runtime-context>'),
    );
  });

  it('requires authorization before protected data reaches a tool/model', () => {
    expect(() =>
      assertToolInvocationAllowed({
        grantedCapabilities: ['read'],
        tool: {
          code: 'registration.read',
          autonomy: 'read',
          requiresAuthorization: true,
        },
        authorizationGranted: false,
      }),
    ).toThrow('autorização deve ocorrer antes');
  });

  it('requires contextual confirmation for sensitive writes', () => {
    expect(() =>
      assertToolInvocationAllowed({
        grantedCapabilities: ['sensitive-write'],
        tool: {
          code: 'quote.cancel',
          autonomy: 'sensitive-write',
          requiresAuthorization: true,
        },
        authorizationGranted: true,
        sensitiveConfirmationContext: 'Confirma #123?',
      }),
    ).toThrow('confirmação contextual clara');

    expect(() =>
      assertToolInvocationAllowed({
        grantedCapabilities: ['sensitive-write'],
        tool: {
          code: 'quote.cancel',
          autonomy: 'sensitive-write',
          requiresAuthorization: true,
        },
        authorizationGranted: true,
        sensitiveConfirmationContext:
          'Confirma o cancelamento do orçamento #123 para a viagem de Uberlândia?',
      }),
    ).not.toThrow();
  });

  it('redacts OpenAI keys and authorization values from diagnostic text', () => {
    const redacted = redactPotentialSecrets(
      'api_key=sk-proj-abcdefghijklmnop Authorization: Bearer abc.def.ghi',
    );

    expect(redacted).not.toContain('sk-proj-abcdefghijklmnop');
    expect(redacted).not.toContain('abc.def.ghi');
    expect(redacted).toContain('[REDACTED_OPENAI_KEY]');
  });
});
