import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from '../../config/env';
import { TransportWorkerService } from '../../application/use-cases/transport/transport-worker.service';
import { PrismaService } from '../database/prisma/prisma.service';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AvicClient } from './avic-client';
import { AvicPasswordAuthentication } from './avic-auth';

const baseUrl = 'https://avic.example.test/';
const credentials = { userId: 'synthetic-user', accessKey: 'synthetic-key' };
const query = { vehicleId: '8', from: '2026-09-01', to: '2026-09-02' };
const instant = Date.parse('2026-09-09T12:00:00Z');
const jwt = (expiry = instant + 3600000, id = 'one') =>
  'header.' +
  Buffer.from(
    JSON.stringify({ exp: Math.floor(expiry / 1000), jti: id }),
  ).toString('base64url') +
  '.signature';
const login = (token = jwt(), extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      Authenticated: true,
      AccessToken: token,
      Expiration: 'unknown format',
      RefreshToken: 'synthetic-refresh-not-used',
      ...extra,
    }),
  );
function setup(fetcher: typeof fetch) {
  vi.useFakeTimers();
  vi.setSystemTime(instant);
  return new AvicClient({ baseUrl, credentials, fetch: fetcher });
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('Avic automatic password login', () => {
  it('logs in with the documented password body and reuses a JWT until its renewal margin', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(login())
      .mockResolvedValueOnce(new Response('[]'))
      .mockResolvedValueOnce(new Response('[]'))
      .mockResolvedValueOnce(login(jwt(instant + 7200000, 'two')))
      .mockResolvedValueOnce(new Response('[]'));
    const client = setup(fetcher);
    await client.readPage(query);
    await client.readPage(query);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const [url, init] = fetcher.mock.calls[0];
    expect((url as URL).pathname).toBe('/api/Login');
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(init?.body as string)).toEqual({
      UserID: credentials.userId,
      AccessKey: credentials.accessKey,
      GrantType: 'password',
    });
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({
      Authorization: 'Bearer ' + jwt(),
    });
    vi.setSystemTime(instant + 3570000);
    await client.readPage(query);
    expect(
      fetcher.mock.calls.filter(([, options]) => options?.method === 'POST'),
    ).toHaveLength(2);
    expect(fetcher.mock.calls[4][1]?.headers).toMatchObject({
      Authorization: 'Bearer ' + jwt(instant + 7200000, 'two'),
    });
  });
  it('coalesces concurrent logins without sharing access across clients', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation((_url, init) =>
        Promise.resolve(init?.method === 'POST' ? login() : new Response('[]')),
      );
    const client = setup(fetcher);
    await Promise.all(Array.from({ length: 8 }, () => client.readPage(query)));
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1);
    await new AvicClient({ baseUrl, credentials, fetch: fetcher }).readPage(
      query,
    );
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(2);
  });
  it('repeats the same read once with a new login after 401', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(login())
      .mockResolvedValueOnce(new Response('private denial', { status: 401 }))
      .mockResolvedValueOnce(login(jwt(instant + 7200000, 'two')))
      .mockResolvedValueOnce(new Response('[]'));
    const client = setup(fetcher);
    await expect(client.readPage({ ...query, skip: 50 })).resolves.toEqual({
      records: [],
      nextSkip: null,
    });
    expect((fetcher.mock.calls[1][0] as URL).href).toBe(
      (fetcher.mock.calls[3][0] as URL).href,
    );
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('stops after a second 401 and prevents an immediate login storm', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation((_url, init) =>
        Promise.resolve(
          init?.method === 'POST'
            ? login()
            : new Response('private denial', { status: 401 }),
        ),
      );
    const client = setup(fetcher);
    await expect(client.readPage(query)).rejects.toMatchObject({
      code: 'AUTHENTICATION',
      retryable: false,
    });
    await expect(client.readPage(query)).rejects.toMatchObject({
      code: 'AUTHENTICATION',
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    vi.setSystemTime(instant + 31000);
    await expect(client.readPage(query)).rejects.toMatchObject({
      code: 'AUTHENTICATION',
    });
    expect(fetcher).toHaveBeenCalledTimes(8);
  });
  it('keeps a newer login when an older request returns a delayed 401', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(instant);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(login())
      .mockResolvedValueOnce(login(jwt(instant + 7200000, 'two')));
    const auth = new AvicPasswordAuthentication({
      base: new URL(baseUrl),
      credentials,
      fetcher,
      timeoutMs: 30000,
    });
    const old = await auth.token();
    auth.invalidate(old);
    const newer = await auth.token();
    auth.invalidate(old, true);
    expect(await auth.token()).toBe(newer);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([403, 429, 500])(
    'does not start extra login attempts for read status %s',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(login())
        .mockResolvedValueOnce(
          new Response('private provider body', { status }),
        );
      const client = setup(fetcher);
      await expect(client.readPage(query)).rejects.toMatchObject({
        code: 'UNAVAILABLE',
        retryable: status !== 403,
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it.each([401, 403, 429, 500])(
    'sanitizes login failure %s and caches failure briefly',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('private credentials echoed', { status }),
        );
      const client = setup(fetcher);
      for (let i = 0; i < 2; i++)
        await expect(client.readPage(query)).rejects.toMatchObject({
          code: 'AUTHENTICATION',
          message: 'Avic read unavailable: AUTHENTICATION',
          retryable: status >= 500 || status === 429,
        });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    [{ Authenticated: false }, 'AUTHENTICATION'],
    [{ Authenticated: 'true' }, 'AUTHENTICATION'],
    [{ AccessToken: '' }, 'INVALID_RESPONSE'],
    [{ AccessToken: 'token\r\ninjection' }, 'INVALID_RESPONSE'],
    [{ AccessToken: jwt(instant - 1000) }, 'AUTHENTICATION'],
    [
      { AccessToken: 'opaque', Expiration: '2026-09-09T13:00:00' },
      'CONFIGURATION',
    ],
    [
      { AccessToken: 'opaque', Expiration: '2026-02-30T13:00:00Z' },
      'CONFIGURATION',
    ],
    [
      { AccessToken: 'opaque', Expiration: '2026-09-09T25:00:00Z' },
      'CONFIGURATION',
    ],
  ])(
    'rejects invalid or unusable login metadata without reading trips',
    async (extra, code) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(login(jwt(), extra));
      const client = setup(fetcher);
      await expect(client.readPage(query)).rejects.toMatchObject({ code });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it('accepts explicitly zoned expiration and an explicitly configured offset for naive expiration', async () => {
    for (const [expiration, utcOffset] of [
      ['2026-09-09T10:00:00-03:00', undefined],
      ['2026-09-09 10:00:00.1234567', '-03:00'],
    ] as const) {
      vi.useFakeTimers();
      vi.setSystemTime(instant);
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(login('opaque', { Expiration: expiration }))
        .mockResolvedValueOnce(new Response('[]'));
      const client = new AvicClient({
        baseUrl,
        credentials: { ...credentials, utcOffset },
        fetch: fetcher,
      });
      await expect(client.readPage(query)).resolves.toMatchObject({
        records: [],
      });
    }
  });
  it('uses the earlier valid deadline when JWT and zoned Expiration differ', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        login(jwt(), { Expiration: '2026-09-09T11:59:59Z' }),
      );
    await expect(setup(fetcher).readPage(query)).rejects.toMatchObject({
      code: 'AUTHENTICATION',
    });
  });
  it('does not expose credentials or raw login responses on malformed data or network errors', async () => {
    for (const response of [
      new Response('<html>private key</html>'),
      new Response('null'),
      new Response('x'.repeat(65537)),
      new Error('private key in failed URL'),
    ]) {
      const fetcher = vi.fn<typeof fetch>();
      if (response instanceof Error) fetcher.mockRejectedValue(response);
      else fetcher.mockResolvedValue(response);
      const client = setup(fetcher);
      try {
        await client.readPage(query);
        throw new Error('Expected failure');
      } catch (error) {
        expect(String(error)).toMatch(
          /^AvicClientError: Avic read unavailable: (INVALID_RESPONSE|UNAVAILABLE)$/,
        );
      }
    }
  });
  it('aborts slow logins and never follows authentication redirects', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          expect(init?.redirect).toBe('error');
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('private timeout')),
          );
        }),
    );
    const client = setup(fetcher);
    const result = expect(client.readPage(query)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(30001);
    await result;
  });
  it('rejects conflicting static authorization and incomplete credentials before network access', () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const headers of [
      { Authorization: 'static' },
      { authorization: 'static' },
    ]) {
      expect(
        () => new AvicClient({ baseUrl, credentials, headers, fetch: fetcher }),
      ).toThrow('CONFIGURATION');
    }
    expect(
      () =>
        new AvicClient({
          baseUrl,
          credentials: { userId: 'u', accessKey: '' },
          fetch: fetcher,
        }),
    ).toThrow('CONFIGURATION');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Avic environment and tenant cache', () => {
  const environment = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://lume:lume@localhost:5432/lume_tenant',
    JWT_ACCESS_SECRET: 'tenant-secret-with-at-least-32-characters',
    INSTALLATION_ID: '00000000-0000-4000-8000-000000000002',
    LICENSE_PUBLIC_KEY_BASE64: 'a'.repeat(64),
    LICENSE_DOCUMENT: 'payload.signature-with-enough-characters',
    HEIGIT_API_KEY: 'synthetic-heigit-key',
  };
  const authEnvironment = {
    AVIC_API_BASE_URL: baseUrl,
    AVIC_API_USER_ID: credentials.userId,
    AVIC_API_ACCESS_KEY: credentials.accessKey,
  };
  it('allows disabled integration and validates a complete login without rewriting the secret', () => {
    expect(validateEnvironment(environment).TRANSPORT_WORKER_ENABLED).toBe(
      false,
    );
    expect(
      validateEnvironment({
        ...environment,
        ...authEnvironment,
        AVIC_API_ACCESS_KEY: ' exact secret ',
      }).AVIC_API_ACCESS_KEY,
    ).toBe(' exact secret ');
  });
  it.each(['AVIC_API_BASE_URL', 'AVIC_API_USER_ID', 'AVIC_API_ACCESS_KEY'])(
    'rejects missing %s for configured login',
    (key) => {
      expect(() =>
        validateEnvironment({ ...environment, ...authEnvironment, [key]: '' }),
      ).toThrow('Login Avic exige');
    },
  );
  it.each(['Authorization', 'authorization', 'AUTHORIZATION'])(
    'rejects conflicting %s without printing the secret',
    (header) => {
      expect(() =>
        validateEnvironment({
          ...environment,
          ...authEnvironment,
          AVIC_API_HEADERS_JSON: JSON.stringify({
            [header]: 'private-static-token',
          }),
        }),
      ).toThrow('Remova Authorization');
    },
  );
  it('retains compatibility with static headers and rejects malformed JSON or offsets', () => {
    expect(
      validateEnvironment({
        ...environment,
        AVIC_API_HEADERS_JSON: '{"Authorization":"synthetic-token"}',
      }).AVIC_API_HEADERS_JSON,
    ).toContain('synthetic-token');
    expect(() =>
      validateEnvironment({
        ...environment,
        ...authEnvironment,
        AVIC_API_HEADERS_JSON: '{invalid',
      }),
    ).toThrow('objeto de headers');
    expect(() =>
      validateEnvironment({
        ...environment,
        ...authEnvironment,
        AVIC_AUTH_UTC_OFFSET: '-99:00',
      }),
    ).toThrow('AVIC_AUTH_UTC_OFFSET');
  });
  it('reuses the client across worker pages, with separate caches for different tenants', () => {
    const worker = new TransportWorkerService(
      {} as PrismaService,
      new ConfigService(authEnvironment),
    );
    const a = worker.client('tenant-a');
    expect(worker.client('tenant-a')).toBe(a);
    expect(worker.client('tenant-b')).not.toBe(a);
    expect(JSON.stringify(a)).not.toContain(credentials.accessKey);
    expect(JSON.stringify(a)).not.toContain(credentials.userId);
    worker.onModuleDestroy();
    expect(worker.client('tenant-a')).not.toBe(a);
  });
  it('bounds the worker cache without sharing the evicted tenant client', () => {
    const worker = new TransportWorkerService(
      {} as PrismaService,
      new ConfigService(authEnvironment),
    );
    const first = worker.client('tenant-first');
    for (let i = 0; i < 100; i++) worker.client('tenant-' + i);
    expect(worker.client('tenant-first')).not.toBe(first);
  });
  it('gives a renewed GET its own timeout after a slow 401 and login', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(instant);
    const deferred = (response: Response, ms: number, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new Error('aborted'));
          return;
        }
        const timer = setTimeout(() => resolve(response), ms);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        });
      });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(login())
      .mockImplementationOnce((_url, init) =>
        deferred(new Response('denied', { status: 401 }), 20000, init),
      )
      .mockImplementationOnce((_url, init) =>
        deferred(login(jwt(instant + 7200000, 'new')), 10000, init),
      )
      .mockImplementationOnce((_url, init) =>
        deferred(new Response('[]'), 10000, init),
      );
    const client = new AvicClient({ baseUrl, credentials, fetch: fetcher });
    const result = expect(client.readPage(query)).resolves.toMatchObject({
      records: [],
    });
    await vi.advanceTimersByTimeAsync(41000);
    await result;
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
