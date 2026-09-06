import { Injectable } from '@nestjs/common';

import { notFound } from '../../../core/errors/app-error';
import {
  classifyLegacyDocumentSubject,
  type LegacySubjectClassification,
  type LegacyPersonAssociation,
} from '../../../domain/documents/legacy-subject-classification';
import type { DocumentRequestContext } from '../../../domain/documents/document-workflow';
import {
  decideUserPersonMatch,
  LEGACY_CONTEXTUAL_REGISTRATION_LINK_MEANING,
  type UserPersonMatchDecision,
} from '../../../domain/identity/user-person-matching';
import {
  DocumentRequestContext as PrismaDocumentRequestContext,
  RoutingClientType,
  type Prisma,
} from '../../../infra/database/prisma/generated/client';
import { PrismaService } from '../../../infra/database/prisma/prisma.service';
import { RegistrationIdentityCandidateReader } from '../../contracts/registration-identity-candidate.reader';
import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';

const contextFromPrisma: Readonly<
  Record<PrismaDocumentRequestContext, DocumentRequestContext>
> = {
  ADMISSION: 'admission',
  DOCUMENT_UPDATE: 'document-update',
  DOCUMENT_RENEWAL: 'document-renewal',
  REGULARIZATION: 'regularization',
  OFFBOARDING: 'offboarding',
  OTHER: 'other',
};

function jsonRecord(
  value: Prisma.JsonValue | undefined,
): Record<string, Prisma.JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function confirmedCpf(value: Prisma.JsonValue): string | null {
  const fields = jsonRecord(value);
  const cpf = fields.cpf;
  const confirmedValue = jsonRecord(cpf).value ?? cpf;
  return typeof confirmedValue === 'string' ? confirmedValue : null;
}

type SubjectAmbiguitySignal = boolean | 'unknown';

type LegacyDocumentAssociationPreview =
  | UserPersonMatchDecision
  | {
      readonly decision: 'confirmed';
      readonly personRegistrationId: string;
      readonly rule:
        | 'persisted-user-person-association'
        | 'persisted-registration-document-subject';
    }
  | {
      readonly decision: 'conflict';
      readonly reason: 'persisted-person-association-invalid';
      readonly conflictingRegistrationIds: readonly string[];
      readonly emailSuggestions: readonly [];
    };

export interface LegacyDocumentSubjectPreviewResult {
  readonly persisted: false;
  readonly submissionId: string;
  readonly requestItemId: string;
  readonly requestId: string;
  readonly existingContextualRegistrationId: string | null;
  readonly existingContextualLinkMeaning:
    typeof LEGACY_CONTEXTUAL_REGISTRATION_LINK_MEANING | null;
  readonly associationPreview: LegacyDocumentAssociationPreview;
  readonly classificationPreview: LegacySubjectClassification;
  readonly evidence: {
    readonly documentCpfSource: 'confirmed-data' | null;
    readonly repeatableByDependent: SubjectAmbiguitySignal;
    readonly hasMultiplePotentialSubjects: SubjectAmbiguitySignal;
  };
}

function subjectAmbiguitySignals(config: Record<string, Prisma.JsonValue>): {
  repeatableByDependent: SubjectAmbiguitySignal;
  hasMultiplePotentialSubjects: SubjectAmbiguitySignal;
} {
  const repeatableByDependent =
    typeof config.repeatableByDependent === 'boolean'
      ? config.repeatableByDependent
      : ('unknown' as const);
  const hasMultiplePotentialSubjects =
    typeof config.hasMultiplePotentialSubjects === 'boolean'
      ? config.hasMultiplePotentialSubjects
      : Array.isArray(config.dependents)
        ? config.dependents.length > 0
        : ('unknown' as const);
  return { repeatableByDependent, hasMultiplePotentialSubjects };
}

