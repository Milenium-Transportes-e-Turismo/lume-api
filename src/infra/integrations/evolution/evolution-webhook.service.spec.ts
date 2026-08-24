import { createHash } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { WhatsAppRepository } from '../../../application/contracts/whatsapp.repository';
import { MILENIUM_INTERNAL_PHONE_ENV_KEYS } from '../../../domain/whatsapp/whatsapp-internal-phones';
import type { EvolutionMediaContentService } from './evolution-media-content.service';
import type { EvolutionProfilePictureService } from './evolution-profile-picture.service';
import { EvolutionWebhookService } from './evolution-webhook.service';

const secret = 'webhook-secret-with-enough-entropy';
const companyId = '00000000-0000-4000-8000-000000000001';
const channelId = '00000000-0000-4000-8000-000000000002';
const conversationId = '00000000-0000-4000-8000-000000000003';
const messageId = '00000000-0000-4000-8000-000000000004';
const now = new Date('2026-08-10T12:00:00.000Z');

function createSubject(configOverrides: Record<string, unknown> = {}) {
  const repository = {
    findWebhookChannel: vi.fn(async () => ({
      id: channelId,
      companyId,
      instanceName: 'lume',
      webhookSecretHash: createHash('sha256').update(secret).digest('hex'),
      ignoreGroups: true,
      ignoreFromMe: true,
      enabled: true,
    })),
    persistWebhookMessage: vi.fn(async () => ({
      accepted: true as const,
      duplicate: false,
      messageId,
      conversationId,
    })),
  };
  const mediaContent = {
    retainInbound: vi.fn(async () => ({
      status: 'stored' as const,
      messageId,
    })),
    retainWebhookMedia: vi.fn(async () => ({
      status: 'stored' as const,
      messageId,
    })),
  };
  const profilePictures = {
    get: vi.fn(async () => 'https://media.example.test/profile.jpg'),
  };
  const subject = new EvolutionWebhookService(
    repository as unknown as WhatsAppRepository,
    mediaContent as unknown as EvolutionMediaContentService,
    profilePictures as unknown as EvolutionProfilePictureService,
    new ConfigService({
      EVOLUTION_WEBHOOK_SECRET: secret,
      WHATSAPP_MAX_ATTACHMENT_BYTES: 52_428_800,
      WHATSAPP_ALLOWED_MIME_TYPES:
        'image/jpeg,audio/ogg,video/mp4,application/pdf',
      ...configOverrides,
    }),
  );
  return { subject, repository, mediaContent, profilePictures };
}

function videoWebhook(size: number, mimeType = 'video/mp4') {
  return {
    event: 'messages.upsert',
    instance: 'lume',
    data: {
      key: {
        id: `provider-video-${size}`,
        remoteJid: '5534999999999@s.whatsapp.net',
        fromMe: false,
      },
      messageTimestamp: Math.floor(now.valueOf() / 1_000),
      message: {
        videoMessage: {
          mimetype: mimeType,
          fileLength: size,
          fileName: 'video.mp4',
        },
      },
    },
  };
}

async function handle(subject: EvolutionWebhookService, body: unknown) {
  const rawBody = Buffer.from(JSON.stringify(body));
  return subject.handle({
    channelId,
    headers: { 'x-evolution-webhook-token': secret },
    rawBody,
    body,
    now,
  });
}

const internalPhoneCases = MILENIUM_INTERNAL_PHONE_ENV_KEYS.map(
  (key, index) => [key, `55349999999${index}`] as const,
);

describe('EvolutionWebhookService internal phone filtering', () => {
  it.each(internalPhoneCases)(
    'ignora inbound configurado em %s antes de persistir ou executar mídia',
    async (key, phone) => {
      const { subject, repository, mediaContent, profilePictures } =
        createSubject({ [key]: phone });
      const body = videoWebhook(2_500_000);
      body.data.key.remoteJid = `${phone}@s.whatsapp.net`;

      await expect(handle(subject, body)).resolves.toEqual({
        accepted: true,
        ignored: true,
        reason: 'internal-phone',
      });
      expect(repository.persistWebhookMessage).not.toHaveBeenCalled();
      expect(mediaContent.retainWebhookMedia).not.toHaveBeenCalled();
      expect(profilePictures.get).not.toHaveBeenCalled();
    },
  );

  it('normaliza o telefone interno e usa remoteJidAlt quando o contato chega por LID', async () => {
    const { subject, repository } = createSubject({
      MILENIUM_DEPARTMENT_MANAGEMENT_PHONE: '+55 (34) 99999-9905',
    });
    const body = videoWebhook(2_500_000);
    body.data.key.remoteJid = '123456789012345@lid';
    Object.assign(body.data.key, {
      remoteJidAlt: '5534999999905@s.whatsapp.net',
      participant: '999999999999999@lid',
    });

    await expect(handle(subject, body)).resolves.toMatchObject({
      ignored: true,
      reason: 'internal-phone',
    });
    expect(repository.persistWebhookMessage).not.toHaveBeenCalled();
  });

  it('mantém a mensagem de saída destinada a um telefone interno no histórico', async () => {
    const phone = '5534999999901';
    const { subject, repository } = createSubject({
      MILENIUM_DEPARTMENT_PURCHASES_PHONE: phone,
    });
    const body = videoWebhook(2_500_000);
    body.data.key.remoteJid = `${phone}@s.whatsapp.net`;
    body.data.key.fromMe = true;

    await expect(handle(subject, body)).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
    });
    expect(repository.persistWebhookMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'outbound',
        phoneNormalized: phone,
      }),
    );
  });
});

