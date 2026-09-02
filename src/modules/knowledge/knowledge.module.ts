import { Module } from '@nestjs/common';

import { KnowledgeDocumentExtractor } from '../../application/contracts/knowledge-document.extractor';
import { KnowledgeOriginalStorage } from '../../application/contracts/knowledge-original.storage';
import { KnowledgeRepository } from '../../application/contracts/knowledge.repository';
import { KnowledgeManagementUseCase } from '../../application/use-cases/knowledge/knowledge-management.use-case';
import { DatabaseModule } from '../../infra/database/database.module';
import { PrismaKnowledgeRepository } from '../../infra/database/repositories/prisma-knowledge.repository';
import { LocalKnowledgeDocumentExtractor } from '../../infra/knowledge/knowledge-document.extractor';
import { FileSystemKnowledgeOriginalStorage } from '../../infra/storage/file-system-knowledge-original.storage';
import { DataExchangeModule } from '../data-exchange/data-exchange.module';
import { KnowledgeController } from './knowledge.controller';
import { InternalKnowledgeObservationsController } from './internal-knowledge-observations.controller';
import { ServiceIdentityGuard } from '../../shared/http/guards/service-identity.guard';

@Module({
  imports: [DatabaseModule, DataExchangeModule],
  controllers: [KnowledgeController, InternalKnowledgeObservationsController],
  providers: [
    PrismaKnowledgeRepository,
    {
      provide: KnowledgeRepository,
      useExisting: PrismaKnowledgeRepository,
    },
    FileSystemKnowledgeOriginalStorage,
    {
      provide: KnowledgeOriginalStorage,
      useExisting: FileSystemKnowledgeOriginalStorage,
    },
    LocalKnowledgeDocumentExtractor,
    {
      provide: KnowledgeDocumentExtractor,
      useExisting: LocalKnowledgeDocumentExtractor,
    },
    {
      provide: KnowledgeManagementUseCase,
      inject: [
        KnowledgeRepository,
        KnowledgeOriginalStorage,
        KnowledgeDocumentExtractor,
      ],
      useFactory: (
        repository: KnowledgeRepository,
        storage: KnowledgeOriginalStorage,
        extractor: KnowledgeDocumentExtractor,
      ) => new KnowledgeManagementUseCase(repository, storage, extractor),
    },
    ServiceIdentityGuard,
  ],
  exports: [KnowledgeManagementUseCase],
})
export class KnowledgeModule {}
