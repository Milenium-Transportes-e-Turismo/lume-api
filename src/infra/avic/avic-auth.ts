import { AvicClientError } from './avic-errors';

export interface AvicCredentials {
  userId: string;
  accessKey: string;
  /** Required only for naive Expiration when AccessToken has no usable JWT exp. */
  utcOffset?: string;
}
interface Access {
  token: string;
  expiresAt: number;
}
interface AuthOptions {
  base: URL;
  credentials: AvicCredentials;
  fetcher: typeof fetch;
  timeoutMs: number;
}
const MARGIN_MS = 30_000;
const COOLDOWN_MS = 30_000;

/** Calendar parsing never inherits the VPS timezone. */
function expirationInstant(value: unknown, offset?: string): number | null {
  if (typeof value !== 'string') return null;
  const match =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})?$/.exec(
      value,
    );
  if (
    !match ||
    Number(match[2]) > 23 ||
    Number(match[3]) > 59 ||
    Number(match[4]) > 59
  )
    return null;
  const day = Date.parse(match[1] + 'T00:00:00Z');
  if (
    !Number.isFinite(day) ||
    new Date(day).toISOString().slice(0, 10) !== match[1]
  )
    return null;
  const zone = match[6] ?? offset;
  if (!zone || !/^(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/.test(zone))
    return null;
  const instant = Date.parse(
    match[1] +
      'T' +
      match[2] +
      ':' +
      match[3] +
      ':' +
      match[4] +
      (match[5] ? '.' + match[5].slice(0, 3) : '') +
      zone,
  );
  return Number.isFinite(instant) ? instant : null;
}

/** Unverified exp is only a cache deadline; it never authorizes a Lume request. */
function jwtExpiration(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    );
    if (!payload || typeof payload !== 'object' || !('exp' in payload))
      return null;
    const exp = payload.exp;
    return typeof exp === 'number' &&
      Number.isSafeInteger(exp) &&
      exp > 0 &&
      exp <= 8_640_000_000_000
      ? exp * 1000
      : null;
  } catch {
    return null;
  }
}

/** Token lives only in this tenant client's memory. No refresh grant is assumed. */
export class AvicPasswordAuthentication {
  #access?: Access;
  #pending?: Promise<string>;
  #failure?: {
    until: number;
    code: AvicClientError['code'];
    retryable: boolean;
  };
  #options: AuthOptions;

  constructor(options: AuthOptions) {
    const { userId, accessKey, utcOffset } = options.credentials;
    if (
      !userId.trim() ||
      !accessKey.trim() ||
      (utcOffset && !/^[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00)$/.test(utcOffset))
    ) {
      throw new AvicClientError('CONFIGURATION', false);
    }
    this.#options = options;
  }
  async token(): Promise<string> {
    if (this.#access && this.#access.expiresAt > Date.now() + MARGIN_MS)
      return this.#access.token;
    if (this.#pending) return this.#pending;
    if (this.#failure && this.#failure.until > Date.now()) {
      throw new AvicClientError(this.#failure.code, this.#failure.retryable);
    }
    this.#access = undefined;
    this.#pending = this.login();
    try {
      return await this.#pending;
    } finally {
      this.#pending = undefined;
    }
  }
  /** A delayed 401 for an old token must not erase a newer successful login. */
  invalidate(token: string, rejectedAfterLogin = false): void {
    if (this.#access?.token !== token) return;
    this.#access = undefined;
    if (rejectedAfterLogin)
      this.#failure = {
        until: Date.now() + COOLDOWN_MS,
        code: 'AUTHENTICATION',
        retryable: false,
      };
  }
  private async login(): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#options.timeoutMs);
    try {
      const response = await this.#options.fetcher(
        new URL('api/Login', this.#options.base),
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            UserID: this.#options.credentials.userId,
            AccessKey: this.#options.credentials.accessKey,
            GrantType: 'password',
          }),
          redirect: 'error',
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new AvicClientError(
          'AUTHENTICATION',
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
          if (bytes > 64 * 1024)
            throw new AvicClientError('INVALID_RESPONSE', false);
          text += decoder.decode(part.value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        throw new AvicClientError('INVALID_RESPONSE', false);
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw new AvicClientError('INVALID_RESPONSE', false);
      const data = payload as Record<string, unknown>;
      if (data.Authenticated !== true)
        throw new AvicClientError('AUTHENTICATION', false);
      if (
        typeof data.AccessToken !== 'string' ||
        !data.AccessToken ||
        data.AccessToken.length > 16 * 1024 ||
        !/^[A-Za-z0-9._~+/=-]+$/.test(data.AccessToken)
      )
        throw new AvicClientError('INVALID_RESPONSE', false);
      const deadlines = [
        jwtExpiration(data.AccessToken),
        expirationInstant(data.Expiration, this.#options.credentials.utcOffset),
      ].filter((value): value is number => value !== null);
      if (!deadlines.length) throw new AvicClientError('CONFIGURATION', false);
      const expiresAt = Math.min(...deadlines);
      if (expiresAt <= Date.now() + MARGIN_MS)
        throw new AvicClientError('AUTHENTICATION', false);
      this.#access = { token: data.AccessToken, expiresAt };
      this.#failure = undefined;
      // RefreshToken/Message and the raw response are deliberately not retained.
      return data.AccessToken;
    } catch (error) {
      const safe =
        error instanceof AvicClientError
          ? error
          : new AvicClientError('UNAVAILABLE', true);
      this.#failure = {
        until: Date.now() + COOLDOWN_MS,
        code: safe.code,
        retryable: safe.retryable,
      };
      throw safe;
    } finally {
      clearTimeout(timer);
    }
  }
}