describe('EvolutionWebhookService automation authorization', () => {
  it('persiste inbound sem autorização automática quando o bot está desligado', async () => {
    const { subject, repository } = createSubject({
      WHATSAPP_ENABLED: false,
    });

    await handle(subject, videoWebhook(2_500_000));

    expect(repository.persistWebhookMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'inbound',
        automationEnabled: false,
      }),
    );
  });

  it('autoriza o repositório a avaliar automação quando o bot está ligado', async () => {
    const { subject, repository } = createSubject({
      WHATSAPP_ENABLED: true,
    });

    await handle(subject, videoWebhook(2_500_000));

    expect(repository.persistWebhookMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'inbound',
        automationEnabled: true,
      }),
    );
  });
});

describe('EvolutionWebhookService media retention metadata', () => {
  it.each([2_500_000, 52_428_800])(
    'persiste vídeo suportado com %d bytes para retenção durável',
    async (size) => {
      const { subject, repository, mediaContent } = createSubject();

      await handle(subject, videoWebhook(size));

      expect(repository.persistWebhookMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'inbound',
          kind: 'video',
          profilePictureUrl: 'https://media.example.test/profile.jpg',
          media: expect.objectContaining({
            mimeType: 'video/mp4',
            size,
            retentionStatus: 'pending',
          }),
        }),
      );
      expect(mediaContent.retainWebhookMedia).toHaveBeenCalledWith(
        companyId,
        conversationId,
        messageId,
      );
    },
  );

  it('mantém o vídeo acima do limite no histórico com estado explícito', async () => {
    const { subject, repository, mediaContent } = createSubject();
    mediaContent.retainWebhookMedia.mockResolvedValueOnce({
      status: 'too-large',
      messageId,
    });

    await expect(handle(subject, videoWebhook(52_428_801))).resolves.toEqual(
      expect.objectContaining({ mediaRetention: 'too-large' }),
    );
    expect(repository.persistWebhookMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        media: expect.objectContaining({ retentionStatus: 'too-large' }),
      }),
    );
  });

  it('rejeita MIME fora da lista permitida antes de persistir', async () => {
    const { subject, repository, mediaContent } = createSubject();

    await expect(
      handle(subject, videoWebhook(2_500_000, 'video/x-unsafe')),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(repository.persistWebhookMessage).not.toHaveBeenCalled();
    expect(mediaContent.retainWebhookMedia).not.toHaveBeenCalled();
  });
});

describe('EvolutionWebhookService outbound history', () => {
  it('persiste mensagem fromMe como saída mesmo com ignoreFromMe habilitado', async () => {
    const { subject, repository } = createSubject();
    const body = {
      event: 'messages.upsert',
      instance: 'lume',
      data: {
        key: {
          id: 'provider-external-outbound',
          remoteJid: '5534999999999@s.whatsapp.net',
          fromMe: true,
        },
        pushName: 'Nome da própria conta',
        messageTimestamp: Math.floor(now.valueOf() / 1_000),
        message: { conversation: 'Mensagem enviada pelo WhatsApp Web' },
      },
    };

    await expect(handle(subject, body)).resolves.toEqual(
      expect.objectContaining({ accepted: true, duplicate: false }),
    );
    expect(repository.persistWebhookMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'outbound',
        phoneNormalized: '5534999999999',
        text: 'Mensagem enviada pelo WhatsApp Web',
        displayName: undefined,
      }),
    );
  });

  it('usa remoteJidAlt telefônico quando remoteJid é um LID', async () => {
    const { subject, repository } = createSubject();
    const body = {
      event: 'messages.upsert',
      instance: 'lume',
      data: {
        key: {
          id: 'provider-lid-outbound',
          remoteJid: '123456789012345@lid',
          remoteJidAlt: '5534999999999@s.whatsapp.net',
          participant: '999999999999999@lid',
          fromMe: true,
        },
        messageTimestamp: Math.floor(now.valueOf() / 1_000),
        message: { conversation: 'Mensagem por LID' },
      },
    };

    await handle(subject, body);

    expect(repository.persistWebhookMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'outbound',
        phoneNormalized: '5534999999999',
      }),
    );
  });

  it('mantém mídia fromMe no fluxo de retenção do webhook', async () => {
    const { subject, repository, mediaContent } = createSubject();
    const body = videoWebhook(2_500_000);
    body.data.key.fromMe = true;

    await handle(subject, body);

    expect(repository.persistWebhookMessage).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'outbound', kind: 'video' }),
    );
    expect(mediaContent.retainWebhookMedia).toHaveBeenCalledWith(
      companyId,
      conversationId,
      messageId,
    );
    expect(mediaContent.retainInbound).not.toHaveBeenCalled();
  });
});
