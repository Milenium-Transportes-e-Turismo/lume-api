import { createHash } from 'node:crypto';

import { AgentCredentialResolutionError } from '../../errors/agent-credential-resolution.error';
import { AgentModelGatewayError } from '../../errors/agent-model-gateway.error';
import {
  AgentConfigurationRepository,
  AgentExecutionRepository,
  type AgentExecutionConfiguration,
  type AgentKnowledgeExecutionSnapshot,
  type AgentMediaInterpretationReference,
  type AgentPromptExecutionSnapshot,
  type AgentRuntimeCandidate,
  type AgentRuntimeExecutionSnapshot,
  type AgentToolExecutionSnapshot,
} from '../../contracts/agent-execution.repository';
import {
  AgentFunctionToolExecutor,
  type ExecutedAgentFunctionToolCall,
} from '../../contracts/agent-function-tool.executor';
import {
  AgentFunctionToolCatalog,
  type AuthorizedAgentFunctionTool,
} from '../../contracts/agent-function-tool.catalog';
import {
  AgentModelGateway,
  type AgentModelResponse,
  type AgentModelUsage,
  type AgentModelFunctionCall,
} from '../../contracts/agent-model.gateway';
import { ConversationIdentityResolver } from '../../contracts/conversation-registration.repository';
import { CustomerContextResolver } from '../../contracts/customer-context.repository';
import {
  AppError,
  externalServiceUnavailable,
  forbidden,
  notFound,
  validationError,
} from '../../../core/errors/app-error';
import {
  buildAgentPrompt,
  canAgentCommunicateWithCustomer,
  createExecutionAttemptAudit,
  redactPotentialSecrets,
  validateAgentRuntimeConfig,
} from '../../../domain/agents/agent-runtime';
import { fingerprintAgentToolArguments } from '../../../domain/agents/agent-tool-authorization';
import { wrapUntrustedKnowledgeContent } from '../../../domain/knowledge/knowledge-policy';

const MAXIMUM_INPUT_BYTES = 1_048_576;
const MAXIMUM_FALLBACK_RUNTIMES = 10;
const MAXIMUM_TOOL_CALLS = 4;
const MAXIMUM_TOOL_RESULTS_BYTES = 32_768;
const MAXIMUM_MEDIA_INTERPRETATIONS = 50;
const SAFETY_IDENTIFIER = /^[a-z0-9_-]{8,64}$/iu;

interface SafeAttemptFailure {
  readonly code: string;
  readonly reason: string | null;
}

export interface RunAgentExecutionInput {
  readonly companyId: string;
  readonly serviceSessionId: string;
  readonly agentId: string;
  readonly parentExecutionId?: string | null;
  readonly commandId: string;
  readonly input: string;
  readonly mediaInterpretations?: readonly AgentMediaInterpretationReference[];
  readonly safetyIdentifier: string;
}

export interface RunAgentExecutionResult {
  readonly executionId: string;
  readonly status: 'completed';
  readonly customerFacing: boolean;
  readonly successfulAttempt: number;
  readonly provider: string;
  readonly model: string;
  readonly outputText: string | null;
  readonly toolCalls: readonly ExecutedAgentFunctionToolCall[];
  readonly usage: AgentModelUsage | null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function requiredIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 120) {
    throw validationError(`${label} é inválido.`);
  }
  return normalized;
}

function prepareMediaInterpretations(
  references: readonly AgentMediaInterpretationReference[] = [],
): readonly AgentMediaInterpretationReference[] {
  if (references.length > MAXIMUM_MEDIA_INTERPRETATIONS) {
    throw validationError(
      'Há interpretações de mídia demais no contexto do agente.',
    );
  }
  const byInterpretationId = new Map<
    string,
    AgentMediaInterpretationReference
  >();
  for (const reference of references) {
    const interpretationId = requiredIdentifier(
      reference.interpretationId,
      'A interpretação de mídia',
    );
    if (
      reference.effectiveSource !== 'machine' &&
      reference.effectiveSource !== 'human'
    ) {
      throw validationError('A origem efetiva da interpretação é inválida.');
    }
    const existing = byInterpretationId.get(interpretationId);
    if (existing && existing.effectiveSource !== reference.effectiveSource) {
      throw validationError(
        'A mesma interpretação não pode ter duas origens efetivas.',
      );
    }
    byInterpretationId.set(interpretationId, {
      interpretationId,
      effectiveSource: reference.effectiveSource,
    });
  }
  return [...byInterpretationId.values()].sort((left, right) =>
    left.interpretationId.localeCompare(right.interpretationId),
  );
}

