import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  EvolutionInstanceManagementError,
  EvolutionInstanceManagementGateway,
  type CreateEvolutionInstanceInput,
  type EvolutionInstanceConnectionState,
  type EvolutionInstanceSnapshot,
  type EvolutionQrCode,
} from '../../../application/contracts/evolution-instance-management.gateway';

const INSTANCE_NAME = /^[a-z0-9](?:[a-z0-9-]{1,118}[a-z0-9])?$/u;
const MAXIMUM_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validInstanceName(value: string): string {
  const name = value.trim();
  if (!INSTANCE_NAME.test(name)) {
    throw new EvolutionInstanceManagementError('invalid-request');
  }
  return name;
}

function validWebhookUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    return parsed.toString();
  } catch {
    throw new EvolutionInstanceManagementError('invalid-request');
  }
}

function stateFromProvider(value: unknown): EvolutionInstanceConnectionState {
  const normalized = optionalString(value)?.toLowerCase();
  if (['open', 'connected', 'online'].includes(normalized ?? '')) {
    return 'connected';
  }
  if (['created', 'connecting', 'pairing'].includes(normalized ?? '')) {
    return 'connecting';
  }
  if (
    ['close', 'closed', 'disconnected', 'offline'].includes(normalized ?? '')
  ) {
    return 'disconnected';
  }
  return 'error';
}

function parseQrCode(value: JsonObject): EvolutionQrCode | null {
  const nested = asObject(value.qrcode) ?? asObject(value.qrCode);
  const base64 =
    optionalString(nested?.base64) ?? optionalString(value.base64) ?? null;
  if (!base64) return null;
  if (
    base64.length > MAXIMUM_RESPONSE_BYTES ||
    (!base64.startsWith('data:image/') && !/^[A-Za-z0-9+/=]+$/u.test(base64))
  ) {
    throw new EvolutionInstanceManagementError('invalid-response');
  }
  return {
    code:
      optionalString(nested?.code) ??
      optionalString(value.code) ??
      optionalString(value.pairingCode),
    base64,
  };
}

function parseSnapshot(
  value: unknown,
  expectedInstanceName: string,
): EvolutionInstanceSnapshot {
  const response = asObject(value);
  if (!response) {
    throw new EvolutionInstanceManagementError('invalid-response');
  }
  const instance = asObject(response.instance) ?? asObject(response.data);
  const responseName =
    optionalString(instance?.instanceName) ??
    optionalString(instance?.name) ??
    expectedInstanceName;
  if (responseName !== expectedInstanceName) {
    throw new EvolutionInstanceManagementError('invalid-response');
  }
  const providerState =
    instance?.state ??
    instance?.connectionStatus ??
    instance?.status ??
    response.state;
  const qrCode = parseQrCode(response);
  if (providerState == null && !qrCode) {
    throw new EvolutionInstanceManagementError('invalid-response');
  }
  return {
    instanceName: expectedInstanceName,
    instanceId:
      optionalString(instance?.instanceId) ??
      optionalString(instance?.id) ??
      null,
    connectionState:
      providerState == null && qrCode
        ? 'connecting'
        : stateFromProvider(providerState),
    qrCode,
  };
}

@Injectable()
export class HttpEvolutionInstanceManagementGateway extends EvolutionInstanceManagementGateway {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    super();
    this.baseUrl = (config.get<string>('EVOLUTION_BASE_URL') ?? '')
      .trim()
      .replace(/\/+$/u, '');
    this.apiKey = (config.get<string>('EVOLUTION_API_KEY') ?? '').trim();
    this.webhookSecret = (
      config.get<string>('EVOLUTION_WEBHOOK_SECRET') ?? ''
    ).trim();
    const timeout = Number(
      config.get<number | string>('EVOLUTION_MANAGEMENT_TIMEOUT_MS'),
    );
    this.timeoutMs =
      Number.isInteger(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS;
  }

  async create(
    input: CreateEvolutionInstanceInput,
  ): Promise<EvolutionInstanceSnapshot> {
    const instanceName = validInstanceName(input.instanceName);
    const webhook = validWebhookUrl(input.webhookUrl);
    const phone = input.phoneNumber?.replace(/\D/gu, '');
    if (phone && !/^\d{10,15}$/u.test(phone)) {
      throw new EvolutionInstanceManagementError('invalid-request');
    }
    if (this.webhookSecret.length < 32) {
      throw new EvolutionInstanceManagementError('invalid-configuration');
    }
    const response = await this.request('/instance/create', {
      method: 'POST',
      body: JSON.stringify({
        instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        groupsIgnore: false,
        webhook: {
          enabled: true,
          url: webhook,
          byEvents: false,
          base64: false,
          headers: {
            'x-evolution-webhook-token': this.webhookSecret,
          },
          events: [
            'QRCODE_UPDATED',
            'MESSAGES_UPSERT',
            'MESSAGES_UPDATE',
            'SEND_MESSAGE',
            'CONNECTION_UPDATE',
            'GROUPS_UPSERT',
            'GROUP_UPDATE',
            'GROUP_PARTICIPANTS_UPDATE',
          ],
        },
        ...(phone ? { number: phone } : {}),
      }),
    });
    return parseSnapshot(response, instanceName);
  }

  async connect(instanceName: string): Promise<EvolutionInstanceSnapshot> {
    const name = validInstanceName(instanceName);
    const response = await this.request(
      `/instance/connect/${encodeURIComponent(name)}`,
      { method: 'GET' },
    );
    return parseSnapshot(response, name);
  }

  async getConnectionState(
    instanceName: string,
  ): Promise<EvolutionInstanceConnectionState> {
    const name = validInstanceName(instanceName);
    const response = asObject(
      await this.request(
        `/instance/connectionState/${encodeURIComponent(name)}`,
        { method: 'GET' },
      ),
    );
    const instance = asObject(response?.instance);
    const state = instance?.state ?? response?.state;
    const parsed = stateFromProvider(state);
    if (parsed === 'error' && state === undefined) {
      throw new EvolutionInstanceManagementError('invalid-response');
    }
    return parsed;
  }

  async restart(instanceName: string): Promise<void> {
    const name = validInstanceName(instanceName);
    await this.request(`/instance/restart/${encodeURIComponent(name)}`, {
      method: 'PUT',
    });
  }

  async disconnect(instanceName: string): Promise<void> {
    const name = validInstanceName(instanceName);
    await this.request(`/instance/logout/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  async removeCancelledSetup(instanceName: string): Promise<void> {
    const name = validInstanceName(instanceName);
    await this.request(`/instance/delete/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    if (!this.baseUrl || !this.apiKey) {
      throw new EvolutionInstanceManagementError('invalid-configuration');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          apikey: this.apiKey,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        signal: controller.signal,
      });
    } catch {
      throw new EvolutionInstanceManagementError(
        controller.signal.aborted ? 'timeout' : 'provider-unavailable',
      );
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const reason =
        response.status === 404
          ? 'not-found'
          : response.status === 409
            ? 'already-exists'
            : response.status >= 500
              ? 'provider-unavailable'
              : 'provider-rejected';
      throw new EvolutionInstanceManagementError(reason, response.status);
    }
    const text = await response.text();
    if (text.length > MAXIMUM_RESPONSE_BYTES) {
      throw new EvolutionInstanceManagementError('invalid-response');
    }
    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new EvolutionInstanceManagementError('invalid-response');
    }
  }
}
