import { describe, expect, it } from 'vitest';

import type { AppError } from '../../core/errors/app-error';
import {
  createRegistrationConsolidationPreview,
  prepareRegistrationConsolidationApplication,
  prepareRegistrationConsolidationReversal,
  type RegistrationConsolidationConfirmation,
  type RegistrationConsolidationPreviewInput,
  type RegistrationConsolidationTransferCandidate,
} from './registration-consolidation';

const companyId = '00000000-0000-4000-8000-000000000001';
const otherCompanyId = '00000000-0000-4000-8000-000000000002';
const principalId = '00000000-0000-4000-8000-000000000010';
const duplicateId = '00000000-0000-4000-8000-000000000011';
const actorUserId = '00000000-0000-4000-8000-000000000020';
const applicationCommandId = '00000000-0000-4000-8000-000000000030';
const reversalCommandId = '00000000-0000-4000-8000-000000000031';

const applicationEvidence: RegistrationConsolidationConfirmation = {
  companyId,
  type: 'pf',
  principalRegistrationId: principalId,
  duplicateRegistrationId: duplicateId,
  commandId: applicationCommandId,
  actorUserId,
  reason: 'Cadastros confirmados como representações da mesma pessoa.',
  confirmedAt: '2026-08-30T12:00:00.000Z',
  explicitlyConfirmed: true,
};

function transfer(
  overrides: Partial<RegistrationConsolidationTransferCandidate> = {},
): RegistrationConsolidationTransferCandidate {
  return {
    resourceType: 'registration-role',
    resourceId: 'role-1',
    referenceField: 'registrationId',
    companyId,
    fromRegistrationId: duplicateId,
    toRegistrationId: principalId,
    reversible: true,
    ...overrides,
  };
}

function previewInput(
  overrides: Partial<RegistrationConsolidationPreviewInput> = {},
): RegistrationConsolidationPreviewInput {
  return {
    companyId,
    principal: {
      id: principalId,
      companyId,
      type: 'pf',
      version: 3,
    },
    duplicate: {
      id: duplicateId,
      companyId,
      type: 'pf',
      version: 5,
    },
    transfers: [transfer()],
    applicationAvailable: true,
    ...overrides,
  };
}

