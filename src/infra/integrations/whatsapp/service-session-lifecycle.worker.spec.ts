import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { WhatsAppRepository } from '../../../application/contracts/whatsapp.repository';
import { ServiceSessionLifecycleWorker } from './service-session-lifecycle.worker';

describe('ServiceSessionLifecycleWorker', () => {
  it('runs one bounded lifecycle batch when WhatsApp is enabled', async () => {
    const processServiceSessionLifecycle = vi.fn(async () => ({
      closingStarted: 1,
      closed: 1,
      skipped: 0,
    }));
    const worker = new ServiceSessionLifecycleWorker(
      { processServiceSessionLifecycle } as unknown as WhatsAppRepository,
      new ConfigService({ WHATSAPP_ENABLED: true }),
    );
    const now = new Date('2026-08-29T12:00:00.000Z');

    await worker.tick(now);

    expect(processServiceSessionLifecycle).toHaveBeenCalledWith({
      now,
      limit: 50,
    });
  });

  it('does not overlap ticks or run while WhatsApp is disabled', async () => {
    let release: (() => void) | undefined;
    const processServiceSessionLifecycle = vi.fn(
      () =>
        new Promise<{
          closingStarted: number;
          closed: number;
          skipped: number;
        }>((resolve) => {
          release = () => resolve({ closingStarted: 0, closed: 0, skipped: 0 });
        }),
    );
    const enabled = new ServiceSessionLifecycleWorker(
      { processServiceSessionLifecycle } as unknown as WhatsAppRepository,
      new ConfigService({ WHATSAPP_ENABLED: true }),
    );
    const first = enabled.tick();
    await enabled.tick();
    expect(processServiceSessionLifecycle).toHaveBeenCalledTimes(1);
    release?.();
    await first;

    const disabledProcess = vi.fn();
    const disabled = new ServiceSessionLifecycleWorker(
      {
        processServiceSessionLifecycle: disabledProcess,
      } as unknown as WhatsAppRepository,
      new ConfigService({ WHATSAPP_ENABLED: false }),
    );
    await disabled.tick();
    expect(disabledProcess).not.toHaveBeenCalled();
  });
});
