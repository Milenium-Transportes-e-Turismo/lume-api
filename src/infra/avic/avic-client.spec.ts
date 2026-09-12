import { describe, expect, it, vi } from 'vitest';
import {
  AvicClient,
  AvicClientError,
  normalizeAvicRecord,
  parseAvicJson,
} from './avic-client';
const mapping = {
  externalIdField: 'RegistroViagemId',
  sourceUtcOffset: '-03:00',
};
const query = { vehicleId: '8', from: '2026-07-01', to: '2026-07-31' };
const synthetic =
  '{"RegistroViagemId":9007199254740993123,"Id":14,"IdLiteDb":54444008062582781,"VeiculoId":8,"IdLinhaRota":21,"KMSaidaGaragem":100,"KMRetornoGaragem":110.25,"KMChegadaOrigem":0,"HoraSaidaGaragem":"2026-07-01T06:00:00","HoraChegadaGaragem":"2026-07-01T07:00:00","KMTotal":10.25}';
describe('Avic precision and normalization', () => {
  it('preserves all numeric tokens including large integers, decimal/exponents and escaped strings', () => {
    const raw = parseAvicJson(
      '{"big":9007199254740993123,"decimal":1.25,"exp":1e25,"negative":-22,"text":"say \\"123\\" \\\\ end","empty":null,"flag":false}',
    );
    expect(raw).toEqual({
      big: '9007199254740993123',
      decimal: '1.25',
      exp: '1e25',
      negative: '-22',
      text: 'say "123" \\ end',
      empty: null,
      flag: false,
    });
  });
  it('does not silently repair malformed JSON', () => {
    for (const text of [
      '{"a":01}',
      '{"a":1.}',
      '{"a":1e}',
      '{"a":"unfinished}',
      '{"a":NaN}',
    ]) {
      expect(() => parseAvicJson(text)).toThrow();
    }
  });
  it('requires explicit source identity and preserves distinct provider IDs', () => {
    const raw = parseAvicJson(synthetic) as Record<string, unknown>;
    const result = normalizeAvicRecord(raw, mapping);
    expect(result.externalId).toBe('9007199254740993123');
    expect(result.raw.IdLiteDb).toBe('54444008062582781');
    expect(result.raw.Id).toBe('14');
    expect(
      normalizeAvicRecord(raw, { ...mapping, externalIdField: 'Id' })
        .externalId,
    ).toBe('14');
  });
  it('normalizes only measurements and timestamps with explicit source offset', () => {
    const result = normalizeAvicRecord(
      parseAvicJson(synthetic) as Record<string, unknown>,
      mapping,
    );
    expect(result).toMatchObject({
      vehicleId: '8',
      routeExternalId: '21',
      startKm: 100,
      endKm: 110.25,
      reportedKm: 10.25,
      startedAt: '2026-07-01T09:00:00.000Z',
      endedAt: '2026-07-01T10:00:00.000Z',
      measurementSource: 'DRIVER_REPORTED',
    });
    expect(result.intermediateReadings.KMChegadaOrigem).toBeNull();
    expect(result.intermediateReadings.KMRetorno).toBeNull();
  });
  it('projects source customer and driver context without inferring local supplier relationships', () => {
    const raw = parseAvicJson(
      '{"RegistroViagemId":1,"VeiculoId":2,"MotoristaLiderId":9007199254740993123,"MotoristaLiderNome":" Synthetic Driver ","CodigoCadastro":9007199254740993124,"ClienteNome":" Synthetic Customer "}',
    );
    const result = normalizeAvicRecord(raw as Record<string, unknown>, mapping);
    expect(result).toMatchObject({
      driverExternalId: '9007199254740993123',
      driverName: 'Synthetic Driver',
      customerExternalId: '9007199254740993124',
      customerName: 'Synthetic Customer',
    });
    expect(result).not.toHaveProperty('supplierCompanyId');
    expect(result).not.toHaveProperty('customerId');
    expect(result).not.toHaveProperty('employeeId');
    const missing = normalizeAvicRecord(
      { RegistroViagemId: '1', VeiculoId: '2' },
      mapping,
    );
    expect(missing).toMatchObject({
      driverExternalId: null,
      driverName: null,
      customerExternalId: null,
      customerName: null,
    });
  });
  it.each([
    '10000000000000',
    '-10000000000000',
    '9007199254740993123',
    '1e20',
    '0.0001',
    '100.1234',
    '9999999999999.999',
    '9999999999999.997',
  ])(
    'preserves raw %s while declining a measurement that cannot be stored precisely',
    (value) => {
      const raw = {
        RegistroViagemId: '1',
        VeiculoId: '2',
        KMSaidaGaragem: value,
        KMRetornoGaragem: value,
        KMTotal: value,
        KMChegadaOrigem: value,
      };
      const result = normalizeAvicRecord(raw, mapping);
      expect(result.startKm).toBeNull();
      expect(result.endKm).toBeNull();
      expect(result.reportedKm).toBeNull();
      expect(result.intermediateReadings.KMChegadaOrigem).toBeNull();
      expect(result.raw).toEqual(raw);
    },
  );
  it.each([
    ['638612.123', 638612.123],
    ['10.2500', 10.25],
    ['1e-3', 0.001],
    ['12500e-3', 12.5],
    ['9999999999999', 9999999999999],
    ['-10.125', -10.125],
    ['0', 0],
  ])(
    'retains exactly representable Decimal(16,3) measurement %s',
    (value, expected) => {
      const result = normalizeAvicRecord(
        {
          RegistroViagemId: '1',
          VeiculoId: '2',
          KMSaidaGaragem: value,
          HoraSaidaGaragem: '2026-07-01T06:00:00',
        },
        mapping,
      );
      expect(result.startKm).toBe(expected);
    },
  );
  it('keeps open-trip garage placeholders unknown until their actual event exists', () => {
    const open = normalizeAvicRecord(
      {
        RegistroViagemId: '1',
        VeiculoId: '2',
        KMSaidaGaragem: '100',
        KMRetornoGaragem: '0',
        HoraSaidaGaragem: '2026-07-01T06:00:00',
        HoraChegadaGaragem: null,
      },
      mapping,
    );
    expect(open.startKm).toBe(100);
    expect(open.endKm).toBeNull();
    expect(open.raw.KMRetornoGaragem).toBe('0');
    const notStarted = normalizeAvicRecord(
      {
        RegistroViagemId: '2',
        VeiculoId: '2',
        KMSaidaGaragem: '0',
        KMRetornoGaragem: '0',
      },
      mapping,
    );
    expect(notStarted.startKm).toBeNull();
    expect(notStarted.endKm).toBeNull();
    const explicit = normalizeAvicRecord(
      {
        RegistroViagemId: '3',
        VeiculoId: '2',
        KMSaidaGaragem: '0',
        KMRetornoGaragem: '0',
        HoraSaidaGaragem: '2026-07-01T06:00:00',
        HoraChegadaGaragem: '2026-07-01T07:00:00',
      },
      mapping,
    );
    expect(explicit.startKm).toBe(0);
    expect(explicit.endKm).toBe(0);
  });
  it('does not infer actual timestamps from scheduled dates or invent category/model', () => {
    const result = normalizeAvicRecord(
      {
        RegistroViagemId: '1',
        VeiculoId: '2',
        DataSaida: '2026-07-01T10:00:00',
        VeiculoModelo: 'CONVENCIONAL',
      },
      mapping,
    );
    expect(result.startedAt).toBeNull();
    expect(result.startKm).toBeNull();
    expect(result).not.toHaveProperty('modality');
    expect(result).not.toHaveProperty('model');
  });
  it('does not normalize invalid calendar dates into a different operating day', () => {
    const result = normalizeAvicRecord(
      {
        RegistroViagemId: '1',
        VeiculoId: '2',
        HoraSaidaGaragem: '2026-02-30T06:00:00',
        HoraChegadaGaragem: '2026-02-30T07:00:00Z',
        LastUpdate: '2026-02-30T08:00:00-03:00',
      },
      mapping,
    );
    expect(result.startedAt).toBeNull();
    expect(result.endedAt).toBeNull();
    expect(result.sourceUpdatedAt).toBeNull();
    expect(result.raw.HoraSaidaGaragem).toBe('2026-02-30T06:00:00');
    expect(() =>
      normalizeAvicRecord(
        { RegistroViagemId: '1', VeiculoId: '2' },
        { ...mapping, sourceUtcOffset: '+14:01' },
      ),
    ).toThrow();
  });
  it('rejects already-rounded JS IDs and unsafe configuration', () => {
    expect(() =>
      normalizeAvicRecord(
        { RegistroViagemId: 9007199254740992, VeiculoId: 2 },
        mapping,
      ),
    ).toThrow();
    expect(() =>
      normalizeAvicRecord(
        { RegistroViagemId: 1, VeiculoId: 2 },
        { ...mapping, sourceUtcOffset: '' },
      ),
    ).toThrow();
    expect(() => new AvicClient({ baseUrl: 'file:///tmp' })).toThrow(
      AvicClientError,
    );
    expect(
      () => new AvicClient({ baseUrl: 'https://user:secret@example.test' }),
    ).toThrow(AvicClientError);
  });
});
describe('read-only paginated Avic client', () => {
  it('requests every fleet record without approval/client/service filters and follows short pages until empty', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('[' + synthetic + ']'))
      .mockResolvedValueOnce(new Response('[]'));
    const client = new AvicClient({
      baseUrl: 'https://example.test/',
      fetch: fetcher,
      headers: { 'X-Token': 'secret' },
    });
    const pages = [];
    for await (const page of client.pages(query)) pages.push(page);
    expect(pages.map((page) => page.nextSkip)).toEqual([25, null]);
    const url = new URL((fetcher.mock.calls[0][0] as URL).href);
    expect(url.pathname).toBe('/api/FrotaContrato/pesquisa/0');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      idveiculo: '8',
      viagemini: '2026-07-01',
      viagemfim: '2026-07-31',
      order: '1',
    });
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: { 'X-Token': 'secret' },
    });
    expect(new URL((fetcher.mock.calls[1][0] as URL).href).pathname).toBe(
      '/api/FrotaContrato/pesquisa/25',
    );
  });
  it('resumes the cursor provided by persistent import jobs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('[]'));
    await new AvicClient({
      baseUrl: 'https://example.test',
      fetch: fetcher,
    }).readPage({ ...query, skip: 75 });
    expect(new URL((fetcher.mock.calls[0][0] as URL).href).pathname).toBe(
      '/api/FrotaContrato/pesquisa/75',
    );
  });
  it('does not interpret unknown envelopes or error pages as successful empty results', async () => {
    for (const body of [
      '{"data":[]}',
      'null',
      '<html>login</html>',
      '[null]',
    ]) {
      const client = new AvicClient({
        baseUrl: 'https://example.test',
        fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
      });
      await expect(client.readPage(query)).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
  });
  it('limits response bytes and page count without silently declaring completion', async () => {
    const large = new AvicClient({
      baseUrl: 'https://example.test',
      maxResponseBytes: 4,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('[{"a":1}]')),
    });
    await expect(large.readPage(query)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    const pages = new AvicClient({
      baseUrl: 'https://example.test',
      maxPages: 1,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('[{}]')),
    }).pages(query);
    expect((await pages.next()).value).toMatchObject({ nextSkip: 25 });
    await expect(pages.next()).rejects.toMatchObject({
      code: 'PAGE_LIMIT',
      retryable: true,
    });
  });
  it('redacts upstream errors and does not forward credentials on redirects', async () => {
    const client = new AvicClient({
      baseUrl: 'https://example.test',
      headers: { Authorization: 'secret' },
      fetch: vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error('secret provider content')),
    });
    await expect(client.readPage(query)).rejects.toThrow(
      'Avic read unavailable: UNAVAILABLE',
    );
    const denied = new AvicClient({
      baseUrl: 'https://example.test',
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('secret', { status: 401 })),
    });
    await expect(denied.readPage(query)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      retryable: false,
    });
  });
  it('aborts slow requests and reports pending availability', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const client = new AvicClient({
      baseUrl: 'https://example.test',
      fetch: fetcher,
      timeoutMs: 5,
    });
    await expect(client.readPage(query)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      retryable: true,
    });
  });
  it('validates cursors and query periods before requesting', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new AvicClient({
      baseUrl: 'https://example.test',
      fetch: fetcher,
    });
    await expect(client.readPage({ ...query, skip: 1 })).rejects.toMatchObject({
      code: 'CONFIGURATION',
    });
    await expect(
      client.readPage({ ...query, from: '2026-08-01' }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION' });
    await expect(
      client.readPage({ ...query, from: '2026-02-30' }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
