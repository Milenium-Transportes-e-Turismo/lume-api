import { createHash } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { CreateHumanOutboundInput } from '../../../application/contracts/whatsapp.repository';
import {
  ConversationState,
  DepartmentCode,
  DocumentAccessMode,
  UserAccountStatus,
} from '../prisma/generated/client';
import type { PrismaService } from '../prisma/prisma.service';
import { PrismaWhatsAppRepository } from './prisma-whatsapp.repository';

const ids = {
  company: '00000000-0000-4000-8000-000000000001',
  conversation: '00000000-0000-4000-8000-000000000002',
  command: '00000000-0000-4000-8000-000000000003',
  idempotency: '00000000-0000-4000-8000-000000000004',
  actor: '00000000-0000-4000-8000-000000000005',
  message: '00000000-0000-5000-8000-000000000006',
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function fingerprint(input: CreateHumanOutboundInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonicalize({ ...input, text: input.text?.trim() ?? '' }),
      ),
    )
    .digest('hex');
}

function command(): CreateHumanOutboundInput {
  return {
    companyId: ids.company,
    conversationId: ids.conversation,
    commandId: ids.command,
    idempotencyKey: ids.idempotency,
    expectedVersion: 3,
    actorUserId: ids.actor,
    text: 'Comprovante',
    attachment: {
      messageId: ids.message,
      kind: 'image',
      fileName: 'comprovante.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 6,
      sha256: 'a'.repeat(64),
      storageKey: `v1/${ids.company}/${ids.conversation}/${ids.message}`,
    },
  };
}

function createHarness(
  options: {
    actorDepartments?: string[];
    conversationDepartment?: DepartmentCode;
    duplicate?: { payloadHash: string; resultSnapshot: object | null } | null;
  } = {},
) {
  const conversation = {
    id: ids.conversation,
    companyId: ids.company,
    version: 3,
    conversationState: ConversationState.HUMAN_ACTIVE,
    department: options.conversationDepartment ?? DepartmentCode.COMMERCIAL,
    assignedToUserId: '00000000-0000-4000-8000-000000000099',
  };
  const transaction = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [{ id: ids.actor }]),
    user: {
      findUnique: vi.fn(async () => ({
        id: ids.actor,
        name: 'Atendente',
        isActive: true,
        status: UserAccountStatus.ACTIVE,
        deletedAt: null,
        isAdministrator: false,
        documentAccessMode: DocumentAccessMode.STANDARD,
        departments: options.actorDepartments ?? ['commercial'],
        permissionCodes: ['whatsapp-conversations:attend'],
      })),
    },
    integrationInbox: {
      findUnique: vi.fn(async () => options.duplicate ?? null),
    },
    whatsAppConversation: {
      findUnique: vi.fn(async () => conversation),
    },
  };
  const prisma = {
    $transaction: vi.fn(
      async (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    ),
  };
  return {
    repository: new PrismaWhatsAppRepository(
      prisma as unknown as PrismaService,
      new ConfigService({}),
    ),
    transaction,
  };
}

describe('PrismaWhatsAppRepository human outbound preflight', () => {
  it('allows a same-department attendant even when another user is the current reference', async () => {
    const harness = createHarness();

    await expect(
      harness.repository.authorizeHumanOutbound(command()),
    ).resolves.toBeUndefined();
  });

  it('rejects an actor outside the responsible department before persistence', async () => {
    const harness = createHarness({ actorDepartments: ['operations'] });

    await expect(
      harness.repository.authorizeHumanOutbound(command()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('accepts an identical idempotent replay without requiring a new conversation read', async () => {
    const input = command();
    const harness = createHarness({
      duplicate: {
        payloadHash: fingerprint(input),
        resultSnapshot: { message: { id: ids.message } },
      },
    });

    await expect(
      harness.repository.authorizeHumanOutbound(input),
    ).resolves.toBeUndefined();
    expect(
      harness.transaction.whatsAppConversation.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('rejects divergent content for the same idempotency key during preflight', async () => {
    const original = command();
    const harness = createHarness({
      duplicate: {
        payloadHash: fingerprint(original),
        resultSnapshot: { message: { id: ids.message } },
      },
    });

    await expect(
      harness.repository.authorizeHumanOutbound({
        ...original,
        attachment: {
          ...original.attachment!,
          sizeBytes: 8,
          sha256: 'b'.repeat(64),
        },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(
      harness.transaction.whatsAppConversation.findUnique,
    ).not.toHaveBeenCalled();
  });
});
