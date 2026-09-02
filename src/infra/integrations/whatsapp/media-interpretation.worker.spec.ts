import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { InterpretWhatsAppMediaUseCase } from '../../../application/use-cases/whatsapp/interpret-whatsapp-media.use-case';
import { MediaInterpretationWorker } from './media-interpretation.worker';

const companyId = '00000000-0000-4000-8000-000000000001';
const firstAssetId = '00000000-0000-4000-8000-000000000002';
const secondAssetId = '00000000-0000-4000-8000-000000000003';

describe('MediaInterpretationWorker', () => {
  it('não deixa a falha de uma mídia bloquear as demais nem o ciclo', async () => {
    const interpretations = {
      listAutomaticCandidates: vi.fn(async () => [
        { companyId, mediaAssetId: firstAssetId },
        { companyId, mediaAssetId: secondAssetId },
      ]),
      analyzeAutomatically: vi
        .fn()
        .mockRejectedValueOnce(new Error('provider unavailable'))
        .mockResolvedValueOnce({
          mediaAssetId: secondAssetId,
          status: 'failed',
        }),
    };
    const worker = new MediaInterpretationWorker(
      interpretations as unknown as InterpretWhatsAppMediaUseCase,
      new ConfigService({ WHATSAPP_ENABLED: true }),
    );

    await expect(worker.tick()).resolves.toBeUndefined();

    expect(interpretations.analyzeAutomatically).toHaveBeenNthCalledWith(1, {
      companyId,
      mediaAssetId: firstAssetId,
    });
    expect(interpretations.analyzeAutomatically).toHaveBeenNthCalledWith(2, {
      companyId,
      mediaAssetId: secondAssetId,
    });
  });

  it('permanece inativo quando o WhatsApp está desabilitado', async () => {
    const interpretations = {
      listAutomaticCandidates: vi.fn(async () => []),
      analyzeAutomatically: vi.fn(),
    };
    const worker = new MediaInterpretationWorker(
      interpretations as unknown as InterpretWhatsAppMediaUseCase,
      new ConfigService({ WHATSAPP_ENABLED: false }),
    );

    await worker.tick();

    expect(interpretations.listAutomaticCandidates).not.toHaveBeenCalled();
  });
});
