import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { WhatsAppRepository } from '../../../application/contracts/whatsapp.repository';
import { sanitizeLogText } from '../../../shared/utils/sensitive-data';

const LIFECYCLE_INTERVAL_MS = 15_000;
const LIFECYCLE_BATCH_SIZE = 50;

/**
 * Drives only lifecycle transitions already authorized in persisted state.
 * In particular, it never infers that a conversation is resolved.
 */
@Injectable()
export class ServiceSessionLifecycleWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ServiceSessionLifecycleWorker.name);
  private readonly enabled: boolean;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly repository: WhatsAppRepository,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('WHATSAPP_ENABLED') ?? false;
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        this.logger.error(
          `Falha no lifecycle de atendimentos: ${sanitizeLogText(String(error))}`,
        );
      });
    }, LIFECYCLE_INTERVAL_MS);
    this.timer.unref();
    void this.tick().catch((error: unknown) => {
      this.logger.error(
        `Falha no ciclo inicial de atendimentos: ${sanitizeLogText(String(error))}`,
      );
    });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      const result = await this.repository.processServiceSessionLifecycle({
        now,
        limit: LIFECYCLE_BATCH_SIZE,
      });
      if (result.closingStarted > 0 || result.closed > 0) {
        this.logger.log(
          `Lifecycle concluído closingStarted=${result.closingStarted} closed=${result.closed} skipped=${result.skipped}`,
        );
      }
    } finally {
      this.running = false;
    }
  }
}
