import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import type { QuoteProposalUseCase } from '../../application/use-cases/commercial/commercial-quotes.use-case';
import type { QueryWhatsAppUseCase } from '../../application/use-cases/whatsapp/whatsapp.use-cases';
import {
  ConversationListQueryDto,
  MessageListQueryDto,
  TransitionListQueryDto,
} from './dto/whatsapp.dto';
import { WhatsAppPanelController } from './whatsapp-panel.controller';

function principal(
  overrides: Partial<AuthenticatedPrincipal> = {},
): AuthenticatedPrincipal {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    companyId: '00000000-0000-4000-8000-000000000002',
    name: 'Motorista',
    username: 'motorista',
    email: 'motorista@example.com',
    cpf: null,
    type: 'employee',
    isAdministrator: false,
    departments: ['operations'],
    permissions: ['dashboard:view', 'drivers:view', 'operations:view'],
    clientCategory: null,
    isActive: true,
    mustChangePassword: false,
    hasProfilePicture: false,
    createdAt: '2026-07-28T12:00:00.000Z',
    updatedAt: '2026-07-28T12:00:00.000Z',
    tokenVersion: 1,
    ...overrides,
  };
}

function setup(configOverrides: Readonly<Record<string, unknown>> = {}) {
  const listConversations = vi.fn();
  const getConversation = vi.fn();
  const listMessages = vi.fn();
  const listTransitions = vi.fn();
  const queryUseCase = {
    listConversations,
    getConversation,
    listMessages,
    listTransitions,
  };
  const commercialQuotes = { currentForConversation: vi.fn() };
  const startHumanConversation = { execute: vi.fn() };
  const transition = { execute: vi.fn() };
  const createHumanOutbound = { authorize: vi.fn(), execute: vi.fn() };
  const mediaStorage = {
    read: vi.fn().mockResolvedValue(Buffer.alloc(0)),
    write: vi.fn().mockResolvedValue({ created: true }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const controller = new WhatsAppPanelController(
    queryUseCase as unknown as QueryWhatsAppUseCase,
    commercialQuotes as unknown as QuoteProposalUseCase,
    startHumanConversation as never,
    transition as never,
    createHumanOutbound as never,
    {} as never,
    mediaStorage,
    new ConfigService({
      WHATSAPP_ALLOWED_MIME_TYPES:
        'image/jpeg,image/png,image/webp,application/pdf,text/vcard,text/x-vcard',
      WHATSAPP_MAX_ATTACHMENT_BYTES: 67_108_864,
      WHATSAPP_PANEL_MAX_ATTACHMENT_BYTES: 104_857_600,
      ...configOverrides,
    }),
  );

  return {
    controller,
    listConversations,
    getConversation,
    listMessages,
    listTransitions,
    startHumanConversation,
    transition,
    createHumanOutbound,
    mediaStorage,
  };
}

describe('WhatsAppPanelController conversation scope', () => {
  it('scopes detail, messages and transitions to assigned departments', () => {
    const { controller, getConversation, listMessages, listTransitions } =
      setup();
    const current = principal({ departments: ['operations', 'monitoring'] });
    const conversationId = '00000000-0000-4000-8000-000000000003';
    const messageQuery = new MessageListQueryDto();
    const transitionQuery = new TransitionListQueryDto();

    void controller.detail(current, conversationId);
    void controller.messages(current, conversationId, messageQuery);
    void controller.transitions(current, conversationId, transitionQuery);

    const scope = { departments: ['operations', 'monitoring'] };
    expect(getConversation).toHaveBeenCalledWith(
      current.companyId,
      conversationId,
      scope,
    );
    expect(listMessages).toHaveBeenCalledWith(
      current.companyId,
      conversationId,
      messageQuery,
      scope,
    );
    expect(listTransitions).toHaveBeenCalledWith(
      current.companyId,
      conversationId,
      transitionQuery,
      scope,
    );
  });

  it('does not turn a management capability without department into tenant-wide scope', () => {
    const { controller, getConversation } = setup();
    const current = principal({
      departments: [],
      permissions: ['whatsapp-conversations:manage'],
    });

    expect(() =>
      controller.detail(current, '00000000-0000-4000-8000-000000000003'),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(getConversation).not.toHaveBeenCalled();
  });

  it('rejects conversation reads without a department or management access', () => {
    const { controller, getConversation } = setup();
    const current = principal({ departments: [], permissions: [] });

    expect(() =>
      controller.detail(current, '00000000-0000-4000-8000-000000000003'),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(getConversation).not.toHaveBeenCalled();
  });
});

describe('WhatsAppPanelController start conversation', () => {
  it('reuses the canonical conversation and assigns the current attendant', async () => {
    const { controller, startHumanConversation } = setup();
    startHumanConversation.execute.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000003',
      version: 8,
      conversationState: 'human-active',
      idempotent: false,
    });

    await controller.startConversation(principal(), {
      commandId: '00000000-0000-4000-8000-000000000010',
      phone: '(34) 99999-9999',
    });

    expect(startHumanConversation.execute).toHaveBeenCalledWith({
      companyId: '00000000-0000-4000-8000-000000000002',
      phoneNormalized: '5534999999999',
      commandId: '00000000-0000-4000-8000-000000000010',
      actorUserId: '00000000-0000-4000-8000-000000000001',
      targetDepartment: undefined,
    });
  });

  it('forwards the explicitly selected initial queue', async () => {
    const { controller, startHumanConversation } = setup();

    await controller.startConversation(
      principal({ departments: ['operations', 'financial'] }),
      {
        commandId: '00000000-0000-4000-8000-000000000010',
        phone: '(34) 99999-9999',
        targetDepartment: 'financial',
      },
    );

    expect(startHumanConversation.execute).toHaveBeenCalledWith(
      expect.objectContaining({ targetDepartment: 'financial' }),
    );
  });
});

describe('WhatsAppPanelController transfer acceptance', () => {
  it('keeps the legacy forward route as a reasoned transfer request', () => {
    const { controller, transition } = setup();

    void controller.forward(
      principal(),
      '00000000-0000-4000-8000-000000000003',
      {
        commandId: '00000000-0000-4000-8000-000000000010',
        expectedVersion: 3,
        targetDepartment: 'financial',
        reason: 'Cliente solicitou apoio sobre a cobrança.',
      },
    );

    expect(transition.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'request-transfer',
        targetDepartment: 'financial',
        metadata: {
          source: 'panel-legacy-forward',
          reason: 'Cliente solicitou apoio sobre a cobrança.',
        },
      }),
    );
  });

  it('records the reason when requesting a transfer', () => {
    const { controller, transition } = setup();

    void controller.requestTransfer(
      principal(),
      '00000000-0000-4000-8000-000000000003',
      {
        commandId: '00000000-0000-4000-8000-000000000010',
        expectedVersion: 3,
        targetDepartment: 'financial',
        reason: 'Cliente solicitou apoio sobre a cobrança.',
      },
    );

    expect(transition.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'request-transfer',
        targetDepartment: 'financial',
        metadata: {
          source: 'panel-transfer-request',
          reason: 'Cliente solicitou apoio sobre a cobrança.',
        },
      }),
    );
  });

  it('sends an explicit versioned accept-transfer command', () => {
    const { controller, transition } = setup();

    void controller.acceptTransfer(
      principal(),
      '00000000-0000-4000-8000-000000000003',
      {
        commandId: '00000000-0000-4000-8000-000000000010',
        expectedVersion: 4,
      },
    );

    expect(transition.execute).toHaveBeenCalledWith({
      companyId: '00000000-0000-4000-8000-000000000002',
      conversationId: '00000000-0000-4000-8000-000000000003',
      commandId: '00000000-0000-4000-8000-000000000010',
      expectedVersion: 4,
      name: 'accept-transfer',
      actorType: 'user',
      actorUserId: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('records a reason in the legacy department correction route', () => {
    const { controller, transition } = setup();

    void controller.changeDepartment(
      principal(),
      '00000000-0000-4000-8000-000000000003',
      {
        commandId: '00000000-0000-4000-8000-000000000010',
        expectedVersion: 4,
        targetDepartment: 'financial',
        reason: 'Correção do departamento classificado inicialmente.',
      },
    );

    expect(transition.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'change-department',
        targetDepartment: 'financial',
        metadata: {
          source: 'panel-department-change',
          reason: 'Correção do departamento classificado inicialmente.',
        },
      }),
    );
  });
});

