import { describe, expect, it, vi } from 'vitest';

import {
  KnowledgeGapStatus,
  KnowledgeReviewStatus,
} from '../prisma/generated/client';
import type { PrismaService } from '../prisma/prisma.service';
import { PrismaKnowledgeRepository } from './prisma-knowledge.repository';

const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SERVICE_IDENTITY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EXECUTION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const AGENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const MESSAGE_ID = '11111111-1111-4111-8111-111111111111';
const COMMAND_ID = '22222222-2222-4222-8222-222222222222';
const SUGGESTION_ID = '33333333-3333-4333-8333-333333333333';
const GAP_ID = '44444444-4444-4444-8444-444444444444';
const OCCURRED_AT = new Date('2026-08-29T12:00:00.000Z');

interface AuditWrite {
  readonly data: {
    readonly action: string;
    readonly metadata: Record<string, unknown>;
  };
}

function repositoryWithTransaction(transaction: object) {
  const prisma = {
    $transaction: vi.fn(
      async (operation: (client: object) => Promise<unknown>) =>
        operation(transaction),
    ),
  } as unknown as PrismaService;
  return new PrismaKnowledgeRepository(prisma);
}

function provenance() {
  return {
    serviceIdentity: {
      findFirst: vi.fn(async (_input: unknown) => ({
        id: SERVICE_IDENTITY_ID,
      })),
    },
    serviceSession: {
      findFirst: vi.fn(async (_input: unknown) => ({ id: SESSION_ID })),
    },
    agentExecution: {
      findFirst: vi.fn(async (_input: unknown) => ({
        id: EXECUTION_ID,
        agentId: AGENT_ID,
      })),
    },
    whatsAppMessage: {
      findMany: vi.fn(async (_input: unknown) => [
        {
          id: MESSAGE_ID,
          direction: 'INBOUND',
          kind: 'TEXT',
          occurredAt: OCCURRED_AT,
        },
      ]),
    },
  };
}

