import type { CommercialServiceRequirementKind } from '../../domain/commercial/confirmed-service';

export interface ConfirmedServiceRecord {
  readonly id: string;
  readonly companyId: string;
  readonly sourceQuoteRequestId: string;
  readonly sourceQuoteVersion: number;
  readonly sourceItemKey: string;
  readonly serviceSnapshot: Readonly<Record<string, unknown>>;
  readonly requirementsSnapshot: Readonly<Record<string, unknown>>;
  readonly confirmationBasis: string;
  readonly version: number;
  readonly confirmedByUserId: string;
  readonly confirmedAt: Date;
}

export interface CommercialServiceRequirementAttestationRecord {
  readonly id: string;
  readonly companyId: string;
  readonly sourceQuoteRequestId: string;
  readonly sourceQuoteVersion: number;
  readonly sourceItemKey: string;
  readonly kind: CommercialServiceRequirementKind;
  readonly evidence: string;
  readonly actorUserId: string;
  readonly commandId: string;
  readonly attestedAt: Date;
}

export interface AttestCommercialServiceRequirementCommand {
  readonly companyId: string;
  readonly actorUserId: string;
  readonly quoteRequestId: string;
  readonly sourceItemKey: 'legacy-primary';
  readonly kind: CommercialServiceRequirementKind;
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly evidence: string;
  readonly requestFingerprint: string;
}

export interface AttestCommercialServiceRequirementResult {
  readonly attestation: CommercialServiceRequirementAttestationRecord;
  readonly idempotent: boolean;
}

export interface ConfirmServiceCommand {
  readonly companyId: string;
  readonly actorUserId: string;
  readonly quoteRequestId: string;
  readonly sourceItemKey: 'legacy-primary';
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly confirmationBasis: string;
  readonly requestFingerprint: string;
}

export interface ConfirmServiceResult {
  readonly service: ConfirmedServiceRecord;
  readonly idempotent: boolean;
}

export interface CommercialServiceReadinessResult {
  readonly quote: {
    readonly id: string;
    readonly status: string;
    readonly version: number;
  };
  readonly attestations: readonly CommercialServiceRequirementAttestationRecord[];
  readonly confirmedService: ConfirmedServiceRecord | null;
}

export abstract class ConfirmedServiceRepository {
  abstract attestRequirement(
    input: AttestCommercialServiceRequirementCommand,
  ): Promise<AttestCommercialServiceRequirementResult>;

  abstract confirm(input: ConfirmServiceCommand): Promise<ConfirmServiceResult>;

  abstract readiness(input: {
    readonly companyId: string;
    readonly quoteRequestId: string;
  }): Promise<CommercialServiceReadinessResult>;
}
