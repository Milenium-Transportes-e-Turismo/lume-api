import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import {
  AgentFunctionToolExecutor,
  type ExecuteAgentFunctionToolInput,
  type ExecutedAgentFunctionToolCall,
} from '../../application/contracts/agent-function-tool.executor';
import { AgentFunctionToolCatalog } from '../../application/contracts/agent-function-tool.catalog';
import type { AgentJsonObject } from '../../application/contracts/agent-model.gateway';
import {
  CONVERSATION_RELATIONSHIP_TYPES,
  ConversationIdentityResolver,
  type ConversationRegistrationPatch,
  type ConversationRelationshipType,
} from '../../application/contracts/conversation-registration.repository';
import { CUSTOMER_PROFILE_KEYS } from '../../application/contracts/customer-context.repository';
import { CustomerContextUseCase } from '../../application/use-cases/customer-context/customer-context.use-case';
import { KnowledgeManagementUseCase } from '../../application/use-cases/knowledge/knowledge-management.use-case';
import { ConversationRegistrationUseCase } from '../../application/use-cases/registrations/conversation-registration.use-case';
import {
  AppError,
  conflict,
  forbidden,
  validationError,
} from '../../core/errors/app-error';
import { fingerprintAgentToolArguments } from '../../domain/agents/agent-tool-authorization';
import {
  AgentExecutionStatus,
  AgentToolCallStatus,
  MessageDirection,
  Prisma,
  ServiceCaseStatus,
  ServiceSessionControlMode,
  ServiceSessionStatus,
} from '../database/prisma/generated/client';
import { PrismaService } from '../database/prisma/prisma.service';

const MAXIMUM_TOOL_CALLS = 4;
const MAXIMUM_ARGUMENT_BYTES = 32_768;
const MAXIMUM_RESULT_BYTES = 8_192;
const SAFE_TEXT_LIMIT = 500;
const MAXIMUM_KNOWLEDGE_EVIDENCE_MESSAGES = 5;

const registrationReadArguments = z
  .object({ draftId: z.uuid().nullable() })
  .strict();
const registrationDraftStartArguments = z
  .object({ kind: z.enum(['personal', 'company']) })
  .strict();
const registrationPatchField = z.enum([
  'person.name',
  'person.cpf',
  'person.email',
  'person.phone',
  'company.legalName',
  'company.cnpj',
  'relationship.type',
  'relationship.jobTitle',
  'relationship.department',
]);
const registrationDraftPatchArguments = z
  .object({
    draftId: z.uuid(),
    expectedDraftVersion: z.number().int().positive(),
    changes: z
      .array(
        z
          .object({
            field: registrationPatchField,
            operation: z.enum(['set', 'clear']),
            value: z.string().min(1).max(200).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(9),
  })
  .strict()
  .superRefine((input, context) => {
    const fields = new Set<string>();
    const clearable = new Set([
      'person.email',
      'relationship.jobTitle',
      'relationship.department',
    ]);
    for (const [index, change] of input.changes.entries()) {
      if (fields.has(change.field)) {
        context.addIssue({
          code: 'custom',
          path: ['changes', index, 'field'],
          message: 'Campo duplicado.',
        });
      }
      fields.add(change.field);
      if (
        (change.operation === 'set' && change.value === null) ||
        (change.operation === 'clear' &&
          (change.value !== null || !clearable.has(change.field)))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['changes', index],
          message: 'Operação incompatível com o campo.',
        });
      }
      if (
        change.field === 'relationship.type' &&
        change.value !== null &&
        !CONVERSATION_RELATIONSHIP_TYPES.includes(
          change.value as ConversationRelationshipType,
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['changes', index, 'value'],
          message: 'Tipo de vínculo inválido.',
        });
      }
    }
  });
const personalDecision = z.enum(['replace', 'keep-existing']).nullable();
const registrationUpdateArguments = z
  .object({
    draftId: z.uuid(),
    expectedDraftVersion: z.number().int().positive(),
    customerConfirmedFinalSummary: z.literal(true),
    confirmationMessageId: z.uuid(),
    fieldDecisions: z
      .object({
        name: personalDecision,
        email: personalDecision,
        phone: personalDecision,
      })
      .strict(),
  })
  .strict();
