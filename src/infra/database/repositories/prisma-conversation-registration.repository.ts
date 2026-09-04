import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  ConversationRegistrationRepository,
  type ConversationIdentityResult,
  type ConversationRegistrationMutation,
  type ConversationRegistrationPatch,
  type PersonalDivergenceDecision,
  type RegistrationAbandonmentResult,
  type RegistrationConfirmationResult,
  type RegistrationConversationSource,
  type RegistrationDataReviewRecord,
  type RegistrationDataReviewStatus as ReviewStatusValue,
  type RegistrationDraftPreview,
  type RegistrationDraftPublicState,
  type RegistrationReviewDecisionResult,
} from '../../../application/contracts/conversation-registration.repository';
import {
  conflict,
  forbidden,
  notFound,
  validationError,
} from '../../../core/errors/app-error';
import {
  decideConversationRegistrationPersistence,
  decideRegistrationDivergence,
  relationshipGrantsAuthorization,
  resolveRegistrationIdentity,
  type ConversationRegistrationDraft,
  type ConversationRegistrationKind,
} from '../../../domain/registrations/conversation-registration';
import { normalizeRegistrationInput } from '../../../domain/registrations/registration';
import {
  normalizeEmail,
  normalizeTaxId,
  normalizeWhatsAppPhone,
} from '../../../shared/utils/normalization';
import {
  ConversationParticipantRole,
  Prisma,
  RegistrationDataReviewSource,
  RegistrationDataReviewStatus,
  RoutingClientType,
  RoutingCompanyStatus,
  ServiceCaseStatus,
  ServiceCaseType,
} from '../prisma/generated/client';
import { PrismaService } from '../prisma/prisma.service';

type TransactionClient = Prisma.TransactionClient;

const DRAFT_KIND = 'conversation-registration-draft';
const DRAFT_SCHEMA_VERSION = 1;

interface StoredDraft {
  readonly kind: ConversationRegistrationKind;
  readonly draftVersion: number;
  readonly person: {
    readonly name?: string;
    readonly cpf?: string;
    readonly email?: string | null;
    readonly phone?: string;
  };
  readonly company: {
    readonly legalName?: string;
    readonly cnpj?: string;
  };
  readonly relationship: {
    readonly type?: string;
    readonly jobTitle?: string | null;
    readonly department?: string | null;
  };
  readonly source: {
    readonly serviceSessionId: string;
    readonly whatsappContactId: string;
    readonly agentExecutionId: string | null;
  };
}

interface DraftRow {
  readonly id: string;
  readonly metadata: Prisma.JsonValue;
  readonly status: ServiceCaseStatus;
}

