import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  KnowledgeRepository,
  type AgentKnowledgeGapObservationResult,
  type AgentKnowledgeMutationIdentity,
  type AgentKnowledgeSuggestionCreationResult,
  type ArchiveKnowledgeDocumentInput,
  type CreateKnowledgeBaseInput,
  type CreateAgentKnowledgeSuggestionInput,
  type CreateKnowledgeDocumentDraftInput,
  type CreateNextKnowledgeDraftInput,
  type KnowledgeChunkDraft,
  type KnowledgeDocumentScope,
  type KnowledgeDocumentVisibility,
  type KnowledgeGapReview,
  type KnowledgeGapStatus as KnowledgeGapStatusValue,
  type KnowledgeMutationIdentity,
  type KnowledgeSuggestionReview,
  type KnowledgeSuggestionStatus,
  type ObserveAgentKnowledgeGapInput,
  type UpdateKnowledgeDraftInput,
  type VersionedKnowledgeMutationInput,
} from '../../../application/contracts/knowledge.repository';
import {
  conflict,
  forbidden,
  notFound,
  validationError,
} from '../../../core/errors/app-error';
import {
  AgentExecutionStatus,
  KnowledgeDocumentSourceType,
  KnowledgeGapStatus,
  KnowledgeReviewStatus,
  KnowledgeScope,
  KnowledgeVersionStatus,
  KnowledgeVisibility,
  Prisma,
} from '../prisma/generated/client';
import { PrismaService } from '../prisma/prisma.service';

type TransactionClient = Prisma.TransactionClient;

const MAX_STORED_GAP_EVIDENCE = 12;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function fingerprint(value: Readonly<Record<string, unknown>>): string {
  return sha256(JSON.stringify(value));
}

function asRecord(
  value: Prisma.JsonValue | null | undefined,
): Record<string, Prisma.JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function jsonResult(
  value: Prisma.JsonValue | undefined,
): Prisma.JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
}

function scopeValue(value: KnowledgeDocumentScope): KnowledgeScope {
  switch (value) {
    case 'tenant':
      return KnowledgeScope.TENANT;
    case 'department':
      return KnowledgeScope.DEPARTMENT;
    case 'multi-department':
      return KnowledgeScope.MULTI_DEPARTMENT;
  }
}

function visibilityValue(
  value: KnowledgeDocumentVisibility,
): KnowledgeVisibility {
  return value === 'customer-safe'
    ? KnowledgeVisibility.CUSTOMER_SAFE
    : KnowledgeVisibility.INTERNAL;
}

function sourceValue(value: 'article' | 'file'): KnowledgeDocumentSourceType {
  return value === 'article'
    ? KnowledgeDocumentSourceType.ARTICLE
    : KnowledgeDocumentSourceType.FILE;
}

function lower(value: string): string {
  return value.toLowerCase().replaceAll('_', '-');
}

function json(
  value: Readonly<Record<string, unknown>>,
): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

function jsonArray(
  value: readonly Prisma.InputJsonValue[],
): Prisma.InputJsonArray {
  return value;
}

function safeString(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.length <= maximum ? value : null;
}

function safeEvidence(
  value: Prisma.JsonValue | null | undefined,
): Prisma.InputJsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_STORED_GAP_EVIDENCE).map((entry) => {
    const current = asRecord(entry);
    if (
      current.schemaVersion !== 1 ||
      current.source !== 'agent-runtime' ||
      current.redacted !== true ||
      current.internetUsed !== false
    ) {
      return json({
        schemaVersion: 1,
        source: 'legacy-redacted',
        redacted: true,
        internetUsed: false,
      });
    }
    const messageRefs = Array.isArray(current.messageRefs)
      ? current.messageRefs
          .slice(0, 5)
          .map((reference) => asRecord(reference))
          .flatMap((reference) => {
            const messageId = safeString(reference.messageId, 120);
            const direction = safeString(reference.direction, 30);
            const kind = safeString(reference.kind, 30);
            const occurredAt = safeString(reference.occurredAt, 40);
            return messageId && direction && kind && occurredAt
              ? [json({ messageId, direction, kind, occurredAt })]
              : [];
          })
      : [];
    return json({
      schemaVersion: 1,
      source: 'agent-runtime',
      serviceIdentityId:
        safeString(current.serviceIdentityId, 120) ?? 'redacted',
      serviceSessionId: safeString(current.serviceSessionId, 120) ?? 'redacted',
      agentExecutionId: safeString(current.agentExecutionId, 120) ?? 'redacted',
      agentId: safeString(current.agentId, 120) ?? 'redacted',
      observedAt: safeString(current.observedAt, 40) ?? 'redacted',
      redacted: true,
      internetUsed: false,
      messageRefs,
    });
  });
}

function chunkData(
  companyId: string,
  versionId: string,
  chunks: readonly KnowledgeChunkDraft[],
) {
  return chunks.map((chunk) => ({
    companyId,
    documentVersionId: versionId,
    ordinal: chunk.ordinal,
    pageNumber: chunk.pageNumber,
    content: chunk.content,
    contentHash: chunk.contentHash,
    tokenCount: chunk.tokenCount,
    provenance: json(chunk.provenance),
  }));
}

