import { describe, expect, it } from 'vitest';

import {
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

  it('normalizes uppercase person names while preserving Portuguese particles', () => {
    const registration = normalizeRegistrationInput({
      type: 'pf',
      firstName: 'MARIA D\u2019\u00c1VILA',
      lastName: 'DOS SANTOS DE SOUZA',
      roleCodes: ['client'],
      phones: [{ number: '(34) 99999-0000' }],
    });

    expect(registration).toMatchObject({
      firstName: 'Maria D\u2019\u00c1vila',
      lastName: 'Dos Santos de Souza',
      individualName: 'Maria D\u2019\u00c1vila Dos Santos de Souza',
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
});
