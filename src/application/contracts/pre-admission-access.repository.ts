export interface PreAdmissionRequestedDocument {
  readonly id: string;
  readonly documentTypeId: string;
  readonly code: string;
  readonly name: string;
  readonly acceptedMimeTypes: readonly string[];
  readonly maxFileSizeBytes: number;
  readonly minFiles: number;
  readonly maxFiles: number;
  readonly requiresFrontBack: boolean;
  readonly instructions: string | null;
  readonly position: number;
}

export interface PreAdmissionAccessRecord {
  readonly id: string;
  readonly companyId: string;
  readonly personRegistrationId: string;
  readonly personName: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly version: number;
  readonly tokenGeneration: number;
  readonly requestedDocuments: readonly PreAdmissionRequestedDocument[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PreAdmissionMutationResult {
  readonly access: PreAdmissionAccessRecord;
  readonly idempotent: boolean;
  readonly resultVersion: number;
  readonly resultTokenGeneration: number;
  readonly resultExpiresAt: Date;
  readonly resultRevokedAt: Date | null;
}

export abstract class PreAdmissionAccessRepository {
  abstract create(input: {
    readonly id: string;
    readonly companyId: string;
    readonly actorUserId: string;
    readonly personRegistrationId: string;
    readonly documentTypeIds: readonly string[];
    readonly instructions?: Readonly<Record<string, string>>;
    readonly commandId: string;
    readonly expectedVersion: 0;
    readonly requestFingerprint: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
    readonly now: Date;
  }): Promise<PreAdmissionMutationResult>;

  abstract renew(input: {
    readonly companyId: string;
    readonly actorUserId: string;
    readonly accessId: string;
    readonly commandId: string;
    readonly expectedVersion: number;
    readonly requestFingerprint: string;
    readonly tokenHash: string;
    readonly tokenGeneration: number;
    readonly expiresAt: Date;
    readonly now: Date;
  }): Promise<PreAdmissionMutationResult>;

  abstract revoke(input: {
    readonly companyId: string;
    readonly actorUserId: string;
    readonly accessId: string;
    readonly commandId: string;
    readonly expectedVersion: number;
    readonly requestFingerprint: string;
    readonly now: Date;
  }): Promise<PreAdmissionMutationResult>;

  abstract resolve(input: {
    readonly accessId: string;
    readonly tokenHash: string;
    readonly now: Date;
  }): Promise<PreAdmissionAccessRecord | null>;
}

export interface IssuedPreAdmissionToken {
  readonly plainText: string;
  readonly hash: string;
}

export interface ParsedPreAdmissionToken {
  readonly accessId: string;
  readonly generation: number;
  readonly hash: string;
}

export abstract class PreAdmissionTokenService {
  abstract issue(input: {
    readonly accessId: string;
    readonly companyId: string;
    readonly generation: number;
  }): IssuedPreAdmissionToken;

  abstract parse(token: string): ParsedPreAdmissionToken | null;
}