function assertPositiveVersion(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw validationError(`${label} deve ser uma versão positiva.`);
  }
}

function validateConfiguration(
  requested: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly agentId: string;
  },
  configuration: AgentExecutionConfiguration,
): readonly AgentRuntimeCandidate[] {
  if (
    configuration.agent.id !== requested.agentId ||
    configuration.agent.companyId !== requested.companyId ||
    configuration.session.id !== requested.serviceSessionId ||
    configuration.session.companyId !== requested.companyId
  ) {
    throw forbidden('Agente indisponível para este atendimento.');
  }
  if (configuration.agent.status !== 'active') {
    throw forbidden('O agente não está ativo para este atendimento.');
  }
  if (
    configuration.session.customerFacing &&
    !canAgentCommunicateWithCustomer(configuration.agent.type)
  ) {
    throw forbidden(
      'Somente agentes de atendimento podem responder ao cliente.',
    );
  }
  if (configuration.fallbackRuntimes.length > MAXIMUM_FALLBACK_RUNTIMES) {
    throw validationError('Há runtimes de fallback demais para este agente.');
  }

  const candidates = [
    configuration.primaryRuntime,
    ...configuration.fallbackRuntimes,
  ];
  const runtimeIds = new Set<string>();
  for (const candidate of candidates) {
    const runtimeId = candidate.runtimeId.trim();
    if (
      !runtimeId ||
      runtimeId.length > 120 ||
      runtimeIds.has(runtimeId) ||
      candidate.agentId !== configuration.agent.id ||
      candidate.companyId !== configuration.agent.companyId
    ) {
      throw validationError(
        'A cadeia de runtimes deve pertencer exclusivamente ao mesmo agente.',
      );
    }
    runtimeIds.add(runtimeId);
    assertPositiveVersion(candidate.version, 'A configuração do runtime');
    const runtime = validateAgentRuntimeConfig(candidate.runtime);
    const allowedStatus =
      candidate === configuration.primaryRuntime
        ? runtime.status === 'active'
        : ['active', 'superseded'].includes(runtime.status);
    if (!allowedStatus) {
      throw validationError(
        'A cadeia de execução pode conter somente runtimes ativos.',
      );
    }
  }
  return candidates;
}

function compilePrompt(configuration: AgentExecutionConfiguration): {
  readonly instructions: string;
  readonly snapshot: AgentPromptExecutionSnapshot;
} {
  const prompt = configuration.prompt;
  assertPositiveVersion(prompt.systemPromptVersion, 'O system prompt');
  assertPositiveVersion(prompt.runtimeContextVersion, 'O contexto de runtime');
  assertPositiveVersion(
    prompt.layers.platformPromptVersion,
    'O prompt da plataforma',
  );
  if (prompt.layers.tenantInstructionsVersion !== null) {
    assertPositiveVersion(
      prompt.layers.tenantInstructionsVersion,
      'As instruções do tenant',
    );
  }

  const instructions = buildAgentPrompt(prompt.layers);
  const tenantInstructions = prompt.layers.tenantInstructions?.trim() || null;
  if (
    (tenantInstructions === null) !==
    (prompt.layers.tenantInstructionsVersion === null)
  ) {
    throw validationError(
      'As instruções do tenant e sua versão precisam ser registradas juntas.',
    );
  }
  return {
    instructions,
    snapshot: {
      systemPromptVersion: prompt.systemPromptVersion,
      platformPromptVersion: prompt.layers.platformPromptVersion,
      tenantInstructionsVersion: prompt.layers.tenantInstructionsVersion,
      runtimeContextVersion: prompt.runtimeContextVersion,
      systemPromptSha256: sha256(prompt.layers.systemPrompt.trim()),
      platformPromptSha256: sha256(prompt.layers.platformAgentPrompt.trim()),
      tenantInstructionsSha256: tenantInstructions
        ? sha256(tenantInstructions)
        : null,
      runtimeContextSha256: sha256(prompt.layers.runtimeContext.trim()),
      compiledInstructionsSha256: sha256(instructions),
    },
  };
}

