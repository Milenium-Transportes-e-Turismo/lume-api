import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { MediaInterpretationGatewayRequest } from '../../application/contracts/media-interpretation.gateway';
import { ServerSideAgentCredentialResolver } from './server-side-agent-credential.resolver';
import { HttpOpenAiMediaInterpretationGateway } from './http-openai-media-interpretation.gateway';

const MEDIA_KEY = 'sk-proj-media-specialist-abcdefghijklmnop123456';
const FORBIDDEN_GLOBAL_KEY = 'sk-proj-global-forbidden-abcdefghijklmnop123456';

function request(
  overrides: Partial<MediaInterpretationGatewayRequest> = {},
): MediaInterpretationGatewayRequest {
  return {
    agentId: '00000000-0000-4000-8000-000000000001',
    runtime: {
      provider: 'openai',
      model: 'gpt-5-mini',
      credentialRef: 'env://LUME_AGENT_MEDIA_OPENAI_API_KEY',
      credentialIdentifier: 'media-specialist-v1',
      status: 'active',
    },
    instructions: 'Interprete com segurança e devolva somente o schema.',
    safetyIdentifier: 'media_abcdef0123456789',
    mediaType: 'image',
    binary: {
      content: Buffer.from('image-content'),
      fileName: 'foto.png',
      mimeType: 'image/png',
    },
    metadata: { source: 'whatsapp' },
    ...overrides,
  };
}

function interpretationResponse(
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return new Response(
    JSON.stringify({
      id: 'resp_media_1',
      status: 'completed',
      model: 'gpt-5-mini-2026-08-01',
      output_text: JSON.stringify({
        transcription: null,
        detectedLanguage: 'pt',
        extractedText: 'Pedido 123',
        summary: 'Documento do pedido 123.',
        documentType: 'pedido',
        structuredDataJson: '{"pedido":"123"}',
        confidence: 0.92,
        durationSeconds: null,
        pageCount: 2,
        businessValidationRequired: true,
        chunks: [
          { ordinal: 1, pageNumber: 1, content: 'Pedido' },
          { ordinal: 2, pageNumber: 2, content: '123' },
        ],
      }),
      usage: {
        input_tokens: 20,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 10,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 30,
      },
      ...overrides,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function subject(fetcher: typeof fetch) {
  const config = new ConfigService({
    LUME_AGENT_MEDIA_OPENAI_API_KEY: MEDIA_KEY,
    WHATSAPP_AI_OPENAI_API_KEY: FORBIDDEN_GLOBAL_KEY,
    OPENAI_API_KEY: FORBIDDEN_GLOBAL_KEY,
    AGENT_OPENAI_RESPONSES_TIMEOUT_MS: 1_000,
  });
  return new HttpOpenAiMediaInterpretationGateway(
    new ServerSideAgentCredentialResolver(config),
    config,
    fetcher,
  );
}

function authorization(call: readonly unknown[]): string | null {
  const init = call[1] as RequestInit | undefined;
  return new Headers(init?.headers).get('Authorization');
}

describe('HttpOpenAiMediaInterpretationGateway', () => {
  it('envia imagem pelo adapter OpenAI usando somente a credencial do media-specialist', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(interpretationResponse());

    await expect(subject(fetcher).interpret(request())).resolves.toMatchObject({
      responseId: 'resp_media_1',
      provider: 'openai',
      summary: 'Documento do pedido 123.',
      pageCount: 2,
      businessValidationRequired: true,
      chunks: [
        { ordinal: 1, pageNumber: 1, content: 'Pedido' },
        { ordinal: 2, pageNumber: 2, content: '123' },
      ],
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.openai.com/v1/responses',
    );
    expect(authorization(fetcher.mock.calls[0] ?? [])).toBe(
      `Bearer ${MEDIA_KEY}`,
    );
    const requestBody = (fetcher.mock.calls[0]?.[1] as RequestInit).body;
    if (typeof requestBody !== 'string') {
      throw new Error('O payload da Responses API deveria ser JSON.');
    }
    const body = JSON.parse(requestBody) as Record<string, unknown>;
    const serialized = JSON.stringify(body);
    expect(serialized).toContain('data:image/png;base64,');
    expect(serialized).not.toContain(MEDIA_KEY);
    expect(serialized).not.toContain(FORBIDDEN_GLOBAL_KEY);
    expect(body).toMatchObject({
      model: 'gpt-5-mini',
      store: false,
      safety_identifier: 'media_abcdef0123456789',
    });
  });

  it('transcreve áudio server-side antes da interpretação com a mesma credencial individual', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: 'áudio transcrito' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(interpretationResponse());

    await expect(
      subject(fetcher).interpret(
        request({
          mediaType: 'audio',
          binary: {
            content: Buffer.from('audio-content'),
            fileName: 'audio.ogg',
            mimeType: 'audio/ogg',
          },
        }),
      ),
    ).resolves.toMatchObject({ transcription: 'áudio transcrito' });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.openai.com/v1/audio/transcriptions',
    );
    expect((fetcher.mock.calls[0]?.[1] as RequestInit).body).toBeInstanceOf(
      FormData,
    );
    expect(authorization(fetcher.mock.calls[0] ?? [])).toBe(
      `Bearer ${MEDIA_KEY}`,
    );
    expect(authorization(fetcher.mock.calls[1] ?? [])).toBe(
      `Bearer ${MEDIA_KEY}`,
    );
  });

  it('rejeita vídeo antes de resolver credencial ou chamar o provider', async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      subject(fetcher).interpret(
        request({
          mediaType: 'video',
          binary: null,
        }),
      ),
    ).rejects.toMatchObject({ reason: 'invalid-request' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