describe('WhatsAppPanelController dashboard indicators', () => {
  it('forces the authenticated user department when none is informed', () => {
    const { controller, listConversations } = setup();
    const result = { data: [], meta: { page: 1, pageSize: 20, total: 0 } };
    listConversations.mockReturnValue(result);

    expect(
      controller.dashboard(principal(), new ConversationListQueryDto()),
    ).toBe(result);
    expect(listConversations).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      expect.objectContaining({ department: 'operations' }),
    );
  });

  it('accepts an explicitly selected department assigned to the user', () => {
    const { controller, listConversations } = setup();
    const query = new ConversationListQueryDto();
    query.department = 'operations';

    void controller.dashboard(principal(), query);

    expect(listConversations).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      query,
    );
  });

  it('rejects access to a department not assigned to the user', () => {
    const { controller, listConversations } = setup();
    const query = new ConversationListQueryDto();
    query.department = 'financial';

    expect(() => controller.dashboard(principal(), query)).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
    expect(listConversations).not.toHaveBeenCalled();
  });

  it('unifies the queues assigned to a user with multiple departments', () => {
    const { controller, listConversations } = setup();

    const query = new ConversationListQueryDto();
    void controller.dashboard(
      principal({ departments: ['operations', 'monitoring'] }),
      query,
    );

    expect(listConversations).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      expect.objectContaining({
        departments: ['operations', 'monitoring'],
      }),
    );
  });

  it('applies the same department scope to the regular conversation list', () => {
    const { controller, listConversations } = setup();
    const query = new ConversationListQueryDto();

    void controller.list(
      principal({ departments: ['operations', 'monitoring'] }),
      query,
    );

    expect(listConversations).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      expect.objectContaining({
        departments: ['operations', 'monitoring'],
      }),
    );
  });

  it('allows an administrator without department assignment to read tenant totals', () => {
    const { controller, listConversations } = setup();
    const query = new ConversationListQueryDto();

    void controller.dashboard(
      principal({
        isAdministrator: true,
        departments: [],
        permissions: ['dashboard:view', 'whatsapp-conversations:manage'],
      }),
      query,
    );

    expect(listConversations).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      query,
    );
  });

  it('rejects a department-less profile without WhatsApp management access', () => {
    const { controller, listConversations } = setup();

    expect(() =>
      controller.dashboard(
        principal({ departments: [], permissions: ['dashboard:view'] }),
        new ConversationListQueryDto(),
      ),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(listConversations).not.toHaveBeenCalled();
  });
});

