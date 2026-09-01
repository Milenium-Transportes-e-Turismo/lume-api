import { conflict, validationError } from '../../core/errors/app-error';
import type { RegistrationType } from './registration';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RegistrationConsolidationCandidate {
  readonly id: string;
  readonly companyId: string;
  readonly type: RegistrationType;
  readonly version: number;
  readonly duplicateOfRegistrationId?: string | null;
}

export interface RegistrationConsolidationTransferCandidate {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly referenceField: string;
  readonly companyId: string;
  readonly fromRegistrationId: string;
  readonly toRegistrationId: string;
  readonly reversible: boolean;
  readonly collisionWithResourceId?: string | null;
}

export interface RegistrationConsolidationPreviewInput {
  readonly companyId: string;
  readonly principal: RegistrationConsolidationCandidate;
  readonly duplicate: RegistrationConsolidationCandidate;
  readonly transfers: readonly RegistrationConsolidationTransferCandidate[];
  readonly applicationAvailable: boolean;
}

export interface RegistrationConsolidationTransfer {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly referenceField: string;
  readonly companyId: string;
  readonly fromRegistrationId: string;
  readonly toRegistrationId: string;
}

export type RegistrationConsolidationBlocker =
  | {
      readonly code: 'application-not-available';
    }
  | {
      readonly code: 'target-collision';
      readonly resourceType: string;
      readonly resourceId: string;
      readonly referenceField: string;
      readonly collisionWithResourceId: string;
    }
  | {
      readonly code: 'duplicate-transfer';
      readonly resourceType: string;
      readonly resourceId: string;
      readonly referenceField: string;
    }
  | {
      readonly code: 'non-reversible-transfer';
      readonly resourceType: string;
      readonly resourceId: string;
      readonly referenceField: string;
    };

export interface RegistrationConsolidationPreview {
  readonly status: 'preview';
  readonly companyId: string;
  readonly type: RegistrationType;
  readonly principalRegistrationId: string;
  readonly duplicateRegistrationId: string;
  readonly expectedPrincipalVersion: number;
  readonly expectedDuplicateVersion: number;
  readonly transfers: readonly RegistrationConsolidationTransfer[];
  readonly blockers: readonly RegistrationConsolidationBlocker[];
  readonly canApply: boolean;
}

export interface RegistrationConsolidationEvidence {
  readonly commandId: string;
  readonly actorUserId: string;
  readonly reason: string;
  readonly confirmedAt: string | Date;
  readonly explicitlyConfirmed: boolean;
}

export interface RegistrationConsolidationConfirmation extends RegistrationConsolidationEvidence {
  readonly companyId: string;
  readonly type: RegistrationType;
  readonly principalRegistrationId: string;
  readonly duplicateRegistrationId: string;
}

export interface NormalizedRegistrationConsolidationEvidence {
  readonly commandId: string;
  readonly actorUserId: string;
  readonly reason: string;
  readonly confirmedAt: string;
  readonly explicitlyConfirmed: true;
}

export interface RegistrationConsolidationApplication {
  readonly status: 'ready-to-apply';
  readonly operation: 'registration-consolidation';
  readonly companyId: string;
  readonly type: RegistrationType;
  readonly principalRegistrationId: string;
  readonly duplicateRegistrationId: string;
  readonly expectedPrincipalVersion: number;
  readonly expectedDuplicateVersion: number;
  readonly evidence: NormalizedRegistrationConsolidationEvidence;
  readonly transfers: readonly RegistrationConsolidationTransfer[];
  readonly duplicateMarker: {
    readonly registrationId: string;
    readonly duplicateOfRegistrationId: string;
  };
  readonly reversalRecipe: {
    readonly requiresNewAuditedOperation: true;
    readonly transfers: readonly RegistrationConsolidationTransfer[];
    readonly duplicateMarker: {
      readonly registrationId: string;
      readonly duplicateOfRegistrationId: null;
    };
  };
}

