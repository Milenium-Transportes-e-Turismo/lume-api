import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  PreAdmissionAccessRepository,
  PreAdmissionTokenService,
  type PreAdmissionAccessRecord,
  type PreAdmissionMutationResult,
} from '../../contracts/pre-admission-access.repository';
import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';
import {
  invalidPreAdmissionToken,
  validationError,
} from '../../../core/errors/app-error';
import {
  assertCanManagePreAdmission,
  preAdmissionExpiresAt,
  preAdmissionStatus,
} from '../../../domain/identity/pre-admission-access';

type CreatePreAdmissionInput = {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly personRegistrationId: string;
  readonly documentTypeIds: readonly string[];
  readonly instructions?: Readonly<Record<string, string>>;
};

type VersionedPreAdmissionInput = {
  readonly commandId: string;
  readonly expectedVersion: number;
};

function fingerprint(value: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function publicRequestedDocuments(access: PreAdmissionAccessRecord) {
  return access.requestedDocuments.map((item) => ({
    code: item.code,
    name: item.name,
    acceptedMimeTypes: item.acceptedMimeTypes,
    maxFileSizeBytes: item.maxFileSizeBytes,
    minFiles: item.minFiles,
    maxFiles: item.maxFiles,
    requiresFrontBack: item.requiresFrontBack,
    instructions: item.instructions,
    position: item.position,
  }));
}

function managementResult(result: PreAdmissionMutationResult, token?: string) {
  const access = result.access;
  return {
    id: access.id,
    personRegistrationId: access.personRegistrationId,
    personName: access.personName,
    purpose: 'admission-document-upload' as const,
    status: preAdmissionStatus({
      revokedAt: result.resultRevokedAt,
      expiresAt: result.resultExpiresAt,
      now: new Date(),
    }),
    expiresAt: result.resultExpiresAt.toISOString(),
    revokedAt: result.resultRevokedAt?.toISOString() ?? null,
    version: result.resultVersion,
    requestedDocuments: access.requestedDocuments,
    uploadAvailable: false as const,
    idempotent: result.idempotent,
    ...(token ? { token } : {}),
  };
}

@Injectable()
export class PreAdmissionAccessService {
  constructor(
    private readonly repository: PreAdmissionAccessRepository,
    private readonly tokens: PreAdmissionTokenService,
  ) {}

  async create(
    principal: AuthenticatedPrincipal,
    input: CreatePreAdmissionInput,
  ) {
    assertCanManagePreAdmission(principal);
    if (input.expectedVersion !== 0) {
      throw validationError(
        'A criação do acesso de pré-admissão exige expectedVersion igual a zero.',
      );
    }
    const now = new Date();
    const id = randomUUID();
    const issued = this.tokens.issue({
      accessId: id,
      companyId: principal.companyId,
      generation: 1,
    });
    const requestFingerprint = fingerprint({
      action: 'created',
      personRegistrationId: input.personRegistrationId,
      documentTypeIds: input.documentTypeIds,
      instructions: input.instructions ?? {},
      expectedVersion: 0,
    });
    const result = await this.repository.create({
      id,
      companyId: principal.companyId,
      actorUserId: principal.id,
      personRegistrationId: input.personRegistrationId,
      documentTypeIds: input.documentTypeIds,
      instructions: input.instructions,
      commandId: input.commandId,
      expectedVersion: 0,
      requestFingerprint,
      tokenHash: issued.hash,
      expiresAt: preAdmissionExpiresAt(now),
      now,
    });
    const responseToken = this.tokens.issue({
      accessId: result.access.id,
      companyId: result.access.companyId,
      generation: result.resultTokenGeneration,
    }).plainText;

    return managementResult(result, responseToken);
  }

  async renew(
    principal: AuthenticatedPrincipal,
    accessId: string,
    input: VersionedPreAdmissionInput,
  ) {
    assertCanManagePreAdmission(principal);
    if (input.expectedVersion < 1) {
      throw validationError('expectedVersion deve ser maior ou igual a um.');
    }
    const now = new Date();
    const tokenGeneration = input.expectedVersion + 1;
    const issued = this.tokens.issue({
      accessId,
      companyId: principal.companyId,
      generation: tokenGeneration,
    });
    const result = await this.repository.renew({
      companyId: principal.companyId,
      actorUserId: principal.id,
      accessId,
      commandId: input.commandId,
      expectedVersion: input.expectedVersion,
      requestFingerprint: fingerprint({
        action: 'renewed',
        accessId,
        expectedVersion: input.expectedVersion,
      }),
      tokenHash: issued.hash,
      tokenGeneration,
      expiresAt: preAdmissionExpiresAt(now),
      now,
    });
    const responseToken = this.tokens.issue({
      accessId: result.access.id,
      companyId: result.access.companyId,
      generation: result.resultTokenGeneration,
    }).plainText;

    return managementResult(result, responseToken);
  }

  async revoke(
    principal: AuthenticatedPrincipal,
    accessId: string,
    input: VersionedPreAdmissionInput,
  ) {
    assertCanManagePreAdmission(principal);
    if (input.expectedVersion < 1) {
      throw validationError('expectedVersion deve ser maior ou igual a um.');
    }
    const result = await this.repository.revoke({
      companyId: principal.companyId,
      actorUserId: principal.id,
      accessId,
      commandId: input.commandId,
      expectedVersion: input.expectedVersion,
      requestFingerprint: fingerprint({
        action: 'revoked',
        accessId,
        expectedVersion: input.expectedVersion,
      }),
      now: new Date(),
    });
    return managementResult(result);
  }

  async resolve(token: string) {
    const parsed = this.tokens.parse(token);
    if (!parsed) throw invalidPreAdmissionToken();
    const now = new Date();
    const access = await this.repository.resolve({
      accessId: parsed.accessId,
      tokenHash: parsed.hash,
      now,
    });
    if (
      !access ||
      parsed.generation !== access.tokenGeneration ||
      preAdmissionStatus({
        revokedAt: access.revokedAt,
        expiresAt: access.expiresAt,
        now,
      }) !== 'active'
    ) {
      throw invalidPreAdmissionToken();
    }

    return {
      personName: access.personName,
      purpose: 'admission-document-upload' as const,
      status: 'active' as const,
      expiresAt: access.expiresAt.toISOString(),
      version: access.version,
      requestedDocuments: publicRequestedDocuments(access),
      uploadAvailable: false as const,
    };
  }
}
