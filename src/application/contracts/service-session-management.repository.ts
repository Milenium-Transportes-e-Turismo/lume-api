import type {
  PresentedUserDepartment,
  UserDepartment,
} from '../../domain/access/access.constants';
import type {
  ServiceControlMode,
  ServicePriority,
  ServiceSessionSnapshot,
  ServiceSessionStatus,
} from '../../domain/whatsapp/service-session';

export type ServiceSessionDepartmentScope =
  readonly PresentedUserDepartment[] | null;

export interface ManagedServiceSession extends ServiceSessionSnapshot {
  readonly id: string;
  readonly companyId: string;
  readonly threadId: string;
  readonly sourceChannelId: string;
  readonly sourceChannelName: string;
  readonly contactPhone: string;
  readonly contactName: string | null;
  readonly currentDepartmentCode: UserDepartment | null;
  readonly currentDepartmentName: string | null;
  readonly responsibleUserName: string | null;
  readonly queueName: string | null;
  readonly responsible: { readonly id: string; readonly name: string } | null;
  readonly queue: { readonly id: string; readonly name: string } | null;
  readonly relatedServiceSessionId: string | null;
  readonly isForeground: boolean;
  readonly availableActions: readonly (
    | 'ASSUME'
    | 'RETURN_TO_QUEUE'
    | 'TRANSFER_USER'
    | 'TRANSFER_DEPARTMENT'
    | 'CHANGE_PRIORITY'
    | 'RETURN_TO_AI'
    | 'CLOSE'
  )[];
  readonly publicContinuationCode: string | null;
  readonly continuationCodeExpiresAt: Date | null;
  readonly closingDeadlineAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ListManagedServiceSessionsInput {
  readonly companyId: string;
  readonly accessibleDepartments: ServiceSessionDepartmentScope;
  readonly page: number;
  readonly pageSize: number;
  readonly status?: ServiceSessionStatus;
  readonly controlMode?: ServiceControlMode;
  readonly priority?: ServicePriority;
  readonly responsibleUserId?: string;
  readonly search?: string;
}

export interface ListManagedServiceSessionsResult {
  readonly items: readonly ManagedServiceSession[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface ServiceAssignmentTarget {
  readonly id: string;
  readonly code: UserDepartment;
  readonly name: string;
  readonly isDefault: boolean;
  readonly queues: readonly {
    readonly id: string;
    readonly name: string;
    readonly assignmentStrategy: 'manual' | 'round-robin' | 'least-load';
    readonly maxConcurrentAttendances: number | null;
  }[];
  readonly users: readonly {
    readonly id: string;
    readonly name: string;
  }[];
}

export interface MutateManagedServiceSessionInput {
  readonly companyId: string;
  readonly sessionId: string;
  readonly actorUserId: string;
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly accessibleDepartments: ServiceSessionDepartmentScope;
  readonly eventName:
    | 'assume'
    | 'return-to-queue'
    | 'return-to-ai'
    | 'transfer'
    | 'change-priority'
    | 'close-human';
  readonly before: ManagedServiceSession;
  readonly after: ServiceSessionSnapshot;
  readonly assignmentReason?: string | null;
  readonly publicContinuationCode?: string;
  readonly continuationCodeExpiresAt?: Date;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export abstract class ServiceSessionManagementRepository {
  abstract list(
    input: ListManagedServiceSessionsInput,
  ): Promise<ListManagedServiceSessionsResult>;

  abstract getAccessible(input: {
    readonly companyId: string;
    readonly sessionId: string;
    readonly accessibleDepartments: ServiceSessionDepartmentScope;
  }): Promise<ManagedServiceSession | null>;

  abstract listAssignmentTargets(input: {
    readonly companyId: string;
  }): Promise<readonly ServiceAssignmentTarget[]>;

  abstract mutate(input: MutateManagedServiceSessionInput): Promise<{
    readonly session: ManagedServiceSession;
    readonly replayed: boolean;
  }>;
}
