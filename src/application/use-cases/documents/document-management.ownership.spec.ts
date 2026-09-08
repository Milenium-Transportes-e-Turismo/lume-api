import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';
import { DocumentManagementUseCase } from './document-management.use-case';

const principal = {
  id: 'user-id',
  companyId: 'company-id',
  isAdministrator: false,
  departments: [],
  permissions: ['documents:view'],
} as unknown as AuthenticatedPrincipal;

describe('Personal document ownership', () => {
  it.each([true, false])(
    'protects canonical file downloads (owner=%s)',
    async (owns) => {
      const prisma = {
        user: {
          findFirst: vi
            .fn()
            .mockResolvedValue(owns ? { id: principal.id } : null),
        },
        documentFile: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'file-id',
            deletedAt: null,
            fileName: 'document.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 3,
            sha256: 'hash',
            content: Buffer.from('pdf'),
            submission: {
              requestItem: {
                requestId: 'request-id',
                request: {
                  subjectUserId: null,
                  subjectRegistrationId: 'person-id',
                },
              },
            },
          }),
        },
        tenantAuditLog: { create: vi.fn().mockResolvedValue({}) },
      };
      const result = new DocumentManagementUseCase(prisma as never).fileContent(
        principal,
        'file-id',
      );
      if (owns)
        await expect(result).resolves.toMatchObject({
          content: Buffer.from('pdf'),
        });
      else await expect(result).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: principal.id,
          companyId: principal.companyId,
          deletedAt: null,
          personRegistrationId: 'person-id',
        },
        select: { id: true },
      });
      expect(prisma.tenantAuditLog.create).toHaveBeenCalledTimes(owns ? 1 : 0);
    },
  );
  it('limits an administrator personal list without changing the management list', async () => {
    const prisma = {
      documentRequest: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
    };
    const useCase = new DocumentManagementUseCase(prisma as never);
    const admin = {
      ...principal,
      isAdministrator: true,
      departments: ['management'],
      permissions: ['documents:manage'],
    } as AuthenticatedPrincipal;
    await useCase.listRequests(admin, {
      page: 1,
      pageSize: 20,
      subjectUserId: admin.id,
    });
    expect(
      prisma.documentRequest.findMany.mock.calls[0][0].where.AND.OR,
    ).toHaveLength(2);
    await useCase.listRequests(admin, { page: 1, pageSize: 20 });
    expect(
      prisma.documentRequest.findMany.mock.calls[1][0].where.AND,
    ).toBeUndefined();
  });
});