function versionOutput(version: {
  id: string;
  version: number;
  status: KnowledgeVersionStatus;
  content: string | null;
  storageKey: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  provenance: Prisma.JsonValue;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  chunks?: readonly {
    id: string;
    ordinal: number;
    pageNumber: number | null;
    content: string;
    contentHash: string;
    tokenCount: number | null;
    provenance: Prisma.JsonValue;
  }[];
}): Prisma.InputJsonObject {
  return {
    id: version.id,
    version: version.version,
    status: lower(version.status),
    content: version.content,
    original: version.storageKey
      ? {
          available: true,
          fileName: version.fileName,
          mimeType: version.mimeType,
          sizeBytes: version.sizeBytes,
          sha256: version.sha256,
        }
      : null,
    contentHash: version.sha256,
    provenance: version.provenance,
    effectiveFrom: version.effectiveFrom?.toISOString() ?? null,
    effectiveUntil: version.effectiveUntil?.toISOString() ?? null,
    publishedAt: version.publishedAt?.toISOString() ?? null,
    createdAt: version.createdAt.toISOString(),
    chunks: (version.chunks ?? []).map((chunk) => ({
      id: chunk.id,
      ordinal: chunk.ordinal,
      pageNumber: chunk.pageNumber,
      content: chunk.content,
      contentHash: chunk.contentHash,
      tokenCount: chunk.tokenCount,
      provenance: chunk.provenance,
    })),
  };
}

