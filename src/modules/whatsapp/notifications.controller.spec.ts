import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import type { QuoteProposalUseCase } from '../../application/use-cases/commercial/commercial-quotes.use-case';
import type { UserDepartment } from '../../domain/access/access.constants';
import { NotificationsController } from './notifications.controller';

function principal(
  departments: readonly UserDepartment[],
  overrides: Partial<AuthenticatedPrincipal> = {},
): AuthenticatedPrincipal {
  return {
    id: '00000000-0000-4000-8000-000000000111',
    companyId: '00000000-0000-4000-8000-000000000222',
    name: 'Atendente',
    username: 'atendente',
    email: 'atendente@example.com',
    cpf: null,
    type: 'employee',
    isAdministrator: false,
    departments: [...departments],
    permissionCodes: [],
    permissions: [
      'dashboard:view',
      'ai-agents:use',
      'profile:view',
      'profile:update',
      'support:view',
      'support:create',
    ],
    clientCategory: null,
    isActive: true,
    status: 'active',
    suspendedUntil: null,
    suspensionReason: null,
    mustChangePassword: false,
    hasProfilePicture: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    tokenVersion: 1,
    ...overrides,
  };
}

describe('NotificationsController', () => {
  it('returns commercial pending quotes without requiring WhatsApp management', async () => {
    const notificationSummary = vi.fn().mockResolvedValue({
      notificationId: 'commercial.pending-quote-proposals',
      pendingTotal: 3,
      unreadTotal: 2,
    });
    const controller = new NotificationsController({
      notificationSummary,
    } as unknown as QuoteProposalUseCase);

    await expect(controller.list(principal(['commercial']))).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: 'commercial.pending-quote-proposals',
          department: 'commercial',
          count: 3,
          unreadCount: 2,
          read: false,
          href: '/quote-proposals',
        }),
      ],
      total: 3,
      unreadTotal: 2,
    });
    expect(notificationSummary).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000222',
      '00000000-0000-4000-8000-000000000111',
    );
  });

  it('does not query or expose commercial data to another department', async () => {
    const notificationSummary = vi.fn();
    const controller = new NotificationsController({
      notificationSummary,
    } as unknown as QuoteProposalUseCase);

    await expect(controller.list(principal(['financial']))).resolves.toEqual({
      items: [],
      total: 0,
      unreadTotal: 0,
    });
    expect(notificationSummary).not.toHaveBeenCalled();
  });

  it('marks the current commercial queue as read for the authenticated user', async () => {
    const markNotificationRead = vi.fn().mockResolvedValue({
      notificationId: 'commercial.pending-quote-proposals',
      pendingTotal: 3,
      unreadTotal: 0,
      markedRead: 2,
      readAt: new Date(0).toISOString(),
    });
    const controller = new NotificationsController({
      markNotificationRead,
    } as unknown as QuoteProposalUseCase);

    await expect(
      controller.markCommercialQuotesRead(principal(['commercial'])),
    ).resolves.toMatchObject({
      pendingTotal: 3,
      unreadTotal: 0,
      markedRead: 2,
    });
    expect(markNotificationRead).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000222',
      '00000000-0000-4000-8000-000000000111',
    );
  });

  it('expõe e marca notificações comerciais para Admin sem departamentos e Diretoria com Gestão do Tenant', async () => {
    const notificationSummary = vi.fn().mockResolvedValue({
      notificationId: 'commercial.pending-quote-proposals',
      pendingTotal: 1,
      unreadTotal: 1,
    });
    const markNotificationRead = vi.fn().mockResolvedValue({
      notificationId: 'commercial.pending-quote-proposals',
      pendingTotal: 1,
      unreadTotal: 0,
      markedRead: 1,
      readAt: new Date(0).toISOString(),
    });
    const controller = new NotificationsController({
      notificationSummary,
      markNotificationRead,
    } as unknown as QuoteProposalUseCase);

    for (const current of [
      principal([], {
        isAdministrator: true,
        permissionCodes: [],
        permissions: [],
      }),
      principal(['directorate'], {
        isAdministrator: false,
        permissionCodes: ['tenant:manage'],
        permissions: ['tenant:manage'],
      }),
    ]) {
      await expect(controller.list(current)).resolves.toMatchObject({
        total: 1,
        unreadTotal: 1,
      });
      await expect(
        controller.markCommercialQuotesRead(current),
      ).resolves.toMatchObject({ markedRead: 1 });
    }

    expect(notificationSummary).toHaveBeenCalledTimes(2);
    expect(markNotificationRead).toHaveBeenCalledTimes(2);
  });

  it('não expõe nem marca notificações comerciais para Diretoria sem Gestão do Tenant', async () => {
    const notificationSummary = vi.fn();
    const markNotificationRead = vi.fn();
    const controller = new NotificationsController({
      notificationSummary,
      markNotificationRead,
    } as unknown as QuoteProposalUseCase);
    const current = principal(['directorate'], {
      isAdministrator: false,
      permissionCodes: ['commercial:view'],
      permissions: ['commercial:view'],
    });

    await expect(controller.list(current)).resolves.toEqual({
      items: [],
      total: 0,
      unreadTotal: 0,
    });
    expect(controller.markCommercialQuotesRead(current)).toMatchObject({
      pendingTotal: 0,
      unreadTotal: 0,
      markedRead: 0,
    });
    expect(notificationSummary).not.toHaveBeenCalled();
    expect(markNotificationRead).not.toHaveBeenCalled();
  });
});
