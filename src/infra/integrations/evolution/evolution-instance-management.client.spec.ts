import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpEvolutionInstanceManagementGateway } from './evolution-instance-management.client';

function gateway(timeoutMs = 1_000) {
  return new HttpEvolutionInstanceManagementGateway(
    new ConfigService({
      EVOLUTION_BASE_URL: 'https://evolution.example.test/',
      EVOLUTION_API_KEY: 'server-secret-never-log',
      EVOLUTION_WEBHOOK_SECRET: 'webhook-secret-with-more-than-32-characters',
      EVOLUTION_MANAGEMENT_TIMEOUT_MS: timeoutMs,
    }),
  );
}

describe('HttpEvolutionInstanceManagementGateway', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates an immutable technical instance with webhook and group sync events', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          instance: {
            instanceName: 'acme-production-financeiro',
            instanceId: 'instance-1',
            status: 'created',
          },
          qrcode: { code: 'qr-code', base64: 'aGVsbG8=' },
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', fetcher);

    const result = await gateway().create({
      instanceName: 'acme-production-financeiro',
      phoneNumber: '+55 (34) 99999-9999',
      webhookUrl:
        'https://api.example.test/whatsapp/webhooks/evolution/channel-1',
    });

    const [url, request] = fetcher.mock.calls[0] ?? [];
    expect(typeof request?.body).toBe('string');
    const body = JSON.parse(request?.body as string) as Record<string, unknown>;
    expect(url).toBe('https://evolution.example.test/instance/create');
    expect(new Headers(request?.headers).get('apikey')).toBe(
      'server-secret-never-log',
    );
    expect(body).toMatchObject({
      instanceName: 'acme-production-financeiro',
      integration: 'WHATSAPP-BAILEYS',
      groupsIgnore: false,
      number: '5534999999999',
      webhook: {
        enabled: true,
        url: 'https://api.example.test/whatsapp/webhooks/evolution/channel-1',
        byEvents: false,
        base64: false,
        headers: {
          'x-evolution-webhook-token':
            'webhook-secret-with-more-than-32-characters',
        },
      },
    });
    const webhook = body.webhook as { events: string[] };
    expect(webhook.events).toEqual(
      expect.arrayContaining([
        'MESSAGES_UPSERT',
        'GROUPS_UPSERT',
        'GROUP_PARTICIPANTS_UPDATE',
      ]),
    );
    expect(result).toEqual({
      instanceName: 'acme-production-financeiro',
      instanceId: 'instance-1',
      connectionState: 'connecting',
      qrCode: { code: 'qr-code', base64: 'aGVsbG8=' },
    });
  });

  it('regenerates QR and maps connection state without recreating the instance', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            instance: {
              instanceName: 'acme-production-financeiro',
              state: 'connecting',
            },
            base64: 'data:image/png;base64,aGVsbG8=',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ instance: { state: 'open' } }), {
          status: 200,
        }),
      );
    vi.stubGlobal('fetch', fetcher);

    await expect(
      gateway().connect('acme-production-financeiro'),
    ).resolves.toMatchObject({
      connectionState: 'connecting',
      qrCode: { base64: 'data:image/png;base64,aGVsbG8=' },
    });
    await expect(
      gateway().getConnectionState('acme-production-financeiro'),
    ).resolves.toBe('connected');
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://evolution.example.test/instance/connect/acme-production-financeiro',
      'https://evolution.example.test/instance/connectionState/acme-production-financeiro',
    ]);
  });

  it('disconnects and restarts the same instance without deleting it', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const subject = gateway();

    await subject.disconnect('acme-production-financeiro');
    await subject.restart('acme-production-financeiro');

    expect(
      fetcher.mock.calls.map(([url, request]) => [url, request?.method]),
    ).toEqual([
      [
        'https://evolution.example.test/instance/logout/acme-production-financeiro',
        'DELETE',
      ],
      [
        'https://evolution.example.test/instance/restart/acme-production-financeiro',
        'PUT',
      ],
    ]);
  });

  it('maps provider failures without exposing the response body or API key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'conflict',
          apiKey: 'server-secret-never-log',
        }),
        { status: 409 },
      ),
    );
    vi.stubGlobal('fetch', fetcher);

    let failure: unknown;
    try {
      await gateway().connect('acme-production-financeiro');
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      reason: 'already-exists',
      providerStatus: 409,
    });
    expect(JSON.stringify(failure)).not.toContain('server-secret-never-log');
  });

  it('aborts on timeout and rejects invalid technical names before fetch', async () => {
    const fetcher = vi.fn<typeof fetch>((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('secret timeout', 'AbortError')),
          { once: true },
        );
      });
    });
    vi.stubGlobal('fetch', fetcher);

    await expect(
      gateway(5).connect('acme-production-financeiro'),
    ).rejects.toMatchObject({ reason: 'timeout' });
    await expect(gateway().connect('../unsafe')).rejects.toMatchObject({
      reason: 'invalid-request',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('recusa provisionamento sem segredo de autenticação do webhook', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const subject = new HttpEvolutionInstanceManagementGateway(
      new ConfigService({
        EVOLUTION_BASE_URL: 'https://evolution.example.test',
        EVOLUTION_API_KEY: 'server-secret-never-log',
      }),
    );

    await expect(
      subject.create({
        instanceName: 'acme-production-financeiro',
        webhookUrl: 'https://api.example.test/api/v1/webhooks/evolution/id',
      }),
    ).rejects.toMatchObject({ reason: 'invalid-configuration' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    {
      instance: { instanceId: 'instance-1', state: 'connecting' },
      base64: 'aGVsbG8=',
    },
    { instance: { instanceId: 'instance-1' }, base64: 'aGVsbG8=' },
    { base64: 'aGVsbG8=' },
  ])(
    'accepts a QR snapshot independently of omitted provider metadata: %j',
    async (body) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
      );
      await expect(
        gateway().connect('acme-production-financeiro'),
      ).resolves.toMatchObject({
        connectionState: 'connecting',
        qrCode: { base64: 'aGVsbG8=' },
      });
    },
  );

  it.each([{}, null, [], { base64: '<invalid>' }])(
    'rejects invalid QR response %j',
    async (body) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
      );
      await expect(
        gateway().connect('acme-production-financeiro'),
      ).rejects.toMatchObject({
        reason: 'invalid-response',
      });
    },
  );

  it('accepts an already connected instance without a QR', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ instance: { state: 'open' } })),
        ),
    );
    await expect(
      gateway().connect('acme-production-financeiro'),
    ).resolves.toMatchObject({
      connectionState: 'connected',
      qrCode: null,
    });
  });

  it('reports a real provider outage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 503 })),
    );
    await expect(
      gateway().connect('acme-production-financeiro'),
    ).rejects.toMatchObject({
      reason: 'provider-unavailable',
    });
  });
});
