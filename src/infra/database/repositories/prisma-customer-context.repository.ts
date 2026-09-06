import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  CUSTOMER_PROFILE_KEYS,
  CustomerContextRepository,
  type ApprovedCustomerProfileItem,
  type ConfirmedCustomerIdentityContext,
  type CreateCustomerProfileSuggestionInput,
  type CustomerContextDetailPage,
  type CustomerContextSummary,
  type CustomerPendingContext,
  type CustomerProfileSuggestionCreationResult,
  type CustomerProfileSuggestionDecisionResult,
  type CustomerProfileSuggestionRecord,
  type CustomerProfileSuggestionStatus as SuggestionStatusValue,
  type RecentCustomerQuoteContext,
  type RecentCustomerServiceContext,
  type RelatedCompanyContext,
} from '../../../application/contracts/customer-context.repository';
import {
  conflict,
  forbidden,
  notFound,
  validationError,
} from '../../../core/errors/app-error';
import { isCustomerProfileValueSafe } from '../../../domain/customer-context/customer-context-policy';
import {
  AgentExecutionStatus,
  ConversationParticipantRole,
  CustomerProfileSuggestionStatus,
  Prisma,
  RoutingClientType,
  RoutingCompanyStatus,
  ServiceCaseStatus,
  ServiceSessionStatus,
} from '../prisma/generated/client';
import { PrismaService } from '../prisma/prisma.service';

type TransactionClient = Prisma.TransactionClient;

const SUMMARY_LIMITS = {
  relatedCompanies: 5,
  approvedProfile: 12,
  recentServices: 5,
  recentQuotes: 5,
  pending: 10,
} as const;

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

function lower(value: string): string {
  return value.toLowerCase().replaceAll('_', '-');
}

function suggestionStatus(
  value: SuggestionStatusValue,
): CustomerProfileSuggestionStatus {
  return CustomerProfileSuggestionStatus[
    value.toUpperCase() as keyof typeof CustomerProfileSuggestionStatus
  ];
}

function pendingActionCount(value: Prisma.JsonValue): number {
  return Array.isArray(value) ? Math.min(value.length, 100) : 0;
}

