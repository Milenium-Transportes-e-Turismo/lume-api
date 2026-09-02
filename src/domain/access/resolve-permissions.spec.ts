import { describe, expect, it } from 'vitest';

import {
  ALL_PERMISSION_CODES,
  ASSIGNABLE_DEPARTMENTS,
  DEFAULT_DEPARTMENT_PERMISSIONS,
  MANAGEMENT_DEPARTMENT_PERMISSIONS,
} from './access.constants';
import { resolveEffectivePermissions } from './resolve-permissions';

describe('resolveEffectivePermissions', () => {
  it('always grants dashboard, AI agent and employee self-service permissions', () => {
    expect(resolveEffectivePermissions([])).toEqual([
      'ai-agents:use',
      'dashboard:view',
      'documents:create',
      'documents:update',
      'documents:view',
      'profile:update',
      'profile:view',
      'support:create',
      'support:view',
    ]);
  });

  it('accepts selected Controladoria permissions for current and legacy codes', () => {
    const selected = ['financial:manage'] as const;
    expect(resolveEffectivePermissions(['controllership'], selected)).toEqual(
      resolveEffectivePermissions(['controlling'], selected),
    );
    expect(resolveEffectivePermissions(['controllership'], selected)).toContain(
      'financial:manage',
    );
  });

  it('never lets materialized legacy permissions exceed a Commercial ceiling', () => {
    const permissions = resolveEffectivePermissions(
      ['commercial'],
      ALL_PERMISSION_CODES,
    );

    expect(permissions).toContain('commercial:manage');
    expect(permissions).not.toContain('users:view');
    expect(permissions).not.toContain('users:manage');
    expect(permissions).not.toContain('license:view');
  });

  it('grants the full current catalog only to an explicit administrator', () => {
    expect(resolveEffectivePermissions([], [], true)).toEqual(
      ALL_PERMISSION_CODES,
    );
    expect(resolveEffectivePermissions([], ['users:manage'])).not.toContain(
      'users:manage',
    );
  });

  it('reserves administrative access to management and people operations', () => {
    for (const department of ASSIGNABLE_DEPARTMENTS) {
      if (
        department === 'management' ||
        department === 'human-resources' ||
        department === 'personnel-department' ||
        department === 'information-technology'
      ) {
        continue;
      }
      expect(
        DEFAULT_DEPARTMENT_PERMISSIONS[department].some(
          (permission) =>
            permission.startsWith('users:') ||
            permission.startsWith('settings:') ||
            permission === 'license:view',
        ),
        department,
      ).toBe(false);
    }
  });

  it('grants user management to existing TI users without granting license access', () => {
    const permissions = resolveEffectivePermissions(
      ['information-technology'],
      [],
    );

    expect(permissions).toEqual(
      expect.arrayContaining([
        'users:view',
        'users:create',
        'users:update',
        'users:manage',
      ]),
    );
    expect(permissions).not.toContain('license:view');
  });

  it('limits HR and Personnel Department to viewing and creating user access', () => {
    for (const department of [
      'human-resources',
      'personnel-department',
    ] as const) {
      expect(DEFAULT_DEPARTMENT_PERMISSIONS[department]).toContain(
        'users:view',
      );
      expect(DEFAULT_DEPARTMENT_PERMISSIONS[department]).toContain(
        'users:create',
      );
      expect(DEFAULT_DEPARTMENT_PERMISSIONS[department]).not.toContain(
        'users:update',
      );
      expect(DEFAULT_DEPARTMENT_PERMISSIONS[department]).not.toContain(
        'users:manage',
      );
    }
  });

  it('publishes RH and Personnel Department with the same document capabilities', () => {
    const documentPermissions = (
      department: 'human-resources' | 'personnel-department',
    ) =>
      DEFAULT_DEPARTMENT_PERMISSIONS[department]
        .filter((permission) => permission.startsWith('documents:'))
        .sort();

    expect(documentPermissions('human-resources')).toEqual(
      documentPermissions('personnel-department'),
    );
    expect(documentPermissions('human-resources')).toEqual([
      'documents:approve',
      'documents:create',
      'documents:export',
      'documents:manage',
      'documents:update',
      'documents:view',
    ]);
  });

  it('publishes RH and Personnel Department as separate assignable departments', () => {
    expect(ASSIGNABLE_DEPARTMENTS).toContain('human-resources');
    expect(ASSIGNABLE_DEPARTMENTS).toContain('personnel-department');
    expect(ASSIGNABLE_DEPARTMENTS.indexOf('human-resources')).not.toBe(
      ASSIGNABLE_DEPARTMENTS.indexOf('personnel-department'),
    );
  });

  it('allows individually assigned WhatsApp attendance and viewing in every internal department', () => {
    for (const department of ASSIGNABLE_DEPARTMENTS.filter(
      (candidate) => candidate !== 'client-company',
    )) {
      expect(
        resolveEffectivePermissions(
          [department],
          ['whatsapp-conversations:view', 'whatsapp-conversations:attend'],
        ),
        department,
      ).toContain('whatsapp-conversations:attend');
      expect(
        resolveEffectivePermissions(
          [department],
          ['whatsapp-conversations:view', 'whatsapp-conversations:attend'],
        ),
        department,
      ).toContain('whatsapp-conversations:view');
    }

    expect(
      resolveEffectivePermissions(
        ['client-company'],
        ['whatsapp-conversations:view', 'whatsapp-conversations:attend'],
      ),
    ).not.toEqual(
      expect.arrayContaining([
        'whatsapp-conversations:view',
        'whatsapp-conversations:attend',
      ]),
    );
  });

  it('expands the Directorate tenant authority without platform administration', () => {
    const permissions = resolveEffectivePermissions(
      ['directorate'],
      ['tenant:manage'],
    );

    expect(permissions).toEqual(
      expect.arrayContaining([
        'tenant:manage',
        'commercial:manage',
        'financial:approve',
        'operations:manage',
        'service-confirmations:approve',
        'whatsapp-conversations:attend',
      ]),
    );
    expect(permissions).not.toContain('users:manage');
    expect(permissions).not.toContain('settings:manage');
    expect(permissions).not.toContain('license:view');
  });

  it('does not expand Directorate authority without the individual grant', () => {
    const permissions = resolveEffectivePermissions(['directorate'], []);

    expect(permissions).not.toContain('tenant:manage');
    expect(permissions).not.toContain('commercial:manage');
  });

  it('does not treat the Management department as administrator authority', () => {
    expect(MANAGEMENT_DEPARTMENT_PERMISSIONS).not.toContain('users:view');
    expect(MANAGEMENT_DEPARTMENT_PERMISSIONS).not.toContain('users:create');
    expect(MANAGEMENT_DEPARTMENT_PERMISSIONS).not.toContain('users:update');
    expect(MANAGEMENT_DEPARTMENT_PERMISSIONS).not.toContain('users:manage');
    expect(MANAGEMENT_DEPARTMENT_PERMISSIONS).toContain('settings:manage');
    expect(MANAGEMENT_DEPARTMENT_PERMISSIONS).toContain('license:view');
    expect(MANAGEMENT_DEPARTMENT_PERMISSIONS).toContain('clients:view');
    expect(MANAGEMENT_DEPARTMENT_PERMISSIONS).toContain('clients:create');
    expect(MANAGEMENT_DEPARTMENT_PERMISSIONS).toContain('clients:update');
    expect(MANAGEMENT_DEPARTMENT_PERMISSIONS).not.toContain('clients:manage');
    expect(MANAGEMENT_DEPARTMENT_PERMISSIONS).not.toContain('clients:history');
    expect(MANAGEMENT_DEPARTMENT_PERMISSIONS).toContain(
      'service-confirmations:approve',
    );
    expect(MANAGEMENT_DEPARTMENT_PERMISSIONS).not.toContain('tenant:manage');
    expect(
      MANAGEMENT_DEPARTMENT_PERMISSIONS.some((permission) =>
        permission.startsWith('commercial:'),
      ),
    ).toBe(false);
    expect(MANAGEMENT_DEPARTMENT_PERMISSIONS).not.toContain(
      'whatsapp-conversations:manage',
    );
  });

  it('allows explicitly assigned Cadastro access for Management', () => {
    const permissions = resolveEffectivePermissions(
      ['management'],
      ['clients:view', 'clients:create', 'clients:update', 'commercial:view'],
    );

    expect(permissions).toEqual(
      expect.arrayContaining([
        'clients:view',
        'clients:create',
        'clients:update',
      ]),
    );
    expect(permissions).not.toContain('commercial:view');
  });
});