@Injectable()
export class PrismaKnowledgeRepository extends KnowledgeRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listScopeDepartments(companyId: string) {
    return this.prisma.tenantDepartment.findMany({
      where: { companyId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, isDefault: true },
    });
  }

  private async command(
    input: KnowledgeMutationIdentity,
    options: {
      readonly action: string;
      readonly targetType: string;
      readonly targetId: string;
      readonly fingerprint: string;
    },
    operation: (
      transaction: TransactionClient,
    ) => Promise<Prisma.InputJsonObject>,
  ): Promise<Prisma.InputJsonObject> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`${input.companyId}:knowledge:${input.commandId}`})
        )
      `;
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
        const metadata = asRecord(duplicate.metadata);
        if (metadata.fingerprint !== options.fingerprint) {
          throw conflict(
            'commandId já foi usado para outra mutação de knowledge.',
          );
        }
        const result = jsonResult(metadata.result);
        if (!result)
          throw conflict('A auditoria idempotente de knowledge está inválida.');
        return { ...result, idempotent: true };
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
      if (!actor)
        throw forbidden('O usuário não pertence ao tenant ou está inativo.');
      const result = await operation(transaction);
      await transaction.tenantAuditLog.create({
        data: {
          companyId: input.companyId,
          actorUserId: input.actorUserId,
          action: options.action,
          targetType: options.targetType,
          targetId: options.targetId,
          metadata: {
            commandId: input.commandId,
            fingerprint: options.fingerprint,
            result,
          },
        },
      });
      return { ...result, idempotent: false };
    });
  }

  private async assertAgentProvenance(
    transaction: TransactionClient,
    input: AgentKnowledgeMutationIdentity,
  ): Promise<{
    readonly agentId: string;
    readonly actorType: 'service-identity' | 'agent-runtime';
    readonly serviceIdentityId: string | null;
  }> {
    const [session, execution] = await Promise.all([
      transaction.serviceSession.findFirst({
        where: { id: input.serviceSessionId, companyId: input.companyId },
        select: { id: true },
      }),
      transaction.agentExecution.findFirst({
        where: {
          id: input.agentExecutionId,
          companyId: input.companyId,
          serviceSessionId: input.serviceSessionId,
          status:
            input.actor.type === 'agent-runtime'
              ? AgentExecutionStatus.RUNNING
              : {
                  in: [
                    AgentExecutionStatus.RUNNING,
                    AgentExecutionStatus.SUCCEEDED,
                  ],
                },
        },
        select: { id: true, agentId: true },
      }),
    ]);
    if (!session || !execution) {
      throw forbidden(
        'A origem do agente não pertence a esta sessão e tenant.',
      );
    }
    if (input.actor.type === 'service-identity') {
      const serviceIdentity = await transaction.serviceIdentity.findFirst({
        where: {
          id: input.actor.serviceIdentityId,
          companyId: input.companyId,
          enabled: true,
        },
        select: { id: true },
      });
      if (!serviceIdentity) {
        throw forbidden(
          'A origem do agente não pertence a esta sessão e tenant.',
        );
      }
      return {
        agentId: execution.agentId,
        actorType: 'service-identity',
        serviceIdentityId: serviceIdentity.id,
      };
    }
    return {
      agentId: execution.agentId,
      actorType: 'agent-runtime',
      serviceIdentityId: null,
    };
  }

  private async redactedAgentEvidence(
    transaction: TransactionClient,
    input: AgentKnowledgeMutationIdentity & {
      readonly evidenceMessageIds: readonly string[];
    },
    agentId: string,
    observedAt: Date,
  ): Promise<Prisma.InputJsonObject> {
    const rows = await transaction.whatsAppMessage.findMany({
      where: {
        companyId: input.companyId,
        serviceSessionId: input.serviceSessionId,
        id: { in: [...input.evidenceMessageIds] },
      },
      select: {
        id: true,
        direction: true,
        kind: true,
        occurredAt: true,
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = input.evidenceMessageIds.flatMap((messageId) => {
      const row = byId.get(messageId);
      return row ? [row] : [];
    });
    if (ordered.length !== input.evidenceMessageIds.length) {
      throw forbidden(
        'Uma ou mais evidências não pertencem a esta sessão e tenant.',
      );
    }
    return json({
      schemaVersion: 1,
      source: 'agent-runtime',
      actorType: input.actor.type,
      serviceIdentityId:
        input.actor.type === 'service-identity'
          ? input.actor.serviceIdentityId
          : null,
      serviceSessionId: input.serviceSessionId,
      agentExecutionId: input.agentExecutionId,
      agentId,
      observedAt: observedAt.toISOString(),
      redacted: true,
      internetUsed: false,
      messageRefs: ordered.map((row) => ({
        messageId: row.id,
        direction: lower(row.direction),
        kind: lower(row.kind),
        occurredAt: row.occurredAt.toISOString(),
      })),
    });
  }

  private serviceCommand<TResult extends Record<string, unknown>>(
    input: AgentKnowledgeMutationIdentity,
    options: {
      readonly action: string;
      readonly targetType: string;
      readonly fingerprint: string;
    },
    operation: (
      transaction: TransactionClient,
      provenance: {
        readonly agentId: string;
        readonly actorType: 'service-identity' | 'agent-runtime';
        readonly serviceIdentityId: string | null;
      },
    ) => Promise<{ readonly targetId: string; readonly result: TResult }>,
  ): Promise<TResult & { readonly idempotent: boolean }> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`${input.companyId}:knowledge-agent:${input.commandId}`})
        )
      `;
      const provenance = await this.assertAgentProvenance(transaction, input);
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
        const metadata = asRecord(duplicate.metadata);
        if (metadata.fingerprint !== options.fingerprint) {
          throw conflict(
            'commandId já foi usado para outra observação de knowledge.',
          );
        }
        const result = jsonResult(metadata.result);
        if (!result) {
          throw conflict(
            'A auditoria idempotente da observação de knowledge está inválida.',
          );
        }
        return {
          ...(result as unknown as TResult),
          idempotent: true,
        };
      }
      const outcome = await operation(transaction, provenance);
      await transaction.tenantAuditLog.create({
        data: {
          companyId: input.companyId,
          actorUserId: null,
          action: options.action,
          targetType: options.targetType,
          targetId: outcome.targetId,
          metadata: json({
            commandId: input.commandId,
            fingerprint: options.fingerprint,
            result: outcome.result,
            actorType: provenance.actorType,
            serviceIdentityId: provenance.serviceIdentityId,
            serviceSessionId: input.serviceSessionId,
            agentExecutionId: input.agentExecutionId,
          }),
        },
      });
      return { ...outcome.result, idempotent: false };
    });
  }

  async listBases(companyId: string): Promise<readonly unknown[]> {
    const bases = await this.prisma.knowledgeBase.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        enabled: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { documents: true } },
      },
    });
    return bases.map((base) => ({
      id: base.id,
      name: base.name,
      description: base.description,
      enabled: base.enabled,
      archivedAt: base.archivedAt?.toISOString() ?? null,
      documentCount: base._count.documents,
      createdAt: base.createdAt.toISOString(),
      updatedAt: base.updatedAt.toISOString(),
    }));
  }

  createBase(input: CreateKnowledgeBaseInput): Promise<unknown> {
    return this.command(
      input,
      {
        action: 'knowledge.base.create',
        targetType: 'knowledge-base',
        targetId: input.id,
        fingerprint: fingerprint({
          companyId: input.companyId,
          id: input.id,
          name: input.name,
          description: input.description,
        }),
      },
      async (transaction) => {
        const base = await transaction.knowledgeBase.create({
          data: {
            id: input.id,
            companyId: input.companyId,
            name: input.name,
            description: input.description,
            createdByUserId: input.actorUserId,
          },
          select: { id: true, name: true, description: true, enabled: true },
        });
        return { ...base };
      },
    );
  }

  async listDocuments(input: {
    readonly companyId: string;
    readonly knowledgeBaseId?: string;
  }): Promise<readonly unknown[]> {
    const documents = await this.prisma.knowledgeDocument.findMany({
      where: {
        companyId: input.companyId,
        ...(input.knowledgeBaseId
          ? { knowledgeBaseId: input.knowledgeBaseId }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        knowledgeBaseId: true,
        title: true,
        description: true,
        sourceType: true,
        scope: true,
        visibility: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        departments: { select: { departmentId: true } },
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: {
            id: true,
            version: true,
            status: true,
            content: true,
            storageKey: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            sha256: true,
            provenance: true,
            effectiveFrom: true,
            effectiveUntil: true,
            publishedAt: true,
            createdAt: true,
          },
        },
      },
    });
    return documents.map((document) => ({
      id: document.id,
      knowledgeBaseId: document.knowledgeBaseId,
      title: document.title,
      description: document.description,
      sourceType: lower(document.sourceType),
      scope: lower(document.scope),
      visibility: lower(document.visibility),
      departmentIds: document.departments.map((entry) => entry.departmentId),
      archivedAt: document.archivedAt?.toISOString() ?? null,
      latestVersion: document.versions[0]
        ? versionOutput(document.versions[0])
        : null,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    }));
  }

  async getDocument(companyId: string, documentId: string): Promise<unknown> {
    const document = await this.prisma.knowledgeDocument.findFirst({
      where: { id: documentId, companyId },
      select: {
        id: true,
        knowledgeBaseId: true,
        title: true,
        description: true,
        sourceType: true,
        scope: true,
        visibility: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        departments: { select: { departmentId: true } },
        versions: {
          orderBy: { version: 'desc' },
          select: {
            id: true,
            version: true,
            status: true,
            content: true,
            storageKey: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            sha256: true,
            provenance: true,
            effectiveFrom: true,
            effectiveUntil: true,
            publishedAt: true,
            createdAt: true,
            chunks: {
              orderBy: { ordinal: 'asc' },
              select: {
                id: true,
                ordinal: true,
                pageNumber: true,
                content: true,
                contentHash: true,
                tokenCount: true,
                provenance: true,
              },
            },
          },
        },
      },
    });
    if (!document) throw notFound('Documento de knowledge');
    return {
      id: document.id,
      knowledgeBaseId: document.knowledgeBaseId,
      title: document.title,
      description: document.description,
      sourceType: lower(document.sourceType),
      scope: lower(document.scope),
      visibility: lower(document.visibility),
      departmentIds: document.departments.map((entry) => entry.departmentId),
      archivedAt: document.archivedAt?.toISOString() ?? null,
      versions: document.versions.map(versionOutput),
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    };
  }

  private async assertDepartments(
    transaction: TransactionClient,
    companyId: string,
    scope: KnowledgeDocumentScope,
    departmentIds: readonly string[],
  ): Promise<void> {
    const unique = [...new Set(departmentIds)];
    const expected = scope === 'tenant' ? 0 : scope === 'department' ? 1 : 2;
    if (
      (scope === 'tenant' && unique.length !== 0) ||
      (scope === 'department' && unique.length !== 1) ||
      (scope === 'multi-department' && unique.length < expected)
    ) {
      throw validationError(
        'Os departamentos não correspondem ao scope informado.',
      );
    }
    if (unique.length > 0) {
      const count = await transaction.tenantDepartment.count({
        where: { companyId, id: { in: unique } },
      });
      if (count !== unique.length) {
        throw forbidden('Um ou mais departamentos não pertencem ao tenant.');
      }
    }
  }

  createDocumentDraft(
    input: CreateKnowledgeDocumentDraftInput,
  ): Promise<unknown> {
    return this.command(
      input,
      {
        action: 'knowledge.document.create-draft',
        targetType: 'knowledge-document',
        targetId: input.documentId,
        fingerprint: fingerprint({
          companyId: input.companyId,
          documentId: input.documentId,
          knowledgeBaseId: input.knowledgeBaseId,
          title: input.title,
          description: input.description,
          sourceType: input.sourceType,
          scope: input.scope,
          visibility: input.visibility,
          departmentIds: [...input.departmentIds].sort(),
          contentHash: input.payload.sha256,
          fileName: input.payload.fileName,
          mimeType: input.payload.mimeType,
          sizeBytes: input.payload.sizeBytes,
          effectiveFrom: input.payload.effectiveFrom,
          effectiveUntil: input.payload.effectiveUntil,
        }),
      },
      async (transaction) => {
        const base = await transaction.knowledgeBase.findFirst({
          where: {
            id: input.knowledgeBaseId,
            companyId: input.companyId,
            enabled: true,
            archivedAt: null,
          },
          select: { id: true },
        });
        if (!base) throw notFound('Base de knowledge ativa');
        await this.assertDepartments(
          transaction,
          input.companyId,
          input.scope,
          input.departmentIds,
        );
        await transaction.knowledgeDocument.create({
          data: {
            id: input.documentId,
            companyId: input.companyId,
            knowledgeBaseId: input.knowledgeBaseId,
            title: input.title,
            description: input.description,
            sourceType: sourceValue(input.sourceType),
            scope: scopeValue(input.scope),
            visibility: visibilityValue(input.visibility),
            createdByUserId: input.actorUserId,
          },
        });
        if (input.departmentIds.length > 0) {
          await transaction.knowledgeDocumentDepartment.createMany({
            data: input.departmentIds.map((departmentId) => ({
              companyId: input.companyId,
              documentId: input.documentId,
              departmentId,
            })),
          });
        }
        await transaction.knowledgeDocumentVersion.create({
          data: {
            id: input.versionId,
            companyId: input.companyId,
            documentId: input.documentId,
            version: 1,
            status: KnowledgeVersionStatus.DRAFT,
            content: input.payload.content,
            storageKey: input.payload.storageKey,
            fileName: input.payload.fileName,
            mimeType: input.payload.mimeType,
            sizeBytes: input.payload.sizeBytes,
            sha256: input.payload.sha256,
            provenance: json(input.payload.provenance),
            effectiveFrom: input.payload.effectiveFrom,
            effectiveUntil: input.payload.effectiveUntil,
            createdByUserId: input.actorUserId,
          },
        });
        if (input.payload.chunks.length > 0) {
          await transaction.knowledgeChunk.createMany({
            data: chunkData(
              input.companyId,
              input.versionId,
              input.payload.chunks,
            ),
          });
        }
        return {
          documentId: input.documentId,
          versionId: input.versionId,
          version: 1,
          status: 'draft',
          extractionStatus: input.payload.provenance.extractionStatus ?? null,
        };
      },
    );
  }

  createNextDraft(input: CreateNextKnowledgeDraftInput): Promise<unknown> {
    return this.command(
      input,
      {
        action: 'knowledge.version.create-draft',
        targetType: 'knowledge-document-version',
        targetId: input.versionId,
        fingerprint: fingerprint({
          companyId: input.companyId,
          documentId: input.documentId,
          versionId: input.versionId,
          expectedVersion: input.expectedVersion,
          contentHash: input.content ? sha256(input.content) : null,
          effectiveFrom: input.effectiveFrom,
          effectiveUntil: input.effectiveUntil,
        }),
      },
      async (transaction) => {
        const document = await transaction.knowledgeDocument.findFirst({
          where: {
            id: input.documentId,
            companyId: input.companyId,
            archivedAt: null,
            sourceType: KnowledgeDocumentSourceType.ARTICLE,
          },
          select: {
            id: true,
            versions: {
              orderBy: { version: 'desc' },
              take: 1,
              select: {
                id: true,
                version: true,
                content: true,
                effectiveFrom: true,
                effectiveUntil: true,
                chunks: {
                  orderBy: { ordinal: 'asc' },
                  select: {
                    ordinal: true,
                    pageNumber: true,
                    content: true,
                    contentHash: true,
                    tokenCount: true,
                    provenance: true,
                  },
                },
              },
            },
          },
        });
        const latest = document?.versions[0];
        if (!document || !latest) throw notFound('Artigo de knowledge');
        if (latest.version !== input.expectedVersion) {
          throw conflict('A versão mais recente do artigo foi alterada.');
        }
        const existingDraft =
          await transaction.knowledgeDocumentVersion.findFirst({
            where: {
              companyId: input.companyId,
              documentId: input.documentId,
              status: KnowledgeVersionStatus.DRAFT,
            },
            select: { id: true },
          });
        if (existingDraft)
          throw conflict('O artigo já possui um draft editável.');
        const content = input.content?.trim() || latest.content;
        if (!content)
          throw validationError('O artigo não possui conteúdo para o draft.');
        const chunks: readonly KnowledgeChunkDraft[] =
          input.chunks.length > 0
            ? input.chunks
            : latest.chunks.map((chunk) => ({
                ...chunk,
                provenance: asRecord(chunk.provenance),
              }));
        const nextVersion = latest.version + 1;
        await transaction.knowledgeDocumentVersion.create({
          data: {
            id: input.versionId,
            companyId: input.companyId,
            documentId: input.documentId,
            version: nextVersion,
            status: KnowledgeVersionStatus.DRAFT,
            content,
            sha256: sha256(content),
            provenance: {
              source: 'article',
              derivedFromVersionId: latest.id,
              extractionStatus: 'completed',
            },
            effectiveFrom: input.effectiveFrom ?? latest.effectiveFrom,
            effectiveUntil: input.effectiveUntil ?? latest.effectiveUntil,
            createdByUserId: input.actorUserId,
          },
        });
        await transaction.knowledgeChunk.createMany({
          data: chunkData(input.companyId, input.versionId, chunks),
        });
        return {
          documentId: input.documentId,
          versionId: input.versionId,
          version: nextVersion,
          status: 'draft',
          contentHash: sha256(content),
        };
      },
    );
  }

  updateDraft(input: UpdateKnowledgeDraftInput): Promise<unknown> {
    return this.command(
      input,
      {
        action: 'knowledge.version.edit-draft',
        targetType: 'knowledge-document-version',
        targetId: input.versionId,
        fingerprint: fingerprint({
          companyId: input.companyId,
          documentId: input.documentId,
          versionId: input.versionId,
          expectedVersion: input.expectedVersion,
          expectedContentHash: input.expectedContentHash,
          contentHash: sha256(input.content),
          effectiveFrom: input.effectiveFrom,
          effectiveUntil: input.effectiveUntil,
        }),
      },
      async (transaction) => {
        const version = await transaction.knowledgeDocumentVersion.findFirst({
          where: {
            id: input.versionId,
            companyId: input.companyId,
            documentId: input.documentId,
            status: KnowledgeVersionStatus.DRAFT,
            document: {
              is: { sourceType: KnowledgeDocumentSourceType.ARTICLE },
            },
          },
          select: { id: true, version: true, sha256: true, provenance: true },
        });
        if (!version) throw notFound('Draft do artigo');
        if (
          version.version !== input.expectedVersion ||
          version.sha256 !== input.expectedContentHash
        ) {
          throw conflict('O draft foi alterado por outra operação.');
        }
        const contentHash = sha256(input.content);
        await transaction.knowledgeChunk.deleteMany({
          where: {
            companyId: input.companyId,
            documentVersionId: input.versionId,
          },
        });
        await transaction.knowledgeDocumentVersion.updateMany({
          where: {
            id: input.versionId,
            companyId: input.companyId,
            status: KnowledgeVersionStatus.DRAFT,
          },
          data: {
            content: input.content,
            sha256: contentHash,
            effectiveFrom: input.effectiveFrom,
            effectiveUntil: input.effectiveUntil,
            provenance: {
              ...asRecord(version.provenance),
              extractionStatus: 'completed',
              editedAt: new Date().toISOString(),
            },
          },
        });
        await transaction.knowledgeChunk.createMany({
          data: chunkData(input.companyId, input.versionId, input.chunks),
        });
        return {
          documentId: input.documentId,
          versionId: input.versionId,
          version: version.version,
          status: 'draft',
          contentHash,
        };
      },
    );
  }

  publishVersion(input: VersionedKnowledgeMutationInput): Promise<unknown> {
    return this.command(
      input,
      {
        action: 'knowledge.version.publish',
        targetType: 'knowledge-document-version',
        targetId: input.versionId,
        fingerprint: fingerprint({
          companyId: input.companyId,
          documentId: input.documentId,
          versionId: input.versionId,
          expectedVersion: input.expectedVersion,
        }),
      },
      async (transaction) => {
        const version = await transaction.knowledgeDocumentVersion.findFirst({
          where: {
            id: input.versionId,
            companyId: input.companyId,
            documentId: input.documentId,
            status: KnowledgeVersionStatus.DRAFT,
            document: {
              is: {
                companyId: input.companyId,
                archivedAt: null,
                knowledgeBase: { is: { enabled: true, archivedAt: null } },
              },
            },
          },
          select: {
            id: true,
            version: true,
            content: true,
            provenance: true,
            _count: { select: { chunks: true } },
          },
        });
        if (!version) throw notFound('Draft publicável');
        if (version.version !== input.expectedVersion) {
          throw conflict('A versão do draft não corresponde à esperada.');
        }
        if (
          !version.content?.trim() ||
          version._count.chunks < 1 ||
          asRecord(version.provenance).extractionStatus === 'unsupported'
        ) {
          throw validationError(
            'A versão não possui conteúdo extraído e chunks publicáveis.',
          );
        }
        await transaction.knowledgeDocumentVersion.updateMany({
          where: {
            companyId: input.companyId,
            documentId: input.documentId,
            status: KnowledgeVersionStatus.PUBLISHED,
            id: { not: input.versionId },
          },
          data: { status: KnowledgeVersionStatus.SUPERSEDED },
        });
        const publishedAt = new Date();
        await transaction.knowledgeDocumentVersion.updateMany({
          where: {
            id: input.versionId,
            companyId: input.companyId,
            status: KnowledgeVersionStatus.DRAFT,
          },
          data: {
            status: KnowledgeVersionStatus.PUBLISHED,
            publishedByUserId: input.actorUserId,
            publishedAt,
          },
        });
        return {
          documentId: input.documentId,
          versionId: input.versionId,
          version: version.version,
          status: 'published',
          publishedAt: publishedAt.toISOString(),
        };
      },
    );
  }

  archiveVersion(input: VersionedKnowledgeMutationInput): Promise<unknown> {
    return this.command(
      input,
      {
        action: 'knowledge.version.archive',
        targetType: 'knowledge-document-version',
        targetId: input.versionId,
        fingerprint: fingerprint({
          companyId: input.companyId,
          documentId: input.documentId,
          versionId: input.versionId,
          expectedVersion: input.expectedVersion,
        }),
      },
      async (transaction) => {
        const version = await transaction.knowledgeDocumentVersion.findFirst({
          where: {
            id: input.versionId,
            companyId: input.companyId,
            documentId: input.documentId,
          },
          select: { id: true, version: true, status: true },
        });
        if (!version) throw notFound('Versão de knowledge');
        if (version.version !== input.expectedVersion) {
          throw conflict('A versão foi alterada.');
        }
        await transaction.knowledgeDocumentVersion.updateMany({
          where: { id: input.versionId, companyId: input.companyId },
          data: { status: KnowledgeVersionStatus.ARCHIVED },
        });
        return {
          documentId: input.documentId,
          versionId: input.versionId,
          version: version.version,
          previousStatus: lower(version.status),
          status: 'archived',
        };
      },
    );
  }

  archiveDocument(input: ArchiveKnowledgeDocumentInput): Promise<unknown> {
    return this.command(
      input,
      {
        action: 'knowledge.document.archive',
        targetType: 'knowledge-document',
        targetId: input.documentId,
        fingerprint: fingerprint({
          companyId: input.companyId,
          documentId: input.documentId,
          expectedVersion: input.expectedVersion,
        }),
      },
      async (transaction) => {
        const document = await transaction.knowledgeDocument.findFirst({
          where: {
            id: input.documentId,
            companyId: input.companyId,
            archivedAt: null,
          },
          select: {
            id: true,
            versions: {
              orderBy: { version: 'desc' },
              take: 1,
              select: { version: true },
            },
          },
        });
        if (!document) throw notFound('Documento de knowledge ativo');
        if (document.versions[0]?.version !== input.expectedVersion) {
          throw conflict('A versão mais recente do documento foi alterada.');
        }
        const archivedAt = new Date();
        await transaction.knowledgeDocument.updateMany({
          where: { id: input.documentId, companyId: input.companyId },
          data: { archivedAt },
        });
        await transaction.knowledgeDocumentVersion.updateMany({
          where: {
            companyId: input.companyId,
            documentId: input.documentId,
            status: { not: KnowledgeVersionStatus.ARCHIVED },
          },
          data: { status: KnowledgeVersionStatus.ARCHIVED },
        });
        return {
          documentId: input.documentId,
          status: 'archived',
          archivedAt: archivedAt.toISOString(),
          retainedThroughVersion: input.expectedVersion,
        };
      },
    );
  }

  async findOriginal(input: {
    readonly companyId: string;
    readonly documentId: string;
    readonly versionId: string;
  }): Promise<{
    readonly storageKey: string;
    readonly fileName: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
    readonly sha256: string;
  } | null> {
    const version = await this.prisma.knowledgeDocumentVersion.findFirst({
      where: {
        id: input.versionId,
        companyId: input.companyId,
        documentId: input.documentId,
      },
      select: {
        storageKey: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        sha256: true,
      },
    });
    return version?.storageKey &&
      version.fileName &&
      version.mimeType &&
      version.sizeBytes !== null &&
      version.sha256
      ? {
          storageKey: version.storageKey,
          fileName: version.fileName,
          mimeType: version.mimeType,
          sizeBytes: version.sizeBytes,
          sha256: version.sha256,
        }
      : null;
  }

  async listSuggestions(input: {
    readonly companyId: string;
    readonly status?: KnowledgeSuggestionStatus;
  }): Promise<readonly unknown[]> {
    const status = input.status
      ? KnowledgeReviewStatus[
          input.status.toUpperCase() as keyof typeof KnowledgeReviewStatus
        ]
      : undefined;
    const rows = await this.prisma.knowledgeSuggestion.findMany({
      where: { companyId: input.companyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        serviceSessionId: true,
        agentExecutionId: true,
        resultingDocumentId: true,
        title: true,
        proposedContent: true,
        evidence: true,
        status: true,
        reviewedByUserId: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      evidence: safeEvidence(row.evidence),
      status: lower(row.status),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  createAgentSuggestion(
    input: CreateAgentKnowledgeSuggestionInput,
  ): Promise<AgentKnowledgeSuggestionCreationResult> {
    return this.serviceCommand(
      input,
      {
        action: 'knowledge.suggestion.create-from-agent',
        targetType: 'knowledge-suggestion',
        fingerprint: fingerprint({
          companyId: input.companyId,
          suggestionId: input.suggestionId,
          serviceSessionId: input.serviceSessionId,
          agentExecutionId: input.agentExecutionId,
          actorType: input.actor.type,
          serviceIdentityId:
            input.actor.type === 'service-identity'
              ? input.actor.serviceIdentityId
              : null,
          titleSha256: sha256(input.title),
          proposedContentSha256: sha256(input.proposedContent),
          evidenceMessageIds: input.evidenceMessageIds,
        }),
      },
      async (transaction, provenance) => {
        const observedAt = new Date();
        const evidence = await this.redactedAgentEvidence(
          transaction,
          input,
          provenance.agentId,
          observedAt,
        );
        const suggestion = await transaction.knowledgeSuggestion.create({
          data: {
            id: input.suggestionId,
            companyId: input.companyId,
            serviceSessionId: input.serviceSessionId,
            agentExecutionId: input.agentExecutionId,
            resultingDocumentId: null,
            title: input.title,
            proposedContent: input.proposedContent,
            evidence: jsonArray([evidence]),
            status: KnowledgeReviewStatus.PENDING,
          },
          select: { id: true, createdAt: true },
        });
        return {
          targetId: suggestion.id,
          result: {
            suggestionId: suggestion.id,
            status: 'pending' as const,
            createdAt: suggestion.createdAt.toISOString(),
            automaticPublication: false as const,
          },
        };
      },
    );
  }

  reviewSuggestion(
    input: KnowledgeMutationIdentity & {
      readonly suggestionId: string;
      readonly decision: KnowledgeSuggestionReview;
    },
  ): Promise<unknown> {
    return this.command(
      input,
      {
        action: 'knowledge.suggestion.review',
        targetType: 'knowledge-suggestion',
        targetId: input.suggestionId,
        fingerprint: fingerprint({
          companyId: input.companyId,
          suggestionId: input.suggestionId,
          decision: input.decision,
        }),
      },
      async (transaction) => {
        const existing = await transaction.knowledgeSuggestion.findFirst({
          where: {
            id: input.suggestionId,
            companyId: input.companyId,
            status: KnowledgeReviewStatus.PENDING,
          },
          select: { id: true },
        });
        if (!existing) throw notFound('Sugestão de knowledge pendente');
        const status =
          input.decision === 'approved'
            ? KnowledgeReviewStatus.APPROVED
            : KnowledgeReviewStatus.REJECTED;
        const reviewedAt = new Date();
        await transaction.knowledgeSuggestion.updateMany({
          where: { id: input.suggestionId, companyId: input.companyId },
          data: {
            status,
            reviewedByUserId: input.actorUserId,
            reviewedAt,
          },
        });
        return {
          suggestionId: input.suggestionId,
          status: input.decision,
          reviewedAt: reviewedAt.toISOString(),
          automaticPublication: false,
        };
      },
    );
  }

  async listGaps(input: {
    readonly companyId: string;
    readonly status?: KnowledgeGapStatusValue;
  }): Promise<readonly unknown[]> {
    const status = input.status
      ? KnowledgeGapStatus[
          input.status.toUpperCase() as keyof typeof KnowledgeGapStatus
        ]
      : undefined;
    const rows = await this.prisma.knowledgeGap.findMany({
      where: { companyId: input.companyId, ...(status ? { status } : {}) },
      orderBy: [{ occurrenceCount: 'desc' }, { lastObservedAt: 'desc' }],
      select: {
        id: true,
        serviceSessionId: true,
        agentExecutionId: true,
        topic: true,
        occurrenceCount: true,
        status: true,
        evidence: true,
        firstObservedAt: true,
        lastObservedAt: true,
        resolvedAt: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      evidence: safeEvidence(row.evidence),
      status: lower(row.status),
      firstObservedAt: row.firstObservedAt.toISOString(),
      lastObservedAt: row.lastObservedAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    }));
  }

  observeAgentGap(
    input: ObserveAgentKnowledgeGapInput,
  ): Promise<AgentKnowledgeGapObservationResult> {
    return this.serviceCommand(
      input,
      {
        action: 'knowledge.gap.observe-from-agent',
        targetType: 'knowledge-gap',
        fingerprint: fingerprint({
          companyId: input.companyId,
          serviceSessionId: input.serviceSessionId,
          agentExecutionId: input.agentExecutionId,
          actorType: input.actor.type,
          serviceIdentityId:
            input.actor.type === 'service-identity'
              ? input.actor.serviceIdentityId
              : null,
          topicNormalized: input.topicNormalized,
          evidenceMessageIds: input.evidenceMessageIds,
        }),
      },
      async (transaction, provenance) => {
        await transaction.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${`${input.companyId}:knowledge-gap:${input.topicNormalized}`})
          )
        `;
        const observedAt = new Date();
        const observation = await this.redactedAgentEvidence(
          transaction,
          input,
          provenance.agentId,
          observedAt,
        );
        const existing = await transaction.knowledgeGap.findUnique({
          where: {
            companyId_topicNormalized: {
              companyId: input.companyId,
              topicNormalized: input.topicNormalized,
            },
          },
          select: {
            id: true,
            status: true,
            occurrenceCount: true,
            evidence: true,
          },
        });
        if (existing) {
          const evidence = [
            ...safeEvidence(existing.evidence).slice(
              -(MAX_STORED_GAP_EVIDENCE - 1),
            ),
            observation,
          ];
          const changed = await transaction.knowledgeGap.updateMany({
            where: {
              id: existing.id,
              companyId: input.companyId,
              occurrenceCount: existing.occurrenceCount,
            },
            data: {
              serviceSessionId: input.serviceSessionId,
              agentExecutionId: input.agentExecutionId,
              occurrenceCount: { increment: 1 },
              evidence: jsonArray(evidence),
              lastObservedAt: observedAt,
            },
          });
          if (changed.count !== 1) {
            throw conflict(
              'A lacuna foi observada simultaneamente por outra execução.',
            );
          }
          return {
            targetId: existing.id,
            result: {
              gapId: existing.id,
              topicNormalized: input.topicNormalized,
              status: lower(existing.status) as KnowledgeGapStatusValue,
              occurrenceCount: existing.occurrenceCount + 1,
              observedAt: observedAt.toISOString(),
              automaticPublication: false as const,
            },
          };
        }
        const created = await transaction.knowledgeGap.create({
          data: {
            id: input.gapId,
            companyId: input.companyId,
            serviceSessionId: input.serviceSessionId,
            agentExecutionId: input.agentExecutionId,
            topic: input.topic,
            topicNormalized: input.topicNormalized,
            occurrenceCount: 1,
            status: KnowledgeGapStatus.OPEN,
            evidence: jsonArray([observation]),
            firstObservedAt: observedAt,
            lastObservedAt: observedAt,
          },
          select: { id: true },
        });
        return {
          targetId: created.id,
          result: {
            gapId: created.id,
            topicNormalized: input.topicNormalized,
            status: 'open' as const,
            occurrenceCount: 1,
            observedAt: observedAt.toISOString(),
            automaticPublication: false as const,
          },
        };
      },
    );
  }

  reviewGap(
    input: KnowledgeMutationIdentity & {
      readonly gapId: string;
      readonly decision: KnowledgeGapReview;
    },
  ): Promise<unknown> {
    return this.command(
      input,
      {
        action: 'knowledge.gap.review',
        targetType: 'knowledge-gap',
        targetId: input.gapId,
        fingerprint: fingerprint({
          companyId: input.companyId,
          gapId: input.gapId,
          decision: input.decision,
        }),
      },
      async (transaction) => {
        const existing = await transaction.knowledgeGap.findFirst({
          where: { id: input.gapId, companyId: input.companyId },
          select: { id: true, status: true },
        });
        if (!existing) throw notFound('Gap de knowledge');
        const status =
          input.decision === 'acknowledged'
            ? KnowledgeGapStatus.ACKNOWLEDGED
            : input.decision === 'resolved'
              ? KnowledgeGapStatus.RESOLVED
              : KnowledgeGapStatus.DISMISSED;
        const terminal =
          status === KnowledgeGapStatus.RESOLVED ||
          status === KnowledgeGapStatus.DISMISSED;
        const reviewedAt = new Date();
        await transaction.knowledgeGap.updateMany({
          where: { id: input.gapId, companyId: input.companyId },
          data: { status, resolvedAt: terminal ? reviewedAt : null },
        });
        return {
          gapId: input.gapId,
          previousStatus: lower(existing.status),
          status: input.decision,
          reviewedAt: reviewedAt.toISOString(),
        };
      },
    );
  }
}
