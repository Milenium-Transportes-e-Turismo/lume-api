import { describe, it, expect } from 'vitest';
import {
  parseInput,
  parse,
  conditionSchema,
  assignmentSchema,
  validateInterval,
  assertDepartmentForSupplierDeactivation,
} from './transport-catalog.rules';
import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
const command = {
  commandId: '6b9b642a-0bf2-4d69-adf9-7a7f634659ef',
  expectedVersion: 0,
};
describe('transport catalog invariants', () => {
  it('accepts catalogs without a code and rejects user assigned codes on create and update', () => {
    const input = { ...command, kind: 'category', name: 'Leito' };
    expect(parseInput('catalogs', input, false)).toMatchObject(input);
    expect(() =>
      parseInput('catalogs', { ...input, code: 'leito' }, false),
    ).toThrow();
    expect(() =>
      parseInput(
        'catalogs',
        { ...command, expectedVersion: 1, code: '123' },
        true,
      ),
    ).toThrow();
  });
  it('normalizes and validates CNPJ while keeping the canonical identity', () => {
    expect(
      parseInput(
        'companies',
        {
          ...command,
          cnpj: '11.222.333/0001-81',
          legalName: 'Empresa',
          tradeName: 'Nome fantasia',
        },
        false,
      ).cnpj,
    ).toBe('11222333000181');
    expect(() =>
      parseInput(
        'companies',
        {
          ...command,
          cnpj: '11.222.333/0001-82',
          legalName: 'Empresa',
          tradeName: 'Nome fantasia',
        },
        false,
      ),
    ).toThrow('CNPJ');
  });
  it('does not silently accept invalid dates or inverted vigencies', () => {
    expect(() =>
      parse(assignmentSchema, {
        ...command,
        contractId: command.commandId,
        validFrom: '2026-02-30',
      }),
    ).toThrow('Data civil');
    expect(() => validateInterval('2026-09-08', '2026-09-07')).toThrow(
      'vigência',
    );
    expect(() => validateInterval('2026-09-08', '2026-09-08')).not.toThrow();
  });
  it('preserves absent franchise as absent, explicit zero as zero and millimetric km precision', () => {
    const base = {
      ...command,
      validFrom: '2026-09-01',
      period: 'monthly',
      includeGarage: true,
    };
    expect(parse(conditionSchema, base).allowanceKm).toBeUndefined();
    expect(
      parse(conditionSchema, { ...base, allowanceKm: null }).allowanceKm,
    ).toBeNull();
    expect(
      parse(conditionSchema, { ...base, allowanceKm: '0' }).allowanceKm,
    ).toBe('0');
    expect(
      parse(conditionSchema, { ...base, allowanceKm: '1234567890123.123' })
        .allowanceKm,
    ).toBe('1234567890123.123');
    expect(() =>
      parse(conditionSchema, { ...base, allowanceKm: 10 }),
    ).toThrow();
    expect(() =>
      parse(conditionSchema, { ...base, allowanceKm: '-1' }),
    ).toThrow();
  });
  it('keeps large external IDs textual and rejects numeric precision loss', () => {
    const fleet = {
      ...command,
      fleetCode: '99660',
      supplierRegistrationId: command.commandId,
      provider: 'avic',
      externalVehicleId: '9223372036854775807',
    };
    expect(parseInput('fleet', fleet, false).externalVehicleId).toBe(
      '9223372036854775807',
    );
    expect(() =>
      parseInput(
        'fleet',
        { ...fleet, externalVehicleId: Number('9223372036854775807') },
        false,
      ),
    ).toThrow();
  });
  it('requires a management department even for an administrator when deactivating suppliers', () => {
    const admin = {
      isAdministrator: true,
      departments: ['information-technology'],
    } as unknown as AuthenticatedPrincipal;
    expect(() => assertDepartmentForSupplierDeactivation(admin)).toThrow(
      'diretoria',
    );
    expect(() =>
      assertDepartmentForSupplierDeactivation({
        ...admin,
        departments: ['management'],
      }),
    ).not.toThrow();
  });
  it('does not accept tenant overrides or odometer editing in catalog commands', () => {
    expect(() =>
      parseInput(
        'fleet',
        {
          ...command,
          fleetCode: '1',
          supplierRegistrationId: command.commandId,
          companyId: command.commandId,
        },
        false,
      ),
    ).toThrow();
    expect(() =>
      parseInput(
        'fleet',
        { ...command, expectedVersion: 1, startKm: '1' },
        true,
      ),
    ).toThrow();
  });
});
