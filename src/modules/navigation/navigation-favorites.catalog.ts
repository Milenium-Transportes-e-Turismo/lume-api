import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import type { PermissionCode } from '../../domain/access/access.constants';
import { canExercisePermission } from '../../domain/access/tenant-authority';

export const FAVORITABLE_NAVIGATION_KEYS = new Set([
  'dashboard',
  'operations.routing',
  'operations.transport',
  'operations.transport.issues',
  'operations.transport.imports',
  'operations.transport.records',
  'operations.transport.routes',
  'operations.transport.summary',
  'company.companies',
  'company.fleet',
  'company.registrations',
  'company.contacts',
  'company.knowledge',
  'company.ai-agents',
  'company.whatsapp-conversations',
  'company.quote-proposals',
  'company.users',
  'company.administration',
  'company.whatsapp-channels',
  'company.license',
  'company.support',
  'company.documents',
  'company.document-management',
  'company.integrations.avic',
  'company.catalogs',
  'company.registration-reconciliation',
  'company.registration-data-reviews',
]);

export function isFavorableNavigationKey(value: string): boolean {
  return FAVORITABLE_NAVIGATION_KEYS.has(value);
}

type NavigationAccessRule = {
  readonly permissions: readonly PermissionCode[];
  readonly additionalPermissions?: readonly PermissionCode[];
  readonly departments?: readonly AuthenticatedPrincipal['departments'][number][];
  readonly employeeOnly?: boolean;
  readonly administratorOnly?: boolean;
};

const NAVIGATION_ACCESS_RULES: Readonly<Record<string, NavigationAccessRule>> =
  {
    dashboard: { permissions: ['dashboard:view'] },
    'operations.routing': {
      permissions: ['route-planner:view', 'route-planner:calculate'],
      departments: [
        'management',
        'commercial',
        'operations',
        'information-technology',
      ],
      employeeOnly: true,
    },
    'operations.transport': {
      permissions: [
        'trips:view',
        'trips:manage',
        'contracts:view',
        'contracts:manage',
      ],
    },
    'operations.transport.issues': {
      permissions: ['trips:view', 'trips:manage'],
    },
    'operations.transport.imports': {
      permissions: ['trips:view', 'trips:manage'],
    },
    'operations.transport.records': {
      permissions: ['trips:view', 'trips:manage'],
    },
    'operations.transport.routes': {
      permissions: ['contracts:view', 'contracts:manage'],
    },
    'operations.transport.summary': {
      permissions: ['trips:view', 'trips:manage'],
      additionalPermissions: ['contracts:view', 'contracts:manage'],
    },
    'company.companies': { permissions: ['clients:view', 'clients:manage'] },
    'company.fleet': { permissions: ['trips:view', 'trips:manage'] },
    'company.registrations': {
      permissions: [
        'clients:view',
        'clients:create',
        'clients:update',
        'clients:manage',
        'clients:history',
      ],
    },
    'company.contacts': { permissions: ['clients:view'] },
    'company.knowledge': {
      permissions: ['knowledge:view', 'knowledge:manage', 'knowledge:publish'],
    },
    'company.ai-agents': {
      permissions: ['ai-agents:view'],
      departments: ['management'],
      employeeOnly: true,
    },
    'company.whatsapp-conversations': {
      permissions: [
        'service:view',
        'whatsapp-conversations:view',
        'whatsapp-conversations:manage',
      ],
      employeeOnly: true,
    },
    'company.quote-proposals': {
      permissions: [
        'whatsapp-conversations:manage',
        'whatsapp-conversations:view',
        'commercial:view',
        'commercial:manage',
      ],
      departments: ['commercial'],
      employeeOnly: true,
    },
    'company.users': {
      permissions: [
        'users:view',
        'users:create',
        'users:update',
        'users:manage',
      ],
    },
    'company.administration': {
      permissions: ['settings:view'],
      administratorOnly: true,
    },
    'company.whatsapp-channels': {
      permissions: ['whatsapp-channels:view'],
      departments: ['management'],
      employeeOnly: true,
    },
    'company.license': {
      permissions: ['license:view'],
      departments: ['management'],
      employeeOnly: true,
    },
    'company.support': { permissions: ['support:view'] },
    'company.documents': { permissions: ['documents:view'] },
    'company.document-management': {
      permissions: ['documents:manage'],
      departments: ['management', 'personnel-department', 'human-resources'],
      employeeOnly: true,
    },
    'company.integrations.avic': {
      permissions: ['trips:view', 'trips:manage'],
    },
    'company.catalogs': { permissions: ['trips:view', 'trips:manage'] },
    'company.registration-reconciliation': {
      permissions: ['clients:history', 'clients:manage'],
    },
    'company.registration-data-reviews': { permissions: ['clients:manage'] },
  };

/**
 * Keeps the persisted favorite catalog aligned with the server-authoritative
 * principal. A favorite is only useful when the same principal can navigate
 * to its screen now; it must never become a stored hint for inaccessible UI.
 */
export function canFavoriteNavigationKey(
  current: AuthenticatedPrincipal,
  navigationKey: string,
): boolean {
  if (!current.isActive || !isFavorableNavigationKey(navigationKey)) {
    return false;
  }

  if (current.documentAccessMode === 'document-portal') {
    return (
      navigationKey === 'company.documents' &&
      canExercisePermission(current, 'documents:view')
    );
  }

  const rule = NAVIGATION_ACCESS_RULES[navigationKey];
  if (
    !rule ||
    !rule.permissions.some((permission) =>
      canExercisePermission(current, permission),
    ) ||
    (rule.additionalPermissions !== undefined &&
      !rule.additionalPermissions.some((permission) =>
        canExercisePermission(current, permission),
      ))
  ) {
    return false;
  }

  if (current.isAdministrator) {
    return true;
  }

  if (rule.administratorOnly) {
    return false;
  }

  if (rule.employeeOnly && current.type !== 'employee') {
    return false;
  }

  return (
    !rule.departments ||
    rule.departments.some((department) =>
      current.departments.includes(department),
    )
  );
}
