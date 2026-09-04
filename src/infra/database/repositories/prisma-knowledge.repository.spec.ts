import { describe, expect, it, vi } from 'vitest';

import {
  KnowledgeDocumentSourceType,
  KnowledgeScope,
  KnowledgeVersionStatus,
  KnowledgeVisibility,
} from '../prisma/generated/client';
import type { PrismaService } from '../prisma/prisma.service';
import { PrismaKnowledgeRepository } from './prisma-knowledge.repository';

const companyId = '00000000-0000-4000-8000-000000000001';
const actorUserId = '00000000-0000-4000-8000-000000000002';
const commandId = '00000000-0000-4000-8000-000000000003';
const baseId = '00000000-0000-4000-8000-000000000004';
const documentId = '00000000-0000-4000-8000-000000000005';
const versionId = '00000000-0000-4000-8000-000000000006';
const departmentId = '00000000-0000-4000-8000-000000000007';

function transactionBase() {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    tenantAuditLog: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    user: { findFirst: vi.fn().mockResolvedValue({ id: actorUserId }) },
  };
}

function repositoryWithTransaction<
  T extends ReturnType<typeof transactionBase>,
>(transaction: T) {
  const prisma = {
    $transaction: vi.fn(async (operation: (client: T) => Promise<unknown>) =>
      operation(transaction),
    ),
  };
  return {
    prisma,
    repository: new PrismaKnowledgeRepository(
      prisma as unknown as PrismaService,
    ),
  };
}