function prepareKnowledge(configuration: AgentExecutionConfiguration): {
  readonly modelContext: readonly string[];
  readonly snapshots: readonly AgentKnowledgeExecutionSnapshot[];
} {
  const modelContext: string[] = [];
  const snapshots: AgentKnowledgeExecutionSnapshot[] = [];
  for (const item of configuration.knowledge) {
    if (
      configuration.session.customerFacing &&
      item.source.visibility !== 'customer-safe'
    ) {
      throw forbidden(
        'Conhecimento interno não pode compor uma resposta ao cliente.',
      );
    }
    if (
      !(item.source.retrievedAt instanceof Date) ||
      !Number.isFinite(item.source.retrievedAt.valueOf())
    ) {
      throw validationError('O snapshot de conhecimento é inválido.');
    }
    const normalized = item.content.trim();
    modelContext.push(wrapUntrustedKnowledgeContent(normalized));
    snapshots.push({
      ...item.source,
      contentSha256: sha256(normalized),
    });
  }
  return { modelContext, snapshots };
}

function prepareAuthorizedTools(
  tools: readonly AuthorizedAgentFunctionTool[],
): {
  readonly definitions: readonly AuthorizedAgentFunctionTool['definition'][];
  readonly snapshots: readonly AgentToolExecutionSnapshot[];
  readonly byFunctionName: ReadonlyMap<string, AuthorizedAgentFunctionTool>;
} {
  const toolIds = new Set<string>();
  const functionNames = new Set<string>();
  const snapshots: AgentToolExecutionSnapshot[] = [];
  const byFunctionName = new Map<string, AuthorizedAgentFunctionTool>();
  for (const tool of tools) {
    const toolId = tool.toolId.trim();
    const functionName = tool.definition.name.trim();
    if (
      !toolId ||
      toolId.length > 120 ||
      !functionName ||
      toolIds.has(toolId) ||
      functionNames.has(functionName)
    ) {
      throw validationError(
        'O catálogo de ferramentas autorizadas é inválido.',
      );
    }
    assertPositiveVersion(tool.policyVersion, 'A policy da ferramenta');
    toolIds.add(toolId);
    functionNames.add(functionName);
    byFunctionName.set(functionName, tool);
    snapshots.push({
      toolId,
      functionName,
      policyVersion: tool.policyVersion,
      schemaSha256: fingerprintAgentToolArguments({
        name: functionName,
        ...(tool.definition.description
          ? { description: tool.definition.description }
          : {}),
        parameters: tool.definition.parameters,
      }),
    });
  }
  return {
    definitions: tools.map((tool) => tool.definition),
    snapshots,
    byFunctionName,
  };
}

function runtimeSnapshot(
  candidate: AgentRuntimeCandidate,
  attempt: number,
  outcome: 'succeeded' | 'failed',
  errorCode?: string,
): AgentRuntimeExecutionSnapshot {
  const audit = createExecutionAttemptAudit({
    attempt,
    runtime: candidate.runtime,
    runtimeConfigVersion: candidate.version,
    outcome,
    errorCode,
  });
  return {
    runtimeId: candidate.runtimeId,
    runtimeConfigVersion: audit.runtimeConfigVersion,
    provider: audit.provider,
    model: audit.model,
    credentialIdentifier: audit.credentialIdentifier,
    temperature: candidate.runtime.temperature ?? null,
    maxOutputTokens: candidate.runtime.maxOutputTokens ?? null,
  };
}