@Injectable()
export class LegacyDocumentSubjectPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidates: RegistrationIdentityCandidateReader,
  ) {}

  async preview(
    current: AuthenticatedPrincipal,
    submissionId: string,
  ): Promise<LegacyDocumentSubjectPreviewResult> {
    const submission = await this.prisma.documentSubmission.findUnique({
      where: {
        id_companyId: { id: submissionId, companyId: current.companyId },
      },
      select: {
        id: true,
        requestItemId: true,
        confirmedData: true,
        requestItem: {
          select: {
            requestId: true,
            configSnapshot: true,
            documentType: { select: { code: true } },
            request: {
              select: {
                id: true,
                context: true,
                subjectRegistration: { select: { id: true, cpf: true } },
                subject: {
                  select: {
                    id: true,
                    companyId: true,
                    cpfNormalized: true,
                    emailNormalized: true,
                    routingCompanyId: true,
                    personRegistrationId: true,
                    personRegistration: {
                      select: {
                        id: true,
                        companyId: true,
                        clientType: true,
                        cpf: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!submission) throw notFound('Envio documental');

    const registration = submission.requestItem.request.subjectRegistration;
    if (registration) {
      const signals = subjectAmbiguitySignals(
        jsonRecord(submission.requestItem.configSnapshot),
      );
      const documentCpf = confirmedCpf(submission.confirmedData);
      return {
        persisted: false,
        submissionId: submission.id,
        requestItemId: submission.requestItemId,
        requestId: submission.requestItem.requestId,
        existingContextualRegistrationId: null,
        existingContextualLinkMeaning: null,
        associationPreview: {
          decision: 'confirmed',
          personRegistrationId: registration.id,
          rule: 'persisted-registration-document-subject',
        },
        classificationPreview: classifyLegacyDocumentSubject({
          documentTypeCode: submission.requestItem.documentType.code,
          requestContext:
            contextFromPrisma[submission.requestItem.request.context],
          personAssociation: {
            status: 'confirmed',
            personRegistrationId: registration.id,
            personCpf: registration.cpf,
          },
          documentCpf,
          ...signals,
        }),
        evidence: {
          documentCpfSource: documentCpf ? 'confirmed-data' : null,
          ...signals,
        },
      };
    }
    const subject = submission.requestItem.request.subject;
    if (!subject) throw notFound('Titular documental');
    const persistedPerson =
      subject.personRegistrationId &&
      subject.companyId === current.companyId &&
      subject.personRegistration?.id === subject.personRegistrationId &&
      subject.personRegistration.companyId === current.companyId &&
      subject.personRegistration.clientType === RoutingClientType.PF
        ? subject.personRegistration
        : null;
    let associationPreview: LegacyDocumentAssociationPreview;
    if (persistedPerson) {
      associationPreview = {
        decision: 'confirmed',
        personRegistrationId: persistedPerson.id,
        rule: 'persisted-user-person-association',
      };
    } else if (subject.personRegistrationId) {
      associationPreview = {
        decision: 'conflict',
        reason: 'persisted-person-association-invalid',
        conflictingRegistrationIds: [subject.personRegistrationId],
        emailSuggestions: [],
      };
    } else {
      const candidates = await this.candidates.findCandidates({
        companyId: current.companyId,
        cpf: subject.cpfNormalized,
        email: subject.emailNormalized,
      });
      associationPreview = decideUserPersonMatch({
        subject: {
          userId: subject.id,
          companyId: subject.companyId,
          cpf: subject.cpfNormalized,
          email: subject.emailNormalized,
        },
        candidates,
      });
    }
    const personAssociation: LegacyPersonAssociation = persistedPerson
      ? {
          status: 'confirmed',
          personRegistrationId: persistedPerson.id,
          personCpf: persistedPerson.cpf,
        }
      : associationPreview.decision === 'conflict'
        ? { status: 'conflict' }
        : associationPreview.decision === 'automatic'
          ? {
              status: 'provisional',
              personRegistrationId: associationPreview.personRegistrationId,
              personCpf: subject.cpfNormalized,
            }
          : { status: 'missing' };
    const config = jsonRecord(submission.requestItem.configSnapshot);
    const { repeatableByDependent, hasMultiplePotentialSubjects } =
      subjectAmbiguitySignals(config);
    const documentCpf = confirmedCpf(submission.confirmedData);
    const classificationPreview = classifyLegacyDocumentSubject({
      documentTypeCode: submission.requestItem.documentType.code,
      requestContext: contextFromPrisma[submission.requestItem.request.context],
      personAssociation,
      documentCpf,
      repeatableByDependent,
      hasMultiplePotentialSubjects,
    });

    return {
      persisted: false,
      submissionId: submission.id,
      requestItemId: submission.requestItemId,
      requestId: submission.requestItem.requestId,
      existingContextualRegistrationId: subject.routingCompanyId,
      existingContextualLinkMeaning: subject.routingCompanyId
        ? LEGACY_CONTEXTUAL_REGISTRATION_LINK_MEANING
        : null,
      associationPreview,
      classificationPreview,
      evidence: {
        documentCpfSource: documentCpf ? 'confirmed-data' : null,
        repeatableByDependent,
        hasMultiplePotentialSubjects,
      },
    };
  }
}