interface RegistrationSnapshot {
  readonly id: string;
  readonly clientType: RoutingClientType;
  readonly taxId: string;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly individualName: string | null;
  readonly cpf: string | null;
  readonly individualEmail: string | null;
  readonly individualWhatsapp: string | null;
  readonly cnpj: string | null;
  readonly legalEmail: string | null;
  readonly legalWhatsapp: string | null;
  readonly status: RoutingCompanyStatus;
  readonly version: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function fingerprint(value: Readonly<Record<string, unknown>>): string {
  return sha256(JSON.stringify(value));
}

function json(
  value: Readonly<Record<string, unknown>>,
): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

function record(
  value: Prisma.JsonValue | null | undefined,
): Record<string, Prisma.JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function stringValue(value: Prisma.JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function nullableStringValue(
  value: Prisma.JsonValue | undefined,
): string | null | undefined {
  return value === null ? null : stringValue(value);
}

function parseStoredDraft(row: DraftRow): StoredDraft {
  const metadata = record(row.metadata);
  const source = record(metadata.source);
  const person = record(metadata.person);
  const company = record(metadata.company);
  const relationship = record(metadata.relationship);
  const kind = metadata.registrationKind;
  const draftVersion = metadata.draftVersion;
  if (
    metadata.kind !== DRAFT_KIND ||
    metadata.schemaVersion !== DRAFT_SCHEMA_VERSION ||
    (kind !== 'personal' && kind !== 'company') ||
    typeof draftVersion !== 'number' ||
    !Number.isInteger(draftVersion) ||
    draftVersion < 1 ||
    typeof source.serviceSessionId !== 'string' ||
    typeof source.whatsappContactId !== 'string'
  ) {
    throw conflict('O draft de cadastro está inconsistente.');
  }
  return {
    kind,
    draftVersion,
    person: {
      ...(stringValue(person.name) ? { name: stringValue(person.name) } : {}),
      ...(stringValue(person.cpf) ? { cpf: stringValue(person.cpf) } : {}),
      ...(person.email === null || stringValue(person.email)
        ? { email: nullableStringValue(person.email) }
        : {}),
      ...(stringValue(person.phone)
        ? { phone: stringValue(person.phone) }
        : {}),
    },
    company: {
      ...(stringValue(company.legalName)
        ? { legalName: stringValue(company.legalName) }
        : {}),
      ...(stringValue(company.cnpj) ? { cnpj: stringValue(company.cnpj) } : {}),
    },
    relationship: {
      ...(stringValue(relationship.type)
        ? { type: stringValue(relationship.type) }
        : {}),
      ...(relationship.jobTitle === null || stringValue(relationship.jobTitle)
        ? { jobTitle: nullableStringValue(relationship.jobTitle) }
        : {}),
      ...(relationship.department === null ||
      stringValue(relationship.department)
        ? { department: nullableStringValue(relationship.department) }
        : {}),
    },
    source: {
      serviceSessionId: source.serviceSessionId,
      whatsappContactId: source.whatsappContactId,
      agentExecutionId: stringValue(source.agentExecutionId) ?? null,
    },
  };
}

function storedDraftJson(draft: StoredDraft): Prisma.InputJsonObject {
  return json({
    kind: DRAFT_KIND,
    schemaVersion: DRAFT_SCHEMA_VERSION,
    registrationKind: draft.kind,
    draftVersion: draft.draftVersion,
    person: draft.person,
    company: draft.company,
    relationship: draft.relationship,
    source: draft.source,
  });
}

function providedFields(draft: StoredDraft): string[] {
  return [
    ...(draft.person.name ? ['person.name'] : []),
    ...(draft.person.cpf ? ['person.cpf'] : []),
    ...(draft.person.email ? ['person.email'] : []),
    ...(draft.person.phone ? ['person.phone'] : []),
    ...(draft.company.legalName ? ['company.legalName'] : []),
    ...(draft.company.cnpj ? ['company.cnpj'] : []),
    ...(draft.relationship.type ? ['relationship.type'] : []),
    ...(draft.relationship.jobTitle ? ['relationship.jobTitle'] : []),
    ...(draft.relationship.department ? ['relationship.department'] : []),
  ];
}

function missingFields(draft: StoredDraft): string[] {
  return [
    ...(!draft.person.name ? ['person.name'] : []),
    ...(!draft.person.cpf ? ['person.cpf'] : []),
    ...(!draft.person.phone ? ['person.phone'] : []),
    ...(draft.kind === 'company' && !draft.company.legalName
      ? ['company.legalName']
      : []),
    ...(draft.kind === 'company' && !draft.company.cnpj
      ? ['company.cnpj']
      : []),
    ...(draft.kind === 'company' && !draft.relationship.type
      ? ['relationship.type']
      : []),
  ];
}

function publicDraft(
  draftId: string,
  draft: StoredDraft,
): RegistrationDraftPublicState {
  const missing = missingFields(draft);
  return {
    draftId,
    draftVersion: draft.draftVersion,
    kind: draft.kind,
    status: missing.length === 0 ? 'awaiting-confirmation' : 'draft',
    providedFields: providedFields(draft),
    missingFields: missing,
    registrationRequiredForQuote: false,
    continueOriginalDemand: true,
  };
}

function completeDomainDraft(
  draft: StoredDraft,
): ConversationRegistrationDraft {
  if (missingFields(draft).length > 0) {
    throw validationError(
      'Complete os campos obrigatórios antes do resumo final.',
    );
  }
  return {
    kind: draft.kind,
    person: {
      name: draft.person.name!,
      cpf: draft.person.cpf!,
      ...(draft.person.email ? { email: draft.person.email } : {}),
      phone: draft.person.phone!,
    },
    ...(draft.kind === 'company'
      ? {
          company: {
            legalName: draft.company.legalName!,
            cnpj: draft.company.cnpj!,
          },
          relationship: {
            type: draft.relationship.type!,
            ...(draft.relationship.jobTitle
              ? { jobTitle: draft.relationship.jobTitle }
              : {}),
            ...(draft.relationship.department
              ? { department: draft.relationship.department }
              : {}),
          },
        }
      : {}),
    confirmedByCustomer: false,
    abandoned: false,
  };
}

function mergeDraft(
  draft: StoredDraft,
  patch: ConversationRegistrationPatch,
): StoredDraft {
  return {
    ...draft,
    draftVersion: draft.draftVersion + 1,
    person: { ...draft.person, ...(patch.person ?? {}) },
    company: { ...draft.company, ...(patch.company ?? {}) },
    relationship: { ...draft.relationship, ...(patch.relationship ?? {}) },
  };
}

function registrationSnapshotJson(
  value: RegistrationSnapshot,
  audit?: Readonly<Record<string, unknown>>,
): Prisma.InputJsonObject {
  return json({
    id: value.id,
    clientType: value.clientType.toLowerCase(),
    taxId: value.taxId,
    legalName: value.legalName,
    tradeName: value.tradeName,
    firstName: value.firstName,
    lastName: value.lastName,
    individualName: value.individualName,
    cpf: value.cpf,
    individualEmail: value.individualEmail,
    individualWhatsapp: value.individualWhatsapp,
    cnpj: value.cnpj,
    legalEmail: value.legalEmail,
    legalWhatsapp: value.legalWhatsapp,
    status: value.status.toLowerCase(),
    version: value.version,
    ...(audit ? { audit } : {}),
  });
}

function reviewStatus(value: ReviewStatusValue): RegistrationDataReviewStatus {
  return RegistrationDataReviewStatus[
    value.toUpperCase() as keyof typeof RegistrationDataReviewStatus
  ];
}

function lower(value: string): string {
  return value.toLowerCase().replaceAll('_', '-');
}

@Injectable()
export class PrismaConversationRegistrationRepository extends ConversationRegistrationRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  private async lock(
    transaction: TransactionClient,
    key: string,
  ): Promise<void> {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${key}))
    `;
  }

  private async validateSource(
    transaction: TransactionClient,
    input: RegistrationConversationSource,
  ): Promise<{ readonly whatsappContactId: string; readonly phone: string }> {
    const session = await transaction.serviceSession.findFirst({
      where: { id: input.serviceSessionId, companyId: input.companyId },
      select: {
        id: true,
        thread: {
          select: {
            contact: {
              select: { id: true, phoneNormalized: true },
            },
          },
        },
      },
    });
    if (!session) throw notFound('Sessão de atendimento');
    if (session.thread.contact.id !== input.whatsappContactId) {
      throw forbidden('O contato não pertence a esta sessão de atendimento.');
    }
    if (input.agentExecutionId) {
      const execution = await transaction.agentExecution.findFirst({
        where: {
          id: input.agentExecutionId,
          companyId: input.companyId,
          serviceSessionId: input.serviceSessionId,
        },
        select: { id: true },
      });
      if (!execution) {
        throw forbidden('A execução do agente não pertence a esta sessão.');
      }
    }
    return {
      whatsappContactId: session.thread.contact.id,
      phone: session.thread.contact.phoneNormalized,
    };
  }

  private async command<T extends object>(
    input: ConversationRegistrationMutation,
    options: {
      readonly action: string;
      readonly targetType: string;
      readonly targetId: string;
      readonly fingerprint: string;
    },
    operation: (transaction: TransactionClient) => Promise<T>,
  ): Promise<T & { readonly idempotent: boolean }> {
    return this.prisma.$transaction(async (transaction) => {
      await this.lock(
        transaction,
        `${input.companyId}:registration-conversation:command:${input.commandId}`,
      );
      const duplicate = await transaction.tenantAuditLog.findFirst({
        where: {
          companyId: input.companyId,
          action: options.action,
          metadata: { path: ['commandId'], equals: input.commandId },
        },
        orderBy: { createdAt: 'desc' },
        select: { metadata: true },
      });
      if (duplicate) {
        const metadata = record(duplicate.metadata);
        if (metadata.fingerprint !== options.fingerprint) {
          throw conflict('commandId já foi usado para outra mutação.');
        }
        const result = record(metadata.result);
        if (Object.keys(result).length === 0) {
          throw conflict('A auditoria idempotente do cadastro está inválida.');
        }
        return { ...(result as unknown as T), idempotent: true };
      }
      await this.validateSource(transaction, input);
      const result = await operation(transaction);
      await transaction.tenantAuditLog.create({
        data: {
          companyId: input.companyId,
          actorUserId: null,
          action: options.action,
          targetType: options.targetType,
          targetId: options.targetId,
          metadata: json({
            commandId: input.commandId,
            fingerprint: options.fingerprint,
            result,
            source: 'WHATSAPP',
            serviceSessionId: input.serviceSessionId,
            whatsappContactId: input.whatsappContactId,
            agentExecutionId: input.agentExecutionId,
            confirmedByCustomer:
              options.action === 'registration.conversation.confirm',
          }),
        },
      });
      return { ...result, idempotent: false };
    });
  }

  private async draftRow(
    transaction: TransactionClient,
    input: RegistrationConversationSource & { readonly draftId: string },
  ): Promise<{ readonly row: DraftRow; readonly draft: StoredDraft }> {
    const row = await transaction.serviceCase.findFirst({
      where: {
        id: input.draftId,
        companyId: input.companyId,
        type: ServiceCaseType.OTHER,
        status: ServiceCaseStatus.OPEN,
        sessions: {
          some: {
            companyId: input.companyId,
            serviceSessionId: input.serviceSessionId,
          },
        },
      },
      select: { id: true, metadata: true, status: true },
    });
    if (!row) throw notFound('Draft de cadastro ativo');
    const draft = parseStoredDraft(row);
    if (
      draft.source.serviceSessionId !== input.serviceSessionId ||
      draft.source.whatsappContactId !== input.whatsappContactId
    ) {
      throw forbidden('O draft não pertence a este contato e sessão.');
    }
    return { row, draft };
  }

  async resolveIdentity(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
  }): Promise<ConversationIdentityResult> {
    return this.prisma.$transaction(async (transaction) => {
      await this.lock(
        transaction,
        `${input.companyId}:conversation-identity:${input.serviceSessionId}`,
      );
      const session = await transaction.serviceSession.findFirst({
        where: { id: input.serviceSessionId, companyId: input.companyId },
        select: {
          id: true,
          thread: {
            select: {
              contact: { select: { id: true, phoneNormalized: true } },
            },
          },
        },
      });
      if (!session) throw notFound('Sessão de atendimento');
      const contact = session.thread.contact;
      const [phones, participants] = await Promise.all([
        transaction.registrationPhone.findMany({
          where: {
            companyId: input.companyId,
            OR: [
              { whatsappContactId: contact.id },
              { normalizedValue: contact.phoneNormalized },
            ],
            registration: {
              is: { status: RoutingCompanyStatus.ACTIVE },
            },
          },
          select: { registrationId: true, whatsappContactId: true },
        }),
        transaction.conversationParticipant.findMany({
          where: {
            companyId: input.companyId,
            serviceSessionId: input.serviceSessionId,
            whatsappContactId: contact.id,
            validUntil: null,
            registrationId: { not: null },
          },
          select: {
            registrationId: true,
            confidence: true,
            confirmedAt: true,
          },
        }),
      ]);

      const candidates = new Map<
        string,
        {
          registrationId: string;
          confidence: number;
          contextConfirmed: boolean;
        }
      >();
      for (const phone of phones) {
        const confidence = phone.whatsappContactId === contact.id ? 0.98 : 0.8;
        const current = candidates.get(phone.registrationId);
        if (!current || current.confidence < confidence) {
          candidates.set(phone.registrationId, {
            registrationId: phone.registrationId,
            confidence,
            contextConfirmed: current?.contextConfirmed ?? false,
          });
        }
      }
      for (const participant of participants) {
        if (!participant.registrationId) continue;
        const confidence = Number(participant.confidence ?? 0.95);
        const current = candidates.get(participant.registrationId);
        candidates.set(participant.registrationId, {
          registrationId: participant.registrationId,
          confidence: Math.max(current?.confidence ?? 0, confidence),
          contextConfirmed:
            current?.contextConfirmed === true ||
            participant.confirmedAt !== null,
        });
      }
      const resolution = resolveRegistrationIdentity([...candidates.values()]);
      const activePrimary = await transaction.conversationParticipant.findFirst(
        {
          where: {
            companyId: input.companyId,
            serviceSessionId: input.serviceSessionId,
            isPrimary: true,
            validUntil: null,
          },
          select: { id: true, registrationId: true, role: true },
        },
      );

      if (resolution.status === 'resolved') {
        if (activePrimary?.registrationId !== resolution.registrationId) {
          const identifiedAt = new Date();
          await transaction.conversationParticipant.updateMany({
            where: {
              companyId: input.companyId,
              serviceSessionId: input.serviceSessionId,
              isPrimary: true,
              validUntil: null,
            },
            data: { isPrimary: false, validUntil: identifiedAt },
          });
          await transaction.conversationParticipant.create({
            data: {
              companyId: input.companyId,
              serviceSessionId: input.serviceSessionId,
              whatsappContactId: contact.id,
              registrationId: resolution.registrationId,
              role: ConversationParticipantRole.CUSTOMER,
              isPrimary: true,
              confidence: candidates.get(resolution.registrationId)?.confidence,
              identificationSource: 'server-registration-phone-resolution',
              metadata: {
                sharedPhoneCandidateCount: candidates.size,
                authorizationGranted: false,
              },
            },
          });
        }
        return {
          ...resolution,
          modelContext:
            'A identidade do interlocutor foi resolvida pelo servidor para esta sessão. Use apenas ferramentas autorizadas para consultar dados; não revele valores armazenados.',
          requiresDisambiguation: false,
          candidateCount: candidates.size,
        };
      }

      if (activePrimary?.registrationId) {
        const expiredAt = new Date();
        await transaction.conversationParticipant.updateMany({
          where: {
            companyId: input.companyId,
            serviceSessionId: input.serviceSessionId,
            isPrimary: true,
            validUntil: null,
          },
          data: { isPrimary: false, validUntil: expiredAt },
        });
      }
      if (!activePrimary || activePrimary.registrationId !== null) {
        await transaction.conversationParticipant.create({
          data: {
            companyId: input.companyId,
            serviceSessionId: input.serviceSessionId,
            whatsappContactId: contact.id,
            registrationId: null,
            role: ConversationParticipantRole.UNKNOWN,
            isPrimary: true,
            confidence: null,
            identificationSource:
              resolution.status === 'ambiguous'
                ? 'shared-phone-requires-disambiguation'
                : 'unknown-contact',
            metadata: {
              sharedPhoneCandidateCount: candidates.size,
              authorizationGranted: false,
            },
          },
        });
      }
      return {
        ...resolution,
        modelContext:
          resolution.status === 'ambiguous'
            ? 'Este telefone pode representar mais de uma pessoa. Não assuma uma identidade e não cite dados armazenados; peça somente os dados mínimos que o interlocutor possa fornecer para desambiguação.'
            : 'O contato ainda não possui identidade cadastral resolvida. Atenda normalmente; cadastro é opcional e não pode bloquear orçamento.',
        requiresDisambiguation: resolution.status === 'ambiguous',
        candidateCount: candidates.size,
      };
    });
  }

  startDraft(
    input: ConversationRegistrationMutation & {
      readonly kind: ConversationRegistrationKind;
    },
  ): Promise<RegistrationDraftPublicState> {
    const commandFingerprint = fingerprint({
      companyId: input.companyId,
      serviceSessionId: input.serviceSessionId,
      whatsappContactId: input.whatsappContactId,
      agentExecutionId: input.agentExecutionId,
      kind: input.kind,
    });
    return this.command(
      input,
      {
        action: 'registration.conversation.start',
        targetType: 'service-session',
        targetId: input.serviceSessionId,
        fingerprint: commandFingerprint,
      },
      async (transaction) => {
        await this.lock(
          transaction,
          `${input.companyId}:registration-conversation:session:${input.serviceSessionId}`,
        );
        const existing = await transaction.serviceCase.findFirst({
          where: {
            companyId: input.companyId,
            type: ServiceCaseType.OTHER,
            status: ServiceCaseStatus.OPEN,
            metadata: { path: ['kind'], equals: DRAFT_KIND },
            sessions: {
              some: {
                companyId: input.companyId,
                serviceSessionId: input.serviceSessionId,
              },
            },
          },
          select: { id: true },
        });
        if (existing) {
          throw conflict('A sessão já possui um draft de cadastro ativo.');
        }
        const draftId = randomUUID();
        const draft: StoredDraft = {
          kind: input.kind,
          draftVersion: 1,
          person: {},
          company: {},
          relationship: {},
          source: {
            serviceSessionId: input.serviceSessionId,
            whatsappContactId: input.whatsappContactId,
            agentExecutionId: input.agentExecutionId,
          },
        };
        await transaction.serviceCase.create({
          data: {
            id: draftId,
            companyId: input.companyId,
            type: ServiceCaseType.OTHER,
            status: ServiceCaseStatus.OPEN,
            title: 'Cadastro pela conversa',
            externalReference: `registration-conversation:${draftId}`,
            metadata: storedDraftJson(draft),
            createdByAgentExecutionId: input.agentExecutionId,
          },
        });
        await transaction.serviceSessionCase.create({
          data: {
            companyId: input.companyId,
            serviceSessionId: input.serviceSessionId,
            caseId: draftId,
            isPrimary: false,
          },
        });
        return publicDraft(draftId, draft);
      },
    );
  }

  updateDraft(
    input: ConversationRegistrationMutation & {
      readonly draftId: string;
      readonly expectedDraftVersion: number;
      readonly patch: ConversationRegistrationPatch;
    },
  ): Promise<RegistrationDraftPublicState> {
    return this.command(
      input,
      {
        action: 'registration.conversation.update-draft',
        targetType: 'registration-conversation-draft',
        targetId: input.draftId,
        fingerprint: fingerprint({
          companyId: input.companyId,
          draftId: input.draftId,
          expectedDraftVersion: input.expectedDraftVersion,
          patchSha256: sha256(JSON.stringify(input.patch)),
        }),
      },
      async (transaction) => {
        await this.lock(
          transaction,
          `${input.companyId}:registration-conversation:draft:${input.draftId}`,
        );
        const { draft } = await this.draftRow(transaction, input);
        if (draft.draftVersion !== input.expectedDraftVersion) {
          throw conflict('O draft foi alterado por outra operação.');
        }
        const updated = mergeDraft(draft, input.patch);
        const changed = await transaction.serviceCase.updateMany({
          where: {
            id: input.draftId,
            companyId: input.companyId,
            status: ServiceCaseStatus.OPEN,
          },
          data: { metadata: storedDraftJson(updated) },
        });
        if (changed.count !== 1) {
          throw conflict('O draft foi concluído por outra operação.');
        }
        return publicDraft(input.draftId, updated);
      },
    );
  }

  async readDraftState(
    input: RegistrationConversationSource & { readonly draftId: string },
  ): Promise<RegistrationDraftPublicState> {
    return this.prisma.$transaction(async (transaction) => {
      await this.validateSource(transaction, input);
      const { draft } = await this.draftRow(transaction, input);
      return publicDraft(input.draftId, draft);
    });
  }

  async previewDraft(
    input: RegistrationConversationSource & { readonly draftId: string },
  ): Promise<RegistrationDraftPreview> {
    return this.prisma.$transaction(async (transaction) => {
      await this.validateSource(transaction, input);
      const { draft } = await this.draftRow(transaction, input);
      const domainDraft = completeDomainDraft(draft);
      const persistence =
        decideConversationRegistrationPersistence(domainDraft);
      if (persistence.action !== 'await-confirmation') {
        throw conflict('O draft não está pronto para confirmação.');
      }
      const cpf = normalizeTaxId(domainDraft.person.cpf);
      const existingPerson = await transaction.routingCompany.findFirst({
        where: {
          companyId: input.companyId,
          cpf,
          clientType: RoutingClientType.PF,
        },
        select: {
          id: true,
          legalName: true,
          individualEmail: true,
          individualWhatsapp: true,
        },
      });
      const requiredFieldDecisions: RegistrationDraftPreview['requiredFieldDecisions'][number][] =
        [];
      if (existingPerson) {
        const comparisons = [
          {
            field: 'name' as const,
            existing: existingPerson.legalName,
            proposed: domainDraft.person.name,
          },
          ...(domainDraft.person.email
            ? [
                {
                  field: 'email' as const,
                  existing: existingPerson.individualEmail,
                  proposed: normalizeEmail(domainDraft.person.email),
                },
              ]
            : []),
          {
            field: 'phone' as const,
            existing: existingPerson.individualWhatsapp,
            proposed: normalizeWhatsAppPhone(domainDraft.person.phone),
          },
        ];
        for (const comparison of comparisons) {
          const decision = decideRegistrationDivergence({
            registrationKind: 'personal',
            field: comparison.field,
            existingValue: comparison.existing,
            proposedValue: comparison.proposed,
          });
          if (decision.action === 'ask-explicit-confirmation') {
            requiredFieldDecisions.push({
              field: comparison.field,
              message: decision.message,
            });
          }
        }
      }
      const organizationReviewsToCreate: RegistrationDraftPreview['organizationReviewsToCreate'][number][] =
        [];
      if (domainDraft.kind === 'company') {
        const cnpj = normalizeTaxId(domainDraft.company!.cnpj);
        const existingCompany = await transaction.routingCompany.findFirst({
          where: {
            companyId: input.companyId,
            cnpj,
            clientType: RoutingClientType.PJ,
          },
          select: { legalName: true },
        });
        if (existingCompany) {
          const decision = decideRegistrationDivergence({
            registrationKind: 'company',
            field: 'legalName',
            existingValue: existingCompany.legalName,
            proposedValue: domainDraft.company!.legalName,
          });
          if (decision.action === 'create-data-review') {
            organizationReviewsToCreate.push({
              field: 'legalName',
              message:
                'Há uma divergência em dado organizacional. A proposta seguirá para revisão humana sem alterar o cadastro atual.',
            });
          }
        }
      }
      return {
        ...publicDraft(input.draftId, draft),
        customerProvidedSummary: persistence.summary,
        requiredFieldDecisions,
        organizationReviewsToCreate,
      };
    });
  }

  private async selectRegistration(
    transaction: TransactionClient,
    companyId: string,
    registrationId: string,
  ): Promise<RegistrationSnapshot> {
    const row = await transaction.routingCompany.findFirst({
      where: { id: registrationId, companyId },
      select: {
        id: true,
        clientType: true,
        taxId: true,
        legalName: true,
        tradeName: true,
        firstName: true,
        lastName: true,
        individualName: true,
        cpf: true,
        individualEmail: true,
        individualWhatsapp: true,
        cnpj: true,
        legalEmail: true,
        legalWhatsapp: true,
        status: true,
        version: true,
      },
    });
    if (!row) throw notFound('Cadastro');
    return row;
  }

  private async ensureClientRole(
    transaction: TransactionClient,
    companyId: string,
    registrationId: string,
  ): Promise<void> {
    const role = await transaction.registrationRole.upsert({
      where: { companyId_code: { companyId, code: 'client' } },
      create: {
        companyId,
        code: 'client',
        name: 'Cliente',
        isSystem: true,
        active: true,
      },
      update: { active: true },
      select: { id: true },
    });
    await transaction.registrationRoleAssignment.upsert({
      where: {
        companyId_registrationId_roleId: {
          companyId,
          registrationId,
          roleId: role.id,
        },
      },
      create: { companyId, registrationId, roleId: role.id },
      update: {},
    });
  }

  private async createRegistration(
    transaction: TransactionClient,
    input: {
      readonly companyId: string;
      readonly type: 'pf' | 'pj';
      readonly name: string;
      readonly taxDocument: string;
      readonly phone?: string;
      readonly email?: string;
      readonly whatsappContactId?: string;
      readonly audit: Readonly<Record<string, unknown>>;
    },
  ): Promise<RegistrationSnapshot> {
    const registrationId = randomUUID();
    const normalized = normalizeRegistrationInput(
      input.type === 'pf'
        ? {
            type: 'pf',
            firstName: input.name,
            cpf: input.taxDocument,
            roleCodes: ['client'],
            phones: [
              {
                number: input.phone!,
                isPrimary: true,
                hasWhatsApp: true,
                whatsappContactId: input.whatsappContactId,
              },
            ],
            ...(input.email
              ? {
                  emails: [
                    { address: input.email, isPrimary: true, type: 'personal' },
                  ],
                }
              : {}),
          }
        : {
            type: 'pj',
            legalName: input.name,
            cnpj: input.taxDocument,
            roleCodes: ['client'],
          },
      registrationId,
    );
    await transaction.routingCompany.create({
      data: {
        id: registrationId,
        companyId: input.companyId,
        taxId: normalized.taxId,
        legalName: normalized.legalName,
        tradeName: normalized.tradeName,
        clientType:
          normalized.type === 'pf'
            ? RoutingClientType.PF
            : RoutingClientType.PJ,
        firstName: normalized.firstName,
        lastName: normalized.lastName,
        individualName: normalized.individualName,
        cpf: normalized.cpf,
        individualEmail: normalized.individualEmail,
        individualWhatsapp: normalized.individualWhatsapp,
        individualPhones: normalized.individualPhones,
        cnpj: normalized.cnpj,
        legalEmail: normalized.legalEmail,
        legalWhatsapp: normalized.legalWhatsapp,
        legalPhones: normalized.legalPhones,
        status: RoutingCompanyStatus.ACTIVE,
      },
    });
    for (const phone of normalized.phones) {
      await transaction.registrationPhone.create({
        data: {
          companyId: input.companyId,
          registrationId,
          originalValue: phone.originalValue,
          normalizedValue: phone.normalizedValue,
          countryCode: phone.countryCode,
          areaCode: phone.areaCode,
          number: phone.number,
          type: phone.type,
          isPrimary: phone.isPrimary,
          hasWhatsApp: phone.hasWhatsApp,
          whatsappContactId: phone.whatsappContactId,
        },
      });
    }
    for (const email of normalized.emails) {
      await transaction.registrationEmail.create({
        data: {
          companyId: input.companyId,
          registrationId,
          address: email.address,
          type: email.type,
          isPrimary: email.isPrimary,
        },
      });
    }
    await this.ensureClientRole(transaction, input.companyId, registrationId);
    const created = await this.selectRegistration(
      transaction,
      input.companyId,
      registrationId,
    );
    await transaction.routingCompanyHistory.create({
      data: {
        companyId: input.companyId,
        routingCompanyId: registrationId,
        actorUserId: null,
        commandId: randomUUID(),
        action: 'registration.conversation.create',
        beforeSnapshot: Prisma.JsonNull,
        afterSnapshot: registrationSnapshotJson(created, input.audit),
      },
    });
    return created;
  }

  private async updateExistingPerson(
    transaction: TransactionClient,
    input: {
      readonly companyId: string;
      readonly registration: RegistrationSnapshot;
      readonly domainDraft: ConversationRegistrationDraft;
      readonly fieldDecisions: Readonly<
        Partial<Record<'name' | 'email' | 'phone', PersonalDivergenceDecision>>
      >;
      readonly whatsappContactId: string | null;
      readonly audit: Readonly<Record<string, unknown>>;
    },
  ): Promise<RegistrationSnapshot> {
    const updates: Prisma.RoutingCompanyUpdateManyMutationInput = {};
    let changed = false;
    const nameDecision = decideRegistrationDivergence({
      registrationKind: 'personal',
      field: 'name',
      existingValue: input.registration.legalName,
      proposedValue: input.domainDraft.person.name,
    });
    if (nameDecision.action === 'ask-explicit-confirmation') {
      const answer = input.fieldDecisions.name;
      if (!answer) {
        throw validationError(
          'Confirme ou mantenha o nome antes de concluir o cadastro.',
        );
      }
      if (answer === 'replace') {
        const normalized = normalizeRegistrationInput(
          {
            type: 'pf',
            firstName: input.domainDraft.person.name,
            cpf: input.registration.cpf,
            roleCodes: ['client'],
            phones: [
              {
                number:
                  input.registration.individualWhatsapp ??
                  input.domainDraft.person.phone,
              },
            ],
          },
          input.registration.id,
        );
        updates.firstName = normalized.firstName;
        updates.lastName = normalized.lastName;
        updates.individualName = normalized.individualName;
        updates.legalName = normalized.legalName;
        changed = true;
      }
    }

    const proposedEmail = input.domainDraft.person.email
      ? normalizeEmail(input.domainDraft.person.email)
      : null;
    if (proposedEmail) {
      const emailDecision = decideRegistrationDivergence({
        registrationKind: 'personal',
        field: 'email',
        existingValue: input.registration.individualEmail,
        proposedValue: proposedEmail,
      });
      if (emailDecision.action === 'ask-explicit-confirmation') {
        const answer = input.fieldDecisions.email;
        if (!answer) {
          throw validationError(
            'Confirme ou mantenha o e-mail antes de concluir o cadastro.',
          );
        }
        if (answer === 'replace') {
          updates.individualEmail = proposedEmail;
          changed = true;
          await transaction.registrationEmail.updateMany({
            where: {
              companyId: input.companyId,
              registrationId: input.registration.id,
              isPrimary: true,
            },
            data: { isPrimary: false },
          });
          await transaction.registrationEmail.upsert({
            where: {
              companyId_registrationId_address: {
                companyId: input.companyId,
                registrationId: input.registration.id,
                address: proposedEmail,
              },
            },
            create: {
              companyId: input.companyId,
              registrationId: input.registration.id,
              address: proposedEmail,
              type: 'personal',
              isPrimary: true,
            },
            update: { isPrimary: true, type: 'personal' },
          });
        }
      }
    }

    const proposedPhone = normalizeWhatsAppPhone(
      input.domainDraft.person.phone,
    );
    const phoneDecision = decideRegistrationDivergence({
      registrationKind: 'personal',
      field: 'phone',
      existingValue: input.registration.individualWhatsapp,
      proposedValue: proposedPhone,
    });
    if (phoneDecision.action === 'ask-explicit-confirmation') {
      const answer = input.fieldDecisions.phone;
      if (!answer) {
        throw validationError(
          'Confirme ou mantenha o telefone antes de concluir o cadastro.',
        );
      }
      if (answer === 'replace') {
        const normalized = normalizeRegistrationInput(
          {
            type: 'pf',
            firstName: input.registration.legalName,
            cpf: input.registration.cpf,
            roleCodes: ['client'],
            phones: [
              {
                number: input.domainDraft.person.phone,
                isPrimary: true,
                hasWhatsApp: true,
                whatsappContactId: input.whatsappContactId,
              },
            ],
          },
          input.registration.id,
        );
        const phone = normalized.phones[0];
        updates.individualWhatsapp = phone.normalizedValue;
        changed = true;
        const endedOn = new Date();
        endedOn.setUTCHours(0, 0, 0, 0);
        await transaction.registrationPhone.updateMany({
          where: {
            companyId: input.companyId,
            registrationId: input.registration.id,
            isPrimary: true,
            activeUntil: null,
          },
          data: { isPrimary: false, activeUntil: endedOn },
        });
        await transaction.registrationPhone.upsert({
          where: {
            companyId_registrationId_normalizedValue: {
              companyId: input.companyId,
              registrationId: input.registration.id,
              normalizedValue: phone.normalizedValue,
            },
          },
          create: {
            companyId: input.companyId,
            registrationId: input.registration.id,
            originalValue: phone.originalValue,
            normalizedValue: phone.normalizedValue,
            countryCode: phone.countryCode,
            areaCode: phone.areaCode,
            number: phone.number,
            type: phone.type,
            isPrimary: true,
            hasWhatsApp: true,
            whatsappContactId: input.whatsappContactId,
          },
          update: {
            originalValue: phone.originalValue,
            countryCode: phone.countryCode,
            areaCode: phone.areaCode,
            number: phone.number,
            type: phone.type,
            isPrimary: true,
            hasWhatsApp: true,
            whatsappContactId: input.whatsappContactId,
            activeUntil: null,
          },
        });
      }
    } else {
      await transaction.registrationPhone.updateMany({
        where: {
          companyId: input.companyId,
          registrationId: input.registration.id,
          normalizedValue: proposedPhone,
        },
        data: {
          hasWhatsApp: true,
          ...(input.whatsappContactId
            ? { whatsappContactId: input.whatsappContactId }
            : {}),
        },
      });
    }

    if (!changed) {
      await this.ensureClientRole(
        transaction,
        input.companyId,
        input.registration.id,
      );
      return input.registration;
    }
    const changedRow = await transaction.routingCompany.updateMany({
      where: {
        id: input.registration.id,
        companyId: input.companyId,
        version: input.registration.version,
      },
      data: { ...updates, version: { increment: 1 } },
    });
    if (changedRow.count !== 1) {
      throw conflict('O Cadastro foi alterado por outra operação.');
    }
    const after = await this.selectRegistration(
      transaction,
      input.companyId,
      input.registration.id,
    );
    await transaction.routingCompanyHistory.create({
      data: {
        companyId: input.companyId,
        routingCompanyId: input.registration.id,
        actorUserId: null,
        commandId: randomUUID(),
        action: 'registration.conversation.confirmed-update',
        beforeSnapshot: registrationSnapshotJson(input.registration),
        afterSnapshot: registrationSnapshotJson(after, input.audit),
      },
    });
    await this.ensureClientRole(
      transaction,
      input.companyId,
      input.registration.id,
    );
    return after;
  }

  confirmDraft(
    input: ConversationRegistrationMutation & {
      readonly draftId: string;
      readonly expectedDraftVersion: number;
      readonly customerConfirmedFinalSummary: true;
      readonly fieldDecisions: Readonly<
        Partial<Record<'name' | 'email' | 'phone', PersonalDivergenceDecision>>
      >;
    },
  ): Promise<RegistrationConfirmationResult> {
    return this.command(
      input,
      {
        action: 'registration.conversation.confirm',
        targetType: 'registration-conversation-draft',
        targetId: input.draftId,
        fingerprint: fingerprint({
          companyId: input.companyId,
          draftId: input.draftId,
          expectedDraftVersion: input.expectedDraftVersion,
          customerConfirmedFinalSummary: true,
          fieldDecisions: input.fieldDecisions,
        }),
      },
      async (transaction) => {
        await this.lock(
          transaction,
          `${input.companyId}:registration-conversation:draft:${input.draftId}`,
        );
        const { draft } = await this.draftRow(transaction, input);
        if (draft.draftVersion !== input.expectedDraftVersion) {
          throw conflict('O draft foi alterado por outra operação.');
        }
        const domainDraft = completeDomainDraft(draft);
        const confirmedDomainDraft: ConversationRegistrationDraft = {
          ...domainDraft,
          confirmedByCustomer: true,
        };
        const persistence =
          decideConversationRegistrationPersistence(confirmedDomainDraft);
        if (
          persistence.action !== 'persist-person' &&
          persistence.action !== 'persist-person-company-relationship'
        ) {
          throw conflict('O draft não pode ser persistido.');
        }

        const cpf = persistence.normalized.cpf;
        await this.lock(
          transaction,
          `${input.companyId}:registration:cpf:${cpf}`,
        );
        const identifiedPerson =
          await transaction.conversationParticipant.findFirst({
            where: {
              companyId: input.companyId,
              serviceSessionId: input.serviceSessionId,
              whatsappContactId: input.whatsappContactId,
              registrationId: { not: null },
              validUntil: null,
              registration: { is: { clientType: RoutingClientType.PF } },
            },
            select: { registration: { select: { cpf: true } } },
          });
        if (
          identifiedPerson?.registration?.cpf &&
          identifiedPerson.registration?.cpf !== cpf
        ) {
          throw validationError(
            'O CPF informado não corresponde à identidade confirmada nesta sessão. CPF não pode ser substituído.',
          );
        }
        const existingPersonRow = await transaction.routingCompany.findFirst({
          where: {
            companyId: input.companyId,
            cpf,
            clientType: RoutingClientType.PF,
          },
          select: {
            id: true,
            clientType: true,
            taxId: true,
            legalName: true,
            tradeName: true,
            firstName: true,
            lastName: true,
            individualName: true,
            cpf: true,
            individualEmail: true,
            individualWhatsapp: true,
            cnpj: true,
            legalEmail: true,
            legalWhatsapp: true,
            status: true,
            version: true,
          },
        });
        const contact = await transaction.whatsAppContact.findFirst({
          where: {
            id: input.whatsappContactId,
            companyId: input.companyId,
          },
          select: { phoneNormalized: true },
        });
        if (!contact) throw notFound('Contato do WhatsApp');
        const proposedPhone = normalizeWhatsAppPhone(
          confirmedDomainDraft.person.phone,
        );
        const linkedContactId =
          contact.phoneNormalized === proposedPhone
            ? input.whatsappContactId
            : undefined;
        const audit = {
          source: 'WHATSAPP',
          agentExecutionId: input.agentExecutionId,
          serviceSessionId: input.serviceSessionId,
          whatsappContactId: input.whatsappContactId,
          confirmedByCustomer: true,
        };
        const person = existingPersonRow
          ? await this.updateExistingPerson(transaction, {
              companyId: input.companyId,
              registration: existingPersonRow,
              domainDraft: confirmedDomainDraft,
              fieldDecisions: input.fieldDecisions,
              whatsappContactId: linkedContactId ?? null,
              audit,
            })
          : await this.createRegistration(transaction, {
              companyId: input.companyId,
              type: 'pf',
              name: persistence.normalized.personName,
              taxDocument: cpf,
              phone: persistence.normalized.phone,
              ...(persistence.normalized.email
                ? { email: persistence.normalized.email }
                : {}),
              ...(linkedContactId
                ? { whatsappContactId: linkedContactId }
                : {}),
              audit,
            });

        let company: RegistrationSnapshot | null = null;
        let relationshipId: string | null = null;
        const reviewIds: string[] = [];
        if (confirmedDomainDraft.kind === 'company') {
          const cnpj = persistence.normalized.cnpj;
          await this.lock(
            transaction,
            `${input.companyId}:registration:cnpj:${cnpj}`,
          );
          const existingCompany = await transaction.routingCompany.findFirst({
            where: {
              companyId: input.companyId,
              cnpj,
              clientType: RoutingClientType.PJ,
            },
            select: {
              id: true,
              clientType: true,
              taxId: true,
              legalName: true,
              tradeName: true,
              firstName: true,
              lastName: true,
              individualName: true,
              cpf: true,
              individualEmail: true,
              individualWhatsapp: true,
              cnpj: true,
              legalEmail: true,
              legalWhatsapp: true,
              status: true,
              version: true,
            },
          });
          company = existingCompany
            ? existingCompany
            : await this.createRegistration(transaction, {
                companyId: input.companyId,
                type: 'pj',
                name: persistence.normalized.companyLegalName,
                taxDocument: cnpj,
                audit,
              });
          if (existingCompany) {
            const organizationDecision = decideRegistrationDivergence({
              registrationKind: 'company',
              field: 'legalName',
              existingValue: existingCompany.legalName,
              proposedValue: persistence.normalized.companyLegalName,
            });
            if (organizationDecision.action === 'create-data-review') {
              const reviewId = randomUUID();
              await transaction.registrationDataReview.create({
                data: {
                  id: reviewId,
                  companyId: input.companyId,
                  registrationId: existingCompany.id,
                  whatsappContactId: input.whatsappContactId,
                  serviceSessionId: input.serviceSessionId,
                  agentExecutionId: input.agentExecutionId,
                  commandId: `conversation:${input.commandId}:legal-name`,
                  field: 'legalName',
                  currentValue: {
                    value: existingCompany.legalName,
                    registrationVersion: existingCompany.version,
                  },
                  proposedValue: {
                    value: persistence.normalized.companyLegalName,
                  },
                  source: RegistrationDataReviewSource.WHATSAPP,
                  status: RegistrationDataReviewStatus.PENDING,
                },
              });
              reviewIds.push(reviewId);
            }
          }

          const relationship =
            await transaction.registrationRelationship.upsert({
              where: {
                companyId_sourceRegistrationId_targetRegistrationId_type: {
                  companyId: input.companyId,
                  sourceRegistrationId: person.id,
                  targetRegistrationId: company.id,
                  type: persistence.normalized.relationshipType,
                },
              },
              create: {
                companyId: input.companyId,
                sourceRegistrationId: person.id,
                targetRegistrationId: company.id,
                type: persistence.normalized.relationshipType,
                jobTitle: persistence.normalized.jobTitle ?? null,
                department:
                  persistence.normalized.relationshipDepartment ?? null,
                isPrimary: true,
                active: true,
              },
              update: {
                jobTitle: persistence.normalized.jobTitle ?? null,
                department:
                  persistence.normalized.relationshipDepartment ?? null,
                isPrimary: true,
                active: true,
                version: { increment: 1 },
              },
              select: { id: true },
            });
          relationshipId = relationship.id;
        }

        const confirmedAt = new Date();
        await transaction.conversationParticipant.updateMany({
          where: {
            companyId: input.companyId,
            serviceSessionId: input.serviceSessionId,
            isPrimary: true,
            validUntil: null,
          },
          data: { isPrimary: false, validUntil: confirmedAt },
        });
        await transaction.conversationParticipant.create({
          data: {
            companyId: input.companyId,
            serviceSessionId: input.serviceSessionId,
            whatsappContactId: input.whatsappContactId,
            registrationId: person.id,
            role:
              company === null
                ? ConversationParticipantRole.CUSTOMER
                : ConversationParticipantRole.REPRESENTATIVE,
            isPrimary: true,
            confidence: 1,
            identificationSource: 'customer-final-confirmation',
            confirmedAt,
            metadata: {
              authorizationGranted: relationshipGrantsAuthorization(),
              relationshipId,
            },
          },
        });

        const finalVersion = draft.draftVersion + 1;
        const outcome: RegistrationConfirmationResult = {
          draftId: input.draftId,
          draftVersion: finalVersion,
          status: 'confirmed',
          personRegistrationId: person.id,
          companyRegistrationId: company?.id ?? null,
          relationshipId,
          reviewIds,
          confirmedByCustomer: true,
          relationshipGrantsAuthorization: false,
          registrationRequiredForQuote: false,
          continueOriginalDemand: true,
        };
        const resolved = await transaction.serviceCase.updateMany({
          where: {
            id: input.draftId,
            companyId: input.companyId,
            status: ServiceCaseStatus.OPEN,
          },
          data: {
            status: ServiceCaseStatus.RESOLVED,
            resolvedAt: confirmedAt,
            metadata: json({
              kind: DRAFT_KIND,
              schemaVersion: DRAFT_SCHEMA_VERSION,
              draftVersion: finalVersion,
              outcome: 'confirmed',
              draftSha256: sha256(JSON.stringify(draft)),
              personRegistrationId: person.id,
              companyRegistrationId: company?.id ?? null,
              relationshipId,
              reviewIds,
              source: audit,
              piiScrubbed: true,
            }),
          },
        });
        if (resolved.count !== 1) {
          throw conflict('O draft foi concluído por outra operação.');
        }
        return outcome;
      },
    );
  }

  abandonDraft(
    input: ConversationRegistrationMutation & {
      readonly draftId: string | null;
      readonly expectedDraftVersion: number | null;
    },
  ): Promise<RegistrationAbandonmentResult> {
    return this.command(
      input,
      {
        action: 'registration.conversation.abandon',
        targetType: input.draftId
          ? 'registration-conversation-draft'
          : 'service-session',
        targetId: input.draftId ?? input.serviceSessionId,
        fingerprint: fingerprint({
          companyId: input.companyId,
          serviceSessionId: input.serviceSessionId,
          draftId: input.draftId,
          expectedDraftVersion: input.expectedDraftVersion,
        }),
      },
      async (transaction): Promise<RegistrationAbandonmentResult> => {
        if (!input.draftId) {
          return {
            draftId: null,
            status: 'declined',
            incompleteRegistrationPersisted: false,
            registrationRequiredForQuote: false,
            continueOriginalDemand: true,
          };
        }
        await this.lock(
          transaction,
          `${input.companyId}:registration-conversation:draft:${input.draftId}`,
        );
        const { draft } = await this.draftRow(transaction, {
          ...input,
          draftId: input.draftId,
        });
        if (
          input.expectedDraftVersion === null ||
          draft.draftVersion !== input.expectedDraftVersion
        ) {
          throw conflict('O draft foi alterado por outra operação.');
        }
        const abandonedAt = new Date();
        const updated = await transaction.serviceCase.updateMany({
          where: {
            id: input.draftId,
            companyId: input.companyId,
            status: ServiceCaseStatus.OPEN,
          },
          data: {
            status: ServiceCaseStatus.CANCELLED,
            resolvedAt: abandonedAt,
            metadata: json({
              kind: DRAFT_KIND,
              schemaVersion: DRAFT_SCHEMA_VERSION,
              draftVersion: draft.draftVersion + 1,
              outcome: 'abandoned',
              draftSha256: sha256(JSON.stringify(draft)),
              source: {
                serviceSessionId: input.serviceSessionId,
                whatsappContactId: input.whatsappContactId,
                agentExecutionId: input.agentExecutionId,
              },
              piiScrubbed: true,
            }),
          },
        });
        if (updated.count !== 1) {
          throw conflict('O draft foi concluído por outra operação.');
        }
        return {
          draftId: input.draftId,
          status: 'abandoned',
          incompleteRegistrationPersisted: false,
          registrationRequiredForQuote: false,
          continueOriginalDemand: true,
        };
      },
    );
  }

  async listDataReviews(input: {
    readonly companyId: string;
    readonly status?: ReviewStatusValue;
  }): Promise<readonly RegistrationDataReviewRecord[]> {
    const rows = await this.prisma.registrationDataReview.findMany({
      where: {
        companyId: input.companyId,
        ...(input.status ? { status: reviewStatus(input.status) } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        registrationId: true,
        whatsappContactId: true,
        serviceSessionId: true,
        agentExecutionId: true,
        field: true,
        currentValue: true,
        proposedValue: true,
        source: true,
        status: true,
        reviewedByUserId: true,
        reviewedAt: true,
        reviewReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      source: lower(row.source) as RegistrationDataReviewRecord['source'],
      status: lower(row.status) as ReviewStatusValue,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  decideDataReview(input: {
    readonly companyId: string;
    readonly actorUserId: string;
    readonly commandId: string;
    readonly reviewId: string;
    readonly decision: 'approved' | 'rejected';
    readonly reason: string | null;
  }): Promise<RegistrationReviewDecisionResult> {
    const commandFingerprint = fingerprint({
      companyId: input.companyId,
      reviewId: input.reviewId,
      decision: input.decision,
      reason: input.reason,
    });
    return this.prisma.$transaction(async (transaction) => {
      await this.lock(
        transaction,
        `${input.companyId}:registration-review:command:${input.commandId}`,
      );
      const duplicate = await transaction.tenantAuditLog.findFirst({
        where: {
          companyId: input.companyId,
          action: 'registration.data-review.decide',
          metadata: { path: ['commandId'], equals: input.commandId },
        },
        orderBy: { createdAt: 'desc' },
        select: { metadata: true },
      });
      if (duplicate) {
        const metadata = record(duplicate.metadata);
        if (metadata.fingerprint !== commandFingerprint) {
          throw conflict('commandId já foi usado para outra decisão.');
        }
        const result = record(metadata.result);
        if (Object.keys(result).length === 0) {
          throw conflict('A auditoria idempotente da revisão está inválida.');
        }
        return {
          ...(result as unknown as RegistrationReviewDecisionResult),
          idempotent: true,
        };
      }
      const actor = await transaction.user.findFirst({
        where: {
          id: input.actorUserId,
          companyId: input.companyId,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!actor) {
        throw forbidden(
          'O responsável não pertence ao tenant ou está inativo.',
        );
      }
      if (input.decision === 'rejected' && !input.reason) {
        throw validationError('Informe o motivo da rejeição.');
      }
      await this.lock(
        transaction,
        `${input.companyId}:registration-review:${input.reviewId}`,
      );
      const review = await transaction.registrationDataReview.findFirst({
        where: {
          id: input.reviewId,
          companyId: input.companyId,
          status: RegistrationDataReviewStatus.PENDING,
        },
        select: {
          id: true,
          registrationId: true,
          field: true,
          currentValue: true,
          proposedValue: true,
        },
      });
      if (!review) throw notFound('Revisão de Cadastro pendente');
      await this.lock(
        transaction,
        `${input.companyId}:registration:${review.registrationId}`,
      );
      const reviewedAt = new Date();
      if (input.decision === 'approved') {
        const current = record(review.currentValue);
        const proposed = record(review.proposedValue);
        const expectedVersion = current.registrationVersion;
        const proposedValue = proposed.value;
        if (
          typeof expectedVersion !== 'number' ||
          !Number.isInteger(expectedVersion) ||
          expectedVersion < 1 ||
          typeof proposedValue !== 'string'
        ) {
          throw conflict('A revisão não possui um snapshot aplicável.');
        }
        const before = await this.selectRegistration(
          transaction,
          input.companyId,
          review.registrationId,
        );
        if (before.version !== expectedVersion) {
          throw conflict(
            'O Cadastro mudou após a criação da revisão; revise os dados novamente.',
          );
        }
        const updates: Prisma.RoutingCompanyUpdateManyMutationInput = {};
        switch (review.field) {
          case 'legalName': {
            const value = proposedValue.replace(/\s+/gu, ' ').trim();
            if (value.length < 2 || value.length > 160) {
              throw validationError('A razão social proposta é inválida.');
            }
            updates.legalName = value;
            break;
          }
          case 'tradeName': {
            const value = proposedValue.replace(/\s+/gu, ' ').trim();
            if (!value || value.length > 120) {
              throw validationError('O nome fantasia proposto é inválido.');
            }
            updates.tradeName = value;
            break;
          }
          case 'legalEmail': {
            const value = normalizeEmail(proposedValue);
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) {
              throw validationError(
                'O e-mail organizacional proposto é inválido.',
              );
            }
            updates.legalEmail = value;
            break;
          }
          case 'legalWhatsapp': {
            updates.legalWhatsapp = normalizeWhatsAppPhone(proposedValue);
            break;
          }
          case 'cnpj': {
            if (before.clientType !== RoutingClientType.PJ) {
              throw validationError(
                'CNPJ só pode ser aplicado a Pessoa Jurídica.',
              );
            }
            const cnpj = normalizeTaxId(proposedValue);
            normalizeRegistrationInput(
              {
                type: 'pj',
                legalName: before.legalName,
                cnpj,
                roleCodes: ['client'],
              },
              before.id,
            );
            updates.cnpj = cnpj;
            updates.taxId = cnpj;
            break;
          }
          default:
            throw validationError(
              'Este campo organizacional ainda não possui aplicação segura no Cadastro.',
            );
        }
        const changed = await transaction.routingCompany.updateMany({
          where: {
            id: review.registrationId,
            companyId: input.companyId,
            version: expectedVersion,
          },
          data: { ...updates, version: { increment: 1 } },
        });
        if (changed.count !== 1) {
          throw conflict('O Cadastro foi alterado por outra operação.');
        }
        const after = await this.selectRegistration(
          transaction,
          input.companyId,
          review.registrationId,
        );
        await transaction.routingCompanyHistory.create({
          data: {
            companyId: input.companyId,
            routingCompanyId: review.registrationId,
            actorUserId: input.actorUserId,
            commandId: randomUUID(),
            action: 'registration.data-review.approve',
            beforeSnapshot: registrationSnapshotJson(before),
            afterSnapshot: registrationSnapshotJson(after, {
              reviewId: input.reviewId,
              humanDecision: 'approved',
            }),
          },
        });
      }
      const status =
        input.decision === 'approved'
          ? RegistrationDataReviewStatus.APPROVED
          : RegistrationDataReviewStatus.REJECTED;
      const decided = await transaction.registrationDataReview.updateMany({
        where: {
          id: input.reviewId,
          companyId: input.companyId,
          status: RegistrationDataReviewStatus.PENDING,
        },
        data: {
          status,
          reviewedByUserId: input.actorUserId,
          reviewedAt,
          reviewReason: input.reason,
        },
      });
      if (decided.count !== 1) {
        throw conflict('A revisão foi decidida por outra operação.');
      }
      const result: RegistrationReviewDecisionResult = {
        reviewId: input.reviewId,
        registrationId: review.registrationId,
        status: input.decision,
        reviewedByUserId: input.actorUserId,
        reviewedAt: reviewedAt.toISOString(),
      };
      await transaction.tenantAuditLog.create({
        data: {
          companyId: input.companyId,
          actorUserId: input.actorUserId,
          action: 'registration.data-review.decide',
          targetType: 'registration-data-review',
          targetId: input.reviewId,
          metadata: json({
            commandId: input.commandId,
            fingerprint: commandFingerprint,
            result,
            humanDecision: input.decision,
            reasonProvided: input.reason !== null,
          }),
        },
      });
      return { ...result, idempotent: false };
    });
  }
}