export interface RegistrationConsolidationReversalInput {
  readonly companyId: string;
  readonly principalRegistrationId: string;
  readonly duplicateRegistrationId: string;
  readonly expectedPrincipalVersion: number;
  readonly expectedDuplicateVersion: number;
  readonly evidence: RegistrationConsolidationEvidence;
  /** Resultado obrigatório da nova checagem de colisões antes da reversão. */
  readonly collisionResourceKeys: readonly string[];
}

export interface RegistrationConsolidationReversal {
  readonly status: 'ready-to-reverse';
  readonly operation: 'registration-consolidation-reversal';
  readonly reversesCommandId: string;
  readonly companyId: string;
  readonly type: RegistrationType;
  readonly principalRegistrationId: string;
  readonly duplicateRegistrationId: string;
  readonly expectedPrincipalVersion: number;
  readonly expectedDuplicateVersion: number;
  readonly evidence: NormalizedRegistrationConsolidationEvidence;
  readonly transfers: readonly RegistrationConsolidationTransfer[];
  readonly duplicateMarker: {
    readonly registrationId: string;
    readonly duplicateOfRegistrationId: null;
  };
}

function uuid(value: string, label: string): string {
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw validationError(`${label} deve ser um UUID válido.`);
  }
  return normalized.toLowerCase();
}

function text(value: string, label: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) throw validationError(`Informe ${label}.`);
  if (normalized.length > maxLength) {
    throw validationError(
      `${label} deve possuir no máximo ${maxLength} caracteres.`,
    );
  }
  return normalized;
}

function version(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw validationError(`${label} deve ser um inteiro positivo.`);
  }
  return value;
}

function evidence(
  value: RegistrationConsolidationEvidence,
): NormalizedRegistrationConsolidationEvidence {
  const commandId = uuid(value.commandId, 'O commandId');
  const actorUserId = uuid(value.actorUserId, 'O responsável');
  const reason = text(value.reason, 'o motivo da consolidação', 1000);
  const confirmedAt = new Date(value.confirmedAt);
  if (Number.isNaN(confirmedAt.getTime())) {
    throw validationError('Informe uma data/hora válida para a confirmação.');
  }
  if (value.explicitlyConfirmed !== true) {
    throw validationError('A consolidação exige confirmação explícita.');
  }
  return {
    commandId,
    actorUserId,
    reason,
    confirmedAt: confirmedAt.toISOString(),
    explicitlyConfirmed: true,
  };
}

function validatedCandidate(
  value: RegistrationConsolidationCandidate,
  label: string,
  companyId: string,
): RegistrationConsolidationCandidate {
  const id = uuid(value.id, `O ID do Cadastro ${label}`);
  const candidateCompanyId = uuid(
    value.companyId,
    `O tenant do Cadastro ${label}`,
  );
  if (candidateCompanyId !== companyId) {
    throw validationError(
      'Os Cadastros principal e duplicado devem pertencer ao mesmo tenant da operação.',
    );
  }
  if (value.type !== 'pf' && value.type !== 'pj') {
    throw validationError('Selecione um tipo válido para cada Cadastro.');
  }
  const duplicateOfRegistrationId = value.duplicateOfRegistrationId
    ? uuid(
        value.duplicateOfRegistrationId,
        `O ID principal já associado ao Cadastro ${label}`,
      )
    : null;
  if (duplicateOfRegistrationId) {
    throw validationError(
      'Não é permitido consolidar um Cadastro que já está marcado como duplicado.',
    );
  }
  return {
    ...value,
    id,
    companyId: candidateCompanyId,
    version: version(value.version, `A versão do Cadastro ${label}`),
    duplicateOfRegistrationId,
  };
}

function transferKey(
  value: Pick<
    RegistrationConsolidationTransfer,
    'resourceType' | 'resourceId' | 'referenceField'
  >,
): string {
  return `${value.resourceType}\u0000${value.resourceId}\u0000${value.referenceField}`;
}

/**
 * Produz um preview puro. Colisões aparecem como bloqueios visíveis e nunca
 * são silenciosamente resolvidas ou descartadas.
 */
