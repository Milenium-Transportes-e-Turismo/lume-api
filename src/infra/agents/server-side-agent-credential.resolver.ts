import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AgentCredentialResolver,
  type ResolveAgentCredentialInput,
} from '../../application/contracts/agent-credential-resolver';
import { AgentCredentialResolutionError } from '../../application/errors/agent-credential-resolution.error';
import { OpenAiApiCredential } from '../../application/value-objects/openai-api-credential';
import { assertSafeCredentialReference } from '../../domain/agents/agent-runtime';

const DEFAULT_DOCKER_SECRETS_ROOT = '/run/secrets';
const MAXIMUM_SECRET_FILE_BYTES = 16 * 1024;
const ENVIRONMENT_KEY = /^[a-z_][a-z0-9_]{2,127}$/iu;
const DOCKER_SECRET_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,127}$/iu;

function isInsideRoot(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot.length > 0 &&
    pathFromRoot !== '..' &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

function safeReference(value: string): string {
  try {
    return assertSafeCredentialReference(value);
  } catch {
    throw new AgentCredentialResolutionError('invalid-reference');
  }
}

@Injectable()
export class ServerSideAgentCredentialResolver extends AgentCredentialResolver {
  constructor(private readonly config: ConfigService) {
    super();
  }

  async resolve(
    input: ResolveAgentCredentialInput,
  ): Promise<OpenAiApiCredential> {
    if (!input.agentId.trim() || input.agentId.trim().length > 120) {
      throw new AgentCredentialResolutionError('invalid-reference');
    }
    const reference = safeReference(input.credentialRef);
    const separator = reference.indexOf('://');
    const scheme = reference.slice(0, separator).toLowerCase();
    const location = reference.slice(separator + 3);

    if (scheme === 'env') {
      return this.resolveEnvironment(location, input.credentialIdentifier);
    }
    if (scheme === 'docker-secret') {
      return this.resolveDockerSecret(location, input.credentialIdentifier);
    }
    throw new AgentCredentialResolutionError('unsupported-scheme');
  }

  private resolveEnvironment(
    environmentKey: string,
    credentialIdentifier: string,
  ): OpenAiApiCredential {
    if (!ENVIRONMENT_KEY.test(environmentKey)) {
      throw new AgentCredentialResolutionError('invalid-reference');
    }
    const value = this.config.get<unknown>(environmentKey);
    if (typeof value !== 'string' || !value.trim()) {
      throw new AgentCredentialResolutionError('missing');
    }
    return OpenAiApiCredential.create({
      secret: value,
      credentialIdentifier,
    });
  }

  private async resolveDockerSecret(
    secretLocation: string,
    credentialIdentifier: string,
  ): Promise<OpenAiApiCredential> {
    const segments = secretLocation.split('/');
    if (
      segments.length === 0 ||
      segments.some(
        (segment) =>
          segment === '.' ||
          segment === '..' ||
          !DOCKER_SECRET_SEGMENT.test(segment),
      )
    ) {
      throw new AgentCredentialResolutionError('unsafe-path');
    }

    const configuredRoot = this.config.get<unknown>(
      'AGENT_DOCKER_SECRETS_ROOT',
    );
    const root =
      configuredRoot === undefined
        ? DEFAULT_DOCKER_SECRETS_ROOT
        : typeof configuredRoot === 'string'
          ? configuredRoot.trim()
          : '';
    if (!root || !isAbsolute(root)) {
      throw new AgentCredentialResolutionError('invalid-docker-secrets-root');
    }

    let canonicalRoot: string;
    try {
      canonicalRoot = await realpath(root);
    } catch {
      throw new AgentCredentialResolutionError('invalid-docker-secrets-root');
    }
    const candidate = resolve(canonicalRoot, ...segments);
    if (!isInsideRoot(canonicalRoot, candidate)) {
      throw new AgentCredentialResolutionError('unsafe-path');
    }

    let canonicalCandidate: string;
    try {
      canonicalCandidate = await realpath(candidate);
    } catch {
      throw new AgentCredentialResolutionError('missing');
    }
    if (!isInsideRoot(canonicalRoot, canonicalCandidate)) {
      throw new AgentCredentialResolutionError('unsafe-path');
    }

    try {
      const file = await stat(canonicalCandidate);
      if (
        !file.isFile() ||
        file.size === 0 ||
        file.size > MAXIMUM_SECRET_FILE_BYTES
      ) {
        throw new AgentCredentialResolutionError('invalid-secret');
      }
      const value = await readFile(canonicalCandidate, 'utf8');
      return OpenAiApiCredential.create({
        secret: value,
        credentialIdentifier,
      });
    } catch (error) {
      if (error instanceof AgentCredentialResolutionError) throw error;
      throw new AgentCredentialResolutionError('missing');
    }
  }
}
