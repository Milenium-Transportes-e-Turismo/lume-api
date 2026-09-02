import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AgentCredentialResolver } from '../../application/contracts/agent-credential-resolver';
import { AgentModelGateway } from '../../application/contracts/agent-model.gateway';
import { AgentModelGatewayRegistry } from '../../infra/agents/agent-model-gateway.registry';
import { HttpOpenAiResponsesGateway } from '../../infra/agents/http-openai-responses.gateway';
import {
  AGENT_MODEL_PROVIDER_ADAPTERS,
  AGENT_OPENAI_RESPONSES_FETCHER,
} from '../../infra/agents/openai-responses.tokens';
import { ServerSideAgentCredentialResolver } from '../../infra/agents/server-side-agent-credential.resolver';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: AGENT_OPENAI_RESPONSES_FETCHER,
      useValue: globalThis.fetch.bind(globalThis),
    },
    {
      provide: AgentCredentialResolver,
      useClass: ServerSideAgentCredentialResolver,
    },
    {
      provide: AGENT_MODEL_PROVIDER_ADAPTERS,
      useFactory: (openAi: HttpOpenAiResponsesGateway) => [openAi],
      inject: [HttpOpenAiResponsesGateway],
    },
    HttpOpenAiResponsesGateway,
    {
      provide: AgentModelGateway,
      useClass: AgentModelGatewayRegistry,
    },
  ],
  exports: [
    AgentCredentialResolver,
    AgentModelGateway,
    AGENT_OPENAI_RESPONSES_FETCHER,
  ],
})
export class AgentsFoundationModule {}