export function createRegistrationConsolidationPreview(
  input: RegistrationConsolidationPreviewInput,
): RegistrationConsolidationPreview {
  const companyId = uuid(input.companyId, 'O tenant da consolidação');
  const principal = validatedCandidate(input.principal, 'principal', companyId);
  const duplicate = validatedCandidate(input.duplicate, 'duplicado', companyId);
  if (principal.id === duplicate.id) {
    throw validationError(
      'O Cadastro principal e o duplicado devem possuir IDs diferentes.',
    );
  }
  if (principal.type !== duplicate.type) {
    throw validationError(
      'Somente Cadastros do mesmo tipo podem ser consolidados.',
    );
  }

  const blockers: RegistrationConsolidationBlocker[] = [];
  if (input.applicationAvailable !== true) {
    blockers.push({ code: 'application-not-available' });
  }
  const seenTransfers = new Set<string>();
  const transfers = input.transfers.map((candidate) => {
    const transferCompanyId = uuid(candidate.companyId, 'O tenant do vínculo');
    const fromRegistrationId = uuid(
      candidate.fromRegistrationId,
      'O Cadastro de origem do vínculo',
    );
    const toRegistrationId = uuid(
      candidate.toRegistrationId,
      'O Cadastro de destino do vínculo',
    );
    if (transferCompanyId !== companyId) {
      throw validationError(
        'Todos os vínculos devem pertencer ao tenant da consolidação.',
      );
    }
    if (
      fromRegistrationId !== duplicate.id ||
      toRegistrationId !== principal.id
    ) {
      throw validationError(
        'Cada vínculo deve sair do Cadastro duplicado e apontar para o principal.',
      );
    }

    const transfer: RegistrationConsolidationTransfer = {
      resourceType: text(candidate.resourceType, 'o tipo do vínculo', 100),
      resourceId: text(candidate.resourceId, 'o ID do recurso', 200),
      referenceField: text(
        candidate.referenceField,
        'o campo de referência',
        100,
      ),
      companyId: transferCompanyId,
      fromRegistrationId,
      toRegistrationId,
    };
    const key = transferKey(transfer);
    if (seenTransfers.has(key)) {
      blockers.push({
        code: 'duplicate-transfer',
        resourceType: transfer.resourceType,
        resourceId: transfer.resourceId,
        referenceField: transfer.referenceField,
      });
    }
    seenTransfers.add(key);

    if (candidate.reversible !== true) {
      blockers.push({
        code: 'non-reversible-transfer',
        resourceType: transfer.resourceType,
        resourceId: transfer.resourceId,
        referenceField: transfer.referenceField,
      });
    }
    if (candidate.collisionWithResourceId != null) {
      blockers.push({
        code: 'target-collision',
        resourceType: transfer.resourceType,
        resourceId: transfer.resourceId,
        referenceField: transfer.referenceField,
        collisionWithResourceId: text(
          candidate.collisionWithResourceId,
          'o ID do recurso em colisão',
          200,
        ),
      });
    }
    return transfer;
  });

  return {
    status: 'preview',
    companyId,
    type: principal.type,
    principalRegistrationId: principal.id,
    duplicateRegistrationId: duplicate.id,
    expectedPrincipalVersion: principal.version,
    expectedDuplicateVersion: duplicate.version,
    transfers,
    blockers,
    canApply: blockers.length === 0,
  };
}

function inverseTransfers(
  transfers: readonly RegistrationConsolidationTransfer[],
): RegistrationConsolidationTransfer[] {
  return transfers.map((transfer) => ({
    ...transfer,
    fromRegistrationId: transfer.toRegistrationId,
    toRegistrationId: transfer.fromRegistrationId,
  }));
}

