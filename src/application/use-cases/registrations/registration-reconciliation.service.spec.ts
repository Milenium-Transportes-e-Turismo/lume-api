import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../infra/database/prisma/prisma.service';
import type {
  ParsedRegistrationWorkbook,
  RegistrationReconciliationWorkbookService,
} from '../../../infra/registrations/registration-reconciliation-workbook.service';
import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';
import { RegistrationReconciliationService } from './registration-reconciliation.service';
import type { RegistrationsService } from './registrations.service';

const current = {
  id: '11111111-1111-4111-8111-111111111111',
  companyId: '22222222-2222-4222-8222-222222222222',
  routingCompanyId: null,
} as AuthenticatedPrincipal;

type CandidateStatus =
  | 'READY_FOR_DECISION'
  | 'IN_REVIEW'
  | 'UNIDENTIFIED'
  | 'IGNORED'
  | 'APPROVED'
  | 'PROMOTED';

function candidate(status: CandidateStatus) {
  const now = new Date('2026-08-26T12:00:00.000Z');
  return {
    id: '33333333-3333-4333-8333-333333333333',
    companyId: current.companyId,
    batchId: '44444444-4444-4444-8444-444444444444',
    status,
    suggestedType: 'PF',
    confirmedType: 'PF',
    displayName: 'Maria Silva',
    normalizedName: 'Maria Silva',
    documentOriginal: null,
    documentNormalized: null,
    documentValid: null,
    phoneOriginal: '(34) 99999-0000',
    phoneNormalized: '5534999990000',
    city: 'Uberlândia',
    state: 'MG',
    confidence: 80,
    priority: 100,
    suggestedRoles: [],
    suggestedRoleCodes: [],
    evidence: [],
    qualityIssues: [],
    minimumDataComplete: true,
    confirmedPayload: {
      type: 'pf',
      firstName: 'Maria',
      roleCodes: ['client'],
      phones: [{ number: '5534999990000' }],
    },
    whatsappConversationId: null,
    reviewerUserId: current.id,
    reviewedAt: now,
    promotedRegistrationId:
      status === 'PROMOTED' ? '55555555-5555-4555-8555-555555555555' : null,
    promotedAt: status === 'PROMOTED' ? now : null,
    version: 3,
    createdAt: now,
    updatedAt: now,
    batch: {
      id: '44444444-4444-4444-8444-444444444444',
      fileName: 'resultado.xlsx',
      source: 'whatsapp-analysis-workbook',
      createdAt: now,
    },
    sources: [],
    decisions: [],
    promotedRegistration:
      status === 'PROMOTED'
        ? {
            id: '55555555-5555-4555-8555-555555555555',
            clientType: 'PF',
            individualName: 'Maria Silva',
            legalName: 'Maria Silva',
            tradeName: null,
          }
        : null,
  };
}

