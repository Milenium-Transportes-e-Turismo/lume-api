import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { InterpretWhatsAppMediaUseCase } from '../../../application/use-cases/whatsapp/interpret-whatsapp-media.use-case';
import { sanitizeLogText } from '../../../shared/utils/sensitive-data';

const MEDIA_INTERPRETATION_INTERVAL_MS = 5_000;
const MEDIA_INTERPRETATION_BATCH_SIZE = 20;

@Injectable()
export class MediaInterpretationWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MediaInterpretationWorker.name);
  private readonly enabled: boolean;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly interpretations: InterpretWhatsAppMediaUseCase,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('WHATSAPP_ENABLED') ?? false;
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        this.logger.error(
          `Falha no worker multimodal: ${sanitizeLogText(String(error), 240)}`,
        );
      });
    }, MEDIA_INTERPRETATION_INTERVAL_MS);
    this.timer.unref();
    void this.tick().catch((error: unknown) => {
      this.logger.error(
        `Falha no ciclo multimodal inicial: ${sanitizeLogText(String(error), 240)}`,
      );
    });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      const candidates = await this.interpretations.listAutomaticCandidates(
        MEDIA_INTERPRETATION_BATCH_SIZE,
      );
      for (const candidate of candidates) {
        try {
          await this.interpretations.analyzeAutomatically(candidate);
        } catch (error) {
          // A mídia e a mensagem já são duráveis. Um item inválido não pode
          // interromper os demais nem o atendimento.
          this.logger.warn(
            `Mídia mantida sem bloquear atendimento assetId=${candidate.mediaAssetId} reason=${sanitizeLogText(String(error), 160)}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
