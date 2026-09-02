import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { ConfirmedServiceRepository } from '../../contracts/confirmed-service.repository';
import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';
import {
  assertCanMarkCommercialServiceRequirementNotApplicable,
  assertCanAttestCommercialServiceRequirement,
  assertCanConfirmCommercialService,
  assertCanViewCommercialServiceReadiness,
  assertExpectedAcceptedQuoteVersion,
  LEGACY_PRIMARY_SERVICE_ITEM_KEY,
  normalizeCommercialServiceRequirementEvidence,
  normalizeCommercialServiceRequirementKind,
  normalizeCommercialServiceRequirementReason,
  normalizeConfirmationBasis,
} from '../../../domain/commercial/confirmed-service';

export interface AttestCommercialServiceRequirementInput {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly evidence: string;
}

export interface ConfirmServiceInput {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly confirmationBasis: string;
}

export interface MarkCommercialServiceRequirementNotApplicableInput {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly reason: string;
  readonly evidence: string;
}

function fingerprint(value: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

@Injectable()
export class ConfirmedServicesService {
  constructor(private readonly repository: ConfirmedServiceRepository) {}

  attestRequirement(
    principal: AuthenticatedPrincipal,
    quoteRequestId: string,
    requirement: string,
    input: AttestCommercialServiceRequirementInput,
  ) {
    const kind = normalizeCommercialServiceRequirementKind(requirement);
    assertCanAttestCommercialServiceRequirement(principal, kind);
    assertExpectedAcceptedQuoteVersion(input.expectedVersion);
    const evidence = normalizeCommercialServiceRequirementEvidence(
      input.evidence,
    );
    const sourceItemKey = LEGACY_PRIMARY_SERVICE_ITEM_KEY;
    const requestFingerprint = fingerprint({
      action: 'attest-commercial-service-requirement',
      quoteRequestId,
      sourceItemKey,
      kind,
      expectedVersion: input.expectedVersion,
      evidence,
    });
    return this.repository.attestRequirement({
      companyId: principal.companyId,
      actorUserId: principal.id,
      quoteRequestId,
      sourceItemKey,
      kind,
      commandId: input.commandId,
      expectedVersion: input.expectedVersion,
      evidence,
      requestFingerprint,
    });
  }

  markRequirementNotApplicable(
    principal: AuthenticatedPrincipal,
    quoteRequestId: string,
    requirement: string,
    input: MarkCommercialServiceRequirementNotApplicableInput,
  ) {
    const kind = normalizeCommercialServiceRequirementKind(requirement);
    assertCanMarkCommercialServiceRequirementNotApplicable(principal);
    assertExpectedAcceptedQuoteVersion(input.expectedVersion);
    const reason = normalizeCommercialServiceRequirementReason(input.reason);
    const evidence = normalizeCommercialServiceRequirementEvidence(
      input.evidence,
    );
    const sourceItemKey = LEGACY_PRIMARY_SERVICE_ITEM_KEY;
    const requestFingerprint = fingerprint({
      action: 'mark-commercial-service-requirement-not-applicable',
      quoteRequestId,
      sourceItemKey,
      kind,
      expectedVersion: input.expectedVersion,
      reason,
      evidence,
    });
    return this.repository.markRequirementNotApplicable({
      companyId: principal.companyId,
      actorUserId: principal.id,
      quoteRequestId,
      sourceItemKey,
      kind,
      commandId: input.commandId,
      expectedVersion: input.expectedVersion,
      reason,
      evidence,
      requestFingerprint,
    });
  }

  confirm(
    principal: AuthenticatedPrincipal,
    quoteRequestId: string,
    input: ConfirmServiceInput,
  ) {
    assertCanConfirmCommercialService(principal);
    assertExpectedAcceptedQuoteVersion(input.expectedVersion);
    const confirmationBasis = normalizeConfirmationBasis(
      input.confirmationBasis,
    );
    const sourceItemKey = LEGACY_PRIMARY_SERVICE_ITEM_KEY;
    const requestFingerprint = fingerprint({
      action: 'confirm-service',
      quoteRequestId,
      sourceItemKey,
      expectedVersion: input.expectedVersion,
      confirmationBasis,
    });

    return this.repository.confirm({
      companyId: principal.companyId,
      actorUserId: principal.id,
      quoteRequestId,
      sourceItemKey,
      commandId: input.commandId,
      expectedVersion: input.expectedVersion,
      confirmationBasis,
      requestFingerprint,
    });
  }

  readiness(principal: AuthenticatedPrincipal, quoteRequestId: string) {
    assertCanViewCommercialServiceReadiness(principal);
    return this.repository.readiness({
      companyId: principal.companyId,
      quoteRequestId,
    });
  }
}
