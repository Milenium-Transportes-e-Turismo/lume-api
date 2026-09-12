import { TransportSummaryService } from '../../application/use-cases/transport/transport-summary.service';
import { Module } from '@nestjs/common';
import { TransportImportService } from '../../application/use-cases/transport/transport-import.service';
import { TransportWorkerService } from '../../application/use-cases/transport/transport-worker.service';
import { TransportImportController } from './transport-import.controller';
@Module({
  controllers: [TransportImportController],
  providers: [
    TransportImportService,
    TransportWorkerService,
    TransportSummaryService,
  ],
  exports: [TransportImportService, TransportWorkerService],
})
export class TransportImportModule {}
