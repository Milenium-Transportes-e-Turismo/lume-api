import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';
import {
  type AttestCommercialServiceRequirementCommand,
  ConfirmedServiceRepository,
  type ConfirmServiceCommand,
} from '../../contracts/confirmed-service.repository';
import { ConfirmedServicesService } from './confirmed-services.service';

const principal = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  username: 'comercial',
  name: 'Atendente Comercial',
  email: 'comercial@example.com',
  departments: ['commercial'],
  permissions: ['commercial:manage'],
  isAdministrator: false,
} as AuthenticatedPrincipal;

class RecordingConfirmedServiceRepository extends ConfirmedServiceRepository {
  readonly attestRequirement = vi.fn(
    async (input: AttestCommercialServiceRequirementCommand) => ({
      attestation: {
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        companyId: input.companyId,
        sourceQuoteRequestId: input.quoteRequestId,
        sourceQuoteVersion: input.expectedVersion,
        sourceItemKey: input.sourceItemKey,
        kind: input.kind,
        outcome: 'SATISFIED' as const,
        reason: null,
        evidence: input.evidence,
        actorUserId: input.actorUserId,
        commandId: input.commandId,
        attestedAt: new Date('2026-09-01T11:00:00.000Z'),
      },
      idempotent: false,
    }),
  );

  readonly markRequirementNotApplicable = vi.fn(
    async (input: {
      companyId: string;
      actorUserId: string;
      quoteRequestId: string;
      sourceItemKey: 'legacy-primary';
      kind: 'financial' | 'operational';
      commandId: string;
      expectedVersion: number;
      reason: string;
      evidence: string;
      requestFingerprint: string;
    }) => ({
      attestation: {
        id: '11111111-1111-4111-8111-111111111111',
        companyId: input.companyId,
        sourceQuoteRequestId: input.quoteRequestId,
        sourceQuoteVersion: input.expectedVersion,
        sourceItemKey: input.sourceItemKey,
        kind: input.kind,
        outcome: 'NOT_APPLICABLE' as const,
        reason: input.reason,
        evidence: input.evidence,
        actorUserId: input.actorUserId,
        commandId: input.commandId,
        attestedAt: new Date('2026-09-01T11:30:00.000Z'),
      },
      idempotent: false,
    }),
  );

  readonly confirm = vi.fn(async (_input: ConfirmServiceCommand) => ({
    service: {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      companyId: principal.companyId,
      sourceQuoteRequestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      sourceQuoteVersion: 4,
      sourceItemKey: 'legacy-primary',
      serviceSnapshot: {},
      requirementsSnapshot: {},
      confirmationBasis: 'Requisitos aplicáveis conferidos manualmente.',
      version: 1,
      confirmedByUserId: principal.id,
      confirmedAt: new Date('2026-09-01T12:00:00.000Z'),
    },
    idempotent: false,
  }));

  readonly readiness = vi.fn();
}

describe('ConfirmedServicesService', () => {
  it('envia um comando tenant-scoped com fingerprint estável ao repositório', async () => {
    const repository = new RecordingConfirmedServiceRepository();
    const service = new ConfirmedServicesService(repository);

    await service.confirm(principal, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', {
      commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      expectedVersion: 4,
      confirmationBasis: '  Requisitos aplicáveis conferidos manualmente.  ',
    });

    expect(repository.confirm).toHaveBeenCalledWith({
      companyId: principal.companyId,
      actorUserId: principal.id,
      quoteRequestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      sourceItemKey: 'legacy-primary',
      commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      expectedVersion: 4,
      confirmationBasis: 'Requisitos aplicáveis conferidos manualmente.',
      requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('rejeita fundamento vazio antes de persistir a confirmação', async () => {
    const repository = new RecordingConfirmedServiceRepository();
    const service = new ConfirmedServicesService(repository);

    expect(() =>
      service.confirm(principal, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', {
        commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        expectedVersion: 4,
        confirmationBasis: '  ',
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(repository.confirm).not.toHaveBeenCalled();
  });

  it('normaliza e envia o ateste da área sem permitir outcome não aplicável', async () => {
    const repository = new RecordingConfirmedServiceRepository();
    const service = new ConfirmedServicesService(repository);
    const financial = {
      ...principal,
      departments: ['financial'],
      permissions: ['financial:approve'],
    } as AuthenticatedPrincipal;

    await service.attestRequirement(
      financial,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'financial',
      {
        commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        expectedVersion: 4,
        evidence: '  Pagamento confirmado no comprovante 123.  ',
      },
    );

    expect(repository.attestRequirement).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: principal.companyId,
        actorUserId: principal.id,
        kind: 'financial',
        evidence: 'Pagamento confirmado no comprovante 123.',
        expectedVersion: 4,
        requestFingerprint:
          '002ad1d7e8c1b598206fb312ddae41c45d20540ba1bfc353ecdc8e6f5cdff0c0',
      }),
    );
  });

  it('marca um requisito como não aplicável com autoridade, motivo e evidência explícitos', async () => {
    const repository = new RecordingConfirmedServiceRepository();
    const service = new ConfirmedServicesService(repository);
    const management = {
      ...principal,
      departments: ['management'],
      permissions: ['service-confirmations:approve'],
    } as AuthenticatedPrincipal;

    await service.markRequirementNotApplicable(
      management,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'financial',
      {
        commandId: '11111111-1111-4111-8111-111111111111',
        expectedVersion: 4,
        reason: '  Serviço sem cobrança antecipada.  ',
        evidence: '  Condição registrada na proposta aceita.  ',
      },
    );

    expect(repository.markRequirementNotApplicable).toHaveBeenCalledWith({
      companyId: principal.companyId,
      actorUserId: principal.id,
      quoteRequestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      sourceItemKey: 'legacy-primary',
      kind: 'financial',
      commandId: '11111111-1111-4111-8111-111111111111',
      expectedVersion: 4,
      reason: 'Serviço sem cobrança antecipada.',
      evidence: 'Condição registrada na proposta aceita.',
      requestFingerprint:
        '66f753e0a0531bb2b3be947c8f02e114914dce322029d01d0dc9c3f443954898',
    });
  });

  it('não permite ao Comercial dispensar requisito mesmo com a capacidade individual', () => {
    const repository = new RecordingConfirmedServiceRepository();
    const service = new ConfirmedServicesService(repository);
    const commercial = {
      ...principal,
      permissions: ['commercial:manage', 'service-confirmations:approve'],
    } as AuthenticatedPrincipal;

    expect(() =>
      service.markRequirementNotApplicable(
        commercial,
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'operational',
        {
          commandId: '11111111-1111-4111-8111-111111111111',
          expectedVersion: 4,
          reason: 'Operação não exigida.',
          evidence: 'Escopo da proposta aceita.',
        },
      ),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(repository.markRequirementNotApplicable).not.toHaveBeenCalled();
  });
});
