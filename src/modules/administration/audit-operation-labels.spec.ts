import { describe, it, expect } from 'vitest';
import {
  auditChangedFields,
  auditOperationLabel,
} from './audit-operation-labels';
describe('administrative audit presentation', () => {
  it('names the actual action and module', () => {
    expect(auditOperationLabel('REGISTRATION_UPDATED', 'registration')).toEqual(
      { module: 'Cadastro', action: 'Cadastro atualizado' },
    );
  });
  it('lists changed public fields without exposing secrets or instruction content', () => {
    expect(
      auditChangedFields(
        {
          permissionCodes: ['users:view'],
          passwordHash: 'old',
          serviceInstructions: 'old',
        },
        {
          permissionCodes: ['users:view', 'users:manage'],
          passwordHash: 'new',
          serviceInstructions: 'new',
        },
      ),
    ).toEqual(['Permissões', 'Instruções de atendimento']);
  });
});
