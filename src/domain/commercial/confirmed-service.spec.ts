import { describe, expect, it } from 'vitest';

import {
  assertCanMarkCommercialServiceRequirementNotApplicable,
  assertCanAttestCommercialServiceRequirement,
  assertCanConfirmCommercialService,
  assertCanViewCommercialServiceReadiness,
  COMMERCIAL_SERVICE_REQUIREMENT_OUTCOMES,
  normalizeCommercialServiceRequirementEvidence,
  normalizeCommercialServiceRequirementReason,
} from './confirmed-service';

describe('serviço confirmado', () => {
  it('mantém a confirmação comum no Comercial e permite a autoridade do tenant', () => {
    expect(() =>
      assertCanConfirmCommercialService({
        departments: ['commercial'],
        permissions: ['commercial:manage'],
      }),
    ).not.toThrow();
    expect(() =>
      assertCanConfirmCommercialService({
        isAdministrator: true,
        departments: [],
        permissions: [],
      }),
    ).not.toThrow();
    expect(() =>
      assertCanConfirmCommercialService({
        isAdministrator: false,
        departments: ['directorate'],
        permissionCodes: ['tenant:manage'],
        permissions: [],
      }),
    ).not.toThrow();
    expect(() =>
      assertCanConfirmCommercialService({
        departments: [],
        permissions: [],
      }),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('não permite que concessões legadas elevem uma conta do portal documental', () => {
    expect(() =>
      assertCanConfirmCommercialService({
        isAdministrator: false,
        documentAccessMode: 'document-portal',
        departments: ['directorate'],
        permissionCodes: ['tenant:manage'],
        permissions: ['tenant:manage', 'commercial:manage'],
      }),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('aplica o teto do Portal de Documentos em todas as decisões comerciais', () => {
    const portalAuthority = {
      isAdministrator: false,
      documentAccessMode: 'document-portal',
      departments: ['commercial', 'financial', 'operations', 'management'],
      permissionCodes: [
        'commercial:manage',
        'financial:approve',
        'operations:manage',
        'service-confirmations:approve',
      ],
      permissions: [
        'commercial:manage',
        'financial:approve',
        'operations:manage',
        'service-confirmations:approve',
      ],
    } as const;

    expect(() =>
      assertCanConfirmCommercialService(portalAuthority),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() =>
      assertCanAttestCommercialServiceRequirement(portalAuthority, 'financial'),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() =>
      assertCanAttestCommercialServiceRequirement(
        portalAuthority,
        'operational',
      ),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() =>
      assertCanMarkCommercialServiceRequirementNotApplicable(portalAuthority),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() =>
      assertCanViewCommercialServiceReadiness(portalAuthority),
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
          isAdministrator: false,
          departments: ['directorate'],
          permissionCodes: ['tenant:manage'],
          permissions: [],
        },
        'financial',
      ),
    ).not.toThrow();
    expect(() =>
      assertCanAttestCommercialServiceRequirement(
        {
          isAdministrator: true,
          departments: [],
          permissions: [],
        },
        'operational',
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

  it('modela o resultado explícito do requisito', () => {
    expect(COMMERCIAL_SERVICE_REQUIREMENT_OUTCOMES).toEqual([
      'SATISFIED',
      'NOT_APPLICABLE',
    ]);
  });

  it.each([
    {
      name: 'Gerência autorizada',
      authority: {
        isAdministrator: false,
        departments: ['management'],
        permissions: ['service-confirmations:approve'],
      },
    },
    {
      name: 'Diretoria autorizada',
      authority: {
        isAdministrator: false,
        departments: ['directorate'],
        permissionCodes: ['tenant:manage'],
        permissions: [],
      },
    },
    {
      name: 'Administradora',
      authority: {
        isAdministrator: true,
        departments: [],
        permissions: [],
      },
    },
  ])('permite marcar requisito não aplicável para $name', ({ authority }) => {
    expect(() =>
      assertCanMarkCommercialServiceRequirementNotApplicable(authority),
    ).not.toThrow();
  });

  it('rejeita dispensa por área operacional sem a autoridade estreita', () => {
    expect(() =>
      assertCanMarkCommercialServiceRequirementNotApplicable({
        isAdministrator: false,
        departments: ['operations'],
        permissions: ['operations:manage'],
      }),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('não transforma a permissão estreita em autoridade de Diretoria sem tenant:manage', () => {
    expect(() =>
      assertCanMarkCommercialServiceRequirementNotApplicable({
        isAdministrator: false,
        departments: ['directorate'],
        permissionCodes: ['service-confirmations:approve'],
        permissions: ['service-confirmations:approve'],
      }),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('permite à autoridade da exceção consultar o estado dos requisitos', () => {
    expect(() =>
      assertCanViewCommercialServiceReadiness({
        departments: ['management'],
        permissions: ['service-confirmations:approve'],
      }),
    ).not.toThrow();
    expect(() =>
      assertCanViewCommercialServiceReadiness({
        isAdministrator: false,
        departments: ['directorate'],
        permissionCodes: ['tenant:manage'],
        permissions: [],
      }),
    ).not.toThrow();
  });

  it('exige motivo explícito para requisito não aplicável', () => {
    expect(
      normalizeCommercialServiceRequirementReason('  Sem cobrança.  '),
    ).toBe('Sem cobrança.');
    expect(() =>
      normalizeCommercialServiceRequirementReason('  '),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
});
