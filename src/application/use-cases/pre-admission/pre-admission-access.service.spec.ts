import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';
import {
  PreAdmissionAccessRepository,
  type PreAdmissionAccessRecord,
  type PreAdmissionMutationResult,
} from '../../contracts/pre-admission-access.repository';
import { HmacPreAdmissionTokenService } from '../../../infra/cryptography/hmac-pre-admission-token.service';
import { PreAdmissionAccessService } from './pre-admission-access.service';

const companyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherCompanyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actorUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const personRegistrationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const documentTypeId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function principal(
  overrides: Partial<AuthenticatedPrincipal> = {},
): AuthenticatedPrincipal {
  return {
    id: actorUserId,
    companyId,
    departments: ['human-resources'],
    permissions: ['documents:manage'],
    ...overrides,
  } as AuthenticatedPrincipal;
}

class InMemoryPreAdmissionAccessRepository extends PreAdmissionAccessRepository {
  readonly accesses = new Map<
    string,
    PreAdmissionAccessRecord & { tokenHash: string }
  >();
  readonly commands = new Map<string, PreAdmissionMutationResult>();

  async create(input: Parameters<PreAdmissionAccessRepository['create']>[0]) {
    const repeated = this.commands.get(`${input.companyId}:${input.commandId}`);
    if (repeated) return { ...repeated, idempotent: true };
    const access: PreAdmissionAccessRecord & { tokenHash: string } = {
      id: input.id,
      companyId: input.companyId,
      personRegistrationId: input.personRegistrationId,
      personName: 'Candidata Exemplo',
      expiresAt: input.expiresAt,
      revokedAt: null,
      version: 1,
      tokenGeneration: 1,
      tokenHash: input.tokenHash,
      requestedDocuments: [
        {
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          documentTypeId,
          code: 'cpf',
          name: 'CPF',
          acceptedMimeTypes: ['application/pdf'],
          maxFileSizeBytes: 10_000_000,
          minFiles: 1,
          maxFiles: 1,
          requiresFrontBack: false,
          instructions: null,
          position: 1,
        },
      ],
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.accesses.set(access.id, access);
    const result = {
      access,
      idempotent: false,
      resultVersion: 1,
      resultTokenGeneration: 1,
      resultExpiresAt: input.expiresAt,
      resultRevokedAt: null,
    };
    this.commands.set(`${input.companyId}:${input.commandId}`, result);
    return result;
  }

  async renew(input: Parameters<PreAdmissionAccessRepository['renew']>[0]) {
    const repeated = this.commands.get(`${input.companyId}:${input.commandId}`);
    if (repeated) return { ...repeated, idempotent: true };
    const current = this.accesses.get(input.accessId);
    if (!current || current.companyId !== input.companyId)
      return Promise.reject(new Error('not found'));
    const access = {
      ...current,
      expiresAt: input.expiresAt,
      revokedAt: null,
      version: input.expectedVersion + 1,
      tokenGeneration: input.tokenGeneration,
      tokenHash: input.tokenHash,
      updatedAt: input.now,
    };
    this.accesses.set(access.id, access);
    const result = {
      access,
      idempotent: false,
      resultVersion: access.version,
      resultTokenGeneration: access.tokenGeneration,
      resultExpiresAt: access.expiresAt,
      resultRevokedAt: null,
    };
    this.commands.set(`${input.companyId}:${input.commandId}`, result);
    return result;
  }

  async revoke(input: Parameters<PreAdmissionAccessRepository['revoke']>[0]) {
    const repeated = this.commands.get(`${input.companyId}:${input.commandId}`);
    if (repeated) return { ...repeated, idempotent: true };
    const current = this.accesses.get(input.accessId);
    if (!current || current.companyId !== input.companyId)
      return Promise.reject(new Error('not found'));
    const access = {
      ...current,
      revokedAt: input.now,
      version: input.expectedVersion + 1,
      tokenGeneration: input.expectedVersion + 1,
      updatedAt: input.now,
    };
    this.accesses.set(access.id, access);
    const result = {
      access,
      idempotent: false,
      resultVersion: access.version,
      resultTokenGeneration: access.tokenGeneration,
      resultExpiresAt: access.expiresAt,
      resultRevokedAt: access.revokedAt,
    };
    this.commands.set(`${input.companyId}:${input.commandId}`, result);
    return result;
  }

  async resolve(input: Parameters<PreAdmissionAccessRepository['resolve']>[0]) {
    const access = this.accesses.get(input.accessId);
    return access?.tokenHash === input.tokenHash ? access : null;
  }
}

function setup() {
  const repository = new InMemoryPreAdmissionAccessRepository();
  const tokens = new HmacPreAdmissionTokenService(
    new ConfigService({
      JWT_ACCESS_SECRET: 'this-is-a-test-secret-with-at-least-32-characters',
    }),
  );
  return {
    repository,
    service: new PreAdmissionAccessService(repository, tokens),
  };
}

describe('PreAdmissionAccessService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('creates a 30-day document-only access without creating a User', async () => {
    const { service } = setup();
    const commandId = '11111111-1111-4111-8111-111111111111';

    const result = await service.create(principal(), {
      commandId,
      expectedVersion: 0,
      personRegistrationId,
      documentTypeIds: [documentTypeId],
    });

    expect(result).toEqual(
      expect.objectContaining({
        token: expect.stringMatching(/^pa_/),
        expiresAt: '2026-10-01T12:00:00.000Z',
        version: 1,
        purpose: 'admission-document-upload',
        uploadAvailable: false,
      }),
    );
  });

  it('returns the same raw token when an idempotent creation is retried', async () => {
    const { service } = setup();
    const input = {
      commandId: '11111111-1111-4111-8111-111111111111',
      expectedVersion: 0 as const,
      personRegistrationId,
      documentTypeIds: [documentTypeId],
    };

    const first = await service.create(principal(), input);
    const repeated = await service.create(principal(), input);

    expect(repeated.token).toBe(first.token);
    expect(repeated.idempotent).toBe(true);
  });

  it('rotates the token on renewal and invalidates the prior token', async () => {
    const { repository, service } = setup();
    const created = await service.create(principal(), {
      commandId: '11111111-1111-4111-8111-111111111111',
      expectedVersion: 0,
      personRegistrationId,
      documentTypeIds: [documentTypeId],
    });
    const renewed = await service.renew(principal(), created.id, {
      commandId: '22222222-2222-4222-8222-222222222222',
      expectedVersion: 1,
    });

    expect(renewed.token).not.toBe(created.token);
    await expect(service.resolve(created.token)).rejects.toMatchObject({
      code: 'INVALID_PREADMISSION_TOKEN',
    });
    expect(await service.resolve(renewed.token)).toEqual(
      expect.objectContaining({ personName: 'Candidata Exemplo' }),
    );
    expect(repository.accesses).toHaveLength(1);
  });

  it('replays renewals and revocations without issuing another state change', async () => {
    const { service } = setup();
    const created = await service.create(principal(), {
      commandId: '11111111-1111-4111-8111-111111111111',
      expectedVersion: 0,
      personRegistrationId,
      documentTypeIds: [documentTypeId],
    });
    const renewalInput = {
      commandId: '22222222-2222-4222-8222-222222222222',
      expectedVersion: 1,
    };
    const renewed = await service.renew(principal(), created.id, renewalInput);
    const repeatedRenewal = await service.renew(
      principal(),
      created.id,
      renewalInput,
    );

    expect(repeatedRenewal.token).toBe(renewed.token);
    expect(repeatedRenewal.idempotent).toBe(true);

    const revokeInput = {
      commandId: '33333333-3333-4333-8333-333333333333',
      expectedVersion: 2,
    };
    const revoked = await service.revoke(principal(), created.id, revokeInput);
    const repeatedRevocation = await service.revoke(
      principal(),
      created.id,
      revokeInput,
    );

    expect(revoked).not.toHaveProperty('token');
    expect(repeatedRevocation).toEqual(
      expect.objectContaining({
        idempotent: true,
        status: 'revoked',
        version: 3,
      }),
    );
  });

  it('rejects wrong, expired and revoked tokens with the same public error', async () => {
    const { repository, service } = setup();
    const created = await service.create(principal(), {
      commandId: '11111111-1111-4111-8111-111111111111',
      expectedVersion: 0,
      personRegistrationId,
      documentTypeIds: [documentTypeId],
    });
    const wrong = `${created.token.slice(0, -1)}${created.token.endsWith('a') ? 'b' : 'a'}`;
    await expect(service.resolve(wrong)).rejects.toMatchObject({
      code: 'INVALID_PREADMISSION_TOKEN',
    });

    vi.setSystemTime(new Date('2026-10-01T12:00:00.001Z'));
    await expect(service.resolve(created.token)).rejects.toMatchObject({
      code: 'INVALID_PREADMISSION_TOKEN',
    });

    vi.setSystemTime(new Date('2026-09-02T12:00:00.000Z'));
    const access = repository.accesses.get(created.id)!;
    repository.accesses.set(created.id, {
      ...access,
      revokedAt: new Date('2026-09-02T11:00:00.000Z'),
    });
    await expect(service.resolve(created.token)).rejects.toMatchObject({
      code: 'INVALID_PREADMISSION_TOKEN',
    });
  });

  it('keeps management mutations isolated by tenant', async () => {
    const { service } = setup();
    const created = await service.create(principal(), {
      commandId: '11111111-1111-4111-8111-111111111111',
      expectedVersion: 0,
      personRegistrationId,
      documentTypeIds: [documentTypeId],
    });

    await expect(
      service.renew(principal({ companyId: otherCompanyId }), created.id, {
        commandId: '22222222-2222-4222-8222-222222222222',
        expectedVersion: 1,
      }),
    ).rejects.toThrow('not found');
  });
});