function safeFailure(error: unknown): SafeAttemptFailure {
  if (error instanceof AgentCredentialResolutionError) {
    return { code: error.code, reason: error.reason };
  }
  if (error instanceof AgentModelGatewayError) {
    return { code: error.code, reason: error.reason };
  }
  if (error instanceof AppError) {
    return {
      code: error.code,
      reason: null,
    };
  }
  return { code: 'AGENT_EXECUTION_ATTEMPT_FAILED', reason: null };
}

interface ReturnedAgentToolCall extends AgentModelFunctionCall {
  readonly toolId: string;
}

function returnedToolCalls(
  response: AgentModelResponse,
  byFunctionName: ReadonlyMap<string, AuthorizedAgentFunctionTool>,
): readonly ReturnedAgentToolCall[] {
  if (response.toolCalls.length > MAXIMUM_TOOL_CALLS) {
    throw new AgentModelGatewayError('invalid-response');
  }
  return response.toolCalls.map((call) => {
    const authorized = byFunctionName.get(call.name);
    if (!authorized) {
      throw new AgentModelGatewayError('invalid-response');
    }
    return {
      id: call.id,
      callId: call.callId,
      toolId: authorized.toolId,
      name: call.name,
      arguments: call.arguments,
    };
  });
}

function combinedUsage(
  first: AgentModelUsage | null,
  second: AgentModelUsage | null,
): AgentModelUsage | null {
  if (!first && !second) return null;
  return {
    inputTokens: (first?.inputTokens ?? 0) + (second?.inputTokens ?? 0),
    cachedInputTokens:
      (first?.cachedInputTokens ?? 0) + (second?.cachedInputTokens ?? 0),
    outputTokens: (first?.outputTokens ?? 0) + (second?.outputTokens ?? 0),
    reasoningTokens:
      (first?.reasoningTokens ?? 0) + (second?.reasoningTokens ?? 0),
    totalTokens: (first?.totalTokens ?? 0) + (second?.totalTokens ?? 0),
  };
}

function continuationInput(
  originalInput: string,
  executionId: string,
  toolCalls: readonly ExecutedAgentFunctionToolCall[],
): string {
  const safeResults = toolCalls.map((call) => ({
    callId: call.providerCallId,
    functionName: call.functionName,
    status: 'succeeded',
    result: call.modelResult,
  }));
  const serialized = JSON.stringify(safeResults);
  if (Buffer.byteLength(serialized, 'utf8') > MAXIMUM_TOOL_RESULTS_BYTES) {
    throw validationError('Os resultados das ferramentas excedem o limite.');
  }
  const value = [
    originalInput,
    '<server-tool-continuation>',
    'As chamadas autorizadas foram concluídas. Produza somente a saída final solicitada. Não solicite nem simule novas ferramentas.',
    '</server-tool-continuation>',
    `<untrusted-tool-results execution-id="${executionId}">`,
    serialized,
    '</untrusted-tool-results>',
  ].join('\n\n');
  if (Buffer.byteLength(value, 'utf8') > MAXIMUM_INPUT_BYTES) {
    throw validationError(
      'A continuação com resultados das ferramentas excede o limite do agente.',
    );
  }
  return value;
}

function safeOutput(value: string | null): string | null {
  if (!value) return null;
  return redactPotentialSecrets(value)
    .replace(
      /\b(?:env|secret|vault|docker-secret):\/\/[a-z0-9][a-z0-9/_.-]{2,199}\b/giu,
      '[REDACTED_CREDENTIAL_REFERENCE]',
    )
    .slice(0, 100_000);
}

export class RunAgentExecutionUseCase {
  constructor(
    private readonly configurations: AgentConfigurationRepository,
    private readonly executions: AgentExecutionRepository,
    private readonly toolCatalog: AgentFunctionToolCatalog,
    private readonly toolExecutor: AgentFunctionToolExecutor,
    private readonly modelGateway: AgentModelGateway,
    private readonly clock: () => Date = () => new Date(),
    private readonly identityResolver?: ConversationIdentityResolver,
    private readonly customerContextResolver?: CustomerContextResolver,
  ) {}