function importBatch(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-08-26T12:00:00.000Z');
  return {
    id: '44444444-4444-4444-8444-444444444444',
    companyId: current.companyId,
    actorUserId: current.id,
    fileName: 'resultado.xlsx',
    fileSha256: 'b'.repeat(64),
    source: 'whatsapp-analysis-workbook',
    status: 'PROCESSING',
    metadata: {},
    counts: {},
    totalRows: 0,
    importedRows: 0,
    duplicateRows: 0,
    ignoredRows: 0,
    errorRows: 0,
    errorMessage: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function parsedWorkbook(
  records: ParsedRegistrationWorkbook['records'],
): ParsedRegistrationWorkbook {
  return {
    fileSha256: 'b'.repeat(64),
    records,
    matches: [],
    rowErrors: [],
    metadata: {},
  };
}

describe('RegistrationReconciliationService', () => {
  it('returns the original batch when the exact file was already imported', async () => {
    const now = new Date('2026-08-26T12:00:00.000Z');
    const existingBatch = {
      id: '44444444-4444-4444-8444-444444444444',
      companyId: current.companyId,
      actorUserId: current.id,
      fileName: 'resultado.xlsx',
      fileSha256: 'a'.repeat(64),
      source: 'whatsapp-analysis-workbook',
      status: 'COMPLETED',
      metadata: {},
      counts: {},
      totalRows: 10,
      importedRows: 10,
      duplicateRows: 0,
      ignoredRows: 0,
      errorRows: 0,
      errorMessage: null,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const createBatch = vi.fn();
    const prisma = {
      registrationImportBatch: {
        findUnique: vi.fn().mockResolvedValue(existingBatch),
        create: createBatch,
      },
    } as unknown as PrismaService;
    const workbook = {
      parse: vi.fn().mockResolvedValue({
        fileSha256: existingBatch.fileSha256,
        records: [],
        matches: [],
        rowErrors: [],
        metadata: {},
      }),
    } as unknown as RegistrationReconciliationWorkbookService;
    const service = new RegistrationReconciliationService(
      prisma,
      workbook,
      {} as RegistrationsService,
    );

    await expect(
      service.import(current, {
        fileName: 'resultado.xlsx',
        content: Buffer.from('xlsx'),
      }),
    ).resolves.toMatchObject({ id: existingBatch.id, duplicateFile: true });
    expect(createBatch).not.toHaveBeenCalled();
  });

  it('does not promote a candidate twice', async () => {
    const promoted = candidate('PROMOTED');
    const transaction = {
      registrationReviewDecision: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      registrationCandidate: {
        findUnique: vi.fn().mockResolvedValue(promoted),
        findUniqueOrThrow: vi.fn().mockResolvedValue(promoted),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (operation: (value: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    } as unknown as PrismaService;
    const createPromotionGraph = vi.fn();
    const registrations = {
      createPromotionGraph,
    } as unknown as RegistrationsService;
    const service = new RegistrationReconciliationService(
      prisma,
      {} as RegistrationReconciliationWorkbookService,
      registrations,
    );

    await expect(
      service.promote(current, promoted.id, {
        commandId: '66666666-6666-4666-8666-666666666666',
        expectedVersion: promoted.version,
      }),
    ).resolves.toMatchObject({ status: 'promoted' });
    expect(createPromotionGraph).not.toHaveBeenCalled();
  });

  it('delegates an approved atomic graph to the official Cadastro use case', async () => {
    const approved = candidate('APPROVED');
    const promoted = candidate('PROMOTED');
    const transaction = {
      registrationReviewDecision: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      registrationCandidate: {
        findUnique: vi.fn().mockResolvedValue(approved),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(promoted),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (operation: (value: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    } as unknown as PrismaService;
    const createPromotionGraph = vi.fn().mockResolvedValue({
      primaryRegistrationId: promoted.promotedRegistrationId,
      registrationIds: [promoted.promotedRegistrationId],
      relationshipIds: [],
    });
    const registrations = {
      createPromotionGraph,
    } as unknown as RegistrationsService;
    const service = new RegistrationReconciliationService(
      prisma,
      {} as RegistrationReconciliationWorkbookService,
      registrations,
    );
    const commandId = '66666666-6666-4666-8666-666666666666';

    await service.promote(current, approved.id, {
      commandId,
      expectedVersion: approved.version,
    });

    expect(createPromotionGraph).toHaveBeenCalledWith(
      transaction,
      current,
      approved.confirmedPayload,
      { commandId, candidateId: approved.id },
    );
    expect(transaction.registrationCandidate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'APPROVED',
          promotedRegistrationId: null,
        }),
        data: expect.objectContaining({
          status: 'PROMOTED',
          promotedRegistrationId: promoted.promotedRegistrationId,
        }),
      }),
    );
  });

  it('saves corrected data with the reviewer and an immutable decision snapshot', async () => {
    const before = candidate('READY_FOR_DECISION');
    const correctedPayload = {
      primaryLocalId: 'primary',
      registrations: [
        {
          localId: 'primary',
          registration: {
            type: 'pf' as const,
            firstName: 'Maria Corrigida',
            roleCodes: ['client'],
            phones: [{ number: '5534999990000' }],
          },
        },
      ],
      relationships: [],
    };
    const after = {
      ...candidate('IN_REVIEW'),
      confirmedPayload: correctedPayload,
      version: before.version + 1,
    };
    const createDecision = vi.fn().mockResolvedValue({});
    const updateCandidate = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      registrationReviewDecision: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: createDecision,
      },
      registrationCandidate: {
        findUnique: vi.fn().mockResolvedValue(before),
        updateMany: updateCandidate,
        findUniqueOrThrow: vi.fn().mockResolvedValue(after),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (operation: (value: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    } as unknown as PrismaService;
    const service = new RegistrationReconciliationService(
      prisma,
      {} as RegistrationReconciliationWorkbookService,
      {} as RegistrationsService,
    );

    await expect(
      service.review(current, before.id, {
        commandId: '77777777-7777-4777-8777-777777777777',
        expectedVersion: before.version,
        action: 'save-review',
        confirmedPayload: correctedPayload,
        note: 'Nome confirmado durante a revisão.',
      }),
    ).resolves.toMatchObject({
      status: 'in-review',
      confirmedPayload: correctedPayload,
      reviewerUserId: current.id,
    });
    expect(updateCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'IN_REVIEW',
          reviewerUserId: current.id,
          confirmedPayload: correctedPayload,
        }),
      }),
    );
    expect(createDecision).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: current.id,
        action: 'SAVE_REVIEW',
        beforeSnapshot: expect.objectContaining({
          status: 'READY_FOR_DECISION',
        }),
        afterSnapshot: expect.objectContaining({ status: 'IN_REVIEW' }),
      }),
    });
  });

  it.each([
    ['mark-unidentified', 'UNIDENTIFIED', 'MARK_UNIDENTIFIED'],
    ['ignore', 'IGNORED', 'IGNORE'],
  ] as const)(
    'records the individual review action %s',
    async (action, targetStatus, decisionAction) => {
      const before = candidate('READY_FOR_DECISION');
      const after = { ...candidate(targetStatus), version: before.version + 1 };
      const createDecision = vi.fn().mockResolvedValue({});
      const updateCandidate = vi.fn().mockResolvedValue({ count: 1 });
      const transaction = {
        registrationReviewDecision: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: createDecision,
        },
        registrationCandidate: {
          findUnique: vi.fn().mockResolvedValue(before),
          updateMany: updateCandidate,
          findUniqueOrThrow: vi.fn().mockResolvedValue(after),
        },
      };
      const prisma = {
        $transaction: vi.fn(
          async (operation: (value: typeof transaction) => Promise<unknown>) =>
            operation(transaction),
        ),
      } as unknown as PrismaService;
      const service = new RegistrationReconciliationService(
        prisma,
        {} as RegistrationReconciliationWorkbookService,
        {} as RegistrationsService,
      );

      await service.review(current, before.id, {
        commandId:
          action === 'ignore'
            ? '88888888-8888-4888-8888-888888888888'
            : '99999999-9999-4999-8999-999999999999',
        expectedVersion: before.version,
        action,
      });

      expect(updateCandidate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: targetStatus }),
        }),
      );
      expect(createDecision).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: decisionAction }),
      });
    },
  );

  it('rolls back promotion orchestration when the official Cadastro use case fails', async () => {
    const approved = candidate('APPROVED');
    const updateCandidate = vi.fn();
    const createDecision = vi.fn();
    const transaction = {
      registrationReviewDecision: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: createDecision,
      },
      registrationCandidate: {
        findUnique: vi.fn().mockResolvedValue(approved),
        updateMany: updateCandidate,
        findUniqueOrThrow: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (operation: (value: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    } as unknown as PrismaService;
    const createPromotionGraph = vi
      .fn()
      .mockRejectedValue(new Error('Falha ao criar relacionamento.'));
    const service = new RegistrationReconciliationService(
      prisma,
      {} as RegistrationReconciliationWorkbookService,
      { createPromotionGraph } as unknown as RegistrationsService,
    );

    await expect(
      service.promote(current, approved.id, {
        commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        expectedVersion: approved.version,
      }),
    ).rejects.toThrow('Falha ao criar relacionamento.');
    expect(updateCandidate).not.toHaveBeenCalled();
    expect(createDecision).not.toHaveBeenCalled();
  });

  it('preserves the existing reviewed candidate when a new backup repeats its stable source', async () => {
    const batch = importBatch();
    const sourceRecord = {
      kind: 'PDF_CUSTOMER' as const,
      sourceSheet: 'Clientes PDF',
      sourceRow: 5,
      externalId: 'pdf-p001-r01',
      fingerprint: 'c'.repeat(64),
      rawPayload: { nome_original: 'Maria Silva' },
      normalizedPayload: {
        name: 'Maria Silva',
        phone: null,
        document: '52998224725',
      },
      technicalRecord: false,
    };
    const persistedRecord = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      fingerprint: sourceRecord.fingerprint,
    };
    const createCandidates = vi.fn();
    const transaction = {
      registrationExternalRecord: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([persistedRecord]),
      },
      registrationCandidateSource: {
        findMany: vi.fn().mockResolvedValue([
          {
            externalRecordId: persistedRecord.id,
            candidateId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          },
        ]),
        createMany: vi.fn(),
      },
      whatsAppConversation: { findMany: vi.fn() },
      registrationCandidate: { createMany: createCandidates },
      registrationImportBatch: {
        update: vi.fn().mockResolvedValue(
          importBatch({
            status: 'COMPLETED',
            completedAt: new Date('2026-08-26T12:01:00.000Z'),
            duplicateRows: 1,
          }),
        ),
      },
    };
    const prisma = {
      registrationImportBatch: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(batch),
        update: vi.fn(),
      },
      $transaction: vi.fn(
        async (operation: (value: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    } as unknown as PrismaService;
    const workbook = {
      parse: vi.fn().mockResolvedValue(parsedWorkbook([sourceRecord])),
    } as unknown as RegistrationReconciliationWorkbookService;
    const service = new RegistrationReconciliationService(
      prisma,
      workbook,
      {} as RegistrationsService,
    );

    await service.import(current, {
      fileName: 'novo-backup.xlsx',
      content: Buffer.from('novo-backup'),
    });

    expect(createCandidates).not.toHaveBeenCalled();
    expect(
      transaction.registrationCandidateSource.createMany,
    ).not.toHaveBeenCalled();
  });

  it('creates PF, PJ and unmatched WhatsApp candidates without inventing roles', async () => {
    const batch = importBatch();
    const records: ParsedRegistrationWorkbook['records'] = [
      {
        kind: 'PDF_CUSTOMER',
        sourceSheet: 'Clientes PDF',
        sourceRow: 5,
        externalId: 'pdf-pf',
        fingerprint: 'd'.repeat(64),
        rawPayload: {
          nome_original: 'Ana Souza',
          documento: '529.982.247-25',
        },
        normalizedPayload: {
          name: 'Ana Souza',
          phone: null,
          document: '52998224725',
        },
        technicalRecord: false,
      },
      {
        kind: 'PDF_CUSTOMER',
        sourceSheet: 'Clientes PDF',
        sourceRow: 6,
        externalId: 'pdf-pj',
        fingerprint: 'e'.repeat(64),
        rawPayload: {
          nome_original: 'Empresa Exemplo Ltda',
          documento: '11.222.333/0001-81',
        },
        normalizedPayload: {
          name: 'Empresa Exemplo Ltda',
          phone: null,
          document: '11222333000181',
        },
        technicalRecord: false,
      },
      {
        kind: 'WHATSAPP_CONTACT',
        sourceSheet: 'Contatos WhatsApp',
        sourceRow: 5,
        externalId: '5534999990000@s.whatsapp.net',
        fingerprint: 'f'.repeat(64),
        rawPayload: {
          nome_disponivel: 'Contato sem cadastro',
          telefone_original: '(34) 99999-0000',
        },
        normalizedPayload: {
          sourceId: 'wa-unmatched',
          jid: '5534999990000@s.whatsapp.net',
          name: 'Contato sem cadastro',
          phone: '5534999990000',
          conversationType: 'individual',
        },
        technicalRecord: false,
      },
    ];
    const persistedRecords = records.map((record, index) => ({
      id: `${index + 1}1111111-1111-4111-8111-111111111111`,
      fingerprint: record.fingerprint,
    }));
    const createCandidates = vi.fn().mockResolvedValue({ count: 3 });
    const transaction = {
      registrationExternalRecord: {
        createMany: vi.fn().mockResolvedValue({ count: 3 }),
        findMany: vi.fn().mockResolvedValue(persistedRecords),
      },
      registrationCandidateSource: {
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn().mockResolvedValue({ count: 3 }),
      },
      whatsAppConversation: { findMany: vi.fn().mockResolvedValue([]) },
      registrationCandidate: { createMany: createCandidates },
      registrationImportBatch: {
        update: vi.fn().mockResolvedValue(
          importBatch({
            status: 'COMPLETED',
            completedAt: new Date('2026-08-26T12:01:00.000Z'),
            totalRows: 3,
            importedRows: 3,
          }),
        ),
      },
    };
    const prisma = {
      registrationImportBatch: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(batch),
        update: vi.fn(),
      },
      $transaction: vi.fn(
        async (operation: (value: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    } as unknown as PrismaService;
    const workbook = {
      parse: vi.fn().mockResolvedValue(parsedWorkbook(records)),
    } as unknown as RegistrationReconciliationWorkbookService;
    const service = new RegistrationReconciliationService(
      prisma,
      workbook,
      {} as RegistrationsService,
    );

    await service.import(current, {
      fileName: 'fontes-sem-correspondencia.xlsx',
      content: Buffer.from('fontes-sem-correspondencia'),
    });

    const created = createCandidates.mock.calls[0]?.[0].data as Array<{
      displayName: string;
      suggestedType?: string;
      suggestedRoleCodes: string[];
      status: string;
      confidence: number;
      minimumDataComplete: boolean;
    }>;
    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: 'Ana Souza',
          suggestedType: 'PF',
          suggestedRoleCodes: ['client'],
          confidence: 0,
          minimumDataComplete: false,
        }),
        expect.objectContaining({
          displayName: 'Empresa Exemplo Ltda',
          suggestedType: 'PJ',
          suggestedRoleCodes: ['client'],
          confidence: 0,
          minimumDataComplete: true,
        }),
        expect.objectContaining({
          displayName: 'Contato sem cadastro',
          status: 'READY_FOR_DECISION',
          suggestedRoleCodes: [],
          minimumDataComplete: false,
        }),
      ]),
    );
  });
  it('approves and creates the official registration in the same transaction', async () => {
    const before = candidate('IN_REVIEW');
    const after = candidate('PROMOTED');
    const transaction = {
      registrationReviewDecision: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      registrationCandidate: {
        findUnique: vi.fn().mockResolvedValue(before),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn(),
        findUniqueOrThrow: vi.fn().mockResolvedValue(after),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (operation: (tx: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    } as unknown as PrismaService;
    const createPromotionGraph = vi.fn().mockResolvedValue({
      primaryRegistrationId: after.promotedRegistrationId,
    });
    const service = new RegistrationReconciliationService(
      prisma,
      {} as RegistrationReconciliationWorkbookService,
      { createPromotionGraph } as unknown as RegistrationsService,
    );
    const result = await service.review(current, before.id, {
      action: 'approve',
      commandId: '77777777-7777-4777-8777-777777777777',
      expectedVersion: before.version,
      confirmedPayload: before.confirmedPayload as never,
    });
    expect(result.status).toBe('promoted');
    expect(createPromotionGraph).toHaveBeenCalledWith(
      transaction,
      current,
      before.confirmedPayload,
      expect.objectContaining({ candidateId: before.id }),
    );
    expect(transaction.registrationCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PROMOTED',
          promotedRegistrationId: after.promotedRegistrationId,
        }),
      }),
    );
  });
});
