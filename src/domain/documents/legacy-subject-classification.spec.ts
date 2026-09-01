import { describe, expect, it } from 'vitest';

import type { DocumentRequestContext } from './document-workflow';
import {
  classifyLegacyDocumentSubject,
  LEGACY_PERSON_SUBJECT_WHITELIST,
  type LegacyPersonAssociationStatus,
} from './legacy-subject-classification';

const confirmedPerson = {
  status: 'confirmed' as const,
  personRegistrationId: 'person-1',
  personCpf: '52998224725',
};
const unambiguousSubject = {
  repeatableByDependent: false,
  hasMultiplePotentialSubjects: false,
} as const;

describe('classifyLegacyDocumentSubject', () => {
  it.each(
    LEGACY_PERSON_SUBJECT_WHITELIST.flatMap((rule) =>
      rule.requestContexts.map(
        (requestContext) => [rule.documentTypeCode, requestContext] as const,
      ),
    ),
  )(
    'classifies whitelisted %s in %s for a confirmed Person',
    (documentTypeCode, requestContext) => {
      expect(
        classifyLegacyDocumentSubject({
          ...unambiguousSubject,
          documentTypeCode,
          requestContext,
          personAssociation: confirmedPerson,
        }),
      ).toEqual({
        classification: 'person',
        personRegistrationId: 'person-1',
        rule: 'legacy-person-subject-v1',
      });
    },
  );

  it('accepts matching normalized CPF evidence', () => {
    expect(
      classifyLegacyDocumentSubject({
        ...unambiguousSubject,
        documentTypeCode: 'cpf',
        requestContext: 'admission',
        personAssociation: confirmedPerson,
        documentCpf: '529.982.247-25',
      }),
    ).toMatchObject({ classification: 'person' });
  });

  it.each([
    'child-identification',
    'child-birth-certificate',
    'spouse-identification',
    'proof-of-address',
    'marriage-certificate',
  ])('keeps ambiguous type %s as legacy-unclassified', (documentTypeCode) => {
    expect(
      classifyLegacyDocumentSubject({
        ...unambiguousSubject,
        documentTypeCode,
        requestContext: 'admission',
        personAssociation: confirmedPerson,
      }),
    ).toEqual({
      classification: 'legacy-unclassified',
      reason: 'document-type-or-context-not-whitelisted',
    });
  });

  it('keeps the generic other context as legacy-unclassified', () => {
    expect(
      classifyLegacyDocumentSubject({
        ...unambiguousSubject,
        documentTypeCode: 'cpf',
        requestContext: 'other',
        personAssociation: confirmedPerson,
      }),
    ).toEqual({
      classification: 'legacy-unclassified',
      reason: 'document-type-or-context-not-whitelisted',
    });
  });

  it('does not classify repeatable or multi-subject documents', () => {
    expect(
      classifyLegacyDocumentSubject({
        ...unambiguousSubject,
        documentTypeCode: 'cpf',
        requestContext: 'admission',
        personAssociation: confirmedPerson,
        repeatableByDependent: true,
      }),
    ).toMatchObject({
      classification: 'legacy-unclassified',
      reason: 'repeatable-by-dependent',
    });

    expect(
      classifyLegacyDocumentSubject({
        ...unambiguousSubject,
        documentTypeCode: 'cpf',
        requestContext: 'admission',
        personAssociation: confirmedPerson,
        hasMultiplePotentialSubjects: true,
      }),
    ).toMatchObject({
      classification: 'legacy-unclassified',
      reason: 'multiple-potential-subjects',
    });
  });

  it.each([
    { repeatableByDependent: 'unknown' as const },
    { hasMultiplePotentialSubjects: 'unknown' as const },
  ])(
    'keeps the subject unclassified when ambiguity was not evaluated: %j',
    (unknownSignal) => {
      expect(
        classifyLegacyDocumentSubject({
          ...unambiguousSubject,
          ...unknownSignal,
          documentTypeCode: 'cpf',
          requestContext: 'admission',
          personAssociation: confirmedPerson,
        }),
      ).toEqual({
        classification: 'legacy-unclassified',
        reason: 'subject-ambiguity-not-evaluated',
      });
    },
  );

  it.each([
    ['provisional', 'person-association-not-confirmed'],
    ['missing', 'person-association-not-confirmed'],
    ['conflict', 'person-association-conflict'],
  ] as const)(
    'keeps a %s Person association as legacy-unclassified',
    (status, reason) => {
      expect(
        classifyLegacyDocumentSubject({
          ...unambiguousSubject,
          documentTypeCode: 'rg',
          requestContext: 'admission',
          personAssociation: {
            ...confirmedPerson,
            status: status satisfies LegacyPersonAssociationStatus,
          },
        }),
      ).toEqual({ classification: 'legacy-unclassified', reason });
    },
  );

  it('does not classify a confirmed association without a Person ID', () => {
    expect(
      classifyLegacyDocumentSubject({
        ...unambiguousSubject,
        documentTypeCode: 'rg',
        requestContext: 'admission',
        personAssociation: { status: 'confirmed' },
      }),
    ).toEqual({
      classification: 'legacy-unclassified',
      reason: 'missing-person-registration-id',
    });
  });

  it('does not classify invalid or contradictory CPF evidence', () => {
    expect(
      classifyLegacyDocumentSubject({
        ...unambiguousSubject,
        documentTypeCode: 'cpf',
        requestContext: 'admission',
        personAssociation: confirmedPerson,
        documentCpf: '111.111.111-11',
      }),
    ).toMatchObject({
      classification: 'legacy-unclassified',
      reason: 'invalid-cpf-evidence',
    });

    expect(
      classifyLegacyDocumentSubject({
        ...unambiguousSubject,
        documentTypeCode: 'cpf',
        requestContext: 'admission',
        personAssociation: confirmedPerson,
        documentCpf: '168.995.350-09',
      }),
    ).toMatchObject({
      classification: 'legacy-unclassified',
      reason: 'cpf-evidence-mismatch',
    });
  });

  it('rejects a malformed request context instead of treating it as evidence', () => {
    expect(() =>
      classifyLegacyDocumentSubject({
        ...unambiguousSubject,
        documentTypeCode: 'cpf',
        requestContext: 'unknown' as DocumentRequestContext,
        personAssociation: confirmedPerson,
      }),
    ).toThrow('contexto documental válido');
  });
});
