export class AvicClientError extends Error {
  constructor(
    public readonly code:
      | 'CONFIGURATION'
      | 'UNAVAILABLE'
      | 'INVALID_RESPONSE'
      | 'PAGE_LIMIT'
      | 'AUTHENTICATION',
    public readonly retryable: boolean,
  ) {
    super('Avic read unavailable: ' + code);
    this.name = 'AvicClientError';
  }
}
