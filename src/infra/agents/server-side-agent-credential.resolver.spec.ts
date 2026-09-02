import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { inspect } from 'node:util';
import { join } from 'node:path';

import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentCredentialResolver } from '../../application/contracts/agent-credential-resolver';
import { AgentCredentialResolutionError } from '../../application/errors/agent-credential-resolution.error';
import { OpenAiApiCredential } from '../../application/value-objects/openai-api-credential';
import { AgentsFoundationModule } from '../../modules/agents/agents-foundation.module';
import { ServerSideAgentCredentialResolver } from './server-side-agent-credential.resolver';

const AGENT_A_KEY = 'sk-proj-agent-a-abcdefghijklmnopqrstuv123456';
const AGENT_B_KEY = 'sk-proj-agent-b-abcdefghijklmnopqrstuv654321';
const temporaryDirectories: string[] = [];

function resolver(config: Readonly<Record<string, unknown>>) {
  return new ServerSideAgentCredentialResolver(new ConfigService(config));
}

function reveal(credential: OpenAiApiCredential): string {
  return credential.use((secret) => secret);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('ServerSideAgentCredentialResolver', () => {
  it('resolves exact env references without sharing credentials between agents', async () => {
    const subject = resolver({
      LUME_AGENT_A_OPENAI_KEY: AGENT_A_KEY,
      LUME_AGENT_B_OPENAI_KEY: AGENT_B_KEY,
    });

    const agentA = await subject.resolve({
      agentId: 'agent-a',
      credentialRef: 'env://LUME_AGENT_A_OPENAI_KEY',
      credentialIdentifier: 'agent-a-v1',
    });
    const agentB = await subject.resolve({
      agentId: 'agent-b',
      credentialRef: 'env://LUME_AGENT_B_OPENAI_KEY',
      credentialIdentifier: 'agent-b-v1',
    });

    expect(reveal(agentA)).toBe(AGENT_A_KEY);
    expect(reveal(agentB)).toBe(AGENT_B_KEY);
    expect(reveal(agentA)).not.toBe(reveal(agentB));
  });

  it('isolates an invalid key instead of falling back to another agent', async () => {
    const subject = resolver({
      LUME_AGENT_A_OPENAI_KEY: 'invalid-agent-a-key',
      LUME_AGENT_B_OPENAI_KEY: AGENT_B_KEY,
    });

    await expect(
      subject.resolve({
        agentId: 'agent-a',
        credentialRef: 'env://LUME_AGENT_A_OPENAI_KEY',
        credentialIdentifier: 'agent-a-v1',
      }),
    ).rejects.toMatchObject({
      reason: 'invalid-secret',
    });
    const agentB = await subject.resolve({
      agentId: 'agent-b',
      credentialRef: 'env://LUME_AGENT_B_OPENAI_KEY',
      credentialIdentifier: 'agent-b-v1',
    });
    expect(reveal(agentB)).toBe(AGENT_B_KEY);
  });

  it('reports an absent exact reference without discovering another key', async () => {
    const subject = resolver({ LUME_AGENT_B_OPENAI_KEY: AGENT_B_KEY });

    await expect(
      subject.resolve({
        agentId: 'agent-a',
        credentialRef: 'env://LUME_AGENT_A_OPENAI_KEY',
        credentialIdentifier: 'agent-a-v1',
      }),
    ).rejects.toMatchObject({
      reason: 'missing',
    });
  });

  it('rejects configured-domain schemes that this server cannot resolve', async () => {
    const subject = resolver({});
    const reference = 'secret://openai/agents/commercial/v1';

    let failure: unknown;
    try {
      await subject.resolve({
        agentId: 'commercial',
        credentialRef: reference,
        credentialIdentifier: 'commercial-v1',
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AgentCredentialResolutionError);
    expect(failure).toMatchObject({
      reason: 'unsupported-scheme',
    });
    expect(String(failure)).not.toContain(reference);
  });

  it('reads a Docker secret only from the configured canonical root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lume-agent-secrets-'));
    temporaryDirectories.push(root);
    await mkdir(join(root, 'openai'), { recursive: true });
    await writeFile(join(root, 'openai', 'agent-a'), `${AGENT_A_KEY}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    const subject = resolver({ AGENT_DOCKER_SECRETS_ROOT: root });

    const credential = await subject.resolve({
      agentId: 'agent-a',
      credentialRef: 'docker-secret://openai/agent-a',
      credentialIdentifier: 'agent-a-docker-v1',
    });

    expect(reveal(credential)).toBe(AGENT_A_KEY);
  });

  it('rejects Docker secret path traversal before reading the filesystem', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lume-agent-secrets-'));
    temporaryDirectories.push(root);
    const subject = resolver({ AGENT_DOCKER_SECRETS_ROOT: root });

    await expect(
      subject.resolve({
        agentId: 'agent-a',
        credentialRef: 'docker-secret://openai/../../outside',
        credentialIdentifier: 'agent-a-v1',
      }),
    ).rejects.toMatchObject({
      reason: 'unsafe-path',
    });
  });
});

describe('OpenAiApiCredential', () => {
  it('never serializes or prints the secret', () => {
    const credential = OpenAiApiCredential.create({
      secret: AGENT_A_KEY,
      credentialIdentifier: 'agent-a-v1',
    });

    expect(JSON.stringify(credential)).toBe(
      '{"provider":"openai","credentialIdentifier":"agent-a-v1"}',
    );
    expect(String(credential)).not.toContain(AGENT_A_KEY);
    expect(inspect(credential)).not.toContain(AGENT_A_KEY);
    expect(Object.keys(credential)).not.toContain('secret');
  });

  it('rejects invalid material without echoing it in the error', () => {
    const invalidSecret = 'definitely-not-an-openai-key';

    expect(() =>
      OpenAiApiCredential.create({
        secret: invalidSecret,
        credentialIdentifier: 'agent-a-v1',
      }),
    ).toThrow('credencial OpenAI do agente é inválida');
    try {
      OpenAiApiCredential.create({
        secret: invalidSecret,
        credentialIdentifier: 'agent-a-v1',
      });
    } catch (error) {
      expect(String(error)).not.toContain(invalidSecret);
    }
  });
});

describe('AgentsFoundationModule', () => {
  it('registers the abstract application contract with the server-side resolver', async () => {
    const testingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true }),
        AgentsFoundationModule,
      ],
    }).compile();

    expect(testingModule.get(AgentCredentialResolver)).toBeInstanceOf(
      ServerSideAgentCredentialResolver,
    );
    await testingModule.close();
  });
});