const registrationDraftAbandonArguments = z
  .object({
    draftId: z.uuid(),
    expectedDraftVersion: z.number().int().positive(),
    abandonmentMessageId: z.uuid(),
  })
  .strict();
const customerProfileArguments = z
  .object({
    profileKey: z.enum(CUSTOMER_PROFILE_KEYS),
    suggestedValue: z.string().min(1).max(500),
    rationale: z.string().min(1).max(1_000).nullable(),
    evidenceMessageId: z.uuid().nullable(),
  })
  .strict();
const knowledgeGapArguments = z
  .object({ topic: z.string().min(1).max(240) })
  .strict();
const knowledgeSuggestionArguments = z
  .object({
    title: z.string().min(1).max(240),
    proposedContent: z.string().min(1).max(16_384),
  })
  .strict();

type ToolContext = {
  readonly whatsappContactId: string;
};

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function deterministicCommandId(value: string): string {
  const hex = sha256(value).slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  const normalized = hex.join('');
  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20),
  ].join('-');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeErrorCode(error: unknown): string {
  return error instanceof AppError ? error.code : 'AGENT_TOOL_EXECUTION_FAILED';
}

function boundedJson(value: AgentJsonObject): Prisma.InputJsonObject {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAXIMUM_RESULT_BYTES) {
    throw validationError('O resultado seguro da ferramenta excede o limite.');
  }
  return JSON.parse(serialized) as Prisma.InputJsonObject;
}

function parseArguments<T>(schema: z.ZodType<T>, value: AgentJsonObject): T {
  if (
    Buffer.byteLength(JSON.stringify(value), 'utf8') > MAXIMUM_ARGUMENT_BYTES
  ) {
    throw validationError('Os argumentos da ferramenta excedem o limite.');
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw validationError('Os argumentos da ferramenta são inválidos.');
  }
  return parsed.data;
}

function explicitConfirmation(text: string | null): boolean {
  if (!text || text.length > SAFE_TEXT_LIMIT) return false;
  const normalized = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9\s]/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
  if (
    !normalized ||
    /\b(?:nao|errad|corrig|alter|discord)\w*\b/iu.test(normalized)
  ) {
    return false;
  }
  return /^(?:sim(?:\s+.*)?|confirmo(?:\s+.*)?|confirmado|correto|corretos|esta correto|estao corretos|tudo certo|pode (?:confirmar|cadastrar|salvar)(?:\s+.*)?)$/iu.test(
    normalized,
  );
}

function explicitAbandonment(text: string | null): boolean {
  if (!text || text.length > SAFE_TEXT_LIMIT) return false;
  const normalized = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9\s]/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
  return /\b(?:nao quero|nao desejo|prefiro nao|deixa pra la|desist\w*|cancel\w*|sem cadastro|parar cadastro)\b/iu.test(
    normalized,
  );
}

function requiredPatchValue(value: string | null): string {
  if (value === null) {
    throw validationError('O valor do patch cadastral é inválido.');
  }
  return value;
}

