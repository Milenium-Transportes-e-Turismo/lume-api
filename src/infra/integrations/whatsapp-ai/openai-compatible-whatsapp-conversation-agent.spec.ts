import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WhatsAppConversationAgentInput } from '../../../application/contracts/whatsapp-conversation-agent';
import {
  OpenAiCompatibleWhatsAppConversationAgent,
  parseProviderOrder,
} from './openai-compatible-whatsapp-conversation-agent';

const validOutput = {
  message: 'Qual é o local de origem?',
  collectionStatus: 'collecting',
  extractedDataPatch: {},
  missingFields: ['origin'],
  summaryPresented: false,
  customerDecision: 'undecided',
} as const;

const input: WhatsAppConversationAgentInput = {
  sourceEventId: 'event-1',
  correlationId: 'correlation-1',
  companyId: 'company-1',
  conversationId: 'conversation-1',
  serviceSessionId: 'service-session-1',
  aiMode: 'eventual-quote',
  userMessage: 'Preciso de um orçamento.',
  currentConversation: null,
};

function configService(
  values: Readonly<Record<string, string>>,
): ConfigService {
  return {
    get: vi.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function providerResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function configuredAgent(
  overrides: Readonly<Record<string, string>> = {},
): OpenAiCompatibleWhatsAppConversationAgent {
  return new OpenAiCompatibleWhatsAppConversationAgent(
    configService({
      WHATSAPP_AI_PROVIDER_ORDER: 'openai',
      WHATSAPP_AI_OPENAI_API_KEY: 'openai-secret-key',
      WHATSAPP_AI_OPENAI_BASE_URL: 'https://openai.example/v1/',
      WHATSAPP_AI_OPENAI_MODEL: 'openai-model',
      WHATSAPP_AI_REQUEST_TIMEOUT_MS: '1000',
      ...overrides,
    }),
  );
}

async function captureFailure(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('A operação deveria ter falhado.');
}

describe('OpenAiCompatibleWhatsAppConversationAgent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('usa exclusivamente OpenAI e valida o schema canônico', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        providerResponse(`\`\`\`json\n${JSON.stringify(validOutput)}\n\`\`\``),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await configuredAgent().complete(input);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(request.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };

    expect(url).toBe('https://openai.example/v1/chat/completions');
    expect((request.headers as Record<string, string>).authorization).toBe(
      'Bearer openai-secret-key',
    );
    expect(body.model).toBe('openai-model');
    expect(body.messages[0]?.content).toContain('Agente Comercial da Milenium');
    expect(result).toMatchObject({
      provider: 'openai',
      model: 'openai-model',
      attempt: 1,
      output: validOutput,
    });
  });

  it('ignora qualquer lista legada e mantém OpenAI como único provider', () => {
    expect(parseProviderOrder('groq,cerebras,gemini')).toEqual(['openai']);
    expect(parseProviderOrder(undefined)).toEqual(['openai']);
  });

  it('não tenta provider alternativo depois de erro HTTP', async () => {
    const fetchMock = vi.fn().mockResolvedValue(providerResponse('{}', 503));
    vi.stubGlobal('fetch', fetchMock);

    const failure = await captureFailure(() =>
      configuredAgent().complete(input),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(failure).toMatchObject({
      message: 'Não foi possível gerar uma resposta automática no momento.',
    });
  });

  it('não tenta provider alternativo quando a resposta OpenAI é inválida', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        providerResponse(
          JSON.stringify({ message: 'Resposta sem campos obrigatórios.' }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(configuredAgent().complete(input)).rejects.toThrow(
      'Não foi possível gerar uma resposta automática no momento.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falha com mensagem segura quando a credencial OpenAI está ausente', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const failure = await captureFailure(() =>
      configuredAgent({ WHATSAPP_AI_OPENAI_API_KEY: '' }).complete(input),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(failure)).not.toContain('API_KEY');
    expect(failure).toMatchObject({
      message: 'Não foi possível gerar uma resposta automática no momento.',
    });
  });

  it('redige credenciais caso o erro de rede tente repeti-las', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error('falha usando sk-secret-openai-value'));
    vi.stubGlobal('fetch', fetchMock);

    const failure = await captureFailure(() =>
      configuredAgent().complete(input),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(failure)).not.toContain('sk-secret-openai-value');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      'sk-secret-openai-value',
    );
    expect(JSON.stringify(warn.mock.calls)).toContain('REDACTED_OPENAI_KEY');
  });
});