describe('WhatsAppPanelController media messages', () => {
  it('reuses the same message identity and storage key on an identical retry', async () => {
    const { controller, createHumanOutbound, mediaStorage } = setup();
    createHumanOutbound.execute.mockResolvedValue({
      message: { id: 'message' },
    });
    const current = principal({
      permissions: ['whatsapp-conversations:manage'],
    });
    const conversationId = '00000000-0000-4000-8000-000000000003';
    const body = {
      commandId: '00000000-0000-4000-8000-000000000010',
      idempotencyKey: '00000000-0000-4000-8000-000000000011',
      expectedVersion: 4,
      caption: 'Comprovante solicitado',
    };
    const file = {
      originalname: 'comprovante.jpg',
      mimetype: 'image/jpeg',
      size: 6,
      buffer: Buffer.from('imagem'),
    };

    await controller.createMediaMessage(current, conversationId, body, file);
    await controller.createMediaMessage(current, conversationId, body, file);

    const firstInput = createHumanOutbound.execute.mock.calls[0][0];
    const retryInput = createHumanOutbound.execute.mock.calls[1][0];
    expect(retryInput.attachment).toEqual(firstInput.attachment);
    expect(firstInput.attachment.storageKey).toBe(
      `v1/${current.companyId}/${conversationId}/${firstInput.attachment.messageId}`,
    );
    expect(mediaStorage.write).toHaveBeenNthCalledWith(2, {
      storageKey: firstInput.attachment.storageKey,
      content: file.buffer,
    });
  });

  it('authorizes a divergent retry before writing another media blob', async () => {
    const { controller, createHumanOutbound, mediaStorage } = setup();
    const idempotencyConflict = new Error('idempotency conflict');
    createHumanOutbound.authorize
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(idempotencyConflict);
    createHumanOutbound.execute.mockResolvedValueOnce({
      message: { id: 'message' },
    });
    const current = principal({
      permissions: ['whatsapp-conversations:manage'],
    });
    const conversationId = '00000000-0000-4000-8000-000000000003';
    const body = {
      commandId: '00000000-0000-4000-8000-000000000010',
      idempotencyKey: '00000000-0000-4000-8000-000000000011',
      expectedVersion: 4,
    };

    await controller.createMediaMessage(current, conversationId, body, {
      originalname: 'comprovante.jpg',
      mimetype: 'image/jpeg',
      size: 6,
      buffer: Buffer.from('imagem'),
    });
    await expect(
      controller.createMediaMessage(current, conversationId, body, {
        originalname: 'comprovante.jpg',
        mimetype: 'image/jpeg',
        size: 8,
        buffer: Buffer.from('alterado'),
      }),
    ).rejects.toBe(idempotencyConflict);

    const originalAttachment =
      createHumanOutbound.authorize.mock.calls[0][0].attachment;
    const conflictingAttachment =
      createHumanOutbound.authorize.mock.calls[1][0].attachment;
    expect(conflictingAttachment.messageId).toBe(originalAttachment.messageId);
    expect(conflictingAttachment.sha256).not.toBe(originalAttachment.sha256);
    expect(conflictingAttachment.storageKey).toBe(
      originalAttachment.storageKey,
    );
    expect(conflictingAttachment.storageKey).toBe(
      `v1/${current.companyId}/${conversationId}/${conflictingAttachment.messageId}`,
    );
    expect(mediaStorage.write).toHaveBeenCalledOnce();
    expect(createHumanOutbound.execute).toHaveBeenCalledOnce();
    expect(mediaStorage.delete).not.toHaveBeenCalled();
  });

  it('does not write media when the current actor or conversation fails preflight authorization', async () => {
    const { controller, createHumanOutbound, mediaStorage } = setup();
    createHumanOutbound.authorize.mockRejectedValue(
      new Error('preflight forbidden'),
    );

    await expect(
      controller.createMediaMessage(
        principal({ permissions: ['whatsapp-conversations:attend'] }),
        '00000000-0000-4000-8000-000000000003',
        {
          commandId: '00000000-0000-4000-8000-000000000010',
          idempotencyKey: '00000000-0000-4000-8000-000000000011',
          expectedVersion: 4,
        },
        {
          originalname: 'comprovante.jpg',
          mimetype: 'image/jpeg',
          size: 6,
          buffer: Buffer.from('imagem'),
        },
      ),
    ).rejects.toThrow('preflight forbidden');

    expect(mediaStorage.write).not.toHaveBeenCalled();
    expect(createHumanOutbound.execute).not.toHaveBeenCalled();
  });

  it('uses the panel limit instead of the smaller inbound retention limit', async () => {
    const { controller, createHumanOutbound } = setup({
      WHATSAPP_MAX_ATTACHMENT_BYTES: 2,
      WHATSAPP_PANEL_MAX_ATTACHMENT_BYTES: 8,
    });
    createHumanOutbound.execute.mockResolvedValue({
      message: { id: 'archive' },
    });

    await controller.createMediaMessage(
      principal({ permissions: ['whatsapp-conversations:manage'] }),
      '00000000-0000-4000-8000-000000000003',
      {
        commandId: '00000000-0000-4000-8000-000000000010',
        idempotencyKey: '00000000-0000-4000-8000-000000000011',
        expectedVersion: 4,
      },
      {
        originalname: 'historico.zip',
        mimetype: 'application/zip',
        size: 4,
        buffer: Buffer.from('zip!'),
      },
    );

    expect(createHumanOutbound.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment: expect.objectContaining({
          fileName: 'historico.zip',
          sizeBytes: 4,
        }),
      }),
    );
  });

  it('stores and creates a human image message with its caption', async () => {
    const { controller, createHumanOutbound, mediaStorage } = setup();
    createHumanOutbound.execute.mockResolvedValue({
      message: { id: 'message' },
    });
    const body = {
      commandId: '00000000-0000-4000-8000-000000000010',
      idempotencyKey: '00000000-0000-4000-8000-000000000011',
      expectedVersion: 4,
      caption: 'Comprovante solicitado',
    };
    const file = {
      originalname: '../foto.jpg',
      mimetype: 'image/jpeg',
      size: 6,
      buffer: Buffer.from('imagem'),
    };

    await controller.createMediaMessage(
      principal({ permissions: ['whatsapp-conversations:manage'] }),
      '00000000-0000-4000-8000-000000000003',
      body,
      file,
    );

    expect(mediaStorage.write).toHaveBeenCalledWith(
      expect.objectContaining({ content: file.buffer }),
    );
    expect(createHumanOutbound.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Comprovante solicitado',
        attachment: expect.objectContaining({
          kind: 'image',
          fileName: 'foto.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 6,
        }),
      }),
    );
  });

  it('preserves the stored file when persistence has an ambiguous outcome', async () => {
    const { controller, createHumanOutbound, mediaStorage } = setup();
    createHumanOutbound.execute.mockRejectedValue(
      new Error('persistence failed'),
    );

    await expect(
      controller.createMediaMessage(
        principal({ permissions: ['whatsapp-conversations:manage'] }),
        '00000000-0000-4000-8000-000000000003',
        {
          commandId: '00000000-0000-4000-8000-000000000010',
          idempotencyKey: '00000000-0000-4000-8000-000000000011',
          expectedVersion: 4,
        },
        {
          originalname: 'contato.vcf',
          mimetype: 'text/vcard',
          size: 4,
          buffer: Buffer.from('card'),
        },
      ),
    ).rejects.toThrow('persistence failed');
    expect(mediaStorage.delete).not.toHaveBeenCalled();
  });

  it('preserves an identical pre-existing file when a retry fails transiently', async () => {
    const { controller, createHumanOutbound, mediaStorage } = setup();
    mediaStorage.write.mockResolvedValue({ created: false });
    createHumanOutbound.execute.mockRejectedValue(
      new Error('temporary database failure'),
    );

    await expect(
      controller.createMediaMessage(
        principal({ permissions: ['whatsapp-conversations:attend'] }),
        '00000000-0000-4000-8000-000000000003',
        {
          commandId: '00000000-0000-4000-8000-000000000010',
          idempotencyKey: '00000000-0000-4000-8000-000000000011',
          expectedVersion: 4,
        },
        {
          originalname: 'comprovante.jpg',
          mimetype: 'image/jpeg',
          size: 6,
          buffer: Buffer.from('imagem'),
        },
      ),
    ).rejects.toThrow('temporary database failure');
    expect(mediaStorage.delete).not.toHaveBeenCalled();
  });

  it('persists a WebP selected explicitly as a sticker', async () => {
    const { controller, createHumanOutbound } = setup();
    createHumanOutbound.execute.mockResolvedValue({
      message: { id: 'sticker' },
    });

    await controller.createMediaMessage(
      principal({ permissions: ['whatsapp-conversations:manage'] }),
      '00000000-0000-4000-8000-000000000003',
      {
        commandId: '00000000-0000-4000-8000-000000000010',
        idempotencyKey: '00000000-0000-4000-8000-000000000011',
        expectedVersion: 4,
        mediaKind: 'sticker',
      },
      {
        originalname: 'figurinha.webp',
        mimetype: 'image/webp',
        size: 4,
        buffer: Buffer.from('webp'),
      },
    );

    expect(createHumanOutbound.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment: expect.objectContaining({
          kind: 'sticker',
          mimeType: 'image/webp',
        }),
      }),
    );
  });

  it('accepts a RAR document even when the deployment allow-list is older', async () => {
    const { controller, createHumanOutbound } = setup();
    createHumanOutbound.execute.mockResolvedValue({
      message: { id: 'archive' },
    });

    await controller.createMediaMessage(
      principal({ permissions: ['whatsapp-conversations:manage'] }),
      '00000000-0000-4000-8000-000000000003',
      {
        commandId: '00000000-0000-4000-8000-000000000010',
        idempotencyKey: '00000000-0000-4000-8000-000000000011',
        expectedVersion: 4,
      },
      {
        originalname: 'documentos.rar',
        mimetype: 'application/vnd.rar',
        size: 4,
        buffer: Buffer.from('rar!'),
      },
    );

    expect(createHumanOutbound.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment: expect.objectContaining({
          kind: 'document',
          fileName: 'documentos.rar',
          mimeType: 'application/vnd.rar',
        }),
      }),
    );
  });
});