function draftPatch(
  changes: z.infer<typeof registrationDraftPatchArguments>['changes'],
): ConversationRegistrationPatch {
  const person: {
    name?: string;
    cpf?: string;
    email?: string | null;
    phone?: string;
  } = {};
  const company: { legalName?: string; cnpj?: string } = {};
  const relationship: {
    type?: ConversationRelationshipType;
    jobTitle?: string | null;
    department?: string | null;
  } = {};
  for (const change of changes) {
    const value = change.operation === 'clear' ? null : change.value;
    if (change.operation === 'set' && value === null) {
      throw validationError('O valor do patch cadastral é inválido.');
    }
    switch (change.field) {
      case 'person.name':
        person.name = requiredPatchValue(value);
        break;
      case 'person.cpf':
        person.cpf = requiredPatchValue(value);
        break;
      case 'person.email':
        person.email = value;
        break;
      case 'person.phone':
        person.phone = requiredPatchValue(value);
        break;
      case 'company.legalName':
        company.legalName = requiredPatchValue(value);
        break;
      case 'company.cnpj':
        company.cnpj = requiredPatchValue(value);
        break;
      case 'relationship.type':
        relationship.type = value as ConversationRelationshipType;
        break;
      case 'relationship.jobTitle':
        relationship.jobTitle = value;
        break;
      case 'relationship.department':
        relationship.department = value;
        break;
    }
  }
  return {
    ...(Object.keys(person).length > 0 ? { person } : {}),
    ...(Object.keys(company).length > 0 ? { company } : {}),
    ...(Object.keys(relationship).length > 0 ? { relationship } : {}),
  };
}

