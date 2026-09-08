import { DataExchangeModule } from '../data-exchange/data-exchange.module';
import { RegistrationContactExportService } from '../../application/use-cases/registrations/registration-contact-export.service';
import { RegistrationContactExportController } from './registration-contact-export.controller';
import { Module } from '@nestjs/common';

import { RegistrationReconciliationService } from '../../application/use-cases/registrations/registration-reconciliation.service';
import { RegistrationsService } from '../../application/use-cases/registrations/registrations.service';
import { RegistrationReconciliationWorkbookService } from '../../infra/registrations/registration-reconciliation-workbook.service';
import { RegistrationReconciliationController } from './registration-reconciliation.controller';
import { RegistrationsController } from './registrations.controller';

@Module({
  imports: [DataExchangeModule],
  controllers: [
    RegistrationContactExportController,
    RegistrationsController,
    RegistrationReconciliationController,
  ],
  providers: [
    RegistrationContactExportService,
    RegistrationsService,
    RegistrationReconciliationWorkbookService,
    RegistrationReconciliationService,
  ],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
