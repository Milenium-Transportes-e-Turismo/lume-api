import { describe, expect, it, vi } from 'vitest';

import { LegacyDocumentSubjectPreviewService } from './legacy-document-subject-preview.service';

const current = { id: 'actor-1', companyId: 'company-1' } as never;

function submission(
  input: {
    configSnapshot?: Readonly<Record<string, unknown>>;
    confirmedData?: Readonly<Record<string, unknown>>;
    extractedData?: Readonly<Record<string, unknown>>;
    routingCompanyId?: string | null;
    personRegistrationId?: string | null;
    personRegistration?: {
      id: string;
      companyId: string;
      clientType: 'PF' | 'PJ';
      cpf: string | null;
    } | null;
  } = {},
) {
  return {
    id: 'submission-1',
    requestItemId: 'item-1',
    confirmedData: input.confirmedData ?? {
      cpf: { value: '529.982.247-25' },
    },
    ...(input.extractedData ? { extractedData: input.extractedData } : {}),
    requestItem: {
      requestId: 'request-1',
      configSnapshot: input.configSnapshot ?? {
        repeatableByDependent: false,
        hasMultiplePotentialSubjects: false,
      },
      documentType: { code: 'cpf' },
      request: {
        id: 'request-1',
        context: 'ADMISSION',
        subject: {
          id: 'user-1',
          companyId: 'company-1',
          cpfNormalized: '52998224725',
          emailNormalized: 'pessoa@example.com',
          routingCompanyId: input.routingCompanyId ?? null,
          personRegistrationId: input.personRegistrationId ?? null,
          personRegistration: input.personRegistration ?? null,
        },
      },
    },
  };
}

function personCandidate() {
  return {
    registrationId: 'person-1',
    companyId: 'company-1',
    type: 'pf' as const,
    cpf: '52998224725',
    emails: ['pessoa@example.com'],
  };
}

function fixture(
  submissionResult: ReturnType<typeof submission> | null,
  candidates: readonly Readonly<Record<string, unknown>>[] = [],
) {
  const findUnique = vi.fn().mockResolvedValue(submissionResult);
  const findCandidates = vi.fn().mockResolvedValue(candidates);
  const service = new LegacyDocumentSubjectPreviewService(
    { documentSubmission: { findUnique } } as never,
    { findCandidates },
  );
  return { service, findUnique, findCandidates };
}

