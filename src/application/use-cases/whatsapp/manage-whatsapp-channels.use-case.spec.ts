import { describe, expect, it, vi } from 'vitest';

import { EvolutionInstanceManagementError } from '../../contracts/evolution-instance-management.gateway';
import type { ManagedWhatsAppChannel } from '../../contracts/whatsapp-channel-management.repository';
import {
  CreateWhatsAppChannelUseCase,
  ManageWhatsAppChannelUseCase,
} from './manage-whatsapp-channels.use-case';

function channel(
  overrides: Partial<ManagedWhatsAppChannel> = {},
): ManagedWhatsAppChannel {
  return {
    id: 'channel-1',
    companyId: 'company-1',
    providerId: 'provider-1',
    displayName: 'Financeiro',
    phoneNumber: '5534999999999',
    evolutionInstanceName: 'acme-production-financeiro',
    evolutionInstanceId: 'instance-1',
    departmentId: 'department-financial',
    routingMode: 'department-owned',
    organizationalStatus: 'pending',
    connectionStatus: 'disconnected',
    allowedAutomaticTargetDepartmentIds: ['department-financial'],
    version: 1,
    createdAt: new Date('2026-08-29T10:00:00.000Z'),
    updatedAt: new Date('2026-08-29T10:00:00.000Z'),
    ...overrides,
  };
}

function repository() {
  return {
    getTenantTechnicalName: vi.fn(async () => 'Acme Turismo'),
    list: vi.fn(async () => []),
    get: vi.fn(async () => channel()),
    createPending: vi.fn(async () => ({
      channel: channel({ evolutionInstanceId: null }),
      replayed: false,
    })),
    mutate: vi.fn(
      async (input: { patch: Partial<ManagedWhatsAppChannel> }) => ({
        channel: channel({ ...input.patch, version: 2 }),
        replayed: false,
      }),
    ),
  };
}

function evolution() {
  return {
    create: vi.fn(async () => ({
      instanceName: 'acme-turismo-production-financeiro',
      instanceId: 'instance-created',
      connectionState: 'connecting' as const,
      qrCode: { code: 'qr', base64: 'aGVsbG8=' },
    })),
    connect: vi.fn(async () => ({
      instanceName: 'acme-production-financeiro',
      instanceId: 'instance-1',
      connectionState: 'connecting' as const,
      qrCode: { code: 'qr-2', base64: 'aGVsbG8=' },
    })),
    getConnectionState: vi.fn(async () => 'connected' as const),
    restart: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    removeCancelledSetup: vi.fn(async () => undefined),
  };
}

const command = {
  companyId: 'company-1',
  channelId: 'channel-1',
  actorUserId: 'user-1',
  commandId: 'command-1',
  expectedVersion: 1,
  isAdministrator: false,
  now: new Date('2026-08-29T12:00:00.000Z'),
} as const;

describe('CreateWhatsAppChannelUseCase', () => {
  it('persists the pending Lume channel before requesting Evolution QR', async () => {
    const channels = repository();
    const provider = evolution();
    const subject = new CreateWhatsAppChannelUseCase(
      channels,
      provider,
      'https://api.example.test',
    );

    const result = await subject.execute({
      companyId: 'company-1',
      actorUserId: 'user-1',
      commandId: 'create-1',
      displayName: 'Financeiro',
      phoneNumber: '+55 (34) 99999-9999',
      departmentId: 'department-financial',
      routingMode: 'department-owned',
      allowedAutomaticTargetDepartmentIds: ['department-financial'],
    });

    expect(channels.createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumber: '5534999999999',
        evolutionInstanceName: 'acme-turismo-production-financeiro',
      }),
    );
    expect(provider.create).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceName: 'acme-turismo-production-financeiro',
        webhookUrl: 'https://api.example.test/webhooks/evolution/channel-1',
      }),
    );
    expect(channels.createPending.mock.invocationCallOrder[0]).toBeLessThan(
      provider.create.mock.invocationCallOrder[0] ?? 0,
    );
    expect(result).toMatchObject({
      qrCode: { code: 'qr' },
      providerIssue: null,
    });
  });

  it('keeps the channel and records ERROR when Evolution creation fails', async () => {
    const channels = repository();
    const provider = evolution();
    provider.create.mockRejectedValue(
      new EvolutionInstanceManagementError('provider-unavailable'),
    );
    const subject = new CreateWhatsAppChannelUseCase(
      channels,
      provider,
      'https://api.example.test',
    );

    const result = await subject.execute({
      companyId: 'company-1',
      actorUserId: 'user-1',
      commandId: 'create-1',
      displayName: 'Financeiro',
      phoneNumber: '5534999999999',
      departmentId: 'department-financial',
      routingMode: 'department-owned',
      allowedAutomaticTargetDepartmentIds: [],
    });

    expect(channels.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'provider-operation-failed',
        patch: { connectionStatus: 'error' },
      }),
    );
    expect(result.providerIssue).toMatchObject({
      reason: 'provider-unavailable',
    });
  });
});

