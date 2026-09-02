import { describe, expect, it, vi } from 'vitest';

import type {
  AttestCommercialServiceRequirementCommand,
  ConfirmServiceCommand,
  MarkCommercialServiceRequirementNotApplicableCommand,
} from '../../../application/contracts/confirmed-service.repository';
import type { PrismaService } from '../prisma/prisma.service';
import { PrismaConfirmedServiceRepository } from './prisma-confirmed-service.repository';

const companyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const quoteRequestId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const confirmedServiceId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const commandId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const input: ConfirmServiceCommand = {
  companyId,
  actorUserId,
  quoteRequestId,
  sourceItemKey: 'legacy-primary',
  commandId,
  expectedVersion: 4,
  confirmationBasis: 'Requisitos aplicáveis conferidos manualmente.',
  requestFingerprint: 'a'.repeat(64),
};

const financialActorUserId = '22222222-2222-4222-8222-222222222222';
const attestInput: AttestCommercialServiceRequirementCommand = {
  companyId,
  actorUserId: financialActorUserId,
  quoteRequestId,
  sourceItemKey: 'legacy-primary',
  kind: 'financial',
  commandId: '33333333-3333-4333-8333-333333333333',
  expectedVersion: 4,
  evidence: 'Pagamento confirmado pelo Financeiro.',
  requestFingerprint: 'b'.repeat(64),
};
const notApplicableInput: MarkCommercialServiceRequirementNotApplicableCommand =
  {
    companyId,
    actorUserId,
    quoteRequestId,
    sourceItemKey: 'legacy-primary',
    kind: 'financial',
    commandId: '77777777-7777-4777-8777-777777777777',
    expectedVersion: 4,
    reason: 'Pagamento antecipado não integra este serviço.',
    evidence: 'Condição registrada na proposta aceita.',
    requestFingerprint: 'd'.repeat(64),
  };

const actor = {
  isActive: true,
  status: 'ACTIVE',
  deletedAt: null,
  isAdministrator: true,
  departments: [],
  permissionCodes: [],
};

const quote = {
  id: quoteRequestId,
  companyId,
  sequence: 7,
  status: 'APPROVED',
  version: 4,
  serviceType: 'Fretamento eventual',
  origin: 'Uberlândia',
  destination: 'Goiânia',
  departureDate: new Date('2026-09-20T00:00:00.000Z'),
  departureAt: null,
  returnDate: new Date('2026-09-21T00:00:00.000Z'),
  returnAt: null,
  passengerCount: 30,
  vehicleType: 'Ônibus executivo',
  vehicleAtDisposal: false,
  localTransfers: false,
  notes: 'Sem pagamento registrado nesta etapa.',
};

const confirmedAt = new Date('2026-09-01T12:00:00.000Z');
const financialAttestation = {
  id: '11111111-1111-4111-8111-111111111111',
  companyId,
  sourceQuoteRequestId: quoteRequestId,
  sourceQuoteVersion: 4,
  sourceItemKey: 'legacy-primary',
  kind: 'FINANCIAL',
  outcome: 'SATISFIED',
  reason: null,
  evidence: 'Pagamento confirmado pelo Financeiro.',
  actorUserId: financialActorUserId,
  commandId: '33333333-3333-4333-8333-333333333333',
  commandFingerprint: 'b'.repeat(64),
  attestedAt: new Date('2026-09-01T10:00:00.000Z'),
  createdAt: new Date('2026-09-01T10:00:00.000Z'),
};
const operationalAttestation = {
  ...financialAttestation,
  id: '44444444-4444-4444-8444-444444444444',
  kind: 'OPERATIONAL',
  evidence: 'Disponibilidade validada pelo Operacional.',
  actorUserId: '55555555-5555-4555-8555-555555555555',
  commandId: '66666666-6666-4666-8666-666666666666',
  commandFingerprint: 'c'.repeat(64),
  attestedAt: new Date('2026-09-01T11:00:00.000Z'),
  createdAt: new Date('2026-09-01T11:00:00.000Z'),
};
const financialNotApplicableAttestation = {
  ...financialAttestation,
  id: '88888888-8888-4888-8888-888888888888',
  outcome: 'NOT_APPLICABLE',
  reason: notApplicableInput.reason,
  evidence: notApplicableInput.evidence,
  actorUserId: notApplicableInput.actorUserId,
  commandId: notApplicableInput.commandId,
  commandFingerprint: notApplicableInput.requestFingerprint,
};
const serviceRow = {
  id: confirmedServiceId,
  companyId,
  sourceQuoteRequestId: quoteRequestId,
  sourceQuoteVersion: 4,
  sourceItemKey: 'legacy-primary',
  serviceSnapshot: {
    quoteSequence: 7,
    source: 'legacy-quote-primary-service',
    serviceType: 'Fretamento eventual',
    origin: 'Uberlândia',
    destination: 'Goiânia',
    departureDate: '2026-09-20',
    departureAt: null,
    returnDate: '2026-09-21',
    returnAt: null,
    passengerCount: 30,
    vehicleType: 'Ônibus executivo',
    vehicleAtDisposal: false,
    localTransfers: false,
    notes: 'Sem pagamento registrado nesta etapa.',
  },
  requirementsSnapshot: {
    commercialAcceptance: {
      outcome: 'satisfied',
      provenance: 'quote-request',
      quoteRequestId,
      quoteVersion: 4,
    },
    financial: {
      outcome: 'satisfied',
      evidence: financialAttestation.evidence,
      provenance: 'financial-attestation',
      attestationId: financialAttestation.id,
      attestedByUserId: financialAttestation.actorUserId,
    },
    operational: {
      outcome: 'satisfied',
      evidence: operationalAttestation.evidence,
      provenance: 'operational-attestation',
      attestationId: operationalAttestation.id,
      attestedByUserId: operationalAttestation.actorUserId,
    },
  },
  confirmationBasis: input.confirmationBasis,
  financialAttestationId: financialAttestation.id,
  operationalAttestationId: operationalAttestation.id,
  version: 1,
  confirmedByUserId: actorUserId,
  confirmedAt,
  createdAt: confirmedAt,
  updatedAt: confirmedAt,
};