  async execute(
    input: RunAgentExecutionInput,
  ): Promise<RunAgentExecutionResult> {
    const companyId = requiredIdentifier(input.companyId, 'O tenant');
    const serviceSessionId = requiredIdentifier(
      input.serviceSessionId,
      'A sessão de atendimento',
    );
    const agentId = requiredIdentifier(input.agentId, 'O agente');
    const parentExecutionId = input.parentExecutionId
      ? requiredIdentifier(input.parentExecutionId, 'A execução delegadora')
      : null;
    const commandId = requiredIdentifier(input.commandId, 'O comando');
    const modelInput = input.input.trim();
    const safetyIdentifier = input.safetyIdentifier.trim();
    const mediaInterpretations = prepareMediaInterpretations(
      input.mediaInterpretations,
    );
    if (
      !modelInput ||
      Buffer.byteLength(modelInput, 'utf8') > MAXIMUM_INPUT_BYTES
    ) {
      throw validationError('A entrada do agente é inválida.');
    }
    if (!SAFETY_IDENTIFIER.test(safetyIdentifier)) {
      throw validationError('O safety identifier do agente é inválido.');
    }

    const requested = { companyId, serviceSessionId, agentId };
    // Identity resolution is deliberately the first durable-domain read. A
    // shared phone remains ambiguous and contributes only non-PII context.
    const identity = await this.identityResolver?.resolveBeforeResponse({
      companyId,
      serviceSessionId,
    });
    const customerContext = await this.customerContextResolver?.resolveForAgent(
      {
        companyId,
        serviceSessionId,
      },
    );
    const configuration =
      await this.configurations.loadActiveForSession(requested);
    if (!configuration) throw notFound('Agente ativo para a sessão');
    const runtimes = validateConfiguration(requested, configuration);
    const prompt = compilePrompt(configuration);
    const knowledge = prepareKnowledge(configuration);

    // This is the only source for tools offered to the model. It deliberately
    // runs before both execution creation and any provider request.
    const catalogTools = await this.toolCatalog.authorizeForModel(requested);
    const tools = prepareAuthorizedTools(catalogTools);
    const combinedInput = [
      ...(identity ? [identity.modelContext] : []),
      ...(customerContext ? [customerContext.modelContext] : []),
      modelInput,
      ...knowledge.modelContext,
    ].join('\n\n');
    if (Buffer.byteLength(combinedInput, 'utf8') > MAXIMUM_INPUT_BYTES) {
      throw validationError(
        'A entrada e o conhecimento autorizado excedem o limite do agente.',
      );
    }

    const created = await this.executions.create({
      companyId,
      serviceSessionId,
      agentId,
      parentExecutionId,
      commandId,
      agentType: configuration.agent.type,
      customerFacing: configuration.session.customerFacing,
      source: configuration.session.source,
      initialRuntime: runtimeSnapshot(runtimes[0], 1, 'succeeded'),
      platformPromptVersionId: configuration.prompt.platformPromptVersionId,
      tenantPromptVersionId: configuration.prompt.tenantInstructionsVersionId,
      mediaInterpretations,
      createdAt: this.clock(),
    });
    const executionId = requiredIdentifier(
      created.executionId,
      'A execução do agente',
    );
    if (!created.created) {
      throw new AppError(
        'CONFLICT',
        'Este comando de execução já foi registrado.',
        { executionId },
      );
    }

    let lastFailure: SafeAttemptFailure = {
      code: 'AGENT_EXECUTION_ATTEMPT_FAILED',
      reason: null,
    };
    let attemptedRuntimeCount = 0;
    for (const [index, candidate] of runtimes.entries()) {
      const attempt = index + 1;
      attemptedRuntimeCount = attempt;
      const startedAt = this.clock();
      let response: AgentModelResponse;
      let executedCalls: readonly ExecutedAgentFunctionToolCall[] = [];
      let attemptUsage: AgentModelUsage | null = null;
      let continuationModelInputSha256: string | null = null;
      let toolPhaseStarted = false;
      try {
        response = await this.modelGateway.generate({
          agentId,
          runtime: candidate.runtime,
          instructions: prompt.instructions,
          input: combinedInput,
          safetyIdentifier,
          tools: tools.definitions,
        });
        if (response.status !== 'completed') {
          throw new AgentModelGatewayError('invalid-response');
        }
        attemptUsage = response.usage;
        const returnedCalls = returnedToolCalls(response, tools.byFunctionName);
        if (returnedCalls.length > 0) {
          toolPhaseStarted = true;
          const results: ExecutedAgentFunctionToolCall[] = [];
          for (const [callIndex, call] of returnedCalls.entries()) {
            results.push(
              await this.toolExecutor.execute({
                companyId,
                serviceSessionId,
                agentId,
                executionId,
                sequence: callIndex + 1,
                providerResponseId: response.responseId,
                providerItemId: call.id,
                providerCallId: call.callId,
                toolId: call.toolId,
                functionName: call.name,
                arguments: call.arguments,
              }),
            );
          }
          executedCalls = results;
          const followUpInput = continuationInput(
            combinedInput,
            executionId,
            executedCalls,
          );
          continuationModelInputSha256 = sha256(followUpInput);
          const firstResponse = response;
          response = await this.modelGateway.generate({
            agentId,
            runtime: candidate.runtime,
            instructions: prompt.instructions,
            input: followUpInput,
            safetyIdentifier,
            tools: [],
          });
          attemptUsage = combinedUsage(firstResponse.usage, response.usage);
          if (
            response.status !== 'completed' ||
            response.toolCalls.length !== 0 ||
            response.provider !== firstResponse.provider ||
            response.model !== firstResponse.model
          ) {
            throw new AgentModelGatewayError('invalid-response');
          }
        }
        response = { ...response, outputText: safeOutput(response.outputText) };
      } catch (error) {
        lastFailure = safeFailure(error);
        await this.executions.recordAttempt({
          companyId,
          executionId,
          attempt,
          startedAt,
          completedAt: this.clock(),
          runtime: runtimeSnapshot(
            candidate,
            attempt,
            'failed',
            lastFailure.code,
          ),
          prompt: prompt.snapshot,
          knowledge: knowledge.snapshots,
          tools: tools.snapshots,
          modelInputSha256: sha256(combinedInput),
          continuationModelInputSha256,
          outcome: 'failed',
          usage: attemptUsage,
          errorCode: lastFailure.code,
          errorReason: lastFailure.reason,
        });
        if (toolPhaseStarted) break;
        continue;
      }

      await this.executions.recordAttempt({
        companyId,
        executionId,
        attempt,
        startedAt,
        completedAt: this.clock(),
        runtime: runtimeSnapshot(candidate, attempt, 'succeeded'),
        prompt: prompt.snapshot,
        knowledge: knowledge.snapshots,
        tools: tools.snapshots,
        modelInputSha256: sha256(combinedInput),
        continuationModelInputSha256,
        outcome: 'succeeded',
        usage: attemptUsage,
        errorCode: null,
        errorReason: null,
      });
      await this.executions.complete({
        companyId,
        executionId,
        successfulAttempt: attempt,
        providerResponseId: response.responseId,
        provider: response.provider,
        model: response.model,
        outputText: response.outputText,
        toolCalls: executedCalls,
        usage: attemptUsage,
        completedAt: this.clock(),
      });
      return {
        executionId,
        status: 'completed',
        customerFacing: configuration.session.customerFacing,
        successfulAttempt: attempt,
        provider: response.provider,
        model: response.model,
        outputText: response.outputText,
        toolCalls: executedCalls,
        usage: attemptUsage,
      };
    }

    try {
      await this.executions.fail({
        companyId,
        executionId,
        attemptedRuntimeCount,
        errorCode: lastFailure.code,
        errorReason: lastFailure.reason,
        failedAt: this.clock(),
      });
    } catch {
      throw externalServiceUnavailable(
        'Não foi possível registrar a falha da execução do agente.',
        { executionId },
      );
    }
    throw externalServiceUnavailable(
      'Não foi possível concluir a execução do agente.',
      {
        executionId,
        failureCode: lastFailure.code,
      },
    );
  }
}
