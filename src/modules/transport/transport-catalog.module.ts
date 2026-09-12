import { Module } from '@nestjs/common';
import { TransportCatalogController } from './transport-catalog.controller';
import { TransportCatalogUseCase } from './transport-catalog.use-case';
import { TransportCatalogRepository } from './transport-catalog.repository';
@Module({
  controllers: [TransportCatalogController],
  providers: [TransportCatalogUseCase, TransportCatalogRepository],
  exports: [TransportCatalogRepository],
})
export class TransportCatalogModule {}
