import type { OpenAiApiCredential } from '../value-objects/openai-api-credential';

export interface ResolveAgentCredentialInput {
  readonly agentId: string;
  readonly credentialRef: string;
  readonly credentialIdentifier: string;
}

export abstract class AgentCredentialResolver {
  abstract resolve(
    input: ResolveAgentCredentialInput,
  ): Promise<OpenAiApiCredential>;
}
