import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type {
  WhatsAppConversationAgentInput,
  WhatsAppConversationAgentResult,
} from '../../../application/contracts/whatsapp-conversation-agent';
import {
  type ClaimedWhatsAppAutomationEvent,
  WhatsAppAutomationExecutionError,
} from '../../../application/contracts/whatsapp-automation.provider';
import { validateAiProviderOutput } from '../../../domain/whatsapp/whatsapp-automation-flow';
import type { Prisma } from '../../database/prisma/generated/client';
import { PrismaService } from '../../database/prisma/prisma.service';

@Injectable()
export class WhatsAppAutomationDecisionStore {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(
    event: Pick<ClaimedWhatsAppAutomationEvent, 'id' | 'companyId'>,
    input: WhatsAppConversationAgentInput,
    createDecision: () => Promise<WhatsAppConversationAgentResult>,
  ): Promise<WhatsAppConversationAgentResult> {
    const inputHash = decisionInputHash(input);
    const key = {
      outboxEventId_companyId: {
        outboxEventId: event.id,
        companyId: event.companyId,
      },
    };
    const existing = await this.prisma.whatsAppAutomationDecision.findUnique({
      where: key,
    });
    if (existing) {
      assertDecisionInputHash(existing.inputHash, inputHash);
      return this.toResult(existing);
    }

    const decision = await createDecision();
    const persisted = await this.prisma.whatsAppAutomationDecision.upsert({
      where: key,
      create: {
        companyId: event.companyId,
        outboxEventId: event.id,
        actorAgentId: decision.agentId,
        agentExecutionId: decision.agentExecutionId,
        inputHash,
        provider: decision.provider,
        model: decision.model,
        promptVersion: 'platform-agent-runtime',
        aiAttempt: decision.attempt,
        output: decision.output as unknown as Prisma.InputJsonValue,
      },
      update: {},
    });
    assertDecisionInputHash(persisted.inputHash, inputHash);
    return this.toResult(persisted);
  }

  private toResult(row: {
    provider: string;
    model: string;
    aiAttempt: number;
    output: Prisma.JsonValue;
    actorAgentId: string | null;
    agentExecutionId: string | null;
  }): WhatsAppConversationAgentResult {
    const validated = validateAiProviderOutput(row.output);
    if (
      !/^[a-z][a-z0-9._-]{1,19}$/iu.test(row.provider) ||
      !validated.valid ||
      !validated.output
    ) {
      throw new WhatsAppAutomationExecutionError(
        'terminal-failure',
        'AI_DECISION_INVALID',
        'A decisão de IA armazenada não atende ao contrato esperado.',
      );
    }
    return {
      provider: row.provider,
      model: row.model,
      attempt: row.aiAttempt,
      output: validated.output,
      ...(row.actorAgentId && row.agentExecutionId
        ? {
            agentId: row.actorAgentId,
            agentExecutionId: row.agentExecutionId,
          }
        : {}),
    };
  }
}

function decisionInputHash(input: WhatsAppConversationAgentInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        sourceEventId: input.sourceEventId,
        companyId: input.companyId,
        conversationId: input.conversationId,
        serviceSessionId: input.serviceSessionId,
        aiMode: input.aiMode,
        userMessage: input.userMessage,
        ...(input.contextThrough
          ? { contextThrough: input.contextThrough }
          : {}),
        ...(input.mediaInterpretations?.length
          ? { mediaInterpretations: input.mediaInterpretations }
          : {}),
        currentConversation: input.currentConversation,
      }),
    )
    .digest('hex');
}

function assertDecisionInputHash(actual: string, expected: string): void {
  if (actual === expected) return;
  throw new WhatsAppAutomationExecutionError(
    'terminal-failure',
    'AI_DECISION_INPUT_MISMATCH',
    'A decisao armazenada pertence a uma entrada diferente.',
  );
}
