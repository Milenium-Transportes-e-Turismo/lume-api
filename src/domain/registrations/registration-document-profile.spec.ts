import { describe, it, expect } from 'vitest';
import {
  normalizeRegistrationDocumentProfile,
  normalizeRegistrationAddress,
} from './registration';
describe('registration personal information', () => {
  const profile = {
    jobTitle: 'Motorista',
    maritalStatus: 'married',
    militaryDocumentStatus: 'not-applicable' as const,
    dependents: [{ name: 'Maria Silva', birthDate: '2018-05-12' }],
  };
  it('normalizes and preserves PF profile independently of a user', () => {
    expect(normalizeRegistrationDocumentProfile(profile, 'pf')).toEqual(
      profile,
    );
  });
  it('rejects profile on a legal entity', () => {
    expect(() => normalizeRegistrationDocumentProfile(profile, 'pj')).toThrow();
  });
  it.each(['2039-01-01', '2026-02-30', 'not-a-date'])(
    'rejects impossible or future dependent date %s',
    (birthDate) => {
      expect(() =>
        normalizeRegistrationDocumentProfile(
          { ...profile, dependents: [{ name: 'Maria', birthDate }] },
          'pf',
        ),
      ).toThrow();
    },
  );
  it('normalizes address and rejects incomplete address', () => {
    expect(
      normalizeRegistrationAddress({
        street: ' Rua A ',
        number: '12',
        district: 'Centro',
        postalCode: '38400-000',
        city: 'Uberlândia',
        state: 'mg',
      }),
    ).toMatchObject({ street: 'Rua A', postalCode: '38400000', state: 'MG' });
    expect(() =>
      normalizeRegistrationAddress({
        street: '',
        number: '12',
        district: 'Centro',
        postalCode: '38400000',
        city: 'Uberlândia',
        state: 'MG',
      }),
    ).toThrow();
  });
});
