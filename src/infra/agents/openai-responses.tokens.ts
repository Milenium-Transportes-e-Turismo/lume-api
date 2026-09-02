export const AGENT_OPENAI_RESPONSES_FETCHER = Symbol(
  'AGENT_OPENAI_RESPONSES_FETCHER',
);

export const AGENT_MODEL_PROVIDER_ADAPTERS = Symbol(
  'AGENT_MODEL_PROVIDER_ADAPTERS',
);

export type AgentOpenAiResponsesFetcher = typeof globalThis.fetch;
