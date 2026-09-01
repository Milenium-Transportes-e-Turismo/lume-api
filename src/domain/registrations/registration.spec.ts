import { describe, expect, it } from 'vitest';

import {
  assertRegistrationAllowsCommercialCommitment,
  assertTemporaryRegistrationCanBeRegularized,
  canAuthorizeTemporaryRegistration,
  normalizeRegistrationInput,
  normalizeRegistrationPromotionPayload,
} from './registration';

describe('normalizeRegistrationInput', () => {
  it('creates one PF identity with multiple roles and typed contacts', () => {
    const registration = normalizeRegistrationInput(
      {
        type: 'pf',
        firstName: ' Ana ',
        lastName: ' Souza ',
        roleCodes: ['client', 'driver', 'client'],
        tagCodes: ['operations'],
        phones: [
          {
            number: '(34) 99999-0000',
            type: 'mobile',
            hasWhatsApp: true,
          },
          { number: '(34) 3333-0000', type: 'commercial' },
        ],
        emails: [{ address: 'ANA@EXAMPLE.COM', type: 'personal' }],
      },
      '44a420ee-e888-4e08-ae22-cbd7d3c31e4d',
    );

    expect(registration).toMatchObject({
      type: 'pf',
      firstName: 'Ana',
      lastName: 'Souza',
      individualName: 'Ana Souza',
      cpf: null,
      roleCodes: ['client', 'driver'],
      tagCodes: ['operations'],
      individualEmail: 'ana@example.com',
    });
    expect(registration.phones).toHaveLength(2);
    expect(registration.phones[0]).toMatchObject({
      normalizedValue: '5534999990000',
      isPrimary: true,
      hasWhatsApp: true,
    });
  });

  it('requires a valid CNPJ for PJ and at least one role for every identity', () => {
    expect(() =>
      normalizeRegistrationInput({
        type: 'pj',
        legalName: 'Empresa de teste',
        cnpj: '11.111.111/1111-11',
        roleCodes: ['supplier'],
      }),
    ).toThrow('Informe um CNPJ válido.');

    expect(() =>
      normalizeRegistrationInput({
        type: 'pj',
        legalName: 'Empresa de teste',
        cnpj: '11.222.333/0001-81',
        roleCodes: [],
      }),
    ).toThrow('Selecione pelo menos um Papel.');
  });

  it('does not accept two primary contacts of the same kind', () => {
    expect(() =>
      normalizeRegistrationInput({
        type: 'pf',
        firstName: 'Ana',
        roleCodes: ['client'],
        phones: [
          { number: '(34) 99999-0000', isPrimary: true },
          { number: '(34) 98888-0000', isPrimary: true },
        ],
      }),
    ).toThrow('Selecione apenas um telefone principal.');
  });

  it('accepts valid optional CPF and rejects an invalid CPF', () => {
    expect(
      normalizeRegistrationInput({
        type: 'pf',
        firstName: 'Maria',
        cpf: '529.982.247-25',
        roleCodes: ['employee'],
        phones: [{ number: '(34) 99999-0000' }],
      }).cpf,
    ).toBe('52998224725');

    expect(() =>
      normalizeRegistrationInput({
        type: 'pf',
        firstName: 'Maria',
        cpf: '111.111.111-11',
        roleCodes: ['employee'],
        phones: [{ number: '(34) 99999-0000' }],
      }),
    ).toThrow('CPF inválido.');
  });

  it('enforces the different PF and PJ minimum data rules', () => {
    expect(() =>
      normalizeRegistrationInput({
        type: 'pf',
        firstName: 'Maria',
        roleCodes: ['client'],
      }),
    ).toThrow('Pessoa Física precisa de pelo menos um telefone.');

    expect(
      normalizeRegistrationInput({
        type: 'pj',
        legalName: 'Empresa Exemplo Ltda',
        cnpj: '11.222.333/0001-81',
        roleCodes: ['supplier'],
      }).phones,
    ).toEqual([]);

    expect(() =>
      normalizeRegistrationInput({
        type: 'pj',
        legalName: 'Empresa Exemplo Ltda',
        roleCodes: ['supplier'],
      }),
    ).toThrow('Informe um CNPJ válido.');
  });

  it('rejects names that contain no meaningful identity', () => {
    expect(() =>
      normalizeRegistrationInput({
        type: 'pf',
        firstName: '1',
        roleCodes: ['client'],
        phones: [{ number: '(34) 99999-0000' }],
      }),
    ).toThrow('Informe um nome válido');

    expect(() =>
      normalizeRegistrationInput({
        type: 'pj',
        legalName: '-',
        cnpj: '11.222.333/0001-81',
        roleCodes: ['supplier'],
      }),
    ).toThrow('Informe uma razão social válida');
  });

  it('normalizes PF, PJ and multiple relationships as one promotion graph', () => {
    const graph = normalizeRegistrationPromotionPayload({
      primaryLocalId: 'organization',
      registrations: [
        {
          localId: 'organization',
          registration: {
            type: 'pj',
            legalName: 'Empresa Exemplo Ltda',
            cnpj: '11.222.333/0001-81',
            roleCodes: ['client'],
          },
        },
        {
          localId: 'person-a',
          registration: {
            type: 'pf',
            firstName: 'João',
            roleCodes: ['partner'],
            phones: [{ number: '(34) 99999-0000' }],
          },
        },
        {
          localId: 'person-b',
          registration: {
            type: 'pf',
            firstName: 'Maria',
            roleCodes: ['employee'],
            phones: [{ number: '(34) 98888-0000' }],
          },
        },
      ],
      relationships: [
        {
          sourceLocalId: 'person-a',
          targetLocalId: 'organization',
          type: 'representante de',
          department: 'Compras',
        },
        {
          sourceLocalId: 'person-b',
          targetLocalId: 'organization',
          type: 'funcionária de',
          department: 'Financeiro',
        },
      ],
    });

    expect(graph.primaryLocalId).toBe('organization');
    expect(graph.registrations).toHaveLength(3);
    expect(graph.relationships).toHaveLength(2);
  });

  it('allows one phone to be associated with multiple distinct identities', () => {
    const graph = normalizeRegistrationPromotionPayload({
      primaryLocalId: 'person-a',
      registrations: [
        {
          localId: 'person-a',
          registration: {
            type: 'pf',
            firstName: 'Ana',
            roleCodes: ['passenger'],
            phones: [{ number: '(34) 99999-0000' }],
          },
        },
        {
          localId: 'person-b',
          registration: {
            type: 'pf',
            firstName: 'Bruno',
            roleCodes: ['passenger'],
            phones: [{ number: '(34) 99999-0000' }],
          },
        },
      ],
      relationships: [],
    });

    expect(
      graph.registrations.map(({ registration }) =>
        registration.phones.map((phone) => phone.normalizedValue),
      ),
    ).toEqual([['5534999990000'], ['5534999990000']]);
  });

  it('creates a temporary registration with a seven-day default deadline', () => {
    const now = new Date('2026-08-30T12:00:00.000Z');
    const registration = normalizeRegistrationInput(
      {
        type: 'pf',
        firstName: 'Motorista substituto',
        roleCodes: ['driver'],
        emails: [{ address: 'substituto@example.com' }],
        isTemporary: true,
        temporaryReason: 'Substituição emergencial na operação de hoje.',
        temporaryResponsibleUserId: '00000000-0000-4000-8000-000000000001',
      },
      '44a420ee-e888-4e08-ae22-cbd7d3c31e4d',
      now,
    );

    expect(registration).toMatchObject({
      isTemporary: true,
      temporaryReason: 'Substituição emergencial na operação de hoje.',
      regularizationRequirements: [
        'cpf-before-regularization',
        'phone-before-regularization',
        'driver-license-before-assignment',
      ],
      temporaryResponsibleUserId: '00000000-0000-4000-8000-000000000001',
    });
    expect(registration.regularizationDueAt?.toISOString()).toBe(
      '2026-09-06T12:00:00.000Z',
    );
  });

  it('requires contact and reason for temporary registrations', () => {
    expect(() =>
      normalizeRegistrationInput({
        type: 'pj',
        legalName: 'Fornecedor emergencial',
        roleCodes: ['supplier'],
        isTemporary: true,
        temporaryReason: 'Compra urgente',
        temporaryResponsibleUserId: '00000000-0000-4000-8000-000000000001',
      }),
    ).toThrow('pelo menos um telefone ou e-mail');

    expect(() =>
      normalizeRegistrationInput({
        type: 'pf',
        firstName: 'Passageiro',
        roleCodes: ['passenger'],
        phones: [{ number: '(34) 99999-0000' }],
        isTemporary: true,
        temporaryResponsibleUserId: '00000000-0000-4000-8000-000000000001',
      }),
    ).toThrow('motivo do Cadastro temporário');
  });

  it('does not allow a temporary deadline beyond seven days', () => {
    expect(() =>
      normalizeRegistrationInput(
        {
          type: 'pf',
          firstName: 'Passageiro',
          roleCodes: ['passenger'],
          phones: [{ number: '(34) 99999-0000' }],
          isTemporary: true,
          temporaryReason: 'Embarque emergencial',
          temporaryResponsibleUserId: '00000000-0000-4000-8000-000000000001',
          regularizationDueAt: '2026-09-07T12:00:00.000Z',
        },
        '44a420ee-e888-4e08-ae22-cbd7d3c31e4d',
        new Date('2026-08-30T12:00:00.000Z'),
      ),
    ).toThrow('em até 7 dias');
  });

  it('requires an explicit regularization owner in the domain input', () => {
    expect(() =>
      normalizeRegistrationInput({
        type: 'pf',
        firstName: 'Pessoa temporária',
        roleCodes: ['client'],
        phones: [{ number: '(34) 99999-0000' }],
        isTemporary: true,
        temporaryReason: 'Atendimento emergencial',
      }),
    ).toThrow('responsável pela regularização');
  });
});

