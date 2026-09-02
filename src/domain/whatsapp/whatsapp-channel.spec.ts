import { describe, expect, it } from 'vitest';

import {
  assertEvolutionInstanceNameUnchanged,
  canAutomaticallyRouteChannelTo,
  channelDeletionOperation,
  createEvolutionInstanceName,
  evolveChannelStatus,
  normalizePhysicalChannelPhone,
  validateChannelConfiguration,
  type WhatsAppChannelSnapshot,
} from './whatsapp-channel';

function channel(
  patch: Partial<WhatsAppChannelSnapshot> = {},
): WhatsAppChannelSnapshot {
  return {
    displayName: 'Comercial',
    phoneNumber: '+55 34 99999-0000',
    evolutionInstanceName: 'tenant-production-comercial',
    departmentId: '8d9d7111-98f5-435a-a029-872dc1d8db45',
    routingMode: 'department-owned',
    organizationalStatus: 'pending',
    connectionStatus: 'disconnected',
    allowedAutomaticTargetDepartmentIds: [
      '8d9d7111-98f5-435a-a029-872dc1d8db45',
    ],
    ...patch,
  };
}

describe('WhatsAppChannel domain', () => {
  it('creates the Lume technical instance name once and keeps it immutable', () => {
    expect(
      createEvolutionInstanceName({
        tenantSlug: 'Empresa Ágil',
        channelSlug: 'Financeiro SP',
      }),
    ).toBe('empresa-agil-production-financeiro-sp');
    expect(() =>
      assertEvolutionInstanceNameUnchanged({
        current: 'tenant-production-comercial',
        proposed: 'tenant-production-vendas',
      }),
    ).toThrow('imutável');
  });

  it('normalizes a physical number globally and rejects group identifiers', () => {
    expect(normalizePhysicalChannelPhone('+55 (34) 99999-0000')).toBe(
      '5534999990000',
    );
    expect(() => normalizePhysicalChannelPhone('120363123456@g.us')).toThrow(
      'grupo não podem ser usados como canal',
    );
  });

  it('requires an owner for department-owned routing but not general triage', () => {
    expect(() =>
      validateChannelConfiguration(channel({ departmentId: null })),
    ).toThrow('departamento proprietário');
    expect(
      validateChannelConfiguration(
        channel({ routingMode: 'general-triage', departmentId: null }),
      ),
    ).toMatchObject({ departmentId: null, routingMode: 'general-triage' });
  });

  it('creates before QR and keeps organizational status independent from connection', () => {
    const connecting = evolveChannelStatus({
      current: channel(),
      action: 'request-qr',
      isAdministrator: false,
    });
    const connected = evolveChannelStatus({
      current: connecting,
      action: 'connected',
      isAdministrator: false,
    });
    const disconnected = evolveChannelStatus({
      current: connected,
      action: 'disconnected',
      isAdministrator: false,
    });

    expect(connecting).toMatchObject({
      organizationalStatus: 'pending',
      connectionStatus: 'connecting',
    });
    expect(connected).toMatchObject({
      organizationalStatus: 'active',
      connectionStatus: 'connected',
    });
    expect(disconnected).toMatchObject({
      organizationalStatus: 'active',
      connectionStatus: 'disconnected',
    });
  });

  it('requires administrator authority to disable an operational channel', () => {
    const active = channel({
      organizationalStatus: 'active',
      connectionStatus: 'connected',
    });
    expect(() =>
      evolveChannelStatus({
        current: active,
        action: 'disable-operational',
        isAdministrator: false,
      }),
    ).toThrow('Somente administrador');
    expect(
      evolveChannelStatus({
        current: active,
        action: 'disable-operational',
        isAdministrator: true,
      }),
    ).toMatchObject({
      organizationalStatus: 'disabled',
      connectionStatus: 'connected',
    });
  });

  it('restricts only automatic routing and never infers ownership from intent', () => {
    const target = '8d9d7111-98f5-435a-a029-872dc1d8db45';
    expect(
      canAutomaticallyRouteChannelTo({
        channel: channel(),
        targetDepartmentId: target,
      }),
    ).toBe(true);
    expect(
      canAutomaticallyRouteChannelTo({
        channel: channel(),
        targetDepartmentId: crypto.randomUUID(),
      }),
    ).toBe(false);
  });

  it('never exposes a physical-delete operation', () => {
    expect(() => channelDeletionOperation()).toThrow(
      'não podem ser excluídos fisicamente',
    );
  });
});
