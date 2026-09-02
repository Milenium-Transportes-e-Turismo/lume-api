import { Module } from '@nestjs/common';

import {
  AgentConfigurationRepository,
  AgentExecutionRepository,
} from '../../application/contracts/agent-execution.repository';
import { AgentFunctionToolCatalog } from '../../application/contracts/agent-function-tool.catalog';
import { AgentFunctionToolExecutor } from '../../application/contracts/agent-function-tool.executor';
import { AgentModelGateway } from '../../application/contracts/agent-model.gateway';
import { ConversationIdentityResolver } from '../../application/contracts/conversation-registration.repository';
import { CustomerContextResolver } from '../../application/contracts/customer-context.repository';
import { RunAgentExecutionUseCase } from '../../application/use-cases/agents/run-agent-execution.use-case';
import { PrismaAgentExecutionRepository } from '../../infra/database/repositories/prisma-agent-execution.repository';
import { PrismaAgentFunctionToolCatalog } from '../../infra/database/repositories/prisma-agent-function-tool.catalog';
import { ServerSideAgentFunctionToolExecutor } from '../../infra/agents/server-side-agent-function-tool.executor';
import { DatabaseModule } from '../../infra/database/database.module';
import { AgentAdministrationController } from './agent-administration.controller';
import { AgentAdministrationService } from './agent-administration.service';
import { AgentsFoundationModule } from './agents-foundation.module';
import { RegistrationConversationModule } from '../registration-conversations/registration-conversation.module';
import { CustomerContextModule } from '../customer-context/customer-context.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';

@Module({
  imports: [
    DatabaseModule,
    AgentsFoundationModule,
    RegistrationConversationModule,
    CustomerContextModule,
    KnowledgeModule,
  ],
  controllers: [AgentAdministrationController],
  providers: [
    PrismaAgentExecutionRepository,
    {
      provide: AgentConfigurationRepository,
      useExisting: PrismaAgentExecutionRepository,
    },
    {
      provide: AgentExecutionRepository,
      useExisting: PrismaAgentExecutionRepository,
    },
    PrismaAgentFunctionToolCatalog,
    {
      provide: AgentFunctionToolCatalog,
      useExisting: PrismaAgentFunctionToolCatalog,
    },
    ServerSideAgentFunctionToolExecutor,
    {
      provide: AgentFunctionToolExecutor,
      useExisting: ServerSideAgentFunctionToolExecutor,
    },
    {
      provide: RunAgentExecutionUseCase,
      useFactory: (
        configurations: AgentConfigurationRepository,
        executions: AgentExecutionRepository,
        tools: AgentFunctionToolCatalog,
        toolExecutor: AgentFunctionToolExecutor,
        models: AgentModelGateway,
        identity: ConversationIdentityResolver,
        customerContext: CustomerContextResolver,
      ) =>
        new RunAgentExecutionUseCase(
          configurations,
          executions,
          tools,
          toolExecutor,
          models,
          undefined,
          identity,
          customerContext,
        ),
      inject: [
        AgentConfigurationRepository,
        AgentExecutionRepository,
        AgentFunctionToolCatalog,
        AgentFunctionToolExecutor,
        AgentModelGateway,
        ConversationIdentityResolver,
        CustomerContextResolver,
      ],
    },
    AgentAdministrationService,
  ],
  exports: [RunAgentExecutionUseCase, AgentFunctionToolCatalog],
})
export class AgentsRuntimeModule {}