describe('ManageWhatsAppChannelUseCase', () => {
  it('persists CONNECTING before regenerating QR on the same instance', async () => {
    const channels = repository();
    const provider = evolution();
    channels.mutate
      .mockResolvedValueOnce({
        channel: channel({ connectionStatus: 'connecting', version: 2 }),
        replayed: false,
      })
      .mockResolvedValueOnce({
        channel: channel({ connectionStatus: 'connecting', version: 3 }),
        replayed: false,
      });
    const subject = new ManageWhatsAppChannelUseCase(channels, provider);

    const result = await subject.requestQr(command);

    expect(channels.mutate.mock.invocationCallOrder[0]).toBeLessThan(
      provider.connect.mock.invocationCallOrder[0] ?? 0,
    );
    expect(provider.create).not.toHaveBeenCalled();
    expect(result.qrCode).toMatchObject({ code: 'qr-2' });
  });

  it('records provider failure without disabling the organizational channel', async () => {
    const channels = repository();
    channels.get.mockResolvedValue(
      channel({
        organizationalStatus: 'active',
        connectionStatus: 'connected',
      }),
    );
    const provider = evolution();
    provider.disconnect.mockRejectedValue(
      new EvolutionInstanceManagementError('timeout'),
    );
    channels.mutate.mockResolvedValue({
      channel: channel({
        organizationalStatus: 'active',
        connectionStatus: 'error',
        version: 2,
      }),
      replayed: false,
    });
    const subject = new ManageWhatsAppChannelUseCase(channels, provider);

    const result = await subject.disconnect(command);

    expect(channels.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'provider-operation-failed',
        patch: { connectionStatus: 'error' },
      }),
    );
    expect(result.channel.organizationalStatus).toBe('active');
    expect(result.providerIssue?.reason).toBe('timeout');
  });

  it('cancels the pending Lume record even if Evolution cleanup fails', async () => {
    const channels = repository();
    const provider = evolution();
    provider.removeCancelledSetup.mockRejectedValue(
      new EvolutionInstanceManagementError('provider-unavailable'),
    );
    channels.mutate.mockResolvedValue({
      channel: channel({
        organizationalStatus: 'cancelled',
        connectionStatus: 'disconnected',
        version: 2,
      }),
      replayed: false,
    });
    const subject = new ManageWhatsAppChannelUseCase(channels, provider);

    const result = await subject.cancelSetup(command);

    expect(result.channel.organizationalStatus).toBe('cancelled');
    expect(result.infrastructureCleanupPending).toBe(true);
  });

  it('requires administrator authority to disable an operational channel', async () => {
    const channels = repository();
    channels.get.mockResolvedValue(
      channel({
        organizationalStatus: 'active',
        connectionStatus: 'connected',
      }),
    );
    const provider = evolution();
    const subject = new ManageWhatsAppChannelUseCase(channels, provider);

    await expect(subject.disable(command)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(channels.mutate).not.toHaveBeenCalled();
    expect(provider.disconnect).not.toHaveBeenCalled();
  });

  it('updates display/routing without ever proposing a technical rename', async () => {
    const channels = repository();
    const provider = evolution();
    const subject = new ManageWhatsAppChannelUseCase(channels, provider);

    await subject.updateConfiguration({
      companyId: 'company-1',
      channelId: 'channel-1',
      actorUserId: 'user-1',
      commandId: 'update-1',
      expectedVersion: 1,
      displayName: 'Financeiro e cobrança',
      departmentId: null,
      routingMode: 'general-triage',
      allowedAutomaticTargetDepartmentIds: ['department-financial'],
    });

    const mutation = channels.mutate.mock.calls[0]?.[0];
    expect(mutation?.patch).not.toHaveProperty('evolutionInstanceName');
    expect(mutation?.patch).toMatchObject({
      displayName: 'Financeiro e cobrança',
      routingMode: 'general-triage',
    });
  });
});
