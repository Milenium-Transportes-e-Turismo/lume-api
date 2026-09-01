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
        evidence: input.evidence,
        actorUserId: input.actorUserId,
        commandId: input.commandId,
        attestedAt: new Date('2026-09-01T11:00:00.000Z'),
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
        requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });
});
