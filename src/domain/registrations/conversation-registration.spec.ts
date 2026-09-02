import { describe, expect, it } from 'vitest';

import {
  decideConversationRegistrationPersistence,
  decideRegistrationDivergence,
  relationshipGrantsAuthorization,
  resolveRegistrationIdentity,
  type ConversationRegistrationDraft,
} from './conversation-registration';

const personalDraft: ConversationRegistrationDraft = {
  kind: 'personal',
  person: {
    name: 'Ana Souza',
    cpf: '529.982.247-25',
    email: 'ANA@EXAMPLE.COM',
    phone: '(34) 99999-0000',
  },
  confirmedByCustomer: false,
  abandoned: false,
};

describe('progressive registration identity', () => {
  it('does not choose arbitrarily when a shared phone has ambiguous registrations', () => {
    expect(
      resolveRegistrationIdentity([
        {
          registrationId: crypto.randomUUID(),
          confidence: 0.8,
          contextConfirmed: false,
        },
        {
          registrationId: crypto.randomUUID(),
          confidence: 0.78,
          contextConfirmed: false,
        },
      ]),
    ).toEqual({ status: 'ambiguous', registrationId: null });
  });

  it('resolves a single context-confirmed participant', () => {
    const registrationId = crypto.randomUUID();
    expect(
      resolveRegistrationIdentity([
        { registrationId, confidence: 0.7, contextConfirmed: true },
        {
          registrationId: crypto.randomUUID(),
          confidence: 0.95,
          contextConfirmed: false,
        },
      ]),
    ).toEqual({ status: 'resolved', registrationId });
  });
});

describe('conversation registration confirmation', () => {
  it('shows only values supplied by the customer before persisting', () => {
    expect(decideConversationRegistrationPersistence(personalDraft)).toEqual({
      action: 'await-confirmation',
      summary: [
        'Nome: Ana Souza',
        'CPF: 52998224725',
        'E-mail: ana@example.com',
        'Telefone: 34999990000',
      ],
    });
  });

  it('persists through registrations only after explicit confirmation', () => {
    expect(
      decideConversationRegistrationPersistence({
        ...personalDraft,
        confirmedByCustomer: true,
      }),
    ).toMatchObject({
      action: 'persist-person',
      normalized: { cpf: '52998224725', email: 'ana@example.com' },
    });
  });

  it('creates PF, PJ and relationship as one confirmed intent', () => {
    expect(
      decideConversationRegistrationPersistence({
        ...personalDraft,
        kind: 'company',
        company: {
          legalName: 'Empresa Exemplo Ltda',
          cnpj: '11.222.333/0001-81',
        },
        relationship: {
          type: 'employee',
          jobTitle: 'Assistente',
          department: 'Recursos Humanos',
        },
        confirmedByCustomer: true,
      }),
    ).toMatchObject({
      action: 'persist-person-company-relationship',
      normalized: {
        cnpj: '11222333000181',
        relationshipType: 'employee',
        jobTitle: 'Assistente',
        relationshipDepartment: 'Recursos Humanos',
      },
    });
  });

  it('discards an abandoned draft without requiring complete data', () => {
    expect(
      decideConversationRegistrationPersistence({
        kind: 'personal',
        person: { name: '', cpf: '', phone: '' },
        confirmedByCustomer: false,
        abandoned: true,
      }),
    ).toMatchObject({ action: 'discard-draft' });
  });
});

describe('safe registration updates', () => {
  it('never reveals the previous value when asking to update a PF field', () => {
    const previousEmail = 'segredo@example.com';
    const decision = decideRegistrationDivergence({
      registrationKind: 'personal',
      field: 'email',
      existingValue: previousEmail,
      proposedValue: 'novo@example.com',
    });

    expect(decision).toMatchObject({ action: 'ask-explicit-confirmation' });
    expect(decision).toHaveProperty(
      'message',
      'Encontrei uma divergência no e-mail. Posso substituir pelo novo valor informado?',
    );
    expect(JSON.stringify(decision)).not.toContain(previousEmail);
  });

  it('sends sensitive organizational divergences to human review', () => {
    expect(
      decideRegistrationDivergence({
        registrationKind: 'company',
        field: 'legalName',
        existingValue: 'Empresa A',
        proposedValue: 'Empresa B',
      }),
    ).toEqual({ action: 'create-data-review', field: 'legalName' });
  });

  it('keeps CPF immutable and relationships separate from authorization', () => {
    expect(
      decideRegistrationDivergence({
        registrationKind: 'personal',
        field: 'cpf',
        existingValue: '52998224725',
        proposedValue: '11144477735',
      }),
    ).toEqual({ action: 'reject-immutable-change', field: 'cpf' });
    expect(relationshipGrantsAuthorization()).toBe(false);
  });
});
