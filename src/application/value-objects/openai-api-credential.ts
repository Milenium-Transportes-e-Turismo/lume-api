import { inspect } from 'node:util';

import { AgentCredentialResolutionError } from '../errors/agent-credential-resolution.error';

const OPENAI_API_KEY = /^sk-[a-z0-9][a-z0-9_-]{18,509}$/iu;
const CREDENTIAL_IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,119}$/iu;

export interface OpenAiApiCredentialMetadata {
  readonly provider: 'openai';
  readonly credentialIdentifier: string;
}

/**
 * Ephemeral server-side credential. The secret is a native private field and
 * can only be exposed to the provider adapter through use().
 */
export class OpenAiApiCredential {
  readonly provider = 'openai' as const;
  readonly credentialIdentifier: string;
  readonly #secret: string;

  private constructor(secret: string, credentialIdentifier: string) {
    this.#secret = secret;
    this.credentialIdentifier = credentialIdentifier;
    Object.freeze(this);
  }

  static create(input: {
    readonly secret: string;
    readonly credentialIdentifier: string;
  }): OpenAiApiCredential {
    const secret = input.secret.trim();
    const credentialIdentifier = input.credentialIdentifier.trim();
    if (
      !OPENAI_API_KEY.test(secret) ||
      secret.toLowerCase().includes('replace-with')
    ) {
      throw new AgentCredentialResolutionError('invalid-secret');
    }
    if (!CREDENTIAL_IDENTIFIER.test(credentialIdentifier)) {
      throw new AgentCredentialResolutionError('invalid-reference');
    }
    return new OpenAiApiCredential(secret, credentialIdentifier);
  }

  use<Result>(operation: (secret: string) => Result): Result {
    return operation(this.#secret);
  }

  toJSON(): OpenAiApiCredentialMetadata {
    return {
      provider: this.provider,
      credentialIdentifier: this.credentialIdentifier,
    };
  }

  toString(): string {
    return `[OpenAiApiCredential ${this.credentialIdentifier} REDACTED]`;
  }

  [inspect.custom](): string {
    return this.toString();
  }
}
