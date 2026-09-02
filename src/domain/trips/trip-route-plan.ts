import { conflict, validationError } from '../../core/errors/app-error';
import type { TripStatus } from './trip';

export interface TripRoutePlanSelection {
  id: string;
  companyId: string;
  tripId: string;
  sourceRouteId: string;
  sourceRouteVersion: number;
  sourcePlanVersion: number;
  routeAggregateVersionAtSelection: number;
  sourceSnapshot: Readonly<Record<string, unknown>>;
  commandId: string;
  selectedByUserId: string;
  reason: string | null;
  selectedAt: Date;
  supersededAt: Date | null;
  usedForExecutionAt: Date | null;
}

interface PrepareTripRoutePlanSelectionInput {
  id: string;
  companyId: string;
  tripId: string;
  tripStatus: TripStatus;
  tripContractId: string;
  tripStartedAt: Date | null;
  route: {
    id: string;
    contractId: string;
    aggregateVersion: number;
    approvedVersion: number | null;
  };
  approvedVersion: {
    version: number;
    planVersion: number;
    snapshot: Readonly<Record<string, unknown>>;
  };
  expectedRouteVersion: number;
  currentSelection: TripRoutePlanSelection | null;
  actorUserId: string;
  commandId: string;
  reason?: string;
  selectedAt: Date;
}

function requiredText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) throw validationError(`Informe ${label}.`);
  if (normalized.length > maxLength) {
    throw validationError(
      `${label} deve possuir no máximo ${maxLength} caracteres.`,
    );
  }
  return normalized;
}

function positiveVersion(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw validationError(`Informe ${label} válida.`);
  }
  return value;
}

function validDate(value: Date, label: string): Date {
  if (Number.isNaN(value.getTime())) {
    throw validationError(`Informe ${label} válida.`);
  }
  return new Date(value);
}

function cloneSnapshot(
  snapshot: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return JSON.parse(JSON.stringify(snapshot)) as Readonly<
    Record<string, unknown>
  >;
}

function operationalSnapshot(
  snapshot: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return cloneSnapshot({
    ...(Object.hasOwn(snapshot, 'route') ? { route: snapshot.route } : {}),
    ...(Object.hasOwn(snapshot, 'points') ? { points: snapshot.points } : {}),
    ...(Object.hasOwn(snapshot, 'navigationLinks')
      ? { navigationLinks: snapshot.navigationLinks }
      : {}),
  });
}

export function prepareTripRoutePlanSelection(
  input: PrepareTripRoutePlanSelectionInput,
): TripRoutePlanSelection {
  if (
    input.tripStartedAt !== null ||
    !['draft', 'scheduled'].includes(input.tripStatus)
  ) {
    throw validationError(
      'O Plano de Rota não pode ser trocado depois do início da Viagem.',
    );
  }
  if (input.route.contractId !== input.tripContractId) {
    throw validationError(
      'O Plano de Rota deve pertencer ao mesmo contrato da Viagem.',
    );
  }
  const expectedRouteVersion = positiveVersion(
    input.expectedRouteVersion,
    'a versão esperada da Rota',
  );
  if (input.route.aggregateVersion !== expectedRouteVersion) {
    throw conflict('A Rota alterada deve ser recarregada antes da seleção.');
  }
  if (input.route.approvedVersion === null) {
    throw validationError('A Rota ainda não possui uma versão aprovada.');
  }
  if (input.approvedVersion.version !== input.route.approvedVersion) {
    throw validationError(
      'O snapshot aprovado não corresponde à versão aprovada da Rota.',
    );
  }
  const reason = input.reason?.trim().replace(/\s+/g, ' ') || null;
  if (input.currentSelection && !reason) {
    throw validationError(
      'Informe o motivo da substituição do Plano de Rota vigente.',
    );
  }
  if (reason && reason.length > 1000) {
    throw validationError('O motivo deve possuir no máximo 1000 caracteres.');
  }

  return {
    id: requiredText(input.id, 'o identificador da seleção', 100),
    companyId: requiredText(input.companyId, 'a empresa da seleção', 100),
    tripId: requiredText(input.tripId, 'a Viagem da seleção', 100),
    sourceRouteId: requiredText(input.route.id, 'a Rota de origem', 100),
    sourceRouteVersion: positiveVersion(
      input.approvedVersion.version,
      'a versão aprovada da Rota',
    ),
    sourcePlanVersion: positiveVersion(
      input.approvedVersion.planVersion,
      'a versão do Plano de Rota',
    ),
    routeAggregateVersionAtSelection: positiveVersion(
      input.route.aggregateVersion,
      'a versão agregada da Rota',
    ),
    sourceSnapshot: operationalSnapshot(input.approvedVersion.snapshot),
    commandId: requiredText(input.commandId, 'o identificador do comando', 100),
    selectedByUserId: requiredText(
      input.actorUserId,
      'o responsável pela seleção',
      100,
    ),
    reason,
    selectedAt: validDate(input.selectedAt, 'a data da seleção'),
    supersededAt: null,
    usedForExecutionAt: null,
  };
}

export function freezeTripRoutePlanSelection(
  selection: TripRoutePlanSelection,
  startedAt: Date,
): TripRoutePlanSelection {
  if (selection.supersededAt !== null) {
    throw validationError(
      'Somente a seleção vigente pode orientar o início da Viagem.',
    );
  }
  const usedForExecutionAt = validDate(startedAt, 'a data de início');
  if (usedForExecutionAt < selection.selectedAt) {
    throw validationError(
      'A Viagem não pode iniciar antes da seleção do Plano de Rota.',
    );
  }
  return { ...selection, usedForExecutionAt };
}
