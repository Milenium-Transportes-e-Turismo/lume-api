import { Module } from '@nestjs/common';

import { PreAdmissionAccessService } from '../../application/use-cases/pre-admission/pre-admission-access.service';
import { PreAdmissionController } from './pre-admission.controller';

@Module({
  controllers: [PreAdmissionController],
  providers: [PreAdmissionAccessService],
})
export class PreAdmissionModule {}
