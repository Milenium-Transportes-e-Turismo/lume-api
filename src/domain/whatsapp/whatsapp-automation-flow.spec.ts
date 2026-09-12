import { describe, expect, it } from 'vitest';

import { UNSUPPORTED_MESSAGE_KIND_REPLY_TEXT } from './whatsapp.constants';
import {
  QUOTE_CONFIRMATION_MESSAGE,
  appendBufferedMessage,
  aiOutputResolvesConversation,
  announcesHumanHandoff,
  buildBufferedText,
  decideAutomationPlan,
  deriveAiActions,
  deterministicCommandId,
  isExplicitPositiveConfirmation,
  isExplicitNewQuoteRequest,
  mediaInterpretationsUsedInBufferedText,
  validateAiProviderOutput,
  type AutomationConversation,
  type WhatsAppAutomationEnvelope,
} from './whatsapp-automation-flow';

describe('isExplicitPositiveConfirmation', () => {
  it('aceita uma confirmação seguida de informação complementar', () => {
    expect(
      isExplicitPositiveConfirmation('Sim. Depois passo o endereço de saída'),
    ).toBe(true);
    expect(
      isExplicitPositiveConfirmation('Sim, pode confirmar. Obrigado!'),
    ).toBe(true);
  });

  it('não trata uma frase ambígua como confirmação', () => {
    expect(isExplicitPositiveConfirmation('Acho que sim')).toBe(false);
    expect(isExplicitPositiveConfirmation('Ainda preciso corrigir')).toBe(
      false,
    );
  });
});

function conversation(
  overrides: Partial<AutomationConversation> = {},
): AutomationConversation {
  return {
    id: 'conversation-1',
    department: 'commercial',
    conversationState: 'bot-active',
    flowStep: 'main-menu',
    requestStatus: 'not-started',
    resumeState: null,
    version: 1,
    mainMenuPresentedAt: '2026-07-25T12:00:00.000Z',
    followUpMenuPresentedAt: null,
    departmentContactOption: null,
    assignedTo: null,
    currentQuoteRequest: null,
    ...overrides,
  };
}

function envelope(
  text: string | null,
  current = conversation(),
  overrides: {
    readonly firstContact?: boolean;
    readonly reopenedAfterClosure?: boolean;
    readonly kind?: WhatsAppAutomationEnvelope['payload']['message']['kind'];
    readonly topic?: WhatsAppAutomationEnvelope['topic'];
    readonly automationAllowed?: boolean;
    readonly canGenerateReply?: boolean;
    readonly canSendReply?: boolean;
    readonly contextualTransition?: boolean;
    readonly media?: Readonly<Record<string, unknown>> | null;
  } = {},
): WhatsAppAutomationEnvelope {
  return {
    schemaVersion: '1.0',
    id: 'event-1',
    companyId: 'company-1',
    topic: overrides.topic ?? 'whatsapp.inbound.persisted',
    aggregateType: 'whatsapp-conversation',
    aggregateId: current.id,
    aggregateSequence: 1,
    executionId: 'execution-1',
    correlationId: 'correlation-1',
    occurredAt: '2026-07-25T12:00:00.000Z',
    payload: {
      eventId: 'event-1',
      messageId: 'message-1',
      conversationId: current.id,
      channelId: 'channel-1',
      companyId: 'company-1',
      contact: {
        id: 'contact-1',
        phone: '5511999999999',
        displayName: 'Cliente',
      },
      message: {
        providerMessageId: 'provider-message-1',
        direction: 'inbound',
        deliveryStatus: 'received',
        kind: overrides.kind ?? 'text',
        text,
        media: overrides.media ?? null,
        occurredAt: '2026-07-25T12:00:00.000Z',
      },
      conversation: current,
      automationAllowed: overrides.automationAllowed ?? true,
      canGenerateReply: overrides.canGenerateReply ?? true,
      canSendReply: overrides.canSendReply ?? true,
      contextualTransition: overrides.contextualTransition ?? false,
      isFirstContact: overrides.firstContact ?? false,
      reopenedAfterClosure: overrides.reopenedAfterClosure ?? false,
    },
  };
}

