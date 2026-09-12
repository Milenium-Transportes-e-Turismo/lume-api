import { describe, it, expect, vi } from 'vitest';
import { assertTransportSupplierChange } from './assert-transport-supplier-change';
import type { Prisma } from './generated/client';
const input = {
  companyId: 'tenant',
  registrationId: 'company',
  actorUserId: 'actor',
  beforeCnpj: '11222333000181',
  beforeType: 'PJ',
  beforeStatus: 'ACTIVE',
};
function tx(profile: unknown, departments: string[] = ['operations']) {
  return {
    transportSupplierProfile: { findFirst: vi.fn().mockResolvedValue(profile) },
    user: { findFirst: vi.fn().mockResolvedValue({ departments }) },
  };
}
describe('canonical supplier identity protection', () => {
  it('leaves ordinary canonical updates unaffected', async () => {
    const prisma = tx({});
    await assertTransportSupplierChange(
      prisma as unknown as Prisma.TransactionClient,
      input,
    );
    expect(prisma.transportSupplierProfile.findFirst).not.toHaveBeenCalled();
  });
  it('prevents swapping supplier CNPJ from another canonical entrypoint', async () => {
    const prisma = tx({});
    await expect(
      assertTransportSupplierChange(
        prisma as unknown as Prisma.TransactionClient,
        { ...input, cnpj: '22333444000190' },
      ),
    ).rejects.toThrow('identidade');
    expect(prisma.transportSupplierProfile.findFirst).toHaveBeenCalledWith({
      where: { companyId: 'tenant', legacyRegistrationId: 'company' },
    });
  });
  it('restricts supplier inactivation to management/directorate without affecting other registrations', async () => {
    await expect(
      assertTransportSupplierChange(
        tx({}) as unknown as Prisma.TransactionClient,
        { ...input, status: 'inactive' },
      ),
    ).rejects.toThrow('diretoria');
    await expect(
      assertTransportSupplierChange(
        tx({}, ['directorate']) as unknown as Prisma.TransactionClient,
        { ...input, status: 'inactive' },
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertTransportSupplierChange(
        tx(null) as unknown as Prisma.TransactionClient,
        { ...input, status: 'inactive' },
      ),
    ).resolves.toBeUndefined();
  });
});
