import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import type { QuoteProposalUseCase } from '../../application/use-cases/commercial/commercial-quotes.use-case';
import { REQUIRED_PERMISSIONS } from '../../shared/http/decorators/require-permissions.decorator';
import { QuoteProposalListQueryDto } from './dto/whatsapp.dto';
import {
  normalizeUploadedFileName,
  QuoteProposalController,
} from './quote-proposal.controller';

function principal(
  overrides: Partial<AuthenticatedPrincipal> = {},
): AuthenticatedPrincipal {
  return {
    companyId: '00000000-0000-4000-8000-000000000010',
    tokenVersion: 1,
    id: '00000000-0000-4000-8000-000000000011',
    name: 'Atendente Comercial',
    username: 'atendente.comercial',
    email: 'atendente@example.test',
    cpf: null,
    type: 'employee',
    isAdministrator: false,
    departments: ['commercial'],
    permissionCodes: ['commercial:view'],
    permissions: ['dashboard:view', 'commercial:view'],
    clientCategory: null,
    isActive: true,
    status: 'active',
    suspendedUntil: null,
    suspensionReason: null,
    mustChangePassword: false,
    hasProfilePicture: false,
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: '2026-07-29T12:00:00.000Z',
    ...overrides,
  };
}

describe('QuoteProposalController permissions', () => {
  it('aceita leitura comercial no contrato sem remover os códigos do Painel WhatsApp', () => {
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, QuoteProposalController),
    ).toEqual([
      'commercial:view',
      'commercial:manage',
      'whatsapp-conversations:view',
      'whatsapp-conversations:manage',
    ]);
  });

  it('restringe mutações a gestão comercial ou gestão do Painel WhatsApp', () => {
    for (const method of [
      'create',
      'decide',
      'updateStatus',
      'upload',
      'send',
    ] as const) {
      const handler = Object.getOwnPropertyDescriptor(
        QuoteProposalController.prototype,
        method,
      )?.value as object;
      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler)).toEqual([
        'commercial:manage',
        'whatsapp-conversations:manage',
      ]);
    }
  });

  it('mantém o vínculo ao departamento Comercial como segunda barreira', () => {
    const proposals = { list: () => ({ items: [] }) };
    const controller = new QuoteProposalController(
      proposals as unknown as QuoteProposalUseCase,
    );

    expect(() =>
      controller.list(
        principal({
          departments: ['financial'],
          permissionCodes: ['commercial:view'],
          permissions: ['commercial:view'],
        }),
        new QuoteProposalListQueryDto(),
      ),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('permite consultar propostas ao Admin sem departamentos e à Diretoria com Gestão do Tenant', () => {
    const list = vi.fn().mockReturnValue({ items: [] });
    const controller = new QuoteProposalController({
      list,
    } as unknown as QuoteProposalUseCase);
    const query = new QuoteProposalListQueryDto();

    for (const current of [
      principal({
        isAdministrator: true,
        departments: [],
        permissionCodes: [],
        permissions: [],
      }),
      principal({
        isAdministrator: false,
        departments: ['directorate'],
        permissionCodes: ['tenant:manage'],
        permissions: ['tenant:manage'],
      }),
    ]) {
      expect(controller.list(current, query)).toEqual({ items: [] });
    }

    expect(list).toHaveBeenCalledTimes(2);
  });

  it('nega propostas à Diretoria sem Gestão do Tenant', () => {
    const list = vi.fn();
    const controller = new QuoteProposalController({
      list,
    } as unknown as QuoteProposalUseCase);

    expect(() =>
      controller.list(
        principal({
          isAdministrator: false,
          departments: ['directorate'],
          permissionCodes: ['commercial:view'],
          permissions: ['commercial:view'],
        }),
        new QuoteProposalListQueryDto(),
      ),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(list).not.toHaveBeenCalled();
  });
});

describe('normalizeUploadedFileName', () => {
  it('recovers UTF-8 names decoded as latin1 by multipart middleware', () => {
    expect(normalizeUploadedFileName('OrÃ§amento 1.pdf')).toBe(
      'Orçamento 1.pdf',
    );
  });

  it('preserves an already valid UTF-8 file name', () => {
    expect(normalizeUploadedFileName('Orçamento final.pdf')).toBe(
      'Orçamento final.pdf',
    );
  });
});
