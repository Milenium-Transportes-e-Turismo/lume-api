import { describe, expect, it } from 'vitest';

import { User } from '../../domain/entities/user';
import { presentUser } from './user.presenter';

describe('presentUser', () => {
  it('não concede permissões operacionais de atendimento apenas por ser administrador', () => {
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
    expect(presented.permissions).not.toContain('service:view');
    expect(presented.permissionCodes).not.toContain('service:respond');
  });
});