describe('canAuthorizeTemporaryRegistration', () => {
  it('accepts administrators, management or the explicit management capability', () => {
    expect(
      canAuthorizeTemporaryRegistration({
        isAdministrator: true,
        departments: [],
        permissions: [],
      }),
    ).toBe(true);
    expect(
      canAuthorizeTemporaryRegistration({
        isAdministrator: false,
        departments: ['management'],
        permissions: [],
      }),
    ).toBe(true);
    expect(
      canAuthorizeTemporaryRegistration({
        isAdministrator: false,
        departments: ['commercial'],
        permissions: ['clients:manage'],
      }),
    ).toBe(true);
  });

  it('rejects a regular registration creator without management authority', () => {
    expect(
      canAuthorizeTemporaryRegistration({
        isAdministrator: false,
        departments: ['commercial'],
        permissions: ['clients:create'],
      }),
    ).toBe(false);
  });
});

describe('assertRegistrationAllowsCommercialCommitment', () => {
  it('blocks registrations that still lack a real tax identifier', () => {
    expect(() =>
      assertRegistrationAllowsCommercialCommitment({
        isTemporary: true,
        regularizationRequirements: ['tax-id-before-commercial-commitment'],
        cpf: null,
        cnpj: null,
      }),
    ).toThrow('Regularize o CPF/CNPJ');
    expect(() =>
      assertRegistrationAllowsCommercialCommitment({
        isTemporary: true,
        regularizationRequirements: ['driver-license-before-assignment'],
        cpf: '52998224725',
        cnpj: null,
      }),
    ).not.toThrow();
    expect(() =>
      assertRegistrationAllowsCommercialCommitment({
        isTemporary: false,
        regularizationRequirements: [],
        cpf: null,
        cnpj: null,
      }),
    ).toThrow('Regularize o CPF/CNPJ');
  });
});

describe('assertTemporaryRegistrationCanBeRegularized', () => {
  it('requires the identity minimum before removing the temporary flag', () => {
    expect(() =>
      assertTemporaryRegistrationCanBeRegularized({
        type: 'pf',
        cpf: null,
        cnpj: null,
        phones: [{}],
      }),
    ).toThrow('Informe o CPF');
    expect(() =>
      assertTemporaryRegistrationCanBeRegularized({
        type: 'pf',
        cpf: '52998224725',
        cnpj: null,
        phones: [{}],
      }),
    ).not.toThrow();
  });
});