function prismaWithTransaction(transaction: object): PrismaService {
  const lockableTransaction = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: actorUserId }]),
    ...transaction,
  };

  return {
    $transaction: vi.fn(
      async (work: (client: typeof lockableTransaction) => Promise<unknown>) =>
        work(lockableTransaction),
    ),
  } as unknown as PrismaService;
}

describe('PrismaConfirmedServiceRepository', () => {
  it('bloqueia a linha do ator antes da revalidação autoritativa', async () => {
    const callOrder: string[] = [];
    const transaction = {
      $queryRaw: vi.fn().mockImplementation(async () => {
        callOrder.push('lock');
        return [{ id: actorUserId }];
      }),
      user: {
        findUnique: vi.fn().mockImplementation(async () => {
          callOrder.push('read');
          return actor;
        }),
      },
      confirmedServiceHistory: {
        findUnique: vi.fn().mockResolvedValue({
          confirmedServiceId,
          actorUserId,
          action: 'confirmed',
          commandFingerprint: input.requestFingerprint,
        }),
      },
      confirmedService: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(serviceRow),
      },
    };

    await expect(
      new PrismaConfirmedServiceRepository(
        prismaWithTransaction(transaction),
      ).confirm(input),
    ).resolves.toMatchObject({ idempotent: true });

    expect(callOrder).toEqual(['lock', 'read']);
  });

  it('persiste o ateste financeiro com ator da própria área e auditoria', async () => {
    const transaction = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          isActive: true,
          status: 'ACTIVE',
          deletedAt: null,
          isAdministrator: true,
          departments: [],
          permissionCodes: [],
        }),
      },
      quoteRequest: { findUnique: vi.fn().mockResolvedValue(quote) },
      commercialServiceRequirementAttestation: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        create: vi.fn().mockResolvedValue(financialAttestation),
      },
      tenantAuditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    await expect(
      new PrismaConfirmedServiceRepository(
        prismaWithTransaction(transaction),
      ).attestRequirement(attestInput),
    ).resolves.toEqual({
      attestation: expect.objectContaining({
        kind: 'financial',
        outcome: 'SATISFIED',
        reason: null,
        actorUserId: financialActorUserId,
        evidence: attestInput.evidence,
      }),
      idempotent: false,
    });
    expect(transaction.tenantAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: financialActorUserId,
          action: 'commercial.service-requirement.attest',
        }),
      }),
    );
  });

  it('marca requisito não aplicável com autoridade ampla da Diretoria revalidada, motivo, evidência e auditoria', async () => {
    const transaction = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          isActive: true,
          status: 'ACTIVE',
          deletedAt: null,
          isAdministrator: false,
          departments: ['DIRECTORATE'],
          permissionCodes: ['tenant:manage'],
        }),
      },
      quoteRequest: { findUnique: vi.fn().mockResolvedValue(quote) },
      commercialServiceRequirementAttestation: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        create: vi.fn().mockResolvedValue(financialNotApplicableAttestation),
      },
      tenantAuditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    await expect(
      new PrismaConfirmedServiceRepository(
        prismaWithTransaction(transaction),
      ).markRequirementNotApplicable(notApplicableInput),
    ).resolves.toEqual({
      attestation: expect.objectContaining({
        kind: 'financial',
        outcome: 'NOT_APPLICABLE',
        reason: notApplicableInput.reason,
        evidence: notApplicableInput.evidence,
      }),
      idempotent: false,
    });
    expect(
      transaction.commercialServiceRequirementAttestation.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId,
        outcome: 'NOT_APPLICABLE',
        reason: notApplicableInput.reason,
        evidence: notApplicableInput.evidence,
      }),
    });
    expect(transaction.tenantAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId,
        actorUserId,
        action: 'commercial.service-requirement.mark-not-applicable',
        metadata: expect.objectContaining({
          outcome: 'NOT_APPLICABLE',
          reason: notApplicableInput.reason,
          evidence: notApplicableInput.evidence,
        }),
      }),
    });
  });

  it('reexecuta a mesma dispensa sem duplicar a decisão', async () => {
    const transaction = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          isActive: true,
          status: 'ACTIVE',
          deletedAt: null,
          isAdministrator: false,
          departments: ['management'],
          permissionCodes: ['service-confirmations:approve'],
        }),
      },
      commercialServiceRequirementAttestation: {
        findUnique: vi
          .fn()
          .mockResolvedValue(financialNotApplicableAttestation),
        create: vi.fn(),
      },
    };

    await expect(
      new PrismaConfirmedServiceRepository(
        prismaWithTransaction(transaction),
      ).markRequirementNotApplicable(notApplicableInput),
    ).resolves.toEqual({
      attestation: expect.objectContaining({
        outcome: 'NOT_APPLICABLE',
        reason: notApplicableInput.reason,
      }),
      idempotent: true,
    });
    expect(
      transaction.commercialServiceRequirementAttestation.create,
    ).not.toHaveBeenCalled();
  });

  it('rejeita dispensa quando o ator persistido não tem a autoridade estreita', async () => {
    const transaction = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          isActive: true,
          status: 'ACTIVE',
          deletedAt: null,
          isAdministrator: false,
          departments: ['commercial'],
          permissionCodes: [
            'commercial:manage',
            'service-confirmations:approve',
          ],
        }),
      },
      quoteRequest: { findUnique: vi.fn() },
      commercialServiceRequirementAttestation: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
    };

    await expect(
      new PrismaConfirmedServiceRepository(
        prismaWithTransaction(transaction),
      ).markRequirementNotApplicable(notApplicableInput),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(transaction.quoteRequest.findUnique).not.toHaveBeenCalled();
  });

  it('cria snapshot, histórico e auditoria somente por comando explícito', async () => {
    const transaction = {
      user: { findUnique: vi.fn().mockResolvedValue(actor) },
      confirmedServiceHistory: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      quoteRequest: { findUnique: vi.fn().mockResolvedValue(quote) },
      confirmedService: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(serviceRow),
      },
      commercialServiceRequirementAttestation: {
        findMany: vi
          .fn()
          .mockResolvedValue([financialAttestation, operationalAttestation]),
      },
      tenantAuditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    const result = await new PrismaConfirmedServiceRepository(
      prismaWithTransaction(transaction),
    ).confirm(input);

    expect(transaction.quoteRequest.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_companyId: { id: quoteRequestId, companyId } },
      }),
    );
    expect(transaction.confirmedService.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId,
        sourceQuoteRequestId: quoteRequestId,
        sourceQuoteVersion: 4,
        sourceItemKey: 'legacy-primary',
        confirmationBasis: input.confirmationBasis,
        financialAttestationId: financialAttestation.id,
        operationalAttestationId: operationalAttestation.id,
        version: 1,
        serviceSnapshot: expect.objectContaining({
          source: 'legacy-quote-primary-service',
          departureDate: '2026-09-20',
        }),
      }),
    });
    const createData = transaction.confirmedService.create.mock.calls[0]?.[0]
      ?.data as { serviceSnapshot: Readonly<Record<string, unknown>> };
    expect(createData.serviceSnapshot).not.toHaveProperty('paymentConfirmed');
    expect(transaction.confirmedServiceHistory.create).toHaveBeenCalled();
    expect(transaction.tenantAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId,
          actorUserId,
          action: 'commercial.service.confirm',
          targetType: 'confirmed-service',
        }),
      }),
    );
    expect(result).toEqual({
      service: expect.objectContaining({
        id: confirmedServiceId,
        companyId,
        sourceQuoteRequestId: quoteRequestId,
        sourceQuoteVersion: 4,
        version: 1,
      }),
      idempotent: false,
    });
  });

  it('aceita requisito financeiro não aplicável na confirmação final e preserva a justificativa', async () => {
    const transaction = {
      user: { findUnique: vi.fn().mockResolvedValue(actor) },
      confirmedServiceHistory: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      quoteRequest: { findUnique: vi.fn().mockResolvedValue(quote) },
      confirmedService: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => ({
          ...serviceRow,
          ...data,
        })),
      },
      commercialServiceRequirementAttestation: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            financialNotApplicableAttestation,
            operationalAttestation,
          ]),
      },
      tenantAuditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    await new PrismaConfirmedServiceRepository(
      prismaWithTransaction(transaction),
    ).confirm(input);

    expect(transaction.confirmedService.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        financialAttestationId: financialNotApplicableAttestation.id,
        requirementsSnapshot: expect.objectContaining({
          financial: expect.objectContaining({
            outcome: 'not-applicable',
            reason: notApplicableInput.reason,
            evidence: notApplicableInput.evidence,
          }),
          operational: expect.objectContaining({
            outcome: 'satisfied',
            reason: null,
          }),
        }),
      }),
    });
  });

  it('não transforma aceite em confirmação sem o comando e bloqueia orçamento não aceito', async () => {
    const transaction = {
      user: { findUnique: vi.fn().mockResolvedValue(actor) },
      confirmedServiceHistory: { findUnique: vi.fn().mockResolvedValue(null) },
      quoteRequest: {
        findUnique: vi.fn().mockResolvedValue({
          ...quote,
          status: 'UNDER_REVIEW',
        }),
      },
      confirmedService: { create: vi.fn() },
      commercialServiceRequirementAttestation: { findMany: vi.fn() },
    };

    await expect(
      new PrismaConfirmedServiceRepository(
        prismaWithTransaction(transaction),
      ).confirm(input),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(transaction.confirmedService.create).not.toHaveBeenCalled();
  });

  it('rejeita confirmação baseada em uma versão antiga do orçamento aceito', async () => {
    const transaction = {
      user: { findUnique: vi.fn().mockResolvedValue(actor) },
      confirmedServiceHistory: { findUnique: vi.fn().mockResolvedValue(null) },
      quoteRequest: {
        findUnique: vi.fn().mockResolvedValue({ ...quote, version: 5 }),
      },
      confirmedService: { create: vi.fn() },
      commercialServiceRequirementAttestation: { findMany: vi.fn() },
    };

    await expect(
      new PrismaConfirmedServiceRepository(
        prismaWithTransaction(transaction),
      ).confirm(input),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(transaction.confirmedService.create).not.toHaveBeenCalled();
  });

  it('não confirma enquanto uma das áreas ainda não atestou', async () => {
    const transaction = {
      user: { findUnique: vi.fn().mockResolvedValue(actor) },
      confirmedServiceHistory: { findUnique: vi.fn().mockResolvedValue(null) },
      quoteRequest: { findUnique: vi.fn().mockResolvedValue(quote) },
      confirmedService: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      commercialServiceRequirementAttestation: {
        findMany: vi.fn().mockResolvedValue([financialAttestation]),
      },
    };

    await expect(
      new PrismaConfirmedServiceRepository(
        prismaWithTransaction(transaction),
      ).confirm(input),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(transaction.confirmedService.create).not.toHaveBeenCalled();
  });

  it('revalida o ator dentro da transação', async () => {
    const transaction = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      confirmedServiceHistory: { findUnique: vi.fn() },
      confirmedService: { create: vi.fn() },
    };

    await expect(
      new PrismaConfirmedServiceRepository(
        prismaWithTransaction(transaction),
      ).confirm(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(transaction.confirmedService.create).not.toHaveBeenCalled();
  });

  it('reexecuta o mesmo commandId e recusa reutilização com outros dados', async () => {
    const matchingHistory = {
      confirmedServiceId,
      actorUserId,
      action: 'confirmed',
      commandFingerprint: input.requestFingerprint,
    };
    const matchingTransaction = {
      user: { findUnique: vi.fn().mockResolvedValue(actor) },
      confirmedServiceHistory: {
        findUnique: vi.fn().mockResolvedValue(matchingHistory),
      },
      confirmedService: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(serviceRow),
        create: vi.fn(),
      },
    };

    await expect(
      new PrismaConfirmedServiceRepository(
        prismaWithTransaction(matchingTransaction),
      ).confirm(input),
    ).resolves.toEqual({
      service: expect.objectContaining({
        id: confirmedServiceId,
        companyId,
        sourceQuoteRequestId: quoteRequestId,
        sourceQuoteVersion: 4,
        version: 1,
      }),
      idempotent: true,
    });
    expect(matchingTransaction.confirmedService.create).not.toHaveBeenCalled();

    const conflictingTransaction = {
      user: { findUnique: vi.fn().mockResolvedValue(actor) },
      confirmedServiceHistory: {
        findUnique: vi.fn().mockResolvedValue({
          ...matchingHistory,
          commandFingerprint: 'b'.repeat(64),
        }),
      },
      confirmedService: { create: vi.fn() },
    };
    await expect(
      new PrismaConfirmedServiceRepository(
        prismaWithTransaction(conflictingTransaction),
      ).confirm(input),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
