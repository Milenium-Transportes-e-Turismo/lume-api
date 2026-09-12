import { AvicPasswordAuthentication, type AvicCredentials } from './avic-auth';
import { AvicClientError } from './avic-errors';
export { AvicClientError } from './avic-errors';

/** Preserve every JSON numeric token as text, before JSON.parse can round large IDs. */
export function parseAvicJson(text: string): unknown {
  let transformed = '';
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === '"') {
      const start = index++;
      let closed = false;
      while (index < text.length) {
        if (text[index] === '\\') {
          index += 2;
          continue;
        }
        if (text[index++] === '"') {
          closed = true;
          break;
        }
      }
      if (!closed) throw new Error('Invalid Avic JSON string');
      transformed += text.slice(start, index);
    } else if (character === '-' || /\d/.test(character)) {
      const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
        text.slice(index),
      );
      if (!token) throw new Error('Invalid Avic JSON number');
      transformed += JSON.stringify(token[0]);
      index += token[0].length;
    } else {
      transformed += character;
      index++;
    }
  }
  return JSON.parse(transformed) as unknown;
}
export type AvicRawRecord = Record<string, unknown>;
export interface AvicFieldMapping {
  /** Provider confirmation required; RegistroViagemId and Id are distinct. */
  externalIdField: string;
  /** Offset for naive source timestamps, configured explicitly (for example -03:00). */
  sourceUtcOffset: string;
}
export interface NormalizedAvicRecord {
  externalId: string;
  vehicleId: string;
  routeExternalId: string | null;
  routeName: string | null;
  fleet: string | null;
  /** Provider labels/identifiers only; they do not establish tenant supplier links. */
  driverExternalId: string | null;
  driverName: string | null;
  customerExternalId: string | null;
  customerName: string | null;
  startedAt: string | null;
  endedAt: string | null;
  startKm: number | null;
  endKm: number | null;
  reportedKm: number | null;
  sourceUpdatedAt: string | null;
  measurementSource: 'DRIVER_REPORTED';
  garageReadingsIncluded: true;
  /** Intermediate zero/null values are unknown and are not promoted to readings. */
  intermediateReadings: Record<string, number | null>;
  raw: AvicRawRecord;
}
function externalId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value))
    return String(value);
  return null;
}
function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
/**
 * Exact thousandths within PostgreSQL Decimal(16,3), before conversion to Number.
 * Excess scale or magnitude remains in raw rather than being rounded or clamped.
 */