describe('registration consolidation policy', () => {
  it('previews, prepares and reverses the same links with explicit audit evidence', () => {
    const preview = createRegistrationConsolidationPreview(previewInput());
    expect(preview).toMatchObject({
      status: 'preview',
      canApply: true,
      blockers: [],
      companyId,
      type: 'pf',
      principalRegistrationId: principalId,
      duplicateRegistrationId: duplicateId,
      expectedPrincipalVersion: 3,
      expectedDuplicateVersion: 5,
    });

    const application = prepareRegistrationConsolidationApplication(
      preview,
      applicationEvidence,
    );
    expect(application).toMatchObject({
      status: 'ready-to-apply',
      duplicateMarker: {
        registrationId: duplicateId,
        duplicateOfRegistrationId: principalId,
      },
      reversalRecipe: {
        requiresNewAuditedOperation: true,
        duplicateMarker: {
          registrationId: duplicateId,
          duplicateOfRegistrationId: null,
        },
      },
    });
    expect(application.transfers[0]).toMatchObject({
      fromRegistrationId: duplicateId,
      toRegistrationId: principalId,
    });
    expect(application.reversalRecipe.transfers[0]).toMatchObject({
      fromRegistrationId: principalId,
      toRegistrationId: duplicateId,
    });

    const reversal = prepareRegistrationConsolidationReversal(application, {
      companyId,
      principalRegistrationId: principalId,
      duplicateRegistrationId: duplicateId,
      expectedPrincipalVersion: 4,
      expectedDuplicateVersion: 6,
      collisionResourceKeys: [],
      evidence: {
        ...applicationEvidence,
        commandId: reversalCommandId,
        reason: 'Reversão confirmada após revisão manual.',
      },
    });
    expect(reversal).toMatchObject({
      status: 'ready-to-reverse',
      reversesCommandId: applicationCommandId,
      expectedPrincipalVersion: 4,
      expectedDuplicateVersion: 6,
      transfers: [
        {
          fromRegistrationId: principalId,
          toRegistrationId: duplicateId,
        },
      ],
    });
  });

  it('rejects equal or malformed Registration IDs', () => {
    expect(() =>
      createRegistrationConsolidationPreview(
        previewInput({
          duplicate: {
            id: principalId,
            companyId,
            type: 'pf',
            version: 1,
          },
          transfers: [],
        }),
      ),
    ).toThrow('IDs diferentes');

    expect(() =>
      createRegistrationConsolidationPreview(
        previewInput({
          principal: {
            id: 'not-a-uuid',
            companyId,
            type: 'pf',
            version: 1,
          },
        }),
      ),
    ).toThrow('UUID válido');
  });

  it('rejects cross-tenant or cross-type consolidation', () => {
    expect(() =>
      createRegistrationConsolidationPreview(
        previewInput({
          duplicate: {
            id: duplicateId,
            companyId: otherCompanyId,
            type: 'pf',
            version: 1,
          },
        }),
      ),
    ).toThrow('mesmo tenant');

    expect(() =>
      createRegistrationConsolidationPreview(
        previewInput({
          duplicate: {
            id: duplicateId,
            companyId,
            type: 'pj',
            version: 1,
          },
        }),
      ),
    ).toThrow('mesmo tipo');
  });

  it('rejects a candidate already marked as duplicate', () => {
    expect(() =>
      createRegistrationConsolidationPreview(
        previewInput({
          duplicate: {
            id: duplicateId,
            companyId,
            type: 'pf',
            version: 1,
            duplicateOfRegistrationId: principalId,
          },
        }),
      ),
    ).toThrow('já está marcado como duplicado');
  });

  it('rejects a transfer outside the tenant or in the wrong direction', () => {
    expect(() =>
      createRegistrationConsolidationPreview(
        previewInput({ transfers: [transfer({ companyId: otherCompanyId })] }),
      ),
    ).toThrow('tenant da consolidação');

    expect(() =>
      createRegistrationConsolidationPreview(
        previewInput({
          transfers: [
            transfer({
              fromRegistrationId: principalId,
              toRegistrationId: duplicateId,
            }),
          ],
        }),
      ),
    ).toThrow('sair do Cadastro duplicado');
  });

  it('exposes target collisions in preview and refuses application', () => {
    const preview = createRegistrationConsolidationPreview(
      previewInput({
        transfers: [
          transfer({ collisionWithResourceId: 'existing-role-at-target' }),
        ],
      }),
    );

    expect(preview).toMatchObject({
      canApply: false,
      blockers: [
        {
          code: 'target-collision',
          collisionWithResourceId: 'existing-role-at-target',
        },
      ],
    });
    expect(() =>
      prepareRegistrationConsolidationApplication(preview, applicationEvidence),
    ).toThrowError(
      expect.objectContaining<Partial<AppError>>({ code: 'CONFLICT' }),
    );
  });

  it('does not advertise execution while persistence adapters are unavailable', () => {
    const preview = createRegistrationConsolidationPreview(
      previewInput({ transfers: [], applicationAvailable: false }),
    );

    expect(preview).toMatchObject({
      canApply: false,
      blockers: [{ code: 'application-not-available' }],
    });
  });

  it('fails closed when application availability is missing at runtime', () => {
    const preview = createRegistrationConsolidationPreview(
      previewInput({
        transfers: [],
        applicationAvailable: undefined as never,
      }),
    );

    expect(preview).toMatchObject({
      canApply: false,
      blockers: [{ code: 'application-not-available' }],
    });
  });

  it('refuses duplicate and non-reversible transfer plans', () => {
    const duplicatedTransfer = transfer();
    const preview = createRegistrationConsolidationPreview(
      previewInput({
        transfers: [
          duplicatedTransfer,
          duplicatedTransfer,
          transfer({ resourceId: 'role-2', reversible: false }),
        ],
      }),
    );

    expect(preview.canApply).toBe(false);
    expect(preview.blockers.map((blocker) => blocker.code)).toEqual([
      'duplicate-transfer',
      'non-reversible-transfer',
    ]);
    expect(() =>
      prepareRegistrationConsolidationApplication(preview, applicationEvidence),
    ).toThrowError(
      expect.objectContaining<Partial<AppError>>({ code: 'CONFLICT' }),
    );
  });

  it('requires explicit evidence and a new command for reversal', () => {
    const application = prepareRegistrationConsolidationApplication(
      createRegistrationConsolidationPreview(previewInput()),
      applicationEvidence,
    );

    expect(() =>
      prepareRegistrationConsolidationApplication(
        createRegistrationConsolidationPreview(previewInput()),
        { ...applicationEvidence, explicitlyConfirmed: false },
      ),
    ).toThrow('confirmação explícita');

    expect(() =>
      prepareRegistrationConsolidationReversal(application, {
        companyId,
        principalRegistrationId: principalId,
        duplicateRegistrationId: duplicateId,
        expectedPrincipalVersion: 4,
        expectedDuplicateVersion: 6,
        collisionResourceKeys: [],
        evidence: applicationEvidence,
      }),
    ).toThrow('novo commandId');
  });

  it('rejects confirmation for IDs, tenant or type different from the preview', () => {
    const preview = createRegistrationConsolidationPreview(previewInput());

    expect(() =>
      prepareRegistrationConsolidationApplication(preview, {
        ...applicationEvidence,
        duplicateRegistrationId: principalId,
      }),
    ).toThrow('IDs exibidos no preview');
    expect(() =>
      prepareRegistrationConsolidationApplication(preview, {
        ...applicationEvidence,
        companyId: otherCompanyId,
      }),
    ).toThrow('tenant, o tipo e os IDs');
    expect(() =>
      prepareRegistrationConsolidationApplication(preview, {
        ...applicationEvidence,
        type: 'pj',
      }),
    ).toThrow('tenant, o tipo e os IDs');
  });

  it('refuses reversal when a fresh collision check finds conflicts', () => {
    const application = prepareRegistrationConsolidationApplication(
      createRegistrationConsolidationPreview(previewInput()),
      applicationEvidence,
    );

    expect(() =>
      prepareRegistrationConsolidationReversal(application, {
        companyId,
        principalRegistrationId: principalId,
        duplicateRegistrationId: duplicateId,
        expectedPrincipalVersion: 4,
        expectedDuplicateVersion: 6,
        collisionResourceKeys: ['registration-role:role-1'],
        evidence: { ...applicationEvidence, commandId: reversalCommandId },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AppError>>({ code: 'CONFLICT' }),
    );
  });
});
