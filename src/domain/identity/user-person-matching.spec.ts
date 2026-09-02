import { describe, expect, it } from 'vitest';

import {
  decideUserPersonMatch,
  type UserPersonMatchCandidate,
} from './user-person-matching';

const companyId = '00000000-0000-4000-8000-000000000001';
const otherCompanyId = '00000000-0000-4000-8000-000000000002';

function candidate(
  registrationId: string,
  input: Partial<UserPersonMatchCandidate> = {},
): UserPersonMatchCandidate {
  return {
    registrationId,
    companyId,
    type: 'pf',
    cpf: null,
    emails: [],
    ...input,
  };
}

describe('decideUserPersonMatch', () => {
  it('associates automatically only to one exact CPF in the same tenant', () => {
    const decision = decideUserPersonMatch({
      subject: {
        userId: 'user-1',
        companyId,
        cpf: '529.982.247-25',
        email: 'user@example.com',
      },
      candidates: [
        candidate('person-1', { cpf: '52998224725' }),
        candidate('person-other-tenant', {
          companyId: otherCompanyId,
          cpf: '52998224725',
        }),
      ],
    });

    expect(decision).toEqual({
      decision: 'automatic',
      personRegistrationId: 'person-1',
      rule: 'unique-exact-cpf',
      emailSuggestions: [],
    });
  });

  it('keeps an exact e-mail match as suggestion instead of association', () => {
    const decision = decideUserPersonMatch({
      subject: {
        userId: 'user-1',
        companyId,
        cpf: null,
        email: ' Pessoa@Example.com ',
      },
      candidates: [candidate('person-2', { emails: ['pessoa@example.com'] })],
    });

    expect(decision).toEqual({
      decision: 'provisional',
      reason: 'cpf-not-informed',
      emailSuggestions: [{ registrationId: 'person-2', rule: 'exact-email' }],
    });
  });

  it('does not let an e-mail suggestion override the unique exact CPF', () => {
    const decision = decideUserPersonMatch({
      subject: {
        userId: 'user-1',
        companyId,
        cpf: '52998224725',
        email: 'shared@example.com',
      },
      candidates: [
        candidate('person-by-cpf', { cpf: '52998224725' }),
        candidate('person-by-email', { emails: ['shared@example.com'] }),
      ],
    });

    expect(decision).toMatchObject({
      decision: 'automatic',
      personRegistrationId: 'person-by-cpf',
      emailSuggestions: [
        { registrationId: 'person-by-email', rule: 'exact-email' },
      ],
    });
  });

  it('requires a provisional Person when CPF is invalid or has no exact match', () => {
    expect(
      decideUserPersonMatch({
        subject: {
          userId: 'user-1',
          companyId,
          cpf: '111.111.111-11',
          email: null,
        },
        candidates: [],
      }),
    ).toMatchObject({ decision: 'provisional', reason: 'invalid-cpf' });

    expect(
      decideUserPersonMatch({
        subject: {
          userId: 'user-1',
          companyId,
          cpf: '52998224725',
          email: null,
        },
        candidates: [],
      }),
    ).toMatchObject({
      decision: 'provisional',
      reason: 'no-exact-cpf-match',
    });
  });

  it('returns an explicit conflict for more than one exact CPF match', () => {
    const decision = decideUserPersonMatch({
      subject: {
        userId: 'user-1',
        companyId,
        cpf: '52998224725',
        email: null,
      },
      candidates: [
        candidate('person-b', { cpf: '52998224725' }),
        candidate('person-a', { cpf: '529.982.247-25' }),
      ],
    });

    expect(decision).toEqual({
      decision: 'conflict',
      reason: 'multiple-exact-cpf-matches',
      conflictingRegistrationIds: ['person-a', 'person-b'],
      emailSuggestions: [],
    });
  });

  it('returns a conflict if the CPF was attached to an Empresa', () => {
    const decision = decideUserPersonMatch({
      subject: {
        userId: 'user-1',
        companyId,
        cpf: '52998224725',
        email: null,
      },
      candidates: [
        candidate('company-with-cpf', {
          type: 'pj',
          cpf: '52998224725',
        }),
      ],
    });

    expect(decision).toMatchObject({
      decision: 'conflict',
      reason: 'cpf-associated-with-non-person',
      conflictingRegistrationIds: ['company-with-cpf'],
    });
  });

  it('rejects an input without tenant identity', () => {
    expect(() =>
      decideUserPersonMatch({
        subject: { userId: 'user-1', companyId: ' ', cpf: null, email: null },
        candidates: [],
      }),
    ).toThrow('identificador do tenant');
  });
});
