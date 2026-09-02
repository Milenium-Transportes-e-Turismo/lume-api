import { Module } from '@nestjs/common';

import { OperationalTripsService } from '../../application/use-cases/trips/operational-trips.service';
import { OperationalTripsController } from './operational-trips.controller';

@Module({
  controllers: [OperationalTripsController],
  providers: [OperationalTripsService],
  exports: [OperationalTripsService],
})
export class OperationalTripsModule {}
