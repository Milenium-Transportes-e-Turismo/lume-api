import { describe, expect, it } from 'vitest';

import {
  AI_CLOSING_WAIT_MS,
  CONTINUITY_WINDOW_MS,
  LUME_AI_CLOSING_QUESTION,
  PUBLIC_CONTINUATION_CODE_TTL_MS,
  assertAiCustomerFacingDispatchAllowed,
  createPublicContinuationCode,
  decideServiceContinuity,
  evolveServiceSession,
  formatAiClosureMessage,
  parsePublicContinuationCommand,
  publicContinuationCodeExpiresAt,
  type ServiceSessionSnapshot,
} from './service-session';

const startedAt = new Date('2026-08-29T12:00:00.000Z');

function session(
  patch: Partial<ServiceSessionSnapshot> = {},
): ServiceSessionSnapshot {
  return {
    status: 'open',
    controlMode: 'ai',
    currentDepartmentId: '1bcb0b1b-a09e-43dd-8b4c-97111416457e',
    responsibleUserId: null,
    queueId: null,
    priority: 'normal',
    priorityReason: null,
    prioritySource: 'system',
    conversationResolved: false,
    pendingActions: [],
    resolutionConfirmedByCustomer: false,
    aiClosingStartedAt: null,
    closedAt: null,
    version: 1,
    ...patch,
  };
}

describe('ServiceSession', () => {
  it('switches to human control immediately after an external WhatsApp App message', () => {
    const updated = evolveServiceSession(session(), {
      type: 'external-human-message',
    });

    expect(updated).toMatchObject({
      status: 'open',
      controlMode: 'human',
      responsibleUserId: null,
      version: 2,
    });
    expect(() => assertAiCustomerFacingDispatchAllowed(updated)).toThrow(
      'controle está com atendimento humano',
    );
  });

  it('requires an explicit action to return human control to AI', () => {
    const human = evolveServiceSession(session(), {
      type: 'external-human-message',
    });
    const returned = evolveServiceSession(human, { type: 'return-to-ai' });

    expect(returned).toMatchObject({
      status: 'open',
      controlMode: 'ai',
      responsibleUserId: null,
      queueId: null,
    });
    expect(() => assertAiCustomerFacingDispatchAllowed(returned)).not.toThrow();
  });

  it('keeps queue, control and assignment as independent concepts', () => {
    const waiting = evolveServiceSession(session(), {
      type: 'request-human',
      queueId: '4503aad9-017c-4e57-811f-c2373052c72e',
    });
    const assumed = evolveServiceSession(waiting, {
      type: 'assume',
      userId: '27ba9890-1c13-4323-bfed-7683ca996268',
    });
    const queuedAgain = evolveServiceSession(assumed, {
      type: 'return-to-queue',
      queueId: '4503aad9-017c-4e57-811f-c2373052c72e',
    });

    expect(waiting).toMatchObject({
      status: 'waiting-human',
      controlMode: 'human',
      responsibleUserId: null,
    });
    expect(assumed).toMatchObject({
      status: 'open',
      controlMode: 'human',
      responsibleUserId: '27ba9890-1c13-4323-bfed-7683ca996268',
    });
    expect(queuedAgain).toMatchObject({
      status: 'waiting-human',
      controlMode: 'human',
      responsibleUserId: null,
    });
  });

  it('clears the previous queue when transferring directly to a user', () => {
    const transferred = evolveServiceSession(
      session({
        controlMode: 'human',
        queueId: '4503aad9-017c-4e57-811f-c2373052c72e',
      }),
      {
        type: 'transfer',
        departmentId: 'be81489f-b186-4642-8548-716d040c7157',
        userId: '27ba9890-1c13-4323-bfed-7683ca996268',
      },
    );

    expect(transferred).toMatchObject({
      currentDepartmentId: 'be81489f-b186-4642-8548-716d040c7157',
      responsibleUserId: '27ba9890-1c13-4323-bfed-7683ca996268',
      queueId: null,
      status: 'open',
    });
  });

  it('transfere só para o departamento e aguarda equipe sem herdar responsável ou fila', () => {
    const transferred = evolveServiceSession(
      session({
        controlMode: 'human',
        responsibleUserId: 'previous-user',
        queueId: 'previous-queue',
      }),
      {
        type: 'transfer',
        departmentId: 'be81489f-b186-4642-8548-716d040c7157',
      },
    );
    expect(transferred).toMatchObject({
      currentDepartmentId: 'be81489f-b186-4642-8548-716d040c7157',
      responsibleUserId: null,
      queueId: null,
      status: 'waiting-human',
      controlMode: 'human',
      version: 2,
    });
    expect(() => assertAiCustomerFacingDispatchAllowed(transferred)).toThrow();
  });

  it('supports priority interruption without changing who controls the session', () => {
    const human = session({
      controlMode: 'human',
      responsibleUserId: '27ba9890-1c13-4323-bfed-7683ca996268',
    });
    const paused = evolveServiceSession(human, {
      type: 'pause-for-higher-priority',
    });
    const resumed = evolveServiceSession(paused, {
      type: 'resume-after-higher-priority',
    });

    expect(paused).toMatchObject({
      status: 'paused-by-higher-priority',
      controlMode: 'human',
      responsibleUserId: human.responsibleUserId,
    });
    expect(resumed.status).toBe('open');
  });

  it.each([
    'waiting-customer',
    'waiting-human',
    'paused-by-higher-priority',
    'closing',
    'closed',
  ] as const)('blocks ordinary AI dispatch while status is %s', (status) => {
    expect(() =>
      assertAiCustomerFacingDispatchAllowed(session({ status })),
    ).toThrow('estado atual do atendimento');
  });

  it('starts the AI closing timer only for a resolved session without pending actions', () => {
    expect(() =>
      evolveServiceSession(session(), {
        type: 'begin-ai-closing',
        at: startedAt,
      }),
    ).toThrow('demanda ou ação relevante pendente');
    expect(() =>
      evolveServiceSession(
        session({
          conversationResolved: true,
          pendingActions: ['deliver-quote'],
        }),
        { type: 'begin-ai-closing', at: startedAt },
      ),
    ).toThrow('demanda ou ação relevante pendente');

    const closing = evolveServiceSession(
      session({ conversationResolved: true }),
      { type: 'begin-ai-closing', at: startedAt },
    );
    expect(closing).toMatchObject({
      status: 'closing',
      aiClosingStartedAt: startedAt,
    });
  });

  it('cancels AI closing when the customer replies and closes only after 30 minutes', () => {
    const closing = evolveServiceSession(
      session({ conversationResolved: true }),
      { type: 'begin-ai-closing', at: startedAt },
    );
    expect(() =>
      evolveServiceSession(closing, {
        type: 'finish-ai-closing',
        at: new Date(startedAt.getTime() + AI_CLOSING_WAIT_MS - 1),
      }),
    ).toThrow('ainda não terminou');

    const replied = evolveServiceSession(closing, {
      type: 'customer-replied-during-closing',
    });
    expect(replied).toMatchObject({
      status: 'open',
      conversationResolved: false,
      aiClosingStartedAt: null,
    });

    const closed = evolveServiceSession(closing, {
      type: 'finish-ai-closing',
      at: new Date(startedAt.getTime() + AI_CLOSING_WAIT_MS),
    });
    expect(closed).toMatchObject({ status: 'closed', controlMode: 'ai' });
  });
});