function scaledMeasurement(value: string): bigint | null {
  if (value.length > 128) return null;
  const parts = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!parts) return null;
  const fraction = parts[3] ?? '';
  const exponent = Number(parts[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 128) return null;
  const coefficient = BigInt(parts[2] + fraction);
  if (coefficient === 0n) return 0n;
  const scale = 3 + exponent - fraction.length;
  let scaled: bigint;
  if (scale >= 0) {
    if (scale > 16) return null;
    scaled = coefficient * 10n ** BigInt(scale);
  } else {
    const divisor = 10n ** BigInt(-scale);
    if (coefficient % divisor !== 0n) return null;
    scaled = coefficient / divisor;
  }
  if (scaled > 9_999_999_999_999_999n) return null;
  return parts[1] === '-' ? -scaled : scaled;
}
function measurement(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const token = String(value);
  const exact = scaledMeasurement(token);
  if (exact === null) return null;
  const result = Number(token);
  // Verify the decimal that Number will serialize is still exactly the source value.
  // Some Decimal(16,3) values exceed the representable precision of JavaScript.
  return Number.isFinite(result) && scaledMeasurement(String(result)) === exact
    ? result
    : null;
}
function civilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(value + 'T00:00:00Z');
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
  );
}
function sourceInstant(value: unknown, offset: string): string | null {
  if (typeof value !== 'string') return null;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})?$/i.test(
      value,
    )
  )
    return null;
  if (!civilDate(value.slice(0, 10)) || Number(value.slice(11, 13)) > 23)
    return null;
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : value + offset;
  const result = Date.parse(zoned);
  return Number.isFinite(result) ? new Date(result).toISOString() : null;
}
export function normalizeAvicRecord(
  raw: AvicRawRecord,
  mapping: AvicFieldMapping,
): NormalizedAvicRecord {
  if (!/^[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00)$/.test(mapping.sourceUtcOffset))
    throw new Error('Configure Avic source UTC offset');
  if (!mapping.externalIdField.trim())
    throw new Error('Configure Avic external ID field');
  const id = externalId(raw[mapping.externalIdField]);
  const vehicleId = externalId(raw.VeiculoId);
  if (!id || !vehicleId)
    throw new Error('Avic record has missing or unsafe external identifiers');
  const intermediateReadings: Record<string, number | null> = {};
  for (const field of [
    'KMChegadaOrigem',
    'KMChegadaDestino',
    'KMSaidaDestino',
    'KMRetorno',
  ]) {
    const value = measurement(raw[field]);
    intermediateReadings[field] = value !== null && value > 0 ? value : null;
  }
  const startedAt = sourceInstant(
    raw.HoraSaidaGaragem,
    mapping.sourceUtcOffset,
  );
  const endedAt = sourceInstant(
    raw.HoraChegadaGaragem,
    mapping.sourceUtcOffset,
  );
  const startKm = measurement(raw.KMSaidaGaragem);
  const endKm = measurement(raw.KMRetornoGaragem);
  return {
    externalId: id,
    vehicleId,
    routeExternalId: externalId(raw.IdLinhaRota),
    routeName: optionalText(raw.LinhaNome),
    fleet: optionalText(raw.VeiculoFrota),
    driverExternalId: externalId(raw.MotoristaLiderId),
    driverName: optionalText(raw.MotoristaLiderNome),
    customerExternalId: externalId(raw.CodigoCadastro),
    customerName: optionalText(raw.ClienteNome),
    startedAt,
    endedAt,
    // A zero without its actual event is a placeholder on an open trip.
    startKm: startKm === 0 && startedAt === null ? null : startKm,
    endKm: endKm === 0 && endedAt === null ? null : endKm,
    reportedKm: measurement(raw.KMTotal),
    sourceUpdatedAt: sourceInstant(raw.LastUpdate, mapping.sourceUtcOffset),
    measurementSource: 'DRIVER_REPORTED',
    garageReadingsIncluded: true,
    intermediateReadings,
    raw,
  };
}
export interface AvicClientOptions {
  baseUrl: string;
  /** Exact authentication headers supplied by server-side configuration. Never serialized. */
  headers?: Record<string, string>;
  /** Server-side password login. Token cache belongs to this client instance. */
  credentials?: AvicCredentials;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxPages?: number;
  fetch?: typeof fetch;
}
export interface AvicPageQuery {
  vehicleId: string;
  from: string;
  to: string;
  skip?: number;
}
export interface AvicPage {
  records: AvicRawRecord[];
  nextSkip: number | null;
}
/** Read-only adapter. No provider update/approve/start/conclude operations exist here. */
export class AvicClient {
  private readonly base: URL;
  #authentication?: AvicPasswordAuthentication;
  #headers: Record<string, string>;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxPages: number;
  constructor(options: AvicClientOptions) {
    this.#headers = { ...options.headers };
    try {
      this.base = new URL(
        options.baseUrl.endsWith('/') ? options.baseUrl : options.baseUrl + '/',
      );
    } catch {
      throw new AvicClientError('CONFIGURATION', false);
    }
    if (
      !['http:', 'https:'].includes(this.base.protocol) ||
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash
    ) {
      throw new AvicClientError('CONFIGURATION', false);
    }
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 8 * 1024 * 1024;
    this.maxPages = options.maxPages ?? 100;
    for (const limit of [
      this.timeoutMs,
      this.maxResponseBytes,
      this.maxPages,
    ]) {
      if (!Number.isSafeInteger(limit) || limit <= 0)
        throw new AvicClientError('CONFIGURATION', false);
    }
    if (options.credentials) {
      if (
        Object.keys(options.headers ?? {}).some(
          (key) => key.toLowerCase() === 'authorization',
        )
      )
        throw new AvicClientError('CONFIGURATION', false);
      this.#authentication = new AvicPasswordAuthentication({
        base: this.base,
        credentials: options.credentials,
        fetcher: this.fetcher,
        timeoutMs: Math.min(this.timeoutMs, 15_000),
      });
    }
  }
  async readPage(query: AvicPageQuery): Promise<AvicPage> {
    const skip = query.skip ?? 0;
    if (
      !query.vehicleId.trim() ||
      !Number.isSafeInteger(skip) ||
      skip < 0 ||
      skip % 25 !== 0 ||
      !civilDate(query.from) ||
      !civilDate(query.to) ||
      query.from > query.to
    ) {
      throw new AvicClientError('CONFIGURATION', false);
    }
    const url = new URL('api/FrotaContrato/pesquisa/' + skip, this.base);
    url.searchParams.set('idveiculo', query.vehicleId);
    url.searchParams.set('viagemini', query.from);
    url.searchParams.set('viagemfim', query.to);
    url.searchParams.set('order', '1');
    let token = await this.#authentication?.token();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      let response: Response;
      for (let attempt = 0; ; attempt++) {
        const controller = new AbortController();
        timer = setTimeout(() => controller.abort(), this.timeoutMs);
        response = await this.fetcher(url, {
          method: 'GET',
          headers: {
            ...this.#headers,
            Accept: 'application/json',
            ...(token ? { Authorization: 'Bearer ' + token } : {}),
          },
          redirect: 'error',
          signal: controller.signal,
        });
        if (response.status !== 401 || !this.#authentication || !token) break;
        await response.body?.cancel();
        clearTimeout(timer);
        this.#authentication.invalidate(token, attempt === 1);
        if (attempt === 1) throw new AvicClientError('AUTHENTICATION', false);
        token = await this.#authentication.token();
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new AvicClientError(
          'UNAVAILABLE',
          response.status === 429 || response.status >= 500,
        );
      }
      if (!response.body) throw new AvicClientError('INVALID_RESPONSE', false);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      let bytes = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > this.maxResponseBytes)
            throw new AvicClientError('INVALID_RESPONSE', false);
          text += decoder.decode(part.value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      let result: unknown;
      try {
        result = parseAvicJson(text);
      } catch {
        throw new AvicClientError('INVALID_RESPONSE', false);
      }
      if (
        !Array.isArray(result) ||
        result.length > 25 ||
        result.some(
          (item) =>
            item === null || typeof item !== 'object' || Array.isArray(item),
        )
      ) {
        throw new AvicClientError('INVALID_RESPONSE', false);
      }
      // A short page is not treated as completion: only an empty page ends the run.
      return {
        records: result as AvicRawRecord[],
        nextSkip: result.length === 0 ? null : skip + 25,
      };
    } catch (error) {
      if (error instanceof AvicClientError) throw error;
      // Do not expose provider response bodies, URLs or authentication headers.
      throw new AvicClientError('UNAVAILABLE', true);
    } finally {
      clearTimeout(timer);
    }
  }
  /** Persist each page and nextSkip before requesting the next page, for safe resume. */
  async *pages(query: AvicPageQuery): AsyncGenerator<AvicPage> {
    let skip = query.skip ?? 0;
    for (let count = 0; count < this.maxPages; count++) {
      const page = await this.readPage({ ...query, skip });
      yield page;
      if (page.nextSkip === null) return;
      skip = page.nextSkip;
    }
    throw new AvicClientError('PAGE_LIMIT', true);
  }
}
