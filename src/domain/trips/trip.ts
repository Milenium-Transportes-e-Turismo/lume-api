import { conflict, validationError } from '../../core/errors/app-error';

export const TRIP_STATUSES = [
  'draft',
  'scheduled',
  'in-execution',
  'suspended',
  'interrupted',
  'early-terminated',
  'completed',
  'cancelled',
] as const;

export type TripStatus = (typeof TRIP_STATUSES)[number];

export const TRIP_TRANSITION_MATRIX = {
  draft: ['scheduled'],
  scheduled: ['in-execution', 'cancelled'],
  'in-execution': ['suspended', 'interrupted', 'completed'],
  suspended: ['in-execution'],
  interrupted: ['early-terminated'],
  'early-terminated': [],
  completed: [],
  cancelled: [],
} as const satisfies Readonly<Record<TripStatus, readonly TripStatus[]>>;

export type TripSource =
  | {
      kind: 'confirmed-service';
      confirmedServiceId: string;
      sourceVersion: number;
    }
  | {
      kind: 'continuous-contract';
      contractId: string;
      sourceVersion: number;
    };

export interface TripLeg {
  id: string;
  sequence: number;
  label: string;
}

export interface TripPlan {
  serviceDate: string | null;
  legs: readonly TripLeg[];
}

