import { describe, expect, it } from 'vitest';

import {
  canExercisePermission,
  hasTenantWideAuthority,
} from '../../domain/access/tenant-authority';
import { SERVICE_PERMISSION_CEILING } from '../../domain/access/access.constants';
import { User } from '../../domain/entities/user';
import { presentUser } from './user.presenter';

describe('presentUser', () => {
  it('projects every operational-service permission for an administrator', () => {
    const user = User.create({
      companyId: '00000000-0000-4000-8000-000000000010',
      name: 'Administrador',
      username: 'admin',
      usernameNormalized: 'admin',
      email: 'admin@example.test',
      emailNormalized: 'admin@example.test',
      cpfNormalized: null,
      passwordHash: 'hash',
      isAdministrator: true,
      departments: [],
      permissionCodes: [],
    });

    const presented = presentUser({ user, companyIsActive: true });

    expect(presented.permissions).toContain('whatsapp-channels:manage');
    expect(presented.permissions).toEqual(
      expect.arrayContaining([...SERVICE_PERMISSION_CEILING]),
    );
    expect(presented.permissionCodes).toEqual([]);
  });

  it('keeps administrator grants and departments distinct from effective access', () => {
    const administrator = User.create({
      companyId: '00000000-0000-4000-8000-000000000001',
      name: 'Administradora',
      username: 'administradora',
      usernameNormalized: 'administradora',
      email: 'administradora@example.test',
      emailNormalized: 'administradora@example.test',
      cpfNormalized: null,
      passwordHash: 'hash',
      isAdministrator: true,
      departments: ['management'],
      permissionCodes: ['license:view'],
    });

    const output = presentUser({ user: administrator, companyIsActive: true });

    expect(output.departments).toEqual(['management']);
    expect(output.permissionCodes).toEqual(['license:view']);
    expect(output.permissions).toEqual(
      expect.arrayContaining([
        'tenant:manage',
        'users:manage',
        'settings:manage',
        'commercial:manage',
      ]),
    );
  });

  it('does not expose legacy business grants from a document-portal account', () => {
    const documentPortalDirector = User.create({
      companyId: '00000000-0000-4000-8000-000000000001',
      name: 'Diretora documental',
      username: 'diretora.documental',
      usernameNormalized: 'diretora.documental',
      email: 'diretora.documental@example.test',
      emailNormalized: 'diretora.documental@example.test',
      cpfNormalized: null,
      passwordHash: 'hash',
      documentAccessMode: 'document-portal',
      isAdministrator: false,
      departments: ['directorate'],
      permissionCodes: ['tenant:manage'],
    });

    const output = presentUser({
      user: documentPortalDirector,
      companyIsActive: true,
    });

    expect(output.departments).toEqual([]);
    expect(output.permissionCodes).toEqual([]);
    expect(output.permissions).toEqual([
      'documents:view',
      'documents:create',
      'documents:update',
      'profile:view',
      'profile:update',
      'support:view',
      'support:create',
    ]);
    expect(hasTenantWideAuthority(output)).toBe(false);
    expect(canExercisePermission(output, 'operations:manage')).toBe(false);
  });
});