describe('PrismaKnowledgeRepository agent suggestions', () => {
  it('creates only PENDING with exact provenance, redacted evidence and idempotent replay', async () => {
    const audits = new Map<string, Record<string, unknown>>();
    const suggestionWrites: Array<{ data: Record<string, unknown> }> = [];
    const auditWrites: AuditWrite[] = [];
    const transaction = {
      $queryRaw: vi.fn(async () => []),
      ...provenance(),
      tenantAuditLog: {
        findFirst: vi.fn(
          async (input: {
            where: { action: string; metadata: { equals: string } };
          }) => {
            const metadata = audits.get(
              `${input.where.action}:${input.where.metadata.equals}`,
            );
            return metadata ? { metadata } : null;
          },
        ),
        create: vi.fn(async (input: AuditWrite) => {
          auditWrites.push(input);
          audits.set(
            `${input.data.action}:${String(input.data.metadata.commandId)}`,
            input.data.metadata,
          );
          return { id: 'audit' };
        }),
      },
      knowledgeSuggestion: {
        create: vi.fn(async (input: { data: Record<string, unknown> }) => {
          suggestionWrites.push(input);
          return { id: SUGGESTION_ID, createdAt: OCCURRED_AT };
        }),
      },
    };
    const repository = repositoryWithTransaction(transaction);
    const input = {
      companyId: COMPANY_ID,
      actor: {
        type: 'service-identity' as const,
        serviceIdentityId: SERVICE_IDENTITY_ID,
      },
      commandId: COMMAND_ID,
      serviceSessionId: SESSION_ID,
      agentExecutionId: EXECUTION_ID,
      suggestionId: SUGGESTION_ID,
      title: 'Transporte de animais',
      proposedContent: 'Definir a política institucional aplicável.',
      evidenceMessageIds: [MESSAGE_ID],
    };

    const first = await repository.createAgentSuggestion(input);
    const replay = await repository.createAgentSuggestion(input);

    expect(first).toMatchObject({
      suggestionId: SUGGESTION_ID,
      status: 'pending',
      automaticPublication: false,
      idempotent: false,
    });
    expect(replay).toMatchObject({
      suggestionId: SUGGESTION_ID,
      status: 'pending',
      automaticPublication: false,
      idempotent: true,
    });
    expect(suggestionWrites).toHaveLength(1);
    expect(suggestionWrites[0]?.data).toMatchObject({
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
      agentExecutionId: EXECUTION_ID,
      resultingDocumentId: null,
      status: KnowledgeReviewStatus.PENDING,
      evidence: [
        expect.objectContaining({
          schemaVersion: 1,
          source: 'agent-runtime',
          serviceIdentityId: SERVICE_IDENTITY_ID,
          serviceSessionId: SESSION_ID,
          agentExecutionId: EXECUTION_ID,
          agentId: AGENT_ID,
          redacted: true,
          internetUsed: false,
          messageRefs: [
            {
              messageId: MESSAGE_ID,
              direction: 'inbound',
              kind: 'text',
              occurredAt: OCCURRED_AT.toISOString(),
            },
          ],
        }),
      ],
    });
    expect(transaction.agentExecution.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: COMPANY_ID,
          serviceSessionId: SESSION_ID,
          id: EXECUTION_ID,
        }),
      }),
    );
    const serializedAudit = JSON.stringify(auditWrites);
    expect(serializedAudit).not.toContain(input.proposedContent);
    expect(serializedAudit).not.toContain(input.title);
    expect(serializedAudit).toContain(SERVICE_IDENTITY_ID);
  });

  it('persists an in-process runtime suggestion without inventing a service identity', async () => {
    const auditWrites: AuditWrite[] = [];
    const source = provenance();
    const transaction = {
      $queryRaw: vi.fn(async () => []),
      ...source,
      tenantAuditLog: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async (input: AuditWrite) => {
          auditWrites.push(input);
          return { id: 'audit' };
        }),
      },
      knowledgeSuggestion: {
        create: vi.fn(async (_input: { data: Record<string, unknown> }) => ({
          id: SUGGESTION_ID,
          createdAt: OCCURRED_AT,
        })),
      },
    };
    const repository = repositoryWithTransaction(transaction);

    const result = await repository.createAgentSuggestion({
      companyId: COMPANY_ID,
      actor: { type: 'agent-runtime' },
      commandId: COMMAND_ID,
      serviceSessionId: SESSION_ID,
      agentExecutionId: EXECUTION_ID,
      suggestionId: SUGGESTION_ID,
      title: 'Política institucional ausente',
      proposedContent: 'Conteúdo para revisão humana.',
      evidenceMessageIds: [MESSAGE_ID],
    });

    expect(result).toMatchObject({
      suggestionId: SUGGESTION_ID,
      status: 'pending',
      automaticPublication: false,
    });
    expect(source.serviceIdentity.findFirst).not.toHaveBeenCalled();
    expect(source.agentExecution.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: COMPANY_ID,
          serviceSessionId: SESSION_ID,
          id: EXECUTION_ID,
          status: 'RUNNING',
        }),
      }),
    );
    expect(auditWrites[0]?.data.metadata).toMatchObject({
      actorType: 'agent-runtime',
      serviceIdentityId: null,
      serviceSessionId: SESSION_ID,
      agentExecutionId: EXECUTION_ID,
    });
    const persisted = transaction.knowledgeSuggestion.create.mock.calls[0]?.[0];
    expect(persisted?.data).toMatchObject({
      status: KnowledgeReviewStatus.PENDING,
      resultingDocumentId: null,
      evidence: [
        expect.objectContaining({
          actorType: 'agent-runtime',
          serviceIdentityId: null,
          internetUsed: false,
        }),
      ],
    });
  });

  it('denies cross-tenant provenance before evidence or suggestion writes', async () => {
    const source = provenance();
    const transaction = {
      $queryRaw: vi.fn(async () => []),
      ...source,
      serviceIdentity: { findFirst: vi.fn(async () => null) },
      tenantAuditLog: { findFirst: vi.fn() },
      knowledgeSuggestion: { create: vi.fn() },
    };
    const repository = repositoryWithTransaction(transaction);

    await expect(
      repository.createAgentSuggestion({
        companyId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        actor: {
          type: 'service-identity',
          serviceIdentityId: SERVICE_IDENTITY_ID,
        },
        commandId: COMMAND_ID,
        serviceSessionId: SESSION_ID,
        agentExecutionId: EXECUTION_ID,
        suggestionId: SUGGESTION_ID,
        title: 'Tópico',
        proposedContent: 'Conteúdo pendente.',
        evidenceMessageIds: [MESSAGE_ID],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(source.whatsAppMessage.findMany).not.toHaveBeenCalled();
    expect(transaction.knowledgeSuggestion.create).not.toHaveBeenCalled();
  });
});

describe('PrismaKnowledgeRepository recurring gaps', () => {
  it('upserts by normalized topic, increments atomically and bounds/redacts evidence', async () => {
    let stored: {
      id: string;
      status: KnowledgeGapStatus;
      occurrenceCount: number;
      evidence: unknown[];
    } | null = null;
    const audits = new Map<string, Record<string, unknown>>();
    const gapUpdates: Array<{ data: Record<string, unknown> }> = [];
    const transaction = {
      $queryRaw: vi.fn(async () => []),
      ...provenance(),
      tenantAuditLog: {
        findFirst: vi.fn(
          async (input: {
            where: { action: string; metadata: { equals: string } };
          }) => {
            const metadata = audits.get(
              `${input.where.action}:${input.where.metadata.equals}`,
            );
            return metadata ? { metadata } : null;
          },
        ),
        create: vi.fn(async (input: AuditWrite) => {
          audits.set(
            `${input.data.action}:${String(input.data.metadata.commandId)}`,
            input.data.metadata,
          );
          return { id: 'audit' };
        }),
      },
      knowledgeGap: {
        findUnique: vi.fn(async (_input: unknown) => stored),
        create: vi.fn(async (input: { data: Record<string, unknown> }) => {
          stored = {
            id: GAP_ID,
            status: KnowledgeGapStatus.OPEN,
            occurrenceCount: 1,
            evidence: input.data.evidence as unknown[],
          };
          return { id: GAP_ID };
        }),
        updateMany: vi.fn(async (input: { data: Record<string, unknown> }) => {
          gapUpdates.push(input);
          if (!stored) return { count: 0 };
          stored = {
            ...stored,
            occurrenceCount: stored.occurrenceCount + 1,
            evidence: input.data.evidence as unknown[],
          };
          return { count: 1 };
        }),
      },
    };
    const repository = repositoryWithTransaction(transaction);
    const base = {
      companyId: COMPANY_ID,
      actor: {
        type: 'service-identity' as const,
        serviceIdentityId: SERVICE_IDENTITY_ID,
      },
      serviceSessionId: SESSION_ID,
      agentExecutionId: EXECUTION_ID,
      gapId: GAP_ID,
      topic: 'Transporte de animais',
      topicNormalized: 'transporte de animais',
      evidenceMessageIds: [MESSAGE_ID],
    };

    await repository.observeAgentGap({ ...base, commandId: COMMAND_ID });
    const initial = stored as {
      id: string;
      status: KnowledgeGapStatus;
      occurrenceCount: number;
      evidence: unknown[];
    } | null;
    if (!initial) throw new Error('O gap inicial deveria existir.');
    stored = {
      ...initial,
      status: KnowledgeGapStatus.ACKNOWLEDGED,
      occurrenceCount: 20,
      evidence: Array.from({ length: 20 }, () => ({
        rawConversation: 'CPF 529.982.247-25',
      })),
    };
    const result = await repository.observeAgentGap({
      ...base,
      commandId: '55555555-5555-4555-8555-555555555555',
    });

    expect(result).toMatchObject({
      gapId: GAP_ID,
      topicNormalized: 'transporte de animais',
      status: 'acknowledged',
      occurrenceCount: 21,
      automaticPublication: false,
    });
    expect(transaction.knowledgeGap.findUnique).toHaveBeenCalledWith({
      where: {
        companyId_topicNormalized: {
          companyId: COMPANY_ID,
          topicNormalized: 'transporte de animais',
        },
      },
      select: {
        id: true,
        status: true,
        occurrenceCount: true,
        evidence: true,
      },
    });
    expect(gapUpdates).toHaveLength(1);
    expect(gapUpdates[0]?.data).not.toHaveProperty('status');
    expect(gapUpdates[0]?.data).not.toHaveProperty('resolvedAt');
    const serializedEvidence = JSON.stringify(gapUpdates[0]?.data.evidence);
    expect(serializedEvidence).not.toContain('529.982.247-25');
    expect(serializedEvidence).toContain('legacy-redacted');
    expect(gapUpdates[0]?.data.evidence).toHaveLength(12);
  });
});
