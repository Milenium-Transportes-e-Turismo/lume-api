import { forbidden, validationError } from '../../core/errors/app-error';
import { normalizeWhatsAppPhone } from '../../shared/utils/normalization';

export const CHANNEL_ORGANIZATIONAL_STATUSES = [
  'pending',
  'active',
  'cancelled',
  'disabled',
] as const;
export const CHANNEL_CONNECTION_STATUSES = [
  'unknown',
  'connected',
  'disconnected',
  'connecting',
  'error',
] as const;
export const CHANNEL_ROUTING_MODES = [
  'department-owned',
  'general-triage',
] as const;

export type ChannelOrganizationalStatus =
  (typeof CHANNEL_ORGANIZATIONAL_STATUSES)[number];
export type ChannelConnectionStatus =
  (typeof CHANNEL_CONNECTION_STATUSES)[number];
export type ChannelRoutingMode = (typeof CHANNEL_ROUTING_MODES)[number];

export interface WhatsAppChannelSnapshot {
  readonly agentsEnabled?: boolean;
  readonly displayName: string;
  readonly phoneNumber: string;
  readonly evolutionInstanceName: string;
  readonly departmentId: string | null;
  readonly routingMode: ChannelRoutingMode;
  readonly organizationalStatus: ChannelOrganizationalStatus;
  readonly connectionStatus: ChannelConnectionStatus;
  readonly allowedAutomaticTargetDepartmentIds: readonly string[];
}

export function normalizePhysicalChannelPhone(value: string): string {
  if (value.includes('@g.us')) {
    throw validationError(
      'Identificadores técnicos de grupo não podem ser usados como canal.',
    );
  }
  return normalizeWhatsAppPhone(value);
}

function slug(value: string, field: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48);
  if (!normalized)
    throw validationError(`${field} não gera um identificador técnico válido.`);
  return normalized;
}

export function createEvolutionInstanceName(input: {
  readonly tenantSlug: string;
  readonly channelSlug: string;
}): string {
  return `${slug(input.tenantSlug, 'Tenant')}-production-${slug(input.channelSlug, 'Canal')}`;
}

export function validateChannelConfiguration(
  snapshot: WhatsAppChannelSnapshot,
): WhatsAppChannelSnapshot {
  const displayName = snapshot.displayName.trim();
  if (!displayName || displayName.length > 80) {
    throw validationError(
      'O nome de exibição do canal é obrigatório e deve ter até 80 caracteres.',
    );
  }
  if (
    snapshot.routingMode === 'department-owned' &&
    snapshot.departmentId === null
  ) {
    throw validationError(
      'Canal de departamento exige um departamento proprietário.',
    );
  }
  const allowed = Array.from(
    new Set(
      snapshot.allowedAutomaticTargetDepartmentIds.map((value) => value.trim()),
    ),
  ).filter(Boolean);
  return {
    ...snapshot,
    displayName,
    phoneNumber: normalizePhysicalChannelPhone(snapshot.phoneNumber),
    allowedAutomaticTargetDepartmentIds: allowed,
  };
}

export function assertEvolutionInstanceNameUnchanged(input: {
  readonly current: string;
  readonly proposed: string;
}): void {
  if (input.current !== input.proposed) {
    throw validationError(
      'O nome técnico da instância Evolution é imutável; altere apenas o nome de exibição.',
    );
  }
}

export function evolveChannelStatus(input: {
  readonly current: WhatsAppChannelSnapshot;
  readonly action:
    | 'request-qr'
    | 'connected'
    | 'disconnected'
    | 'connection-error'
    | 'cancel-pending'
    | 'disable-operational';
  readonly isAdministrator: boolean;
}): WhatsAppChannelSnapshot {
  const current = validateChannelConfiguration(input.current);

  switch (input.action) {
    case 'request-qr':
      if (
        current.organizationalStatus === 'cancelled' ||
        current.organizationalStatus === 'disabled'
      ) {
        throw validationError(
          'O canal não aceita conexão no estado organizacional atual.',
        );
      }
      return { ...current, connectionStatus: 'connecting' };

    case 'connected':
      if (
        current.organizationalStatus === 'cancelled' ||
        current.organizationalStatus === 'disabled'
      ) {
        throw validationError(
          'O canal não pode ser ativado no estado organizacional atual.',
        );
      }
      return {
        ...current,
        organizationalStatus: 'active',
        connectionStatus: 'connected',
      };

    case 'disconnected':
      return { ...current, connectionStatus: 'disconnected' };

    case 'connection-error':
      return { ...current, connectionStatus: 'error' };

    case 'cancel-pending':
      if (current.organizationalStatus !== 'pending') {
        throw validationError(
          'Somente uma configuração pendente pode ser cancelada.',
        );
      }
      return {
        ...current,
        organizationalStatus: 'cancelled',
        connectionStatus: 'disconnected',
      };

    case 'disable-operational':
      if (!input.isAdministrator) {
        throw forbidden(
          'Somente administrador pode desativar um canal operacional.',
        );
      }
      if (current.organizationalStatus !== 'active') {
        throw validationError('Somente um canal ativo pode ser desativado.');
      }
      return { ...current, organizationalStatus: 'disabled' };
  }
}

export function canAutomaticallyRouteChannelTo(input: {
  readonly channel: WhatsAppChannelSnapshot;
  readonly targetDepartmentId: string;
}): boolean {
  return input.channel.allowedAutomaticTargetDepartmentIds.includes(
    input.targetDepartmentId,
  );
}

export function channelDeletionOperation(): never {
  throw validationError(
    'Canais operacionais não podem ser excluídos fisicamente; cancele ou desative.',
  );
}