describe('fluxo de automação do WhatsApp', () => {
  it('confirma a coleta sem prometer um menu no próximo contato', () => {
    expect(QUOTE_CONFIRMATION_MESSAGE).not.toMatch(/menu|opção|número/i);
  });

  it.each([
    'main-menu',
    'commercial-menu',
    'commercial-follow-up-menu',
  ] as const)(
    'usa contexto em %s inclusive com marcadores legados de menu',
    (flowStep) => {
      const current = conversation({
        flowStep,
        requestStatus: 'under-review',
        followUpMenuPresentedAt: null,
      });
      for (const text of [
        'Quero falar do pagamento da viagem de quinze dias atrás',
        '0',
        '1',
        'Obrigado',
      ]) {
        const plan = decideAutomationPlan({
          envelope: envelope(text, current, { contextualTransition: true }),
        });
        expect(plan).toMatchObject({
          kind: 'ai',
          aiMode: 'natural-service',
          responseMessage: null,
          transitionBeforeAi: null,
          transitionAfterSend: null,
        });
      }
    },
  );

  it('entende a primeira mensagem em linguagem natural sem impor menu', () => {
    const current = conversation({ mainMenuPresentedAt: null });

    expect(
      decideAutomationPlan({
        envelope: envelope('Olá', current, { firstContact: true }),
      }),
    ).toMatchObject({
      kind: 'ai',
      aiMode: 'natural-service',
      responseMessage: null,
      transitionAfterSend: null,
      reason: 'natural-language-first-contact',
    });
  });

  it('usa o estado mais recente quando uma mensagem chegou durante a IA', () => {
    const eventConversation = conversation({ flowStep: 'main-menu' });
    const latestConversation = conversation({
      flowStep: 'quote-data-collection',
      requestStatus: 'collecting-information',
      version: 4,
    });

    expect(
      decideAutomationPlan({
        envelope: envelope('1', eventConversation),
        conversation: latestConversation,
      }),
    ).toMatchObject({
      kind: 'ai',
      aiMode: 'eventual-quote',
      reason: 'continue-quote',
    });
  });

  it.each(['2', '3', '4', '5', '6', '7', '8', '9'] as const)(
    'não transforma o texto %s em transferência automática de departamento',
    (option) => {
      expect(
        decideAutomationPlan({ envelope: envelope(option) }),
      ).toMatchObject({
        kind: 'ai',
        aiMode: 'natural-service',
        transitionBeforeAi: null,
        transitionMetadata: null,
        reason: 'natural-language-service',
      });
    },
  );

  it('retoma contexto de contato departamental legado sem notificação ou menu fixo', () => {
    const current = conversation({
      flowStep: 'main-menu',
      department: 'management',
      departmentContactOption: 'commercial-continuous-director',
    });
    expect(
      decideAutomationPlan({
        envelope: envelope('Maria, sobre o fretamento contínuo', current),
      }),
    ).toMatchObject({
      kind: 'ai',
      aiMode: 'natural-service',
      transitionAfterSend: null,
      responseMessage: null,
    });
  });

  it('orienta conteúdo não textual sem enviá-lo para a IA nem alterar o fluxo', () => {
    const event = envelope(null, conversation(), {
      kind: 'audio',
      media: { transcription: 'conteúdo que não deve chegar à IA' },
    });

    expect(decideAutomationPlan({ envelope: event })).toMatchObject({
      kind: 'static-reply',
      responseMessage: UNSUPPORTED_MESSAGE_KIND_REPLY_TEXT,
      transitionBeforeAi: null,
      transitionAfterSend: null,
      aiMode: null,
      reason: 'unsupported-message-kind-preserves-conversation-state',
      outboundPurpose: 'unsupported-message-kind',
    });
  });

  it.each([
    'image',
    'audio',
    'video',
    'sticker',
    'document',
    'location',
    'contact',
    'unknown',
  ] as const)('bloqueia %s antes do roteamento do menu comercial', (kind) => {
    const current = conversation({
      flowStep: 'commercial-menu',
      version: 3,
    });

    expect(
      decideAutomationPlan({
        envelope: envelope(null, current, {
          kind,
          media: { ignoredByAutomation: true },
        }),
      }),
    ).toMatchObject({
      kind: 'static-reply',
      responseMessage: UNSUPPORTED_MESSAGE_KIND_REPLY_TEXT,
      transitionBeforeAi: null,
      transitionAfterSend: null,
      aiMode: null,
      outboundPurpose: 'unsupported-message-kind',
    });
  });

  it('orienta mídia após encerramento sem reintroduzir menu numérico', () => {
    const current = conversation({ mainMenuPresentedAt: null });
    const plan = decideAutomationPlan({
      envelope: envelope(null, current, {
        kind: 'image',
        media: { mimeType: 'image/jpeg' },
        reopenedAfterClosure: true,
      }),
    });

    expect(plan).toMatchObject({
      kind: 'static-reply',
      transitionAfterSend: null,
      outboundPurpose: null,
      reason: 'reopened-conversation-menu-pending-durable-confirmation',
    });
    expect(plan.responseMessage).not.toContain('1 - Comercial');
  });

  it('repete a pergunta pendente do orçamento quando recebe mídia', () => {
    const current = conversation({
      flowStep: 'quote-data-collection',
      requestStatus: 'collecting-information',
    });

    expect(
      decideAutomationPlan({
        envelope: envelope(null, current, {
          kind: 'document',
          media: { mimeType: 'application/pdf' },
        }),
        pendingQuestion: 'Qual é a cidade de destino?',
      }),
    ).toMatchObject({
      responseMessage: `Qual é a cidade de destino?\n\n${UNSUPPORTED_MESSAGE_KIND_REPLY_TEXT}`,
      transitionBeforeAi: null,
      transitionAfterSend: null,
      aiMode: null,
    });
  });

  it.each([
    'text',
    'image',
    'audio',
    'video',
    'sticker',
    'document',
    'unknown',
  ] as const)(
    'mantém silêncio absoluto para %s durante atendimento humano',
    (kind) => {
      const current = conversation({
        conversationState: 'human-active',
        flowStep: 'human-service',
        assignedTo: { id: 'user-1', name: 'Operador' },
      });

      expect(
        decideAutomationPlan({
          envelope: envelope(kind === 'text' ? 'Detalhe' : null, current, {
            kind,
            media: kind === 'text' ? null : { received: true },
            topic: 'whatsapp.inbound.human-notification',
            automationAllowed: false,
            canGenerateReply: false,
            canSendReply: false,
          }),
        }),
      ).toMatchObject({
        kind: 'human-notification',
        responseMessage: null,
        transitionAfterSend: null,
        reason: 'human-active-blocks-bot',
      });
    },
  );

  it.each([
    { conversationState: 'sent-to-human' as const },
    { flowStep: 'human-service' as const },
    { assignedTo: { id: 'user-1', name: 'Operador' } },
  ])(
    'bloqueia toda automação em qualquer sinal de atendimento humano',
    (blocked) => {
      expect(
        decideAutomationPlan({
          envelope: envelope('Olá', conversation(blocked)),
        }),
      ).toMatchObject({
        kind: 'human-notification',
        responseMessage: null,
      });
    },
  );

  it('não ativa o bot durante atendimento humano', () => {
    const current = conversation({
      conversationState: 'human-active',
      flowStep: 'human-service',
      assignedTo: { id: 'user-1', name: 'Operador' },
    });

    expect(
      decideAutomationPlan({
        envelope: envelope('Mais um detalhe', current, {
          topic: 'whatsapp.inbound.human-notification',
          automationAllowed: false,
          canGenerateReply: false,
          canSendReply: false,
        }),
      }),
    ).toMatchObject({
      kind: 'human-notification',
      responseMessage: null,
      reason: 'human-active-blocks-bot',
    });
  });

  it('valida todas as chaves obrigatórias do provedor', () => {
    expect(
      validateAiProviderOutput({
        message: 'Qual é a origem?',
        collectionStatus: 'collecting',
        extractedDataPatch: {},
        missingFields: ['origin'],
        summaryPresented: false,
        customerDecision: 'undecided',
      }),
    ).toMatchObject({ valid: true, errors: [] });

    expect(
      validateAiProviderOutput({
        message: 'Sua solicitação é urgente.',
        collectionStatus: 'collecting',
        extractedDataPatch: {},
        missingFields: [],
        summaryPresented: false,
        customerDecision: 'undecided',
        priority: 'urgent',
        priorityReason: 'Risco operacional informado pelo cliente.',
      }),
    ).toMatchObject({
      valid: true,
      output: {
        priority: 'urgent',
        priorityReason: 'Risco operacional informado pelo cliente.',
      },
    });

    expect(
      validateAiProviderOutput({
        message: 'Sem decisão',
        collectionStatus: 'collecting',
        extractedDataPatch: {},
        missingFields: [],
        summaryPresented: false,
      }),
    ).toMatchObject({ valid: false, output: null });

    expect(
      validateAiProviderOutput({
        message: 'Sem justificativa.',
        collectionStatus: 'collecting',
        extractedDataPatch: {},
        missingFields: [],
        summaryPresented: false,
        customerDecision: 'undecided',
        priority: 'high',
      }),
    ).toMatchObject({ valid: false, output: null });
  });

  it('encaminha a pré-triagem contínua quando completa', () => {
    expect(
      deriveAiActions(
        {
          message: 'Obrigado, vou encaminhar.',
          collectionStatus: 'completed',
          extractedDataPatch: { serviceType: 'continuous' },
          missingFields: [],
          summaryPresented: false,
          customerDecision: 'undecided',
        },
        'continuous-pretriage',
      ),
    ).toEqual({
      sendMessage: true,
      transitionBeforeSend: null,
      transitionAfterSend: 'forward',
      humanReason: 'continuous-pretriage-completed',
    });
  });

  it('derives lifecycle resolution only from a complete natural-service signal without pending fields', () => {
    const completed = {
      message: 'A demanda foi concluída.',
      collectionStatus: 'completed' as const,
      extractedDataPatch: {},
      missingFields: [],
      summaryPresented: false,
      customerDecision: 'undecided' as const,
    };

    expect(aiOutputResolvesConversation(completed, 'natural-service')).toBe(
      true,
    );
    expect(
      aiOutputResolvesConversation(completed, 'continuous-pretriage'),
    ).toBe(false);
    expect(
      aiOutputResolvesConversation(
        { ...completed, missingFields: ['customer-confirmation'] },
        'natural-service',
      ),
    ).toBe(false);
    expect(
      aiOutputResolvesConversation(
        { ...completed, customerDecision: 'human-requested' },
        'natural-service',
      ),
    ).toBe(false);
  });

  it('gera commandId UUID v5 estável e distinto por ação', () => {
    const first = deterministicCommandId('source-event-1', 'transition:start');
    const replay = deterministicCommandId('source-event-1', 'transition:start');
    const outbound = deterministicCommandId('source-event-1', 'outbound');

    expect(first).toBe(replay);
    expect(first).not.toBe(outbound);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('ordena e deduplica mensagens do buffer por evento de origem', () => {
    const first = {
      sourceEventId: 'event-1',
      messageId: 'message-1',
      occurredAt: '2026-07-25T12:00:00.000Z',
      kind: 'text',
      text: 'Meu nome é Ana',
      isFirstContact: false,
    };
    const second = {
      sourceEventId: 'event-2',
      messageId: 'message-2',
      occurredAt: '2026-07-25T12:00:01.000Z',
      kind: 'text',
      text: 'Saída de Campinas',
      isFirstContact: false,
    };

    const buffered = appendBufferedMessage(
      appendBufferedMessage(appendBufferedMessage([], second), first),
      second,
    );

    expect(buffered).toHaveLength(2);
    expect(buildBufferedText(buffered)).toBe(
      'Meu nome é Ana\nSaída de Campinas',
    );
  });

  it('prioriza a correção humana efetiva ao compor o contexto multimodal', () => {
    expect(
      buildBufferedText([
        {
          sourceEventId: 'event-media-1',
          messageId: 'message-media-1',
          occurredAt: '2026-07-25T12:00:00.000Z',
          kind: 'document',
          text: null,
          mediaInterpretationStatus: 'succeeded',
          interpretedText: 'Correção humana validada do pedido 456',
          interpretationSource: 'human',
          isFirstContact: false,
        },
      ]),
    ).toBe('Correção humana validada do pedido 456');
  });

  it('retorna somente as interpretações estruturadas efetivamente consumidas', () => {
    expect(
      mediaInterpretationsUsedInBufferedText([
        {
          sourceEventId: 'event-media-machine',
          messageId: 'message-media-machine',
          occurredAt: '2026-07-25T12:00:00.000Z',
          kind: 'audio',
          text: null,
          mediaInterpretationId: 'interpretation-machine',
          mediaInterpretationStatus: 'succeeded',
          interpretedText: 'Transcrição automática usada',
          interpretationSource: 'machine',
          isFirstContact: false,
        },
        {
          sourceEventId: 'event-media-human',
          messageId: 'message-media-human',
          occurredAt: '2026-07-25T12:00:01.000Z',
          kind: 'document',
          text: null,
          mediaInterpretationId: 'interpretation-human',
          mediaInterpretationStatus: 'succeeded',
          interpretedText: 'Correção humana usada',
          interpretationSource: 'human',
          isFirstContact: false,
        },
        {
          sourceEventId: 'event-media-present-only',
          messageId: 'message-media-present-only',
          occurredAt: '2026-07-25T12:00:02.000Z',
          kind: 'video',
          text: null,
          mediaInterpretationId: 'interpretation-unused',
          mediaInterpretationStatus: 'unsupported',
          interpretedText: null,
          interpretationSource: 'none',
          isFirstContact: false,
        },
      ]),
    ).toEqual([
      {
        interpretationId: 'interpretation-machine',
        effectiveSource: 'machine',
      },
      {
        interpretationId: 'interpretation-human',
        effectiveSource: 'human',
      },
    ]);
  });

  it('não cria provenance quando o contexto não usa mídia', () => {
    expect(
      mediaInterpretationsUsedInBufferedText([
        {
          sourceEventId: 'event-text',
          messageId: 'message-text',
          occurredAt: '2026-07-25T12:00:00.000Z',
          kind: 'text',
          text: 'Mensagem sem mídia',
          isFirstContact: false,
        },
      ]),
    ).toEqual([]);
  });

  it('encaminha mídia interpretada para a IA sem resposta fixa de unsupported', () => {
    const current = conversation({ mainMenuPresentedAt: null });

    expect(
      decideAutomationPlan({
        envelope: envelope(null, current, {
          firstContact: true,
          kind: 'document',
          media: { mimeType: 'application/pdf' },
        }),
        bufferedText: 'Solicitação de orçamento extraída do documento',
        mediaInterpretationAvailable: true,
      }),
    ).toMatchObject({
      kind: 'ai',
      aiMode: 'natural-service',
      reason: 'natural-language-first-contact',
    });
  });
});

describe('pedido explícito de novo orçamento', () => {
  it.each([
    'collecting-information',
    'waiting-for-customer',
    'under-review',
    'approved',
    'rejected',
    'cancelled',
  ] as const)('inicia outra coleta com orçamento anterior em %s', (status) => {
    const current = conversation({
      requestStatus: status,
      flowStep: 'quote-data-collection',
      currentQuoteRequest: { id: 'old', sequence: 1, status, version: 1 },
    });
    expect(
      decideAutomationPlan({
        envelope: envelope('Gostaria de um novo orçamento', current),
      }),
    ).toMatchObject({
      kind: 'ai',
      transitionBeforeAi: 'new-quote-request',
      aiMode: 'eventual-quote',
    });
  });
  it.each([
    'Quero corrigir o orçamento',
    'Não quero um novo orçamento',
    'Quero saber do orçamento',
    'E o valor?',
  ])('não cria outro registro ao receber %s', (text) => {
    const current = conversation({
      requestStatus: 'collecting-information',
      flowStep: 'quote-data-collection',
      currentQuoteRequest: {
        id: 'old',
        sequence: 1,
        status: 'collecting-information',
        version: 1,
      },
    });
    expect(
      decideAutomationPlan({ envelope: envelope(text, current) })
        .transitionBeforeAi,
    ).not.toBe('new-quote-request');
  });
  it('não toma a conversa de um atendente para criar orçamento', () => {
    const current = conversation({
      conversationState: 'human-active',
      flowStep: 'human-service',
    });
    expect(
      decideAutomationPlan({
        envelope: envelope('Quero outro orçamento', current),
      }).kind,
    ).toBe('human-notification');
  });
});

it.each([
  'Queria outro orçamento',
  'Faz outra cotação pra mim',
  'Gostaria de orçamento para nova viagem',
])('reconhece um pedido novo em linguagem natural: %s', (message) => {
  expect(isExplicitNewQuoteRequest(message)).toBe(true);
});

describe('handoff commitment consistency', () => {
  const output = {
    message: '',
    collectionStatus: 'completed' as const,
    extractedDataPatch: {},
    missingFields: [],
    summaryPresented: false,
    customerDecision: 'undecided' as const,
  };
  it.each([
    'Não consigo consultar as parcelas pendentes por aqui. Vou encaminhar sua solicitação ao time responsável para verificarem o pagamento da sua última viagem.',
    'Estou transferindo seu atendimento ao Financeiro.',
    'Sua solicitação foi encaminhada à equipe responsável.',
    'Vou conectar você com nossa equipe.',
    'Vou direcionar seu pedido para o setor responsável.',
  ])('does not resolve or send a standalone promise: %s', (message) => {
    expect(announcesHumanHandoff(message)).toBe(true);
    expect(
      aiOutputResolvesConversation({ ...output, message }, 'natural-service'),
    ).toBe(false);
    expect(
      deriveAiActions({ ...output, message }, 'natural-service')
        .transitionAfterSend,
    ).toBe('forward');
  });
  it.each([
    'Posso encaminhar você para o Financeiro?',
    'Se quiser, vou encaminhar sua solicitação ao Financeiro.',
    'Vou encaminhar sua solicitação quando você confirmar.',
    'Não vou encaminhar seu atendimento.',
    'Não foi possível encaminhar sua solicitação.',
    'Vou encaminhar o comprovante de pagamento.',
    'O pagamento pode ser parcelado.',
    'Você pediu: "vou encaminhar seu atendimento".',
  ])(
    'does not treat an offer, negation, quote or document as an executed handoff: %s',
    (message) => {
      expect(announcesHumanHandoff(message)).toBe(false);
      expect(
        deriveAiActions({ ...output, message }, 'natural-service')
          .transitionAfterSend,
      ).toBeNull();
    },
  );
});
