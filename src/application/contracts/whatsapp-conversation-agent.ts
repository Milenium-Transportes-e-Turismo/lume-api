import type {
  AiMode,
  AiProviderOutput,
  AutomationConversation,
} from '../../domain/whatsapp/whatsapp-automation-flow';
import type { AgentMediaInterpretationReference } from './agent-execution.repository';

export interface WhatsAppConversationAgentInput {
  readonly sourceEventId: string;
  readonly correlationId: string;
  readonly companyId: string;
  readonly conversationId: string;
  readonly serviceSessionId: string;
  readonly aiMode: AiMode;
  readonly userMessage: string;
  readonly contextThrough?: string;
  readonly mediaInterpretations?: readonly AgentMediaInterpretationReference[];
  readonly currentConversation: AutomationConversation | null;
  readonly instructionText?: string;
  readonly contextText?: string;
  readonly contentText?: string;
}

export interface WhatsAppConversationAgentResult {
  readonly output: AiProviderOutput;
  readonly provider: string;
  readonly model: string;
  readonly attempt: number;
  readonly agentId?: string;
  readonly agentExecutionId?: string;
}

export type WhatsAppContinuityClassification =
  'continuation' | 'new-subject' | 'uncertain';

export interface WhatsAppContinuityMessageContext {
  readonly direction: 'inbound' | 'outbound';
  readonly text: string;
  readonly occurredAt: string;
}

export interface WhatsAppContinuityTargetDepartment {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface WhatsAppContinuityClassificationInput {
  readonly sourceEventId: string;
  readonly companyId: string;
  readonly conversationId: string;
  readonly serviceSessionId: string;
  readonly currentDepartmentId: string | null;
  readonly previousMessages: readonly WhatsAppContinuityMessageContext[];
  readonly userMessage: string;
  readonly allowedTargetDepartments: readonly WhatsAppContinuityTargetDepartment[];
}

export interface WhatsAppContinuityClassificationResult {
  readonly classification: WhatsAppContinuityClassification;
  readonly confidence: number;
  readonly reason: string;
  readonly targetDepartmentId: string | null;
  readonly agentId: string;
  readonly agentExecutionId: string;
}

export class WhatsAppContinuityClassificationError extends Error {
  readonly name = 'WhatsAppContinuityClassificationError';

  constructor(
    readonly agentId: string | null,
    readonly agentExecutionId: string | null,
  ) {
    super('A classificação silenciosa de continuidade falhou.');
  }
}

export abstract class WhatsAppConversationAgent {
  classifyContinuity(
    input: WhatsAppContinuityClassificationInput,
  ): Promise<WhatsAppContinuityClassificationResult> {
    void input;
    return Promise.reject(
      new Error('Este adaptador não suporta classificação de continuidade.'),
    );
  }

  abstract complete(
    input: WhatsAppConversationAgentInput,
  ): Promise<WhatsAppConversationAgentResult>;
}

export const WHATSAPP_CONVERSATION_AGENT = Symbol(
  'WHATSAPP_CONVERSATION_AGENT',
);