function serviceOutput(row: {
  readonly id: string;
  readonly status: string;
  readonly controlMode: string;
  readonly currentDepartmentId: string | null;
  readonly priority: string;
  readonly pendingActions: Prisma.JsonValue;
  readonly updatedAt: Date;
}): RecentCustomerServiceContext {
  return {
    serviceSessionId: row.id,
    status: lower(row.status),
    controlMode: lower(row.controlMode),
    departmentId: row.currentDepartmentId,
    priority: lower(row.priority),
    pendingActionCount: pendingActionCount(row.pendingActions),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function quoteOutput(row: {
  readonly id: string;
  readonly status: string;
  readonly serviceType: string | null;
  readonly origin: string | null;
  readonly destination: string | null;
  readonly departureDate: Date | null;
  readonly updatedAt: Date;
}): RecentCustomerQuoteContext {
  return {
    quoteRequestId: row.id,
    status: lower(row.status),
    serviceType: row.serviceType?.slice(0, 120) ?? null,
    origin: row.origin?.slice(0, 300) ?? null,
    destination: row.destination?.slice(0, 300) ?? null,
    departureDate: row.departureDate?.toISOString().slice(0, 10) ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function profileOutput(row: {
  readonly id: string;
  readonly profileKey: string;
  readonly suggestedValue: string;
  readonly reviewedAt: Date;
}): ApprovedCustomerProfileItem {
  return {
    suggestionId: row.id,
    key: row.profileKey as ApprovedCustomerProfileItem['key'],
    value: row.suggestedValue.slice(0, 500),
    approvedAt: row.reviewedAt.toISOString(),
  };
}

function uniqueApprovedProfile(
  rows: readonly {
    readonly id: string;
    readonly profileKey: string;
    readonly suggestedValue: string;
    readonly reviewedAt: Date | null;
  }[],
  limit: number,
): ApprovedCustomerProfileItem[] {
  const keys = new Set<string>();
  const result: ApprovedCustomerProfileItem[] = [];
  for (const row of rows) {
    if (
      !row.reviewedAt ||
      keys.has(row.profileKey) ||
      !isCustomerProfileValueSafe(row.suggestedValue)
    ) {
      continue;
    }
    keys.add(row.profileKey);
    result.push(profileOutput({ ...row, reviewedAt: row.reviewedAt }));
    if (result.length >= limit) break;
  }
  return result;
}

@Injectable()
export class PrismaCustomerContextRepository extends CustomerContextRepository {
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

  private async anchor(
    transaction: TransactionClient,
    input: { readonly companyId: string; readonly serviceSessionId: string },
  ): Promise<{ readonly whatsappContactId: string }> {
    const session = await transaction.serviceSession.findFirst({
      where: { id: input.serviceSessionId, companyId: input.companyId },
      select: {
        id: true,
        thread: { select: { contactId: true } },
      },
    });
    if (!session) throw notFound('Sessão de atendimento');
    return { whatsappContactId: session.thread.contactId };
  }

  private async confirmedIdentity(
    transaction: TransactionClient,
    input: {
      readonly companyId: string;
      readonly serviceSessionId: string;
      readonly whatsappContactId: string;
    },
  ): Promise<ConfirmedCustomerIdentityContext | null> {
    const participant = await transaction.conversationParticipant.findFirst({
      where: {
        companyId: input.companyId,
        serviceSessionId: input.serviceSessionId,
        whatsappContactId: input.whatsappContactId,
        registrationId: { not: null },
        confirmedAt: { not: null },
        validUntil: null,
        role: {
          in: [
            ConversationParticipantRole.CUSTOMER,
            ConversationParticipantRole.REPRESENTATIVE,
            ConversationParticipantRole.RELATED_PERSON,
          ],
        },
      },
      orderBy: [{ isPrimary: 'desc' }, { confirmedAt: 'desc' }],
      select: {
        confirmedAt: true,
        registration: {
          select: {
            id: true,
            clientType: true,
            individualName: true,
            legalName: true,
          },
        },
      },
    });
    if (!participant?.registration || !participant.confirmedAt) return null;
    return {
      registrationId: participant.registration.id,
      kind:
        participant.registration.clientType === RoutingClientType.PF
          ? 'personal'
          : 'company',
      displayName: (
        participant.registration.individualName ??
        participant.registration.legalName
      ).slice(0, 160),
      confirmedAt: participant.confirmedAt.toISOString(),
    };
  }

  private async relatedCompanies(
    transaction: TransactionClient,
    companyId: string,
    identity: ConfirmedCustomerIdentityContext | null,
    limit: number,
  ): Promise<RelatedCompanyContext[]> {
    if (!identity) return [];
    if (identity.kind === 'company') {
      return [
        {
          registrationId: identity.registrationId,
          displayName: identity.displayName,
          relationshipType: 'self',
          jobTitle: null,
          department: null,
        },
      ];
    }
    const rows = await transaction.registrationRelationship.findMany({
      where: {
        companyId,
        sourceRegistrationId: identity.registrationId,
        active: true,
        target: {
          is: {
            clientType: RoutingClientType.PJ,
            status: RoutingCompanyStatus.ACTIVE,
          },
        },
      },
      orderBy: [{ isPrimary: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
      select: {
        type: true,
        jobTitle: true,
        department: true,
        target: { select: { id: true, legalName: true } },
      },
    });
    return rows.map((row) => ({
      registrationId: row.target.id,
      displayName: row.target.legalName.slice(0, 160),
      relationshipType: row.type.slice(0, 60),
      jobTitle: row.jobTitle?.slice(0, 120) ?? null,
      department: row.department?.slice(0, 120) ?? null,
    }));
  }

  private async profile(
    transaction: TransactionClient,
    companyId: string,
    whatsappContactId: string,
    limit: number,
  ): Promise<ApprovedCustomerProfileItem[]> {
    const rows = await transaction.customerProfileSuggestion.findMany({
      where: {
        companyId,
        whatsappContactId,
        status: CustomerProfileSuggestionStatus.APPROVED,
        profileKey: { in: [...CUSTOMER_PROFILE_KEYS] },
      },
      orderBy: [{ reviewedAt: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(limit * 4, 100),
      select: {
        id: true,
        profileKey: true,
        suggestedValue: true,
        reviewedAt: true,
      },
    });
    return uniqueApprovedProfile(rows, limit);
  }

  private async services(
    transaction: TransactionClient,
    companyId: string,
    whatsappContactId: string,
    limit: number,
  ) {
    return transaction.serviceSession.findMany({
      where: {
        companyId,
        thread: { is: { contactId: whatsappContactId } },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        status: true,
        controlMode: true,
        currentDepartmentId: true,
        priority: true,
        pendingActions: true,
        updatedAt: true,
      },
    });
  }

  private async quotes(
    transaction: TransactionClient,
    companyId: string,
    whatsappContactId: string,
    limit: number,
  ) {
    return transaction.quoteRequest.findMany({
      where: {
        companyId,
        conversation: { is: { contactId: whatsappContactId } },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        status: true,
        serviceType: true,
        origin: true,
        destination: true,
        departureDate: true,
        updatedAt: true,
      },
    });
  }

  private async pendingCases(
    transaction: TransactionClient,
    companyId: string,
    whatsappContactId: string,
    limit: number,
  ) {
    return transaction.serviceCase.findMany({
      where: {
        companyId,
        status: { in: [ServiceCaseStatus.OPEN, ServiceCaseStatus.PAUSED] },
        sessions: {
          some: {
            companyId,
            serviceSession: {
              is: { thread: { is: { contactId: whatsappContactId } } },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, status: true, updatedAt: true },
    });
  }

  private pending(
    services: readonly Awaited<ReturnType<typeof this.services>>[number][],
    quotes: readonly Awaited<ReturnType<typeof this.quotes>>[number][],
    cases: readonly Awaited<ReturnType<typeof this.pendingCases>>[number][],
    limit: number,
  ): CustomerPendingContext[] {
    const serviceItems: CustomerPendingContext[] = services
      .filter((row) => row.status !== ServiceSessionStatus.CLOSED)
      .map((row) => ({
        kind: 'service',
        id: row.id,
        status: lower(row.status),
        updatedAt: row.updatedAt.toISOString(),
      }));
    const quoteItems: CustomerPendingContext[] = quotes
      .filter(
        (row) => !['APPROVED', 'REJECTED', 'CANCELLED'].includes(row.status),
      )
      .map((row) => ({
        kind: 'quote',
        id: row.id,
        status: lower(row.status),
        updatedAt: row.updatedAt.toISOString(),
      }));
    const caseItems: CustomerPendingContext[] = cases.map((row) => ({
      kind: 'case',
      id: row.id,
      status: lower(row.status),
      updatedAt: row.updatedAt.toISOString(),
    }));
    return [...serviceItems, ...quoteItems, ...caseItems]
      .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))
      .slice(0, limit);
  }

  async loadSummary(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly audience: 'agent' | 'human';
  }): Promise<CustomerContextSummary> {
    return this.prisma.$transaction(async (transaction) => {
      const anchor = await this.anchor(transaction, input);
      const identity = await this.confirmedIdentity(transaction, {
        ...input,
        whatsappContactId: anchor.whatsappContactId,
      });
      const registration = identity
        ? await transaction.routingCompany.findFirst({
            where: {
              id: identity.registrationId,
              companyId: input.companyId,
              status: 'ACTIVE',
            },
            select: { id: true, version: true, serviceInstructions: true },
          })
        : null;
      const registrationInstructions = registration?.serviceInstructions
        ? {
            registrationId: registration.id,
            version: registration.version,
            content: registration.serviceInstructions,
          }
        : null;
      const [relatedCompanies, approvedProfile, serviceRows, quoteRows, cases] =
        await Promise.all([
          this.relatedCompanies(
            transaction,
            input.companyId,
            identity,
            SUMMARY_LIMITS.relatedCompanies,
          ),
          this.profile(
            transaction,
            input.companyId,
            anchor.whatsappContactId,
            SUMMARY_LIMITS.approvedProfile,
          ),
          this.services(
            transaction,
            input.companyId,
            anchor.whatsappContactId,
            SUMMARY_LIMITS.recentServices,
          ),
          this.quotes(
            transaction,
            input.companyId,
            anchor.whatsappContactId,
            SUMMARY_LIMITS.recentQuotes,
          ),
          this.pendingCases(
            transaction,
            input.companyId,
            anchor.whatsappContactId,
            SUMMARY_LIMITS.pending,
          ),
        ]);
      return {
        serviceSessionId: input.serviceSessionId,
        whatsappContactId: anchor.whatsappContactId,
        identity,
        registrationInstructions,
        relatedCompanies,
        approvedProfile,
        recentServices: serviceRows.map(serviceOutput),
        recentQuotes: quoteRows.map(quoteOutput),
        pending: this.pending(
          serviceRows,
          quoteRows,
          cases,
          SUMMARY_LIMITS.pending,
        ),
        limits: SUMMARY_LIMITS,
      };
    });
  }

  async loadDetails(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly audience: 'agent' | 'human';
    readonly section:
      'relationships' | 'profile' | 'services' | 'quotes' | 'pending';
    readonly limit: number;
  }): Promise<CustomerContextDetailPage> {
    return this.prisma.$transaction(async (transaction) => {
      const anchor = await this.anchor(transaction, input);
      const requested = input.limit + 1;
      let items: readonly unknown[];
      switch (input.section) {
        case 'relationships': {
          const identity = await this.confirmedIdentity(transaction, {
            ...input,
            whatsappContactId: anchor.whatsappContactId,
          });
          items = await this.relatedCompanies(
            transaction,
            input.companyId,
            identity,
            requested,
          );
          break;
        }
        case 'profile':
          // Human and agent context both use the same permanent-memory rule:
          // only a human-approved suggestion is a profile item.
          items = await this.profile(
            transaction,
            input.companyId,
            anchor.whatsappContactId,
            requested,
          );
          break;
        case 'services': {
          const rows = await this.services(
            transaction,
            input.companyId,
            anchor.whatsappContactId,
            requested,
          );
          items = rows.map(serviceOutput);
          break;
        }
        case 'quotes': {
          const rows = await this.quotes(
            transaction,
            input.companyId,
            anchor.whatsappContactId,
            requested,
          );
          items = rows.map(quoteOutput);
          break;
        }
        case 'pending': {
          const [services, quotes, cases] = await Promise.all([
            this.services(
              transaction,
              input.companyId,
              anchor.whatsappContactId,
              requested,
            ),
            this.quotes(
              transaction,
              input.companyId,
              anchor.whatsappContactId,
              requested,
            ),
            this.pendingCases(
              transaction,
              input.companyId,
              anchor.whatsappContactId,
              requested,
            ),
          ]);
          items = this.pending(services, quotes, cases, requested);
          break;
        }
      }
      return {
        section: input.section,
        items: items.slice(0, input.limit),
        limit: input.limit,
        hasMore: items.length > input.limit,
      };
    });
  }

  async createSuggestion(
    input: CreateCustomerProfileSuggestionInput,
  ): Promise<CustomerProfileSuggestionCreationResult> {
    const commandFingerprint = fingerprint({
      companyId: input.companyId,
      serviceSessionId: input.serviceSessionId,
      actorType: input.actor.type,
      actorId:
        input.actor.type === 'human'
          ? input.actor.userId
          : input.actor.agentExecutionId,
      profileKey: input.profileKey,
      suggestedValueSha256: sha256(input.suggestedValue),
      rationaleSha256: input.rationale ? sha256(input.rationale) : null,
      evidenceMessageId: input.evidenceMessageId,
    });
    return this.prisma.$transaction(async (transaction) => {
      await this.lock(
        transaction,
        `${input.companyId}:customer-profile:command:${input.commandId}`,
      );
      const duplicate = await transaction.tenantAuditLog.findFirst({
        where: {
          companyId: input.companyId,
          action: 'customer-profile.suggestion.create',
          metadata: { path: ['commandId'], equals: input.commandId },
        },
        orderBy: { createdAt: 'desc' },
        select: { metadata: true },
      });
      if (duplicate) {
        const metadata = record(duplicate.metadata);
        if (metadata.fingerprint !== commandFingerprint) {
          throw conflict('commandId já foi usado para outra sugestão.');
        }
        const result = record(metadata.result);
        if (
          typeof result.suggestionId !== 'string' ||
          typeof result.createdAt !== 'string'
        ) {
          throw conflict('A auditoria idempotente da sugestão está inválida.');
        }
        return {
          suggestionId: result.suggestionId,
          status: 'pending',
          createdAt: result.createdAt,
          idempotent: true,
          ...(result.deduplicated === true ? { deduplicated: true } : {}),
        };
      }
      const anchor = await this.anchor(transaction, input);
      let actorUserId: string | null = null;
      let agentExecutionId: string | null = null;
      let serviceIdentityId: string | null = null;
      if (input.actor.type === 'human') {
        const user = await transaction.user.findFirst({
          where: {
            id: input.actor.userId,
            companyId: input.companyId,
            isActive: true,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!user) {
          throw forbidden('O usuário não pertence ao tenant ou está inativo.');
        }
        actorUserId = user.id;
      } else {
        const execution = await transaction.agentExecution.findFirst({
          where: {
            id: input.actor.agentExecutionId,
            companyId: input.companyId,
            serviceSessionId: input.serviceSessionId,
            ...(input.actor.type === 'agent-runtime'
              ? { status: AgentExecutionStatus.RUNNING }
              : {}),
          },
          select: { id: true },
        });
        const identity =
          input.actor.type === 'agent'
            ? await transaction.serviceIdentity.findFirst({
                where: {
                  id: input.actor.serviceIdentityId,
                  companyId: input.companyId,
                  enabled: true,
                },
                select: { id: true },
              })
            : null;
        if (!execution || (input.actor.type === 'agent' && !identity)) {
          throw forbidden(
            'A origem do agente não pertence a esta sessão e tenant.',
          );
        }
        agentExecutionId = execution.id;
        serviceIdentityId = identity?.id ?? null;
      }
      if (input.evidenceMessageId) {
        const message = await transaction.whatsAppMessage.findFirst({
          where: {
            id: input.evidenceMessageId,
            companyId: input.companyId,
            serviceSessionId: input.serviceSessionId,
            contactId: anchor.whatsappContactId,
          },
          select: { id: true },
        });
        if (!message) {
          throw forbidden('A evidência não pertence a esta sessão e contato.');
        }
      }
      const confirmed = await this.confirmedIdentity(transaction, {
        ...input,
        whatsappContactId: anchor.whatsappContactId,
      });
      let deduplicated = false;
      let suggestion: { readonly id: string; readonly createdAt: Date } | null =
        null;
      if (agentExecutionId) {
        const existing = await transaction.customerProfileSuggestion.findFirst({
          where: {
            companyId: input.companyId,
            agentExecutionId,
            profileKey: input.profileKey,
          },
          select: {
            id: true,
            whatsappContactId: true,
            serviceSessionId: true,
            suggestedValue: true,
            rationale: true,
            status: true,
            createdAt: true,
          },
        });
        if (existing) {
          if (
            existing.whatsappContactId !== anchor.whatsappContactId ||
            existing.serviceSessionId !== input.serviceSessionId ||
            existing.suggestedValue !== input.suggestedValue ||
            existing.rationale !== input.rationale ||
            existing.status !== CustomerProfileSuggestionStatus.PENDING
          ) {
            throw conflict(
              'Esta execução já sugeriu outro valor para a chave de perfil.',
            );
          }
          suggestion = existing;
          deduplicated = true;
        }
      }
      if (!suggestion) {
        suggestion = await transaction.customerProfileSuggestion.create({
          data: {
            id: randomUUID(),
            companyId: input.companyId,
            whatsappContactId: anchor.whatsappContactId,
            registrationId: confirmed?.registrationId ?? null,
            serviceSessionId: input.serviceSessionId,
            agentExecutionId,
            profileKey: input.profileKey,
            suggestedValue: input.suggestedValue,
            rationale: input.rationale,
            origin: json({
              actorType: input.actor.type,
              commandId: input.commandId,
              serviceSessionId: input.serviceSessionId,
              agentExecutionId,
              actorUserId,
              serviceIdentityId,
              evidenceMessageId: input.evidenceMessageId,
              source: 'conversation-observation',
            }),
            status: CustomerProfileSuggestionStatus.PENDING,
          },
          select: { id: true, createdAt: true },
        });
      }
      const result: CustomerProfileSuggestionCreationResult = {
        suggestionId: suggestion.id,
        status: 'pending',
        createdAt: suggestion.createdAt.toISOString(),
        ...(deduplicated ? { deduplicated: true } : {}),
      };
      await transaction.tenantAuditLog.create({
        data: {
          companyId: input.companyId,
          actorUserId,
          action: 'customer-profile.suggestion.create',
          targetType: 'customer-profile-suggestion',
          targetId: suggestion.id,
          metadata: json({
            commandId: input.commandId,
            fingerprint: commandFingerprint,
            result,
            actorType: input.actor.type,
            serviceSessionId: input.serviceSessionId,
            agentExecutionId,
            evidenceMessageId: input.evidenceMessageId,
          }),
        },
      });
      return { ...result, idempotent: false };
    });
  }

  async listSuggestions(input: {
    readonly companyId: string;
    readonly status?: SuggestionStatusValue;
    readonly serviceSessionId?: string;
    readonly limit: number;
  }): Promise<readonly CustomerProfileSuggestionRecord[]> {
    const rows = await this.prisma.customerProfileSuggestion.findMany({
      where: {
        companyId: input.companyId,
        ...(input.status ? { status: suggestionStatus(input.status) } : {}),
        ...(input.serviceSessionId
          ? { serviceSessionId: input.serviceSessionId }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      select: {
        id: true,
        whatsappContactId: true,
        registrationId: true,
        serviceSessionId: true,
        agentExecutionId: true,
        profileKey: true,
        suggestedValue: true,
        rationale: true,
        origin: true,
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
      profileKey:
        row.profileKey as CustomerProfileSuggestionRecord['profileKey'],
      status: lower(row.status) as SuggestionStatusValue,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async decideSuggestion(input: {
    readonly companyId: string;
    readonly actorUserId: string;
    readonly commandId: string;
    readonly suggestionId: string;
    readonly expectedUpdatedAt: Date;
    readonly decision: 'approved' | 'ignored';
    readonly reason: string | null;
  }): Promise<CustomerProfileSuggestionDecisionResult> {
    const commandFingerprint = fingerprint({
      companyId: input.companyId,
      suggestionId: input.suggestionId,
      expectedUpdatedAt: input.expectedUpdatedAt.toISOString(),
      decision: input.decision,
      reason: input.reason,
    });
    return this.prisma.$transaction(async (transaction) => {
      await this.lock(
        transaction,
        `${input.companyId}:customer-profile:decision:${input.commandId}`,
      );
      const duplicate = await transaction.tenantAuditLog.findFirst({
        where: {
          companyId: input.companyId,
          action: 'customer-profile.suggestion.decide',
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
        if (
          typeof result.suggestionId !== 'string' ||
          (result.status !== 'approved' && result.status !== 'ignored') ||
          typeof result.reviewedByUserId !== 'string' ||
          typeof result.reviewedAt !== 'string'
        ) {
          throw conflict('A auditoria idempotente da decisão está inválida.');
        }
        return {
          suggestionId: result.suggestionId,
          status: result.status,
          reviewedByUserId: result.reviewedByUserId,
          reviewedAt: result.reviewedAt,
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
        throw forbidden('O usuário não pertence ao tenant ou está inativo.');
      }
      await this.lock(
        transaction,
        `${input.companyId}:customer-profile:suggestion:${input.suggestionId}`,
      );
      const suggestion = await transaction.customerProfileSuggestion.findFirst({
        where: {
          id: input.suggestionId,
          companyId: input.companyId,
          status: CustomerProfileSuggestionStatus.PENDING,
        },
        select: { id: true, updatedAt: true },
      });
      if (!suggestion) throw notFound('Sugestão de perfil pendente');
      if (
        suggestion.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
      ) {
        throw conflict('A sugestão foi alterada por outra operação.');
      }
      if (input.decision === 'ignored' && !input.reason) {
        throw validationError('Informe o motivo para ignorar a sugestão.');
      }
      const reviewedAt = new Date();
      const status =
        input.decision === 'approved'
          ? CustomerProfileSuggestionStatus.APPROVED
          : CustomerProfileSuggestionStatus.IGNORED;
      const changed = await transaction.customerProfileSuggestion.updateMany({
        where: {
          id: input.suggestionId,
          companyId: input.companyId,
          status: CustomerProfileSuggestionStatus.PENDING,
          updatedAt: input.expectedUpdatedAt,
        },
        data: {
          status,
          reviewedByUserId: input.actorUserId,
          reviewedAt,
          reviewReason: input.reason,
        },
      });
      if (changed.count !== 1) {
        throw conflict('A sugestão foi decidida por outra operação.');
      }
      const result: CustomerProfileSuggestionDecisionResult = {
        suggestionId: input.suggestionId,
        status: input.decision,
        reviewedByUserId: input.actorUserId,
        reviewedAt: reviewedAt.toISOString(),
      };
      await transaction.tenantAuditLog.create({
        data: {
          companyId: input.companyId,
          actorUserId: input.actorUserId,
          action: 'customer-profile.suggestion.decide',
          targetType: 'customer-profile-suggestion',
          targetId: input.suggestionId,
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
