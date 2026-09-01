import { describe, expect, it } from 'vitest';

import {
  assertCanAttestCommercialServiceRequirement,
  assertCanConfirmCommercialService,
  normalizeCommercialServiceRequirementEvidence,
} from './confirmed-service';

describe('serviço confirmado', () => {
  it('exige autoridade comercial explícita, sem bypass administrativo', () => {
    expect(() =>
      assertCanConfirmCommercialService({
        departments: ['commercial'],
        permissions: ['commercial:manage'],
      }),
    ).not.toThrow();
    expect(() =>
      assertCanConfirmCommercialService({
        departments: [],
        permissions: [],
      }),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('separa os atestes Financeiro e Operacional', () => {
    expect(() =>
      assertCanAttestCommercialServiceRequirement(
        {
          departments: ['financial'],
          permissions: ['financial:approve'],
        },
        'financial',
      ),
    ).not.toThrow();
    expect(() =>
      assertCanAttestCommercialServiceRequirement(
        {
          departments: ['operations'],
          permissions: ['operations:manage'],
        },
        'operational',
      ),
    ).not.toThrow();
    expect(() =>
      assertCanAttestCommercialServiceRequirement(
        {
          departments: ['commercial'],
          permissions: ['commercial:manage'],
        },
        'financial',
      ),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('exige evidência explícita e não oferece dispensa automática', () => {
    expect(() =>
      normalizeCommercialServiceRequirementEvidence(''),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
});
