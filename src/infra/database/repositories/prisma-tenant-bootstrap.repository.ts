import { Injectable } from '@nestjs/common';

import {
  TenantBootstrapRepository,
  type BootstrapTenantPersistenceInput,
} from '../../../application/contracts/repositories';
import type { UserDepartment } from '../../../domain/access/access.constants';
import {
  DEFAULT_REGISTRATION_ROLES,
  DEFAULT_REGISTRATION_TAGS,
} from '../../../domain/registrations/registration';
import { ensurePlatformAgentCatalog } from '../../agents/platform-agent-persistence';
import {
  DepartmentCode,
  DocumentAccessMode,
  Prisma,
  UserAccountStatus,
} from '../prisma/generated/client';
import { rethrowKnownPrismaConflict } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';

const departmentPersistenceCodes: Readonly<
  Record<UserDepartment, DepartmentCode>
> = {
  'client-company': DepartmentCode.CLIENT_COMPANY,
  'human-resources': DepartmentCode.HUMAN_RESOURCES,
  'personnel-department': DepartmentCode.PERSONNEL_DEPARTMENT,
  commercial: DepartmentCode.COMMERCIAL,
  purchasing: DepartmentCode.PURCHASING,
  controlling: DepartmentCode.CONTROLLING,
  maintenance: DepartmentCode.MAINTENANCE,
  monitoring: DepartmentCode.MONITORING,
  management: DepartmentCode.MANAGEMENT,
  directorate: DepartmentCode.DIRECTORATE,
  operations: DepartmentCode.OPERATIONS,
  cleaning: DepartmentCode.CLEANING,
  financial: DepartmentCode.FINANCIAL,
  'information-technology': DepartmentCode.INFORMATION_TECHNOLOGY,
};

@Injectable()
export class PrismaTenantBootstrapRepository implements TenantBootstrapRepository {
  constructor(private readonly prisma: PrismaService) {}

  async isInitialized(): Promise<boolean> {
    return (await this.prisma.company.count()) > 0;
  }

  async createWithAdministrator(
    input: BootstrapTenantPersistenceInput,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.company.create({ data: input.company.props });
        await transaction.registrationRole.createMany({
          data: DEFAULT_REGISTRATION_ROLES.map((role) => ({
            companyId: input.company.id,
            ...role,
            isSystem: true,
          })),
        });
        await transaction.registrationTag.createMany({
          data: DEFAULT_REGISTRATION_TAGS.map((tag) => ({
            companyId: input.company.id,
            ...tag,
          })),
        });
        await transaction.tenantDepartment.createMany({
          data: input.departments.map((department) => ({
            companyId: input.company.id,
            code: departmentPersistenceCodes[department.code],
            name: department.name,
            isDefault: department.isDefault,
          })),
        });
        await transaction.user.create({
          data: {
            ...input.administrator.props,
            documentAccessMode: DocumentAccessMode.STANDARD,
            clientCategory: null,
            departments: [...input.administrator.props.departments],
            permissionCodes: [...input.administrator.props.permissionCodes],
            dependents: input.administrator.props
              .dependents as unknown as Prisma.InputJsonValue,
            status: UserAccountStatus.ACTIVE,
          },
        });
        await ensurePlatformAgentCatalog(transaction, input.company.id);
        await transaction.tenantAuditLog.create({
          data: {
            companyId: input.company.id,
            actorUserId: input.administrator.id,
            action: 'TENANT_BOOTSTRAPPED',
            targetType: 'company',
            targetId: input.company.id,
            metadata: {},
          },
        });
      });
    } catch (error) {
      rethrowKnownPrismaConflict(error);
    }
  }
}