/** Prepara a operação; não persiste nem afirma que ela foi executada. */
export function prepareRegistrationConsolidationApplication(
  preview: RegistrationConsolidationPreview,
  confirmation: RegistrationConsolidationConfirmation,
): RegistrationConsolidationApplication {
  if (!preview.canApply || preview.blockers.length > 0) {
    throw conflict(
      'A consolidação possui colisões ou vínculos sem reversão e não pode ser aplicada.',
    );
  }
  const confirmedCompanyId = uuid(
    confirmation.companyId,
    'O tenant confirmado',
  );
  const confirmedPrincipalId = uuid(
    confirmation.principalRegistrationId,
    'O Cadastro principal confirmado',
  );
  const confirmedDuplicateId = uuid(
    confirmation.duplicateRegistrationId,
    'O Cadastro duplicado confirmado',
  );
  if (
    confirmedCompanyId !== preview.companyId ||
    confirmation.type !== preview.type ||
    confirmedPrincipalId !== preview.principalRegistrationId ||
    confirmedDuplicateId !== preview.duplicateRegistrationId
  ) {
    throw validationError(
      'A confirmação deve repetir o tenant, o tipo e os IDs exibidos no preview.',
    );
  }
  const normalizedEvidence = evidence(confirmation);
  const reversalTransfers = inverseTransfers(preview.transfers);
  return {
    status: 'ready-to-apply',
    operation: 'registration-consolidation',
    companyId: preview.companyId,
    type: preview.type,
    principalRegistrationId: preview.principalRegistrationId,
    duplicateRegistrationId: preview.duplicateRegistrationId,
    expectedPrincipalVersion: preview.expectedPrincipalVersion,
    expectedDuplicateVersion: preview.expectedDuplicateVersion,
    evidence: normalizedEvidence,
    transfers: preview.transfers,
    duplicateMarker: {
      registrationId: preview.duplicateRegistrationId,
      duplicateOfRegistrationId: preview.principalRegistrationId,
    },
    reversalRecipe: {
      requiresNewAuditedOperation: true,
      transfers: reversalTransfers,
      duplicateMarker: {
        registrationId: preview.duplicateRegistrationId,
        duplicateOfRegistrationId: null,
      },
    },
  };
}

/**
 * Prepara a reversão como nova operação auditada. A camada chamadora deve
 * recalcular versões e colisões no momento da reversão.
 */
export function prepareRegistrationConsolidationReversal(
  application: RegistrationConsolidationApplication,
  input: RegistrationConsolidationReversalInput,
): RegistrationConsolidationReversal {
  const companyId = uuid(input.companyId, 'O tenant da reversão');
  const principalRegistrationId = uuid(
    input.principalRegistrationId,
    'O Cadastro principal da reversão',
  );
  const duplicateRegistrationId = uuid(
    input.duplicateRegistrationId,
    'O Cadastro duplicado da reversão',
  );
  if (
    companyId !== application.companyId ||
    principalRegistrationId !== application.principalRegistrationId ||
    duplicateRegistrationId !== application.duplicateRegistrationId
  ) {
    throw validationError(
      'A reversão deve usar o mesmo tenant e os mesmos Cadastros da consolidação original.',
    );
  }
  if (input.collisionResourceKeys.length > 0) {
    throw conflict(
      'A reversão possui colisões de vínculos e não pode ser aplicada.',
    );
  }
  const normalizedEvidence = evidence(input.evidence);
  if (normalizedEvidence.commandId === application.evidence.commandId) {
    throw validationError(
      'A reversão exige um novo commandId para registrar outra operação auditada.',
    );
  }

  return {
    status: 'ready-to-reverse',
    operation: 'registration-consolidation-reversal',
    reversesCommandId: application.evidence.commandId,
    companyId,
    type: application.type,
    principalRegistrationId,
    duplicateRegistrationId,
    expectedPrincipalVersion: version(
      input.expectedPrincipalVersion,
      'A versão atual do Cadastro principal',
    ),
    expectedDuplicateVersion: version(
      input.expectedDuplicateVersion,
      'A versão atual do Cadastro duplicado',
    ),
    evidence: normalizedEvidence,
    transfers: application.reversalRecipe.transfers,
    duplicateMarker: application.reversalRecipe.duplicateMarker,
  };
}
