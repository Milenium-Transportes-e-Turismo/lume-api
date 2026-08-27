import { Module } from '@nestjs/common';

import { RegistrationReconciliationService } from '../../application/use-cases/registrations/registration-reconciliation.service';
import { RegistrationsService } from '../../application/use-cases/registrations/registrations.service';
import { RegistrationReconciliationWorkbookService } from '../../infra/registrations/registration-reconciliation-workbook.service';
import { RegistrationReconciliationController } from './registration-reconciliation.controller';
import { RegistrationsController } from './registrations.controller';

@Module({
  controllers: [RegistrationsController, RegistrationReconciliationController],
  providers: [
    RegistrationsService,
    RegistrationReconciliationWorkbookService,
    RegistrationReconciliationService,
  ],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