export interface Trip {
  id: string;
  companyId: string;
  code: string;
  source: TripSource;
  status: TripStatus;
  plan: TripPlan;
  version: number;
  planVersion: number;
  scheduledAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export const TRIP_EVIDENCE_KINDS = [
  'manual-note',
  'document-reference',
  'external-reference',
] as const;

export type TripEvidenceKind = (typeof TRIP_EVIDENCE_KINDS)[number];

export interface TripEvidence {
  kind: TripEvidenceKind;
  description: string;
  referenceId?: string | null;
}

export type TripOccurrenceCategory =
  'operational' | 'suspension' | 'resumption' | 'interruption';

interface TripOperationalRecordBase {
  tripId: string;
  companyId: string;
  commandId: string;
  actorUserId: string;
  reason: string;
  evidence: readonly TripEvidence[];
  occurredAt: Date;
  resultingVersion: number;
}

export interface TripOccurrence extends TripOperationalRecordBase {
  kind: 'occurrence';
  category: TripOccurrenceCategory;
}

export interface TripDeviation extends TripOperationalRecordBase {
  kind: 'deviation';
}

export type TripOperationalRecord = TripOccurrence | TripDeviation;

export const TRIP_COMMAND_TYPES = [
  'edit-draft',
  'schedule',
  'revise-schedule',
  'start',
  'suspend',
  'resume',
  'interrupt',
  'close-early',
  'complete',
  'cancel',
  'record-occurrence',
  'record-deviation',
] as const;

export type TripCommandType = (typeof TRIP_COMMAND_TYPES)[number];

interface TripCommandContext {
  commandId: string;
  actorUserId: string;
  expectedVersion: number;
  occurredAt: Date;
}

export type TripCommand =
  | (TripCommandContext & { type: 'edit-draft'; plan: TripPlan })
  | (TripCommandContext & { type: 'schedule' })
  | (TripCommandContext & {
      type: 'revise-schedule';
      plan: TripPlan;
      reason: string;
    })
  | (TripCommandContext & { type: 'start' })
  | (TripCommandContext & {
      type: 'suspend';
      reason: string;
      evidence?: readonly TripEvidence[];
    })
  | (TripCommandContext & {
      type: 'resume';
      reason: string;
      evidence?: readonly TripEvidence[];
    })
  | (TripCommandContext & {
      type: 'interrupt';
      reason: string;
      evidence: readonly TripEvidence[];
    })
  | (TripCommandContext & { type: 'close-early'; reason: string })
  | (TripCommandContext & { type: 'complete' })
  | (TripCommandContext & { type: 'cancel'; reason: string })
  | (TripCommandContext & {
      type: 'record-occurrence';
      reason: string;
      evidence: readonly TripEvidence[];
    })
  | (TripCommandContext & {
      type: 'record-deviation';
      reason: string;
      evidence: readonly TripEvidence[];
    });

export type TripHistoryAction = 'draft-created' | TripCommandType;

export interface TripHistoryEntry {
  tripId: string;
  companyId: string;
  commandId: string;
  actorUserId: string;
  action: TripHistoryAction;
  fromStatus: TripStatus | null;
  toStatus: TripStatus;
  reason: string | null;
  expectedVersion: number | null;
  resultingVersion: number;
  occurredAt: Date;
}

export interface TripPlanVersion {
  tripId: string;
  companyId: string;
  commandId: string;
  createdByUserId: string;
  version: number;
  aggregateVersion: number;
  plan: TripPlan;
  reason: string | null;
  createdAt: Date;
}

export interface TripCommandResult {
  trip: Trip;
  history: TripHistoryEntry;
  planVersion: TripPlanVersion | null;
  operationalRecord: TripOperationalRecord | null;
}

export interface CreateTripDraftInput {
  id: string;
  companyId: string;
  code: string;
  source: TripSource;
  plan: TripPlan;
  actorUserId: string;
  commandId: string;
  createdAt: Date;
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

function validDate(value: Date, label: string): Date {
  if (Number.isNaN(value.getTime())) {
    throw validationError(`Informe ${label} válida.`);
  }
  return new Date(value);
}

function normalizeDateOnly(value: string | null): string | null {
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw validationError(
      'Informe a data civil da viagem no formato AAAA-MM-DD.',
    );
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw validationError('Informe uma data civil válida para a viagem.');
  }
  return value;
}

function normalizeSource(source: TripSource): TripSource {
  if (!Number.isInteger(source.sourceVersion) || source.sourceVersion < 1) {
    throw validationError('A origem da viagem deve possuir uma versão válida.');
  }
  if (source.kind === 'confirmed-service') {
    return {
      kind: source.kind,
      confirmedServiceId: requiredText(
        source.confirmedServiceId,
        'o serviço confirmado de origem',
        100,
      ),
      sourceVersion: source.sourceVersion,
    };
  }
  return {
    kind: source.kind,
    contractId: requiredText(
      source.contractId,
      'o contrato contínuo de origem',
      100,
    ),
    sourceVersion: source.sourceVersion,
  };
}

function normalizePlan(plan: TripPlan): TripPlan {
  const ids = new Set<string>();
  const sequences = new Set<number>();
  const legs = plan.legs.map((leg) => {
    const id = requiredText(leg.id, 'o identificador do trecho', 100);
    if (ids.has(id)) {
      throw validationError('A viagem não pode possuir trechos duplicados.');
    }
    ids.add(id);
    if (!Number.isInteger(leg.sequence) || leg.sequence < 1) {
      throw validationError(
        'A sequência do trecho deve ser um inteiro positivo.',
      );
    }
    if (sequences.has(leg.sequence)) {
      throw validationError(
        'A viagem não pode possuir dois trechos na mesma sequência.',
      );
    }
    sequences.add(leg.sequence);
    return {
      id,
      sequence: leg.sequence,
      label: requiredText(leg.label, 'o nome do trecho', 160),
    };
  });
  return {
    serviceDate: normalizeDateOnly(plan.serviceDate),
    legs: legs.sort((left, right) => left.sequence - right.sequence),
  };
}

function assertSchedulable(plan: TripPlan): void {
  if (plan.serviceDate === null) {
    throw validationError('Informe a data civil antes de programar a viagem.');
  }
  if (plan.legs.length === 0) {
    throw validationError(
      'Informe ao menos um trecho antes de programar a viagem.',
    );
  }
}

function normalizeReason(reason: string): string {
  return requiredText(reason, 'o motivo da ação', 1000);
}

function normalizeEvidence(
  evidence: readonly TripEvidence[] | undefined,
  required: boolean,
): readonly TripEvidence[] {
  const normalized = (evidence ?? []).map((item) => {
    const referenceId = item.referenceId?.trim() || null;
    if (item.kind !== 'manual-note' && !referenceId) {
      throw validationError(
        'Uma evidência documental ou externa exige sua referência.',
      );
    }
    return {
      kind: item.kind,
      description: requiredText(
        item.description,
        'a descrição da evidência',
        1000,
      ),
      referenceId,
    };
  });
  if (required && normalized.length === 0) {
    throw validationError('Informe ao menos uma evidência para esta ação.');
  }
  return normalized;
}

function clonePlan(plan: TripPlan): TripPlan {
  return {
    serviceDate: plan.serviceDate,
    legs: plan.legs.map((leg) => ({ ...leg })),
  };
}

export function createTripDraft(
  input: CreateTripDraftInput,
): TripCommandResult {
  const createdAt = validDate(input.createdAt, 'a data de criação');
  const trip: Trip = {
    id: requiredText(input.id, 'o identificador da viagem', 100),
    companyId: requiredText(input.companyId, 'a empresa da viagem', 100),
    code: requiredText(input.code, 'o código da viagem', 80).toUpperCase(),
    source: normalizeSource(input.source),
    status: 'draft',
    plan: normalizePlan(input.plan),
    version: 1,
    planVersion: 0,
    scheduledAt: null,
    startedAt: null,
    endedAt: null,
    createdByUserId: requiredText(
      input.actorUserId,
      'o responsável pela criação',
      100,
    ),
    createdAt,
    updatedAt: createdAt,
  };
  return {
    trip,
    history: {
      tripId: trip.id,
      companyId: trip.companyId,
      commandId: requiredText(input.commandId, 'o comando de criação', 100),
      actorUserId: trip.createdByUserId,
      action: 'draft-created',
      fromStatus: null,
      toStatus: 'draft',
      reason: null,
      expectedVersion: null,
      resultingVersion: 1,
      occurredAt: createdAt,
    },
    planVersion: null,
    operationalRecord: null,
  };
}

function assertCommandContext(trip: Trip, command: TripCommand): Date {
  requiredText(command.commandId, 'o identificador do comando', 100);
  requiredText(command.actorUserId, 'o responsável pela ação', 100);
  if (
    !Number.isInteger(command.expectedVersion) ||
    command.expectedVersion < 1
  ) {
    throw validationError('Informe uma versão esperada válida para a viagem.');
  }
  if (command.expectedVersion !== trip.version) {
    throw conflict(
      'A viagem foi alterada por outro comando. Recarregue e tente novamente.',
    );
  }
  const occurredAt = validDate(command.occurredAt, 'a data da ação');
  if (occurredAt < trip.updatedAt) {
    throw validationError(
      'A data da ação não pode ser anterior à última alteração da viagem.',
    );
  }
  return occurredAt;
}

function assertTransition(from: TripStatus, to: TripStatus): void {
  const allowed: readonly TripStatus[] = TRIP_TRANSITION_MATRIX[from];
  if (!allowed.includes(to)) {
    throw validationError(`A viagem não pode passar de ${from} para ${to}.`);
  }
}

function assertDraftEditAllowed(trip: Trip): void {
  if (trip.startedAt !== null) {
    throw validationError(
      'Depois do início, mudanças devem ser registradas como ocorrências ou desvios de execução.',
    );
  }
  if (trip.status !== 'draft') {
    throw validationError(
      'Uma viagem programada deve ser alterada por uma revisão da programação.',
    );
  }
}

function assertOperationalRecordingAllowed(trip: Trip): void {
  if (!['in-execution', 'suspended', 'interrupted'].includes(trip.status)) {
    throw validationError(
      'Ocorrências e desvios só podem ser registrados depois do início e antes do encerramento.',
    );
  }
}

function occurrence(
  trip: Trip,
  command: TripCommandContext,
  category: TripOccurrenceCategory,
  reason: string,
  evidence: readonly TripEvidence[],
  resultingVersion: number,
): TripOccurrence {
  return {
    kind: 'occurrence',
    category,
    tripId: trip.id,
    companyId: trip.companyId,
    commandId: command.commandId,
    actorUserId: command.actorUserId,
    reason,
    evidence,
    occurredAt: new Date(command.occurredAt),
    resultingVersion,
  };
}

export function applyTripCommand(
  current: Trip,
  command: TripCommand,
): TripCommandResult {
  const occurredAt = assertCommandContext(current, command);
  let status = current.status;
  let plan = current.plan;
  let planVersion = current.planVersion;
  let scheduledAt = current.scheduledAt;
  let startedAt = current.startedAt;
  let endedAt = current.endedAt;
  let reason: string | null = null;
  let versionSnapshot: TripPlanVersion | null = null;
  let operationalRecord: TripOperationalRecord | null = null;
  const resultingVersion = current.version + 1;

  switch (command.type) {
    case 'edit-draft':
      assertDraftEditAllowed(current);
      plan = normalizePlan(command.plan);
      break;

    case 'schedule':
      assertTransition(current.status, 'scheduled');
      assertSchedulable(current.plan);
      status = 'scheduled';
      scheduledAt = occurredAt;
      planVersion += 1;
      break;

    case 'revise-schedule':
      if (current.status !== 'scheduled') {
        if (current.startedAt !== null) {
          throw validationError(
            'Depois do início, mudanças devem ser registradas como ocorrências ou desvios de execução.',
          );
        }
        throw validationError(
          'Somente uma viagem programada pode ser revisada.',
        );
      }
      reason = normalizeReason(command.reason);
      plan = normalizePlan(command.plan);
      assertSchedulable(plan);
      planVersion += 1;
      break;

    case 'start':
      assertTransition(current.status, 'in-execution');
      status = 'in-execution';
      startedAt = occurredAt;
      break;

    case 'suspend': {
      assertTransition(current.status, 'suspended');
      reason = normalizeReason(command.reason);
      status = 'suspended';
      operationalRecord = occurrence(
        current,
        command,
        'suspension',
        reason,
        normalizeEvidence(command.evidence, false),
        resultingVersion,
      );
      break;
    }

    case 'resume': {
      assertTransition(current.status, 'in-execution');
      reason = normalizeReason(command.reason);
      status = 'in-execution';
      operationalRecord = occurrence(
        current,
        command,
        'resumption',
        reason,
        normalizeEvidence(command.evidence, false),
        resultingVersion,
      );
      break;
    }

    case 'interrupt': {
      assertTransition(current.status, 'interrupted');
      reason = normalizeReason(command.reason);
      status = 'interrupted';
      operationalRecord = occurrence(
        current,
        command,
        'interruption',
        reason,
        normalizeEvidence(command.evidence, true),
        resultingVersion,
      );
      break;
    }

    case 'close-early':
      assertTransition(current.status, 'early-terminated');
      reason = normalizeReason(command.reason);
      status = 'early-terminated';
      endedAt = occurredAt;
      break;

    case 'complete':
      assertTransition(current.status, 'completed');
      status = 'completed';
      endedAt = occurredAt;
      break;

    case 'cancel':
      assertTransition(current.status, 'cancelled');
      reason = normalizeReason(command.reason);
      status = 'cancelled';
      endedAt = occurredAt;
      break;

    case 'record-occurrence': {
      assertOperationalRecordingAllowed(current);
      reason = normalizeReason(command.reason);
      operationalRecord = occurrence(
        current,
        command,
        'operational',
        reason,
        normalizeEvidence(command.evidence, true),
        resultingVersion,
      );
      break;
    }

    case 'record-deviation': {
      assertOperationalRecordingAllowed(current);
      reason = normalizeReason(command.reason);
      operationalRecord = {
        kind: 'deviation',
        tripId: current.id,
        companyId: current.companyId,
        commandId: command.commandId,
        actorUserId: command.actorUserId,
        reason,
        evidence: normalizeEvidence(command.evidence, true),
        occurredAt,
        resultingVersion,
      };
      break;
    }
  }

  const trip: Trip = {
    ...current,
    status,
    plan: clonePlan(plan),
    version: resultingVersion,
    planVersion,
    scheduledAt,
    startedAt,
    endedAt,
    updatedAt: occurredAt,
  };

  if (command.type === 'schedule' || command.type === 'revise-schedule') {
    versionSnapshot = {
      tripId: trip.id,
      companyId: trip.companyId,
      commandId: command.commandId,
      createdByUserId: command.actorUserId,
      version: trip.planVersion,
      aggregateVersion: trip.version,
      plan: clonePlan(trip.plan),
      reason,
      createdAt: occurredAt,
    };
  }

  return {
    trip,
    history: {
      tripId: trip.id,
      companyId: trip.companyId,
      commandId: command.commandId,
      actorUserId: command.actorUserId,
      action: command.type,
      fromStatus: current.status,
      toStatus: trip.status,
      reason,
      expectedVersion: command.expectedVersion,
      resultingVersion,
      occurredAt,
    },
    planVersion: versionSnapshot,
    operationalRecord,
  };
}
