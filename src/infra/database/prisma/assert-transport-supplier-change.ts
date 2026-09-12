import { forbidden, validationError } from '../../../core/errors/app-error';
import type { Prisma } from './generated/client';

/** Canonical entrypoints must preserve the supplier identity and restricted inactivation. */
export async function assertTransportSupplierChange(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    registrationId: string;
    actorUserId: string;
    beforeCnpj: string | null;
    cnpj?: string | null;
    beforeType: string;
    clientType?: string;
    beforeStatus: string;
    status?: string;
  },
) {
  const identityChanged =
    (input.cnpj !== undefined && input.cnpj !== input.beforeCnpj) ||
    (input.clientType !== undefined &&
      input.clientType.toLowerCase() !== input.beforeType.toLowerCase());
  const inactivating =
    input.status !== undefined &&
    input.status.toLowerCase() !== 'active' &&
    input.status.toLowerCase() !== input.beforeStatus.toLowerCase();
  if (!identityChanged && !inactivating) return;
  const profile = await tx.transportSupplierProfile.findFirst({
    where: {
      companyId: input.companyId,
      legacyRegistrationId: input.registrationId,
    },
  });
  if (!profile) return;
  if (identityChanged)
    throw validationError(
      'A identidade de uma empresa prestadora com histórico não pode ser substituída. Cadastre outra empresa.',
    );
  const actor = await tx.user.findFirst({
    where: { companyId: input.companyId, id: input.actorUserId },
    select: { departments: true },
  });
  if (
    !actor?.departments.some(
      (value) => value === 'management' || value === 'directorate',
    )
  )
    throw forbidden(
      'Somente diretoria ou gerência podem inativar uma empresa prestadora.',
    );
}
