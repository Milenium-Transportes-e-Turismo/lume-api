import {
  createPublicContinuationCode,
  evolveServiceSession,
  publicContinuationCodeExpiresAt,
  type ServicePriority,
  type ServiceSessionCommand,
} from '../../../domain/whatsapp/service-session';
import {
  conflict,
  notFound,
  validationError,
} from '../../../core/errors/app-error';
import {
  ServiceSessionManagementRepository,
  type ListManagedServiceSessionsInput,
  type MutateManagedServiceSessionInput,
  type ServiceSessionDepartmentScope,
} from '../../contracts/service-session-management.repository';

export interface ServiceActorContext {
  readonly companyId: string;
  readonly actorUserId: string;
  readonly accessibleDepartments: ServiceSessionDepartmentScope;
}

interface VersionedServiceCommand extends ServiceActorContext {
  readonly sessionId: string;
  readonly commandId: string;
  readonly expectedVersion: number;
}

export class QueryServiceSessionsUseCase {
  constructor(private readonly sessions: ServiceSessionManagementRepository) {}

  list(
    actor: ServiceActorContext,
    query: Omit<ListManagedServiceSessionsInput, keyof ServiceActorContext>,
  ) {
    return this.sessions.list({
      ...query,
      companyId: actor.companyId,
      accessibleDepartments: actor.accessibleDepartments,
    });
  }

  async get(actor: ServiceActorContext, sessionId: string) {
    const session = await this.sessions.getAccessible({
      companyId: actor.companyId,
      sessionId,
      accessibleDepartments: actor.accessibleDepartments,
    });
    if (!session) throw notFound('Atendimento');
    return session;
  }

  assignmentTargets(actor: ServiceActorContext) {
    return this.sessions.listAssignmentTargets({ companyId: actor.companyId });
  }
}

export class ManageServiceSessionUseCase {
  constructor(private readonly sessions: ServiceSessionManagementRepository) {}

  assume(input: VersionedServiceCommand) {
    return this.execute(input, { type: 'assume', userId: input.actorUserId });
  }

  returnToQueue(input: VersionedServiceCommand & { readonly queueId: string }) {
    return this.execute(input, {
      type: 'return-to-queue',
      queueId: input.queueId,
    });
  }

  returnToAi(input: VersionedServiceCommand) {
    return this.execute(input, { type: 'return-to-ai' });
  }

  transfer(
    input: VersionedServiceCommand & {
      readonly departmentId: string;
      readonly queueId?: string;
      readonly userId?: string;
      readonly reason?: string;
    },
  ) {
    return this.execute(
      input,
      {
        type: 'transfer',
        departmentId: input.departmentId,
        ...(input.queueId ? { queueId: input.queueId } : {}),
        ...(input.userId ? { userId: input.userId } : {}),
      },
      input.reason,
    );
  }

  changePriority(
    input: VersionedServiceCommand & {
      readonly priority: ServicePriority;
      readonly reason: string;
    },
  ) {
    return this.execute(input, {
      type: 'change-priority',
      priority: input.priority,
      reason: input.reason,
      source: 'human-user',
    });
  }

  close(input: VersionedServiceCommand & { readonly reason: string }) {
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      throw validationError(
        'Informe um motivo de encerramento entre 3 e 500 caracteres.',
      );
    }
    return this.execute(input, { type: 'close-human', at: new Date() }, reason);
  }

  private async execute(
    input: VersionedServiceCommand,
    command: ServiceSessionCommand,
    assignmentReason?: string,
  ) {
    const before = await this.sessions.getAccessible({
      companyId: input.companyId,
      sessionId: input.sessionId,
      accessibleDepartments: input.accessibleDepartments,
    });
    if (!before) throw notFound('Atendimento');
    if (before.version !== input.expectedVersion) {
      throw conflict(
        'O atendimento foi atualizado. Recarregue os dados antes de tentar novamente.',
      );
    }
    const after = evolveServiceSession(before, command);
    const closure = after.status === 'closed';
    const closedAt = after.closedAt;
    const mutation: MutateManagedServiceSessionInput = {
      companyId: input.companyId,
      sessionId: input.sessionId,
      actorUserId: input.actorUserId,
      commandId: input.commandId,
      expectedVersion: input.expectedVersion,
      accessibleDepartments: input.accessibleDepartments,
      eventName: command.type as MutateManagedServiceSessionInput['eventName'],
      before,
      after,
      assignmentReason: assignmentReason?.trim() || null,
      metadata: { source: 'lume-web' },
      ...(closure && closedAt
        ? (() => {
            const publicContinuationCode = createPublicContinuationCode();
            return {
              publicContinuationCode,
              continuationCodeExpiresAt:
                publicContinuationCodeExpiresAt(closedAt),
            };
          })()
        : {}),
    };
    return (await this.sessions.mutate(mutation)).session;
  }
}