@Injectable()
export class ServerSideAgentFunctionToolExecutor extends AgentFunctionToolExecutor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: AgentFunctionToolCatalog,
    private readonly identity: ConversationIdentityResolver,
    private readonly registrations: ConversationRegistrationUseCase,
    private readonly customerContext: CustomerContextUseCase,
    private readonly knowledge: KnowledgeManagementUseCase,
  ) {
    super();
  }

  private async assertExecution(input: ExecuteAgentFunctionToolInput) {
    const execution = await this.prisma.agentExecution.findFirst({
      where: {
        id: input.executionId,
        companyId: input.companyId,
        serviceSessionId: input.serviceSessionId,
        agentId: input.agentId,
        status: AgentExecutionStatus.RUNNING,
      },
      select: { id: true },
    });
    if (!execution) {
      throw forbidden('A execução da ferramenta não pertence a esta sessão.');
    }
  }

  private async liveContext(
    input: ExecuteAgentFunctionToolInput,
  ): Promise<ToolContext> {
    const session = await this.prisma.serviceSession.findFirst({
      where: { id: input.serviceSessionId, companyId: input.companyId },
      select: {
        status: true,
        controlMode: true,
        thread: { select: { contactId: true } },
      },
    });
    if (
      !session ||
      session.status !== ServiceSessionStatus.OPEN ||
      session.controlMode !== ServiceSessionControlMode.AI
    ) {
      throw forbidden(
        'A ferramenta foi bloqueada pelo controle atual do atendimento.',
      );
    }
    return { whatsappContactId: session.thread.contactId };
  }

  private async begin(
    input: ExecuteAgentFunctionToolInput,
    argumentsFingerprint: string,
  ): Promise<AgentJsonObject | null> {
    const existing = await this.prisma.agentToolCall.upsert({
      where: {
        companyId_executionId_sequence: {
          companyId: input.companyId,
          executionId: input.executionId,
          sequence: input.sequence,
        },
      },
      create: {
        companyId: input.companyId,
        executionId: input.executionId,
        toolId: input.toolId,
        sequence: input.sequence,
        status: AgentToolCallStatus.REQUESTED,
        inputHash: argumentsFingerprint,
        requestMetadata: {
          providerResponseId: input.providerResponseId,
          providerItemId: input.providerItemId,
          providerCallId: input.providerCallId,
          functionName: input.functionName,
          authorizationStatus: 'pending-argument-reauthorization',
        },
        authorizationReason:
          'Aguardando reautorização server-side dos argumentos reais.',
      },
      update: {},
      select: {
        toolId: true,
        inputHash: true,
        status: true,
        requestMetadata: true,
        resultSummary: true,
      },
    });
    const metadata = asRecord(existing.requestMetadata);
    if (
      existing.toolId !== input.toolId ||
      existing.inputHash !== argumentsFingerprint ||
      metadata.providerResponseId !== input.providerResponseId ||
      metadata.providerItemId !== input.providerItemId ||
      metadata.providerCallId !== input.providerCallId ||
      metadata.functionName !== input.functionName
    ) {
      throw conflict(
        'A sequência desta chamada de ferramenta já foi utilizada.',
      );
    }
    if (existing.status === AgentToolCallStatus.SUCCEEDED) {
      const result = asRecord(existing.resultSummary);
      if (Object.keys(result).length === 0) {
        throw conflict('O resultado auditado da ferramenta está inválido.');
      }
      return result;
    }
    if (
      existing.status === AgentToolCallStatus.DENIED ||
      existing.status === AgentToolCallStatus.FAILED
    ) {
      throw forbidden('Esta chamada de ferramenta já foi encerrada.');
    }
    return null;
  }

  private async markDenied(
    input: ExecuteAgentFunctionToolInput,
    error: unknown,
  ): Promise<void> {
    const updated = await this.prisma.agentToolCall.updateMany({
      where: {
        companyId: input.companyId,
        executionId: input.executionId,
        sequence: input.sequence,
      },
      data: {
        status: AgentToolCallStatus.DENIED,
        authorizationReason:
          'Negada pela allow-list ou reautorização server-side.',
        errorCode: safeErrorCode(error),
        errorMessage: null,
        completedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw conflict('Não foi possível auditar a negação da ferramenta.');
    }
  }

  private async markAllowed(
    input: ExecuteAgentFunctionToolInput,
    authorizationId: string,
  ): Promise<void> {
    const updated = await this.prisma.agentToolCall.updateMany({
      where: {
        companyId: input.companyId,
        executionId: input.executionId,
        sequence: input.sequence,
      },
      data: {
        status: AgentToolCallStatus.ALLOWED,
        authorizationReason: `server-policy:${authorizationId.slice(0, 64)}`,
        errorCode: null,
        errorMessage: null,
        startedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw conflict('Não foi possível auditar a autorização da ferramenta.');
    }
  }

  private async markFailed(
    input: ExecuteAgentFunctionToolInput,
    error: unknown,
  ): Promise<void> {
    const updated = await this.prisma.agentToolCall.updateMany({
      where: {
        companyId: input.companyId,
        executionId: input.executionId,
        sequence: input.sequence,
      },
      data: {
        status: AgentToolCallStatus.FAILED,
        resultSummary: { status: 'failed' },
        errorCode: safeErrorCode(error),
        errorMessage: null,
        completedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw conflict('Não foi possível auditar a falha da ferramenta.');
    }
  }

  private async markSucceeded(
    input: ExecuteAgentFunctionToolInput,
    result: AgentJsonObject,
  ): Promise<void> {
    const updated = await this.prisma.agentToolCall.updateMany({
      where: {
        companyId: input.companyId,
        executionId: input.executionId,
        sequence: input.sequence,
      },
      data: {
        status: AgentToolCallStatus.SUCCEEDED,
        resultSummary: boundedJson(result),
        errorCode: null,
        errorMessage: null,
        completedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw conflict('Não foi possível concluir a auditoria da ferramenta.');
    }
  }

  private async draftEvidence(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly whatsappContactId: string;
    readonly draftId: string;
    readonly evidenceMessageId: string;
    readonly accepts: (text: string | null) => boolean;
    readonly deniedMessage: string;
  }): Promise<void> {
    const [message, draft] = await Promise.all([
      this.prisma.whatsAppMessage.findFirst({
        where: {
          id: input.evidenceMessageId,
          companyId: input.companyId,
          serviceSessionId: input.serviceSessionId,
          contactId: input.whatsappContactId,
          direction: MessageDirection.INBOUND,
        },
        select: { text: true, occurredAt: true },
      }),
      this.prisma.serviceCase.findFirst({
        where: {
          id: input.draftId,
          companyId: input.companyId,
          status: ServiceCaseStatus.OPEN,
          sessions: {
            some: {
              companyId: input.companyId,
              serviceSessionId: input.serviceSessionId,
            },
          },
        },
        select: { updatedAt: true },
      }),
    ]);
    if (
      !message ||
      !draft ||
      message.occurredAt < draft.updatedAt ||
      !input.accepts(message.text)
    ) {
      throw forbidden(input.deniedMessage);
    }
  }

  private async assertInboundEvidence(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly whatsappContactId: string;
    readonly evidenceMessageId: string;
  }): Promise<void> {
    const message = await this.prisma.whatsAppMessage.findFirst({
      where: {
        id: input.evidenceMessageId,
        companyId: input.companyId,
        serviceSessionId: input.serviceSessionId,
        contactId: input.whatsappContactId,
        direction: MessageDirection.INBOUND,
      },
      select: { id: true },
    });
    if (!message) {
      throw forbidden('A evidência não pertence ao cliente desta sessão.');
    }
  }

  private async knowledgeEvidenceMessageIds(
    input: ExecuteAgentFunctionToolInput,
    context: ToolContext,
  ): Promise<readonly string[]> {
    const messages = await this.prisma.whatsAppMessage.findMany({
      where: {
        companyId: input.companyId,
        serviceSessionId: input.serviceSessionId,
        contactId: context.whatsappContactId,
        direction: MessageDirection.INBOUND,
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: MAXIMUM_KNOWLEDGE_EVIDENCE_MESSAGES,
      select: { id: true },
    });
    if (messages.length === 0) {
      throw forbidden(
        'A observação de knowledge exige evidência inbound desta sessão.',
      );
    }
    return messages.reverse().map((message) => message.id);
  }

  private async executeAllowed(
    input: ExecuteAgentFunctionToolInput,
    context: ToolContext,
    commandId: string,
  ): Promise<AgentJsonObject> {
    switch (input.functionName) {
      case 'registration_draft_start': {
        const args = parseArguments(
          registrationDraftStartArguments,
          input.arguments,
        );
        const result = await this.registrations.start({
          companyId: input.companyId,
          serviceSessionId: input.serviceSessionId,
          whatsappContactId: context.whatsappContactId,
          agentExecutionId: input.executionId,
          commandId,
          kind: args.kind,
        });
        return {
          draftId: result.draftId,
          draftVersion: result.draftVersion,
          kind: result.kind,
          status: result.status,
          missingFields: result.missingFields,
        };
      }
      case 'registration_draft_patch': {
        const args = parseArguments(
          registrationDraftPatchArguments,
          input.arguments,
        );
        const result = await this.registrations.update({
          companyId: input.companyId,
          serviceSessionId: input.serviceSessionId,
          whatsappContactId: context.whatsappContactId,
          agentExecutionId: input.executionId,
          commandId,
          draftId: args.draftId,
          expectedDraftVersion: args.expectedDraftVersion,
          patch: draftPatch(args.changes),
        });
        return {
          draftId: result.draftId,
          draftVersion: result.draftVersion,
          kind: result.kind,
          status: result.status,
          providedFields: result.providedFields,
          missingFields: result.missingFields,
        };
      }
      case 'registration_read': {
        const args = parseArguments(registrationReadArguments, input.arguments);
        if (args.draftId === null) {
          const identity = await this.identity.resolveBeforeResponse({
            companyId: input.companyId,
            serviceSessionId: input.serviceSessionId,
          });
          return {
            status: 'identity-state',
            result: {
              identityStatus: identity.status,
              requiresDisambiguation: identity.requiresDisambiguation,
              candidateCount: Math.min(identity.candidateCount, 20),
            },
          };
        }
        const draft = await this.registrations.read({
          companyId: input.companyId,
          serviceSessionId: input.serviceSessionId,
          whatsappContactId: context.whatsappContactId,
          agentExecutionId: input.executionId,
          draftId: args.draftId,
        });
        const preview =
          draft.status === 'awaiting-confirmation'
            ? await this.registrations.preview({
                companyId: input.companyId,
                serviceSessionId: input.serviceSessionId,
                whatsappContactId: context.whatsappContactId,
                agentExecutionId: input.executionId,
                draftId: args.draftId,
              })
            : null;
        return {
          status: 'draft-state',
          result: {
            draftId: draft.draftId,
            draftVersion: draft.draftVersion,
            kind: draft.kind,
            status: draft.status,
            providedFields: draft.providedFields,
            missingFields: draft.missingFields,
            requiredFieldDecisions:
              preview?.requiredFieldDecisions.map(({ field }) => field) ?? [],
            organizationReviewCount:
              preview?.organizationReviewsToCreate.length ?? 0,
          },
        };
      }
      case 'registration_update': {
        const args = parseArguments(
          registrationUpdateArguments,
          input.arguments,
        );
        await this.draftEvidence({
          companyId: input.companyId,
          serviceSessionId: input.serviceSessionId,
          whatsappContactId: context.whatsappContactId,
          draftId: args.draftId,
          evidenceMessageId: args.confirmationMessageId,
          accepts: explicitConfirmation,
          deniedMessage:
            'Não há confirmação final explícita e vigente do cliente para o draft.',
        });
        const fieldDecisions = Object.fromEntries(
          Object.entries(args.fieldDecisions).filter(
            (entry): entry is [string, 'replace' | 'keep-existing'] =>
              entry[1] !== null,
          ),
        );
        const result = await this.registrations.confirm({
          companyId: input.companyId,
          serviceSessionId: input.serviceSessionId,
          whatsappContactId: context.whatsappContactId,
          agentExecutionId: input.executionId,
          commandId,
          draftId: args.draftId,
          expectedDraftVersion: args.expectedDraftVersion,
          customerConfirmedFinalSummary: true,
          fieldDecisions,
        });
        return {
          status: result.status,
          draftVersion: result.draftVersion,
          reviewCount: result.reviewIds.length,
        };
      }
      case 'registration_draft_abandon': {
        const args = parseArguments(
          registrationDraftAbandonArguments,
          input.arguments,
        );
        await this.draftEvidence({
          companyId: input.companyId,
          serviceSessionId: input.serviceSessionId,
          whatsappContactId: context.whatsappContactId,
          draftId: args.draftId,
          evidenceMessageId: args.abandonmentMessageId,
          accepts: explicitAbandonment,
          deniedMessage:
            'Não há recusa ou abandono explícito e vigente do cliente para o draft.',
        });
        const result = await this.registrations.abandon({
          companyId: input.companyId,
          serviceSessionId: input.serviceSessionId,
          whatsappContactId: context.whatsappContactId,
          agentExecutionId: input.executionId,
          commandId,
          draftId: args.draftId,
          expectedDraftVersion: args.expectedDraftVersion,
        });
        return {
          status: result.status,
          incompleteRegistrationPersisted:
            result.incompleteRegistrationPersisted,
          continueOriginalDemand: result.continueOriginalDemand,
        };
      }
      case 'customer-profile_suggest': {
        const args = parseArguments(customerProfileArguments, input.arguments);
        if (args.evidenceMessageId) {
          await this.assertInboundEvidence({
            companyId: input.companyId,
            serviceSessionId: input.serviceSessionId,
            whatsappContactId: context.whatsappContactId,
            evidenceMessageId: args.evidenceMessageId,
          });
        }
        const result = await this.customerContext.suggestFromRuntime({
          companyId: input.companyId,
          serviceSessionId: input.serviceSessionId,
          agentExecutionId: input.executionId,
          commandId,
          profileKey: args.profileKey,
          suggestedValue: args.suggestedValue,
          rationale: args.rationale,
          evidenceMessageId: args.evidenceMessageId,
        });
        return { suggestionId: result.suggestionId, status: 'pending' };
      }
      case 'knowledge_gap_observe': {
        const args = parseArguments(knowledgeGapArguments, input.arguments);
        const evidenceMessageIds = await this.knowledgeEvidenceMessageIds(
          input,
          context,
        );
        const result = await this.knowledge.observeRuntimeGap({
          companyId: input.companyId,
          serviceSessionId: input.serviceSessionId,
          agentExecutionId: input.executionId,
          commandId,
          topic: args.topic,
          evidenceMessageIds,
        });
        return {
          gapId: result.gapId,
          status: result.status,
          occurrenceCount: result.occurrenceCount,
          automaticPublication: false,
        };
      }
      case 'knowledge_suggestion_create': {
        const args = parseArguments(
          knowledgeSuggestionArguments,
          input.arguments,
        );
        const evidenceMessageIds = await this.knowledgeEvidenceMessageIds(
          input,
          context,
        );
        const result = await this.knowledge.createRuntimeSuggestion({
          companyId: input.companyId,
          serviceSessionId: input.serviceSessionId,
          agentExecutionId: input.executionId,
          commandId,
          title: args.title,
          proposedContent: args.proposedContent,
          evidenceMessageIds,
        });
        return {
          suggestionId: result.suggestionId,
          status: 'pending',
          reviewRequired: true,
          automaticPublication: false,
        };
      }
      default:
        throw forbidden('A ferramenta não está na allow-list executável.');
    }
  }

  async execute(
    input: ExecuteAgentFunctionToolInput,
  ): Promise<ExecutedAgentFunctionToolCall> {
    if (
      !Number.isInteger(input.sequence) ||
      input.sequence < 1 ||
      input.sequence > MAXIMUM_TOOL_CALLS
    ) {
      throw validationError('A sequência da ferramenta é inválida.');
    }
    await this.assertExecution(input);
    const argumentsFingerprint = fingerprintAgentToolArguments(input.arguments);
    const replay = await this.begin(input, argumentsFingerprint);
    if (replay) {
      return {
        providerItemId: input.providerItemId,
        providerCallId: input.providerCallId,
        toolId: input.toolId,
        functionName: input.functionName,
        sequence: input.sequence,
        argumentsFingerprint,
        authorizationId: 'idempotent-replay',
        authorizationStatus: 'authorized-and-executed',
        modelResult: replay,
      };
    }

    let authorizationId = '';
    try {
      await this.liveContext(input);
      const authorized = await this.catalog.reauthorizeReturnedCall({
        companyId: input.companyId,
        serviceSessionId: input.serviceSessionId,
        agentId: input.agentId,
        toolId: input.toolId,
        arguments: input.arguments,
      });
      if (authorized.argumentsFingerprint !== argumentsFingerprint) {
        throw forbidden('A reautorização da ferramenta é inválida.');
      }
      authorizationId = authorized.authorizationId;
      if (
        ![
          'registration_read',
          'registration_update',
          'registration_draft_start',
          'registration_draft_patch',
          'registration_draft_abandon',
          'customer-profile_suggest',
          'knowledge_gap_observe',
          'knowledge_suggestion_create',
        ].includes(input.functionName)
      ) {
        throw forbidden('A ferramenta não está na allow-list executável.');
      }
      await this.markAllowed(input, authorizationId);
    } catch (error) {
      await this.markDenied(input, error);
      throw forbidden('A chamada de ferramenta foi negada pelo servidor.');
    }

    let result: AgentJsonObject;
    try {
      const context = await this.liveContext(input);
      const commandId = deterministicCommandId(
        [
          input.companyId,
          input.executionId,
          input.providerCallId,
          input.functionName,
          argumentsFingerprint,
        ].join(':'),
      );
      result = await this.executeAllowed(input, context, commandId);
      boundedJson(result);
    } catch (error) {
      await this.markFailed(input, error);
      throw forbidden('A ferramenta não pôde ser executada com segurança.');
    }
    // If the final audit write itself is temporarily unavailable, keep the row
    // ALLOWED. A retry will run the deterministic domain command idempotently
    // and can finish the audit instead of recording a false terminal failure.
    await this.markSucceeded(input, result);
    return {
      providerItemId: input.providerItemId,
      providerCallId: input.providerCallId,
      toolId: input.toolId,
      functionName: input.functionName,
      sequence: input.sequence,
      argumentsFingerprint,
      authorizationId,
      authorizationStatus: 'authorized-and-executed',
      modelResult: result,
    };
  }
}