describe('PrismaKnowledgeRepository', () => {
  it('lista somente departamentos do tenant para seleção de scope', async () => {
    const prisma = {
      tenantDepartment: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const repository = new PrismaKnowledgeRepository(
      prisma as unknown as PrismaService,
    );

    await repository.listScopeDepartments(companyId);

    expect(prisma.tenantDepartment.findMany).toHaveBeenCalledWith({
      where: { companyId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, isDefault: true },
    });
  });

  it('nega documento cross-tenant com filtro composto, sem busca global de fallback', async () => {
    const prisma = {
      knowledgeDocument: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const repository = new PrismaKnowledgeRepository(
      prisma as unknown as PrismaService,
    );

    await expect(
      repository.getDocument('tenant-b', documentId),
    ).rejects.toHaveProperty('code', 'NOT_FOUND');
    expect(prisma.knowledgeDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: documentId, companyId: 'tenant-b' },
      }),
    );
  });

  it('detalha todas as versões retidas sem expor a chave interna do original', async () => {
    const createdAt = new Date('2026-08-29T10:00:00.000Z');
    const version = (input: {
      id: string;
      version: number;
      status: KnowledgeVersionStatus;
      content: string;
    }) => ({
      ...input,
      storageKey: `v1/${companyId}/${documentId}/${input.id}/${'a'.repeat(64)}`,
      fileName: `manual-v${input.version}.txt`,
      mimeType: 'text/plain',
      sizeBytes: input.content.length,
      sha256: 'a'.repeat(64),
      provenance: { extractor: 'utf8-text-v1' },
      effectiveFrom: createdAt,
      effectiveUntil: null,
      publishedAt: createdAt,
      createdAt,
      chunks: [],
    });
    const prisma = {
      knowledgeDocument: {
        findFirst: vi.fn().mockResolvedValue({
          id: documentId,
          knowledgeBaseId: baseId,
          title: 'Manual',
          description: null,
          sourceType: KnowledgeDocumentSourceType.FILE,
          scope: KnowledgeScope.TENANT,
          visibility: KnowledgeVisibility.INTERNAL,
          archivedAt: null,
          createdAt,
          updatedAt: createdAt,
          departments: [],
          versions: [
            version({
              id: versionId,
              version: 2,
              status: KnowledgeVersionStatus.PUBLISHED,
              content: 'novo',
            }),
            version({
              id: '00000000-0000-4000-8000-000000000008',
              version: 1,
              status: KnowledgeVersionStatus.SUPERSEDED,
              content: 'antigo preservado',
            }),
          ],
        }),
      },
    };
    const repository = new PrismaKnowledgeRepository(
      prisma as unknown as PrismaService,
    );

    const result = await repository.getDocument(companyId, documentId);

    expect(result).toMatchObject({
      id: documentId,
      versions: [
        { version: 2, status: 'published', content: 'novo' },
        { version: 1, status: 'superseded', content: 'antigo preservado' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('storageKey');
    expect(JSON.stringify(result)).not.toContain(`v1/${companyId}`);
  });

  it('nega department scope quando qualquer departamento pertence a outro tenant', async () => {
    const transaction = {
      ...transactionBase(),
      knowledgeBase: { findFirst: vi.fn().mockResolvedValue({ id: baseId }) },
      tenantDepartment: { count: vi.fn().mockResolvedValue(0) },
      knowledgeDocument: { create: vi.fn() },
      knowledgeDocumentDepartment: { createMany: vi.fn() },
      knowledgeDocumentVersion: { create: vi.fn() },
      knowledgeChunk: { createMany: vi.fn() },
    };
    const { repository } = repositoryWithTransaction(transaction);

    await expect(
      repository.createDocumentDraft({
        companyId,
        actorUserId,
        commandId,
        knowledgeBaseId: baseId,
        documentId,
        versionId,
        title: 'Documento',
        description: null,
        sourceType: 'article',
        scope: 'department',
        visibility: 'internal',
        departmentIds: [departmentId],
        payload: {
          content: 'conteúdo',
          storageKey: null,
          fileName: null,
          mimeType: null,
          sizeBytes: null,
          sha256: 'a'.repeat(64),
          provenance: { extractionStatus: 'completed' },
          effectiveFrom: null,
          effectiveUntil: null,
          chunks: [],
        },
      }),
    ).rejects.toHaveProperty('code', 'FORBIDDEN');
    expect(transaction.tenantDepartment.count).toHaveBeenCalledWith({
      where: { companyId, id: { in: [departmentId] } },
    });
    expect(transaction.knowledgeDocument.create).not.toHaveBeenCalled();
  });

  it('publica somente o DRAFT exato e supersede a versão anterior sem alterar payload', async () => {
    const transaction = {
      ...transactionBase(),
      knowledgeDocumentVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: versionId,
          version: 2,
          content: 'conteúdo aprovado',
          provenance: { extractionStatus: 'completed' },
          _count: { chunks: 1 },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { repository } = repositoryWithTransaction(transaction);

    await expect(
      repository.publishVersion({
        companyId,
        actorUserId,
        commandId,
        documentId,
        versionId,
        expectedVersion: 2,
      }),
    ).resolves.toMatchObject({ status: 'published', version: 2 });

    expect(transaction.knowledgeDocumentVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: versionId,
          companyId,
          documentId,
          status: KnowledgeVersionStatus.DRAFT,
        }),
      }),
    );
    expect(
      transaction.knowledgeDocumentVersion.updateMany,
    ).toHaveBeenNthCalledWith(1, {
      where: {
        companyId,
        documentId,
        status: KnowledgeVersionStatus.PUBLISHED,
        id: { not: versionId },
      },
      data: { status: KnowledgeVersionStatus.SUPERSEDED },
    });
    expect(
      transaction.knowledgeDocumentVersion.updateMany,
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          id: versionId,
          companyId,
          status: KnowledgeVersionStatus.DRAFT,
        },
        data: expect.objectContaining({
          status: KnowledgeVersionStatus.PUBLISHED,
          publishedByUserId: actorUserId,
        }),
      }),
    );
    for (const call of transaction.knowledgeDocumentVersion.updateMany.mock
      .calls) {
      expect(call[0]?.data).not.toHaveProperty('content');
      expect(call[0]?.data).not.toHaveProperty('sha256');
      expect(call[0]?.data).not.toHaveProperty('provenance');
    }
  });

  it('recusa publicar original sem extração/chunks e preserva seu DRAFT', async () => {
    const transaction = {
      ...transactionBase(),
      knowledgeDocumentVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: versionId,
          version: 1,
          content: null,
          provenance: {
            extractionStatus: 'unsupported',
            limitationCode: 'PDF_PARSER_NOT_CONFIGURED',
          },
          _count: { chunks: 0 },
        }),
        updateMany: vi.fn(),
      },
    };
    const { repository } = repositoryWithTransaction(transaction);

    await expect(
      repository.publishVersion({
        companyId,
        actorUserId,
        commandId,
        documentId,
        versionId,
        expectedVersion: 1,
      }),
    ).rejects.toHaveProperty('code', 'VALIDATION_ERROR');
    expect(
      transaction.knowledgeDocumentVersion.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('arquiva sem delete físico e retém todas as versões', async () => {
    const transaction = {
      ...transactionBase(),
      knowledgeDocument: {
        findFirst: vi.fn().mockResolvedValue({
          id: documentId,
          versions: [{ version: 3 }],
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      knowledgeDocumentVersion: {
        updateMany: vi.fn().mockResolvedValue({ count: 3 }),
      },
    };
    const { repository } = repositoryWithTransaction(transaction);

    await repository.archiveDocument({
      companyId,
      actorUserId,
      commandId,
      documentId,
      expectedVersion: 3,
    });

    expect(transaction.knowledgeDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: documentId, companyId } }),
    );
    expect(
      transaction.knowledgeDocumentVersion.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        companyId,
        documentId,
        status: { not: KnowledgeVersionStatus.ARCHIVED },
      },
      data: { status: KnowledgeVersionStatus.ARCHIVED },
    });
    expect(transaction).not.toHaveProperty('knowledgeDocument.delete');
    expect(transaction).not.toHaveProperty('knowledgeDocumentVersion.delete');
  });

  it('edita draft somente para ARTICLE do mesmo tenant', async () => {
    const transaction = {
      ...transactionBase(),
      knowledgeDocumentVersion: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      knowledgeChunk: { deleteMany: vi.fn(), createMany: vi.fn() },
    };
    const { repository } = repositoryWithTransaction(transaction);

    await expect(
      repository.updateDraft({
        companyId,
        actorUserId,
        commandId,
        documentId,
        versionId,
        expectedVersion: 1,
        expectedContentHash: 'a'.repeat(64),
        content: 'novo',
        effectiveFrom: null,
        effectiveUntil: null,
        chunks: [],
      }),
    ).rejects.toHaveProperty('code', 'NOT_FOUND');
    expect(transaction.knowledgeDocumentVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId,
          document: {
            is: { sourceType: KnowledgeDocumentSourceType.ARTICLE },
          },
        }),
      }),
    );
    expect(transaction.knowledgeChunk.deleteMany).not.toHaveBeenCalled();
  });
});