describe('LegacyDocumentSubjectPreviewService', () => {
  it('classifies a whitelisted document for the Person association already persisted on User', async () => {
    const { service } = fixture(
      submission({
        personRegistrationId: 'person-1',
        personRegistration: {
          id: 'person-1',
          companyId: 'company-1',
          clientType: 'PF',
          cpf: '52998224725',
        },
      }),
      [personCandidate()],
    );

    await expect(
      service.preview(current, 'submission-1'),
    ).resolves.toMatchObject({
      associationPreview: {
        decision: 'confirmed',
        personRegistrationId: 'person-1',
        rule: 'persisted-user-person-association',
      },
      classificationPreview: {
        classification: 'person',
        personRegistrationId: 'person-1',
        rule: 'legacy-person-subject-v1',
      },
    });
  });

  it('uses the canonical Person CPF as evidence for a persisted association', async () => {
    const { service } = fixture(
      submission({
        personRegistrationId: 'person-1',
        personRegistration: {
          id: 'person-1',
          companyId: 'company-1',
          clientType: 'PF',
          cpf: '16899535009',
        },
      }),
      [personCandidate()],
    );

    await expect(
      service.preview(current, 'submission-1'),
    ).resolves.toMatchObject({
      associationPreview: {
        decision: 'confirmed',
        personRegistrationId: 'person-1',
      },
      classificationPreview: {
        classification: 'legacy-unclassified',
        reason: 'cpf-evidence-mismatch',
      },
    });
  });

  it('keeps a persisted Person association without canonical CPF unclassified', async () => {
    const { service } = fixture(
      submission({
        personRegistrationId: 'person-1',
        personRegistration: {
          id: 'person-1',
          companyId: 'company-1',
          clientType: 'PF',
          cpf: null,
        },
      }),
      [personCandidate()],
    );

    await expect(
      service.preview(current, 'submission-1'),
    ).resolves.toMatchObject({
      associationPreview: {
        decision: 'confirmed',
        personRegistrationId: 'person-1',
      },
      classificationPreview: {
        classification: 'legacy-unclassified',
        reason: 'missing-person-cpf-evidence',
      },
    });
  });

  it.each([
    [
      'outro tenant',
      {
        id: 'person-1',
        companyId: 'company-2',
        clientType: 'PF' as const,
        cpf: '52998224725',
      },
    ],
    [
      'Empresa',
      {
        id: 'person-1',
        companyId: 'company-1',
        clientType: 'PJ' as const,
        cpf: '52998224725',
      },
    ],
  ])(
    'keeps an invalid persisted association to %s conflicted even when CPF suggests a Person',
    async (_label, personRegistration) => {
      const { service } = fixture(
        submission({
          personRegistrationId: 'person-1',
          personRegistration,
        }),
        [personCandidate()],
      );

      await expect(
        service.preview(current, 'submission-1'),
      ).resolves.toMatchObject({
        associationPreview: {
          decision: 'conflict',
          reason: 'persisted-person-association-invalid',
          conflictingRegistrationIds: ['person-1'],
        },
        classificationPreview: {
          classification: 'legacy-unclassified',
          reason: 'person-association-conflict',
        },
      });
    },
  );

  it('recommends the exact CPF match but keeps the subject unclassified until association is persisted', async () => {
    const { service } = fixture(submission(), [personCandidate()]);

    await expect(
      service.preview(current, 'submission-1'),
    ).resolves.toMatchObject({
      persisted: false,
      submissionId: 'submission-1',
      existingContextualLinkMeaning: null,
      associationPreview: {
        decision: 'automatic',
        personRegistrationId: 'person-1',
      },
      classificationPreview: {
        classification: 'legacy-unclassified',
        reason: 'person-association-not-confirmed',
      },
      evidence: {
        documentCpfSource: 'confirmed-data',
        repeatableByDependent: false,
        hasMultiplePotentialSubjects: false,
      },
    });
  });

  it('propagates a CPF attached to Empresa as an explicit conflict', async () => {
    const { service } = fixture(submission(), [
      {
        ...personCandidate(),
        registrationId: 'company-registration-1',
        type: 'pj',
      },
    ]);

    await expect(
      service.preview(current, 'submission-1'),
    ).resolves.toMatchObject({
      associationPreview: {
        decision: 'conflict',
        reason: 'cpf-associated-with-non-person',
        conflictingRegistrationIds: ['company-registration-1'],
      },
      classificationPreview: {
        classification: 'legacy-unclassified',
        reason: 'person-association-conflict',
      },
    });
  });

  it.each([
    [{ repeatableByDependent: false }, false, 'unknown'],
    [{ hasMultiplePotentialSubjects: false }, 'unknown', false],
    [{}, 'unknown', 'unknown'],
  ] as const)(
    'keeps missing multiplicity provenance conservative for config %j',
    async (
      configSnapshot,
      repeatableByDependent,
      hasMultiplePotentialSubjects,
    ) => {
      const { service } = fixture(submission({ configSnapshot }), [
        personCandidate(),
      ]);

      await expect(
        service.preview(current, 'submission-1'),
      ).resolves.toMatchObject({
        classificationPreview: {
          classification: 'legacy-unclassified',
          reason: 'subject-ambiguity-not-evaluated',
        },
        evidence: { repeatableByDependent, hasMultiplePotentialSubjects },
      });
    },
  );

  it('ignores raw OCR and exposes a contextual legacy link without using it as identity', async () => {
    const { service, findUnique } = fixture(
      submission({
        confirmedData: {},
        extractedData: { cpf: '52998224725' },
        routingCompanyId: 'legacy-scope-id',
      }),
    );

    await expect(
      service.preview(current, 'submission-1'),
    ).resolves.toMatchObject({
      existingContextualRegistrationId: 'legacy-scope-id',
      existingContextualLinkMeaning:
        'legacy-access-scope-not-person-association',
      associationPreview: {
        decision: 'provisional',
        reason: 'no-exact-cpf-match',
      },
      evidence: { documentCpfSource: null },
    });
    expect(findUnique.mock.calls[0][0].select.extractedData).toBeUndefined();
  });

  it('isolates the lookup by tenant and rejects an unknown submission', async () => {
    const { service, findUnique } = fixture(null);

    await expect(
      service.preview(current, 'submission-1'),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id_companyId: {
            id: 'submission-1',
            companyId: 'company-1',
          },
        },
      }),
    );
  });
});