describe('service continuity', () => {
  it('tolerates only the sub-second precision lost by provider timestamps', () => {
    expect(
      decideServiceContinuity({
        now: new Date(startedAt.getTime() - 999),
        previousClosedAt: startedAt,
      }),
    ).toMatchObject({ action: 'reopen-previous' });

    expect(() =>
      decideServiceContinuity({
        now: new Date(startedAt.getTime() - 1_000),
        previousClosedAt: startedAt,
      }),
    ).toThrow('A data de fechamento não pode estar no futuro.');
  });

  it('reopens continuation and uncertain classifications within two hours', () => {
    const now = new Date(startedAt.getTime() + CONTINUITY_WINDOW_MS);

    expect(
      decideServiceContinuity({
        now,
        previousClosedAt: startedAt,
        classification: 'continuation',
        confidence: 0.93,
      }),
    ).toMatchObject({ action: 'reopen-previous', fallbackAction: 'none' });
    expect(
      decideServiceContinuity({
        now,
        previousClosedAt: startedAt,
        classification: 'uncertain',
      }),
    ).toMatchObject({
      action: 'reopen-previous',
      fallbackAction: 'reopen-on-uncertain',
    });
  });

  it('creates a new session after two hours unless a valid public code was supplied', () => {
    const now = new Date(startedAt.getTime() + CONTINUITY_WINDOW_MS + 1);

    expect(
      decideServiceContinuity({ now, previousClosedAt: startedAt }),
    ).toMatchObject({
      action: 'create-new',
      classification: 'new-subject',
    });
    expect(
      decideServiceContinuity({
        now,
        previousClosedAt: startedAt,
        validPublicContinuationCode: true,
      }),
    ).toMatchObject({
      action: 'reopen-previous',
      classification: 'public-code',
    });
  });

  it('uses a fixed seven-day expiry and a neutral Lume closure message', () => {
    const code = createPublicContinuationCode();

    expect(code).toMatch(/^\d{3}$/u);
    expect(publicContinuationCodeExpiresAt(startedAt).getTime()).toBe(
      startedAt.getTime() + PUBLIC_CONTINUATION_CODE_TTL_MS,
    );
    expect(formatAiClosureMessage(code)).toContain(`CONTINUAR ${code}`);
    expect(formatAiClosureMessage(code)).not.toMatch(/milenium|milena/iu);
    expect(LUME_AI_CLOSING_QUESTION).toBe('Precisa de mais alguma coisa?');
  });

  it('accepts only the exact public continuation command shape', () => {
    expect(parsePublicContinuationCommand(' CONTINUAR 845 ')).toBe('845');
    expect(parsePublicContinuationCommand('continuar 845')).toBe('845');
    expect(parsePublicContinuationCommand('CONTINUAR 84')).toBeNull();
    expect(parsePublicContinuationCommand('texto CONTINUAR 845')).toBeNull();
    expect(parsePublicContinuationCommand('CONTINUAR 845 agora')).toBeNull();
  });
});
