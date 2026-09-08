import 'dotenv/config';

import { execFileSync } from 'node:child_process';
import { createHmac, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import ExcelJS, { type Worksheet } from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AccessTokenService } from '../src/application/contracts/cryptography';
import {
  CommercialQuoteRepository,
  type QuoteRequestPatch,
} from '../src/application/contracts/commercial-quote.repository';
import { UsersRepository } from '../src/application/contracts/repositories';
import {
  type ClaimEvolutionDispatchInput,
  type CompleteOutboxExecutionInput,
  type CreateOutboundInput,
  type EvolutionResultInput,
  type TransitionCommand,
  WhatsAppRepository,
} from '../src/application/contracts/whatsapp.repository';
import { userMutationAuthorizationFingerprint } from '../src/domain/access/user-management-policy';
import {
  dateOnlyFromDateTime,
  parseBusinessDateTime,
} from '../src/domain/commercial/quote-schedule';
import { PLATFORM_AGENT_CATALOG } from '../src/domain/agents/platform-agent-catalog';
import { UNSUPPORTED_MESSAGE_KIND_REPLY_TEXT } from '../src/domain/whatsapp/whatsapp.constants';
import {
  DeliveryStatus,
  MessageDirection,
  MessageKind,
  Prisma,
  RequestStatus,
  RoutingRouteStatus,
  RoutingRouteType,
  WhatsAppImportBatchStatus,
} from '../src/infra/database/prisma/generated/client';
import { ProductionBootstrapService } from '../src/infra/bootstrap/production-bootstrap.service';
import { WhatsAppImportService } from '../src/infra/imports/whatsapp-import.service';
import {
  CONVERSATION_HEADERS,
  DOCUMENT_HEADERS,
  MESSAGE_HEADERS,
} from '../src/infra/imports/whatsapp-import.types';
import { configureBodyParsers } from '../src/shared/http/configure-body-parsers';
import { formatWhatsAppPhone } from '../src/shared/utils/normalization';

const channelId = '00000000-0000-4000-8000-000000000221';
const e2eDispatchOwnerId = '00000000-0000-4000-8000-000000000223';
const webhookSecret = 'evolution-webhook-secret-with-more-than-32-characters';
const tenantId = '00000000-0000-4000-8000-000000000210';
const installationId = '00000000-0000-4000-8000-000000000211';

function blankImportRow(length: number): unknown[] {
  return Array.from({ length }, () => null);
}

function addImportTable(
  worksheet: Worksheet,
  name: string,
  headers: readonly string[],
  rows: unknown[][],
): void {
  worksheet.addTable({
    name,
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    columns: headers.map((header) => ({ name: header })),
    rows,
  });
}

function legacyConversationRow(options: {
  externalId: string;
  phone: string;
  wallClock: Date;
  contactName?: string;
  origin?: string;
  destination?: string;
  quoteSequence?: number;
}): unknown[] {
  const row = blankImportRow(CONVERSATION_HEADERS.length);
  row[0] = options.externalId;
  row[1] = 'legacy-e2e';
  row[2] = options.phone;
  row[3] = options.contactName ?? 'Cliente legado E2E';
  row[4] = '5511999999999';
  row[5] = 'commercial';
  row[7] = 'bot-active';
  row[8] = options.quoteSequence ? 'commercial-follow-up-menu' : 'main-menu';
  row[9] = options.quoteSequence ? 'under-review' : 'not-started';
  row[10] = options.wallClock;
  row[11] = 'Histórico legado importado';
  row[12] = 0;
  row[13] = options.quoteSequence ?? null;
  row[14] = options.quoteSequence ? options.contactName : null;
  row[17] = options.quoteSequence ? 'fretamento-eventual' : null;
  row[18] = 'unknown';
  row[19] = options.origin ?? null;
  row[20] = options.destination ?? null;
  row[23] = options.quoteSequence ? 12 : null;
  row[25] = 'desconhecido';
  row[26] = 'desconhecido';
  row[29] = options.quoteSequence ? options.wallClock : null;
  row[32] = 'upsert';
  return row;
}

function legacyMessageRow(
  externalConversationId: string,
  externalMessageId: string,
  wallClock: Date,
): unknown[] {
  const row = blankImportRow(MESSAGE_HEADERS.length);
  row[0] = externalConversationId;
  row[1] = externalMessageId;
  row[2] = 'inbound';
  row[3] = 'text';
  row[4] = wallClock;
  row[5] = 'received';
  row[6] = 'Mensagem histórica';
  row[9] = `provider-${externalMessageId}`;
  return row;
}

function legacyDocumentRow(
  externalConversationId: string,
  externalDocumentId: string,
  quoteSequence: number,
): unknown[] {
  const row = blankImportRow(DOCUMENT_HEADERS.length);
  row[0] = externalConversationId;
  row[1] = quoteSequence;
  row[2] = externalDocumentId;
  row[3] = 'proposta-legada.pdf';
  row[4] = 'files/proposta-legada.pdf';
  row[5] = 'application/pdf';
  row[6] = 'uploaded';
  return row;
}

async function createLegacyImportPackage(options: {
  root: string;
  directory: string;
  conversations: unknown[][];
  messages?: unknown[][];
  documents?: unknown[][];
  includePdf?: boolean;
}): Promise<string> {
  const packagePath = join(options.root, options.directory);
  const filesPath = join(packagePath, 'files');
  await mkdir(filesPath, { recursive: true });
  if (options.includePdf) {
    await writeFile(
      join(filesPath, 'proposta-legada.pdf'),
      Buffer.from('%PDF-1.7\nimport-e2e\n%%EOF'),
    );
  }
  const workbook = new ExcelJS.Workbook();
  addImportTable(
    workbook.addWorksheet('Atendimentos'),
    'AtendimentosImportacao',
    CONVERSATION_HEADERS,
    options.conversations,
  );
  addImportTable(
    workbook.addWorksheet('Mensagens'),
    'MensagensImportacao',
    MESSAGE_HEADERS,
    options.messages ?? [],
  );
  addImportTable(
    workbook.addWorksheet('Documentos'),
    'DocumentosImportacao',
    DOCUMENT_HEADERS,
    options.documents ?? [],
  );
  await workbook.xlsx.writeFile(
    join(packagePath, 'modelo-importacao-atendimentos-whatsapp.xlsx'),
  );
  return packagePath;
}

function configureEnvironment(mediaStoragePath: string): string {
  const configuredDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
  if (!configuredDatabaseUrl) {
    throw new Error(
      'TEST_DATABASE_URL é obrigatório para o E2E e deve apontar para um banco descartável.',
    );
  }
  const parsedDatabaseUrl = new URL(configuredDatabaseUrl);
  const configuredSchema = parsedDatabaseUrl.searchParams.get('schema');
  if (configuredSchema) {
    parsedDatabaseUrl.searchParams.set('schema', configuredSchema.trim());
  }
  const databaseUrl = parsedDatabaseUrl.toString();
  const databaseName = parsedDatabaseUrl.pathname.toLowerCase();
  if (!databaseName.includes('test')) {
    throw new Error('TEST_DATABASE_URL deve conter "test" no nome do banco.');
  }

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const license = {
    version: 1,
    licenseId: '00000000-0000-4000-8000-000000000212',
    installationId,
    tenantId,
    plan: 'standard',
    features: ['users', 'whatsapp'],
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-01-01T00:00:00.000Z',
    graceUntil: '2027-02-01T00:00:00.000Z',
  };
  const encoded = Buffer.from(JSON.stringify(license)).toString('base64url');
  const signature = sign(null, Buffer.from(encoded), privateKey).toString(
    'base64url',
  );
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: 'e2e-jwt-secret-with-at-least-32-characters',
    INSTALLATION_ID: installationId,
    LICENSE_PUBLIC_KEY_BASE64: Buffer.from(publicPem).toString('base64'),
    LICENSE_DOCUMENT: `${encoded}.${signature}`,
    HEIGIT_API_KEY: 'heigit-api-key-for-e2e',
    TENANT_LEGAL_NAME: 'Lume E2E Ltda.',
    TENANT_TRADE_NAME: 'Lume E2E',
    TENANT_TAX_ID: '04.252.011/0001-10',
    TENANT_ADMIN_NAME: 'Admin E2E',
    TENANT_ADMIN_USERNAME: 'admin.e2e',
    TENANT_ADMIN_EMAIL: 'admin.e2e@example.test',
    TENANT_ADMIN_CPF: '11144477735',
    TENANT_ADMIN_PASSWORD: 'SenhaForte@2026',
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_CHANNEL_ID: channelId,
    WHATSAPP_CHANNEL_NAME: 'WhatsApp E2E',
    WHATSAPP_PHONE_NUMBER: '5511999999999',
    EVOLUTION_PROVIDER_NAME: 'Evolution E2E',
    EVOLUTION_BASE_URL: 'https://evolution.example.test',
    EVOLUTION_INSTANCE_NAME: 'lume-e2e',
    EVOLUTION_API_KEY: 'evolution-api-key-for-e2e',
    EVOLUTION_WEBHOOK_SECRET: webhookSecret,
    WHATSAPP_AI_PROVIDER_ORDER: 'openai',
    WHATSAPP_AI_OPENAI_API_KEY: 'whatsapp-ai-openai-key-for-e2e',
    LUME_AGENT_ORCHESTRATOR_OPENAI_API_KEY:
      'sk-e2e-orchestrator-agent-key-0001',
    LUME_AGENT_CUSTOMER_SERVICE_OPENAI_API_KEY:
      'sk-e2e-customer-service-agent-key-0002',
    LUME_AGENT_REGISTRATION_OPENAI_API_KEY:
      'sk-e2e-registration-agent-key-0003',
    LUME_AGENT_KNOWLEDGE_OPENAI_API_KEY: 'sk-e2e-knowledge-agent-key-0004',
    LUME_AGENT_MEDIA_OPENAI_API_KEY: 'sk-e2e-media-agent-key-0005',
    LUME_AGENT_CONTINUITY_OPENAI_API_KEY: 'sk-e2e-continuity-agent-key-0006',
    LUME_AGENT_SUPERVISOR_OPENAI_API_KEY: 'sk-e2e-supervisor-agent-key-0007',
    MILENIUM_DIRECTOR_PHONE: '5511999999901',
    MILENIUM_DEPARTMENT_PURCHASES_PHONE: '5511999999902',
    MILENIUM_DEPARTMENT_CONTROLLING_PHONE: '5511999999903',
    MILENIUM_DEPARTMENT_DP_PHONE: '5511999999904',
    MILENIUM_DEPARTMENT_FINANCE_PHONE: '5511999999905',
    MILENIUM_DEPARTMENT_MANAGEMENT_PHONE: '5511999999906',
    MILENIUM_DEPARTMENT_MAINTENANCE_PHONE: '5511999999907',
    MILENIUM_DEPARTMENT_MONITORING_PHONE: '5511999999908',
    MILENIUM_DEPARTMENT_OPERATIONAL_PHONE: '5511999999909',
    WHATSAPP_ALLOWED_MIME_TYPES:
      'image/jpeg,image/png,image/webp,image/gif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv,application/octet-stream,audio/ogg,audio/mpeg,audio/mp4,audio/aac,audio/wav,video/mp4,video/webm,video/quicktime',
    WHATSAPP_MEDIA_STORAGE_DRIVER: 'filesystem',
    WHATSAPP_MEDIA_STORAGE_PATH: mediaStoragePath,
    WHATSAPP_IMPORT_ROOT: join(mediaStoragePath, 'imports'),
    WHATSAPP_IMPORT_UPLOAD_TEMP_ROOT: join(
      mediaStoragePath,
      'imports',
      'incoming',
    ),
    RETENTION_JOB_ENABLED: 'false',
    SWAGGER_ENABLED: 'false',
  });
  return databaseUrl;
}

function webhookPayload(
  messageId: string,
  phone: string,
  text: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
) {
  return {
    event: 'messages.upsert',
    instance: 'lume-e2e',
    data: {
      key: {
        id: messageId,
        remoteJid: `${phone}@s.whatsapp.net`,
        fromMe: false,
      },
      pushName: `Contato ${phone.slice(-4)}`,
      messageTimestamp: timestampSeconds,
      message: { conversation: text },
    },
  };
}

function signedWebhook(
  app: INestApplication,
  payload: ReturnType<typeof webhookPayload>,
  targetChannelId = channelId,
) {
  const raw = JSON.stringify(payload);
  const timestamp = String(payload.data.messageTimestamp);
  const signature = createHmac('sha256', webhookSecret)
    .update(timestamp)
    .update('.')
    .update(raw)
    .digest('hex');
  return request(app.getHttpServer())
    .post(`/api/v1/webhooks/evolution/${targetChannelId}`)
    .set('content-type', 'application/json')
    .set('x-evolution-timestamp', timestamp)
    .set('x-evolution-signature', `sha256=${signature}`)
    .send(raw);
}

async function signedMediaWebhook(
  app: INestApplication,
  payload: ReturnType<typeof webhookPayload>,
) {
  const originalFetch = globalThis.fetch;
  const providerContent = Buffer.from(
    `retained:${payload.data.key.id}`,
    'utf8',
  );
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes('/chat/getBase64FromMediaMessage/')) {
        return new Response(
          JSON.stringify({ base64: providerContent.toString('base64') }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      return originalFetch(input, init);
    });
  try {
    return await signedWebhook(app, payload);
  } finally {
    fetchSpy.mockRestore();
  }
}

function tokenWebhook(
  app: INestApplication,
  payload: ReturnType<typeof webhookPayload>,
) {
  return request(app.getHttpServer())
    .post(`/api/v1/webhooks/evolution/${channelId}`)
    .set('content-type', 'application/json')
    .set('x-evolution-webhook-token', webhookSecret)
    .send(JSON.stringify(payload));
}

describe('WhatsApp MVP HTTP E2E com PostgreSQL', () => {
  let app: NestExpressApplication;
  let prisma: import('../src/infra/database/prisma/prisma.service').PrismaService;
  let accessTokens: AccessTokenService;
  let whatsappRepository: WhatsAppRepository;
  let commercialQuoteRepository: CommercialQuoteRepository;
  let accessToken: string;
  let commercialAccessToken: string;
  let commercialAttendant: { id: string; name: string; tokenVersion: number };
  let conversationId: string;
  let quoteRequestId: string;
  let selectedCommandId: string;
  let mediaStoragePath: string;

  type AutomationBody = Record<string, unknown> & {
    id: string;
    version: number;
    conversationId: string;
    messageId: string;
    attemptId: string;
    attempts: Array<Record<string, unknown> & { id: string }>;
    message: AutomationBody;
    conversation: AutomationBody;
  };

  const automationBody = (value: unknown) => value as AutomationBody;
  const transitionSystem = async (
    input: Omit<TransitionCommand, 'companyId' | 'actorType'>,
  ) =>
    automationBody(
      await whatsappRepository.transition({
        ...input,
        companyId: tenantId,
        actorType: 'system',
      }),
    );
  const createAutomaticOutbound = async (
    input: Omit<CreateOutboundInput, 'companyId' | 'automatic'>,
  ) =>
    automationBody(
      await whatsappRepository.createOutbound({
        ...input,
        companyId: tenantId,
        automatic: true,
      }),
    );
  const claimEvolution = async (
    input: Omit<ClaimEvolutionDispatchInput, 'companyId' | 'ownerId'>,
  ) =>
    automationBody(
      await whatsappRepository.claimEvolutionDispatch({
        ...input,
        companyId: tenantId,
        ownerId: e2eDispatchOwnerId,
      }),
    );
  const recordEvolution = async (
    input: Omit<EvolutionResultInput, 'companyId'>,
  ) =>
    automationBody(
      await whatsappRepository.recordEvolutionResult({
        ...input,
        companyId: tenantId,
      }),
    );
  const completeAutomationOutbox = async (
    input: Omit<CompleteOutboxExecutionInput, 'companyId'>,
  ) =>
    automationBody(
      await whatsappRepository.completeOutboxExecution({
        ...input,
        companyId: tenantId,
      }),
    );
  const patchQuoteFromAutomation = async (
    quoteId: string,
    input: QuoteRequestPatch,
  ) =>
    automationBody(
      await commercialQuoteRepository.patchQuoteRequest(
        tenantId,
        quoteId,
        input,
      ),
    );

  beforeAll(async () => {
    mediaStoragePath = await mkdtemp(
      join(tmpdir(), 'lume-whatsapp-media-e2e-'),
    );
    const databaseUrl = configureEnvironment(mediaStoragePath);
    execFileSync(
      process.execPath,
      [
        join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'),
        'migrate',
        'reset',
        '--force',
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
      },
    );

    const [{ AppModule }, { ProductionBootstrapService }, prismaModule] =
      await Promise.all([
        import('../src/app.module'),
        import('../src/infra/bootstrap/production-bootstrap.service'),
        import('../src/infra/database/prisma/prisma.service'),
      ]);
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      rawBody: true,
      bodyParser: false,
      logger: ['error'],
    });
    configureBodyParsers(
      app,
      app.get(ConfigService).getOrThrow<number>('HTTP_MAX_JSON_BODY_BYTES'),
    );
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    prisma = app.get(prismaModule.PrismaService);
    accessTokens = app.get(AccessTokenService);
    whatsappRepository = app.get(WhatsAppRepository);
    commercialQuoteRepository = app.get(CommercialQuoteRepository);
    await app.get(ProductionBootstrapService).execute();

    const firstAccess = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        identifier: 'admin.e2e',
        password: 'SenhaForte@2026',
        remember: false,
      })
      .expect(403);
    expect(firstAccess.body).toMatchObject({
      code: 'ACCOUNT_PASSWORD_SETUP_REQUIRED',
      details: {
        challengeToken: expect.any(String),
        expiresAt: expect.any(String),
        reason: 'first-access',
      },
    });
    const challengeToken = firstAccess.body.details.challengeToken as string;
    await request(app.getHttpServer())
      .post('/api/v1/auth/password/change')
      .send({
        token: challengeToken,
        newPassword: 'SenhaFinalE2E@2026',
      })
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ changed: true }));
    await request(app.getHttpServer())
      .post('/api/v1/auth/password/change')
      .send({
        token: challengeToken,
        newPassword: 'OutraSenhaE2E@2026',
      })
      .expect(401);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        identifier: 'admin.e2e',
        password: 'SenhaFinalE2E@2026',
        remember: false,
      })
      .expect((response) => {
        if (response.status !== 200) {
          throw new Error(
            `Login E2E falhou com HTTP ${response.status}: ${JSON.stringify(response.body)}`,
          );
        }
      });
    accessToken = login.body.accessToken as string;
    commercialAttendant = await prisma.user.create({
      data: {
        companyId: tenantId,
        name: 'Atendente Comercial E2E',
        username: 'atendente.comercial.e2e',
        usernameNormalized: 'atendente.comercial.e2e',
        email: 'atendente.comercial.e2e@example.test',
        emailNormalized: 'atendente.comercial.e2e@example.test',
        passwordHash: 'hash-e2e-sem-uso',
        departments: ['commercial'],
        permissionCodes: ['whatsapp-conversations:manage', 'commercial:manage'],
      },
      select: { id: true, name: true, tokenVersion: true },
    });
    commercialAccessToken = await accessTokens.sign({
      sub: commercialAttendant.id,
      companyId: tenantId,
      tokenVersion: commercialAttendant.tokenVersion,
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    if (mediaStoragePath) {
      await rm(mediaStoragePath, { recursive: true, force: true });
    }
  });

  it('exports only approved active registrations as a private Google Contacts CSV', async () => {
    const auth = 'Bearer ' + accessToken;
    const suffix = randomUUID().slice(0, 8);
    const approved = await prisma.routingCompany.create({
      data: {
        companyId: tenantId,
        taxId: 'exp-' + suffix,
        legalName: 'José Exportação ' + suffix,
        clientType: 'PF',
        firstName: 'José',
        lastName: 'Exportação ' + suffix,
        individualName: 'José Exportação ' + suffix,
        status: 'ACTIVE',
        isTemporary: false,
        registrationPhones: {
          create: {
            normalizedValue: '5534999990123',
            number: '999990123',
            areaCode: '34',
          },
        },
      },
    });
    await prisma.routingCompany.createMany({
      data: [
        {
          companyId: tenantId,
          taxId: 'temp-' + suffix,
          legalName: 'TEMPORARIO-' + suffix,
          isTemporary: true,
          temporaryReason: 'Teste isolado de exportação.',
          regularizationDueAt: new Date('2027-01-01'),
          temporaryResponsibleUserId: commercialAttendant.id,
        },
        {
          companyId: tenantId,
          taxId: 'off-' + suffix,
          legalName: 'INATIVO-' + suffix,
          status: 'INACTIVE',
        },
      ],
    });
    const preview = await request(app.getHttpServer())
      .get('/api/v1/registrations/contact-export')
      .set('authorization', auth)
      .expect(200);
    expect(preview.body.contacts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: approved.id })]),
    );
    const commandId = randomUUID();
    const first = await request(app.getHttpServer())
      .post('/api/v1/registrations/contact-export')
      .set('authorization', auth)
      .send({ commandId, batch: 1 })
      .expect(201);
    expect(first.headers['content-type']).toContain('text/csv');
    expect(first.headers['cache-control']).toContain('no-store');
    expect(first.headers['content-disposition']).toContain(
      'lume-google-contacts-1.csv',
    );
    expect(first.text).toContain('José,Exportação ' + suffix);
    expect(first.text).toContain('+5534999990123');
    expect(first.text).not.toContain('TEMPORARIO-' + suffix);
    expect(first.text).not.toContain('INATIVO-' + suffix);
    const replay = await request(app.getHttpServer())
      .post('/api/v1/registrations/contact-export')
      .set('authorization', auth)
      .send({ commandId, batch: 1 })
      .expect(201);
    expect(replay.text).toBe(first.text);
    expect(
      await prisma.dataExchangeArtifact.count({
        where: { companyId: tenantId, commandId },
      }),
    ).toBe(1);
    await request(app.getHttpServer())
      .get('/api/v1/registrations/contact-export')
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/registrations/contact-export')
      .set('authorization', auth)
      .send({ commandId: randomUUID(), batch: 0 })
      .expect(400);
  });

  it('mantém endereço e perfil documental no Cadastro e solicita documentos sem conta de acesso', async () => {
    const address = {
      street: 'Rua Teste',
      number: '21',
      complement: 'Sala 2',
      district: 'Centro',
      postalCode: '38400000',
      city: 'Uberlândia',
      state: 'MG',
    };
    const profile = {
      jobTitle: 'Geral',
      maritalStatus: 'single',
      militaryDocumentStatus: 'not-applicable',
      dependents: [
        {
          name: 'Dependente Teste',
          birthDate: '2018-01-10',
          relationship: 'filha',
        },
      ],
    };
    const payload = {
      commandId: randomUUID(),
      type: 'pf',
      firstName: 'Pessoa',
      lastName: 'Documental Teste',
      isTemporary: true,
      temporaryReason: 'Validação isolada da revisão.',
      roleCodes: ['client'],
      phones: [
        {
          number: '5511971234567',
          type: 'mobile',
          isPrimary: true,
          hasWhatsApp: true,
        },
      ],
      address,
      documentProfile: profile,
      serviceInstructions: 'Confirmar local de embarque.',
    };
    const auth = 'Bearer ' + accessToken;
    const created = await request(app.getHttpServer())
      .post('/api/v1/registrations')
      .set('authorization', auth)
      .send(payload);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({
      address,
      documentProfile: profile,
      serviceInstructions: payload.serviceInstructions,
    });
    const replay = await request(app.getHttpServer())
      .post('/api/v1/registrations')
      .set('authorization', auth)
      .send(payload)
      .expect(201);
    expect(replay.body.id).toBe(created.body.id);
    const updated = await request(app.getHttpServer())
      .patch('/api/v1/registrations/' + created.body.id)
      .set('authorization', auth)
      .send({
        ...payload,
        commandId: randomUUID(),
        expectedVersion: created.body.version,
        address: { ...address, number: '22' },
      })
      .expect(200);
    expect(updated.body.address.number).toBe('22');
    const checklists = await request(app.getHttpServer())
      .get('/api/v1/document-management/checklists')
      .set('authorization', auth)
      .expect(200);
    const checklist = (
      checklists.body.data as { id: string; context: string }[]
    ).find((item) => item.context === 'admission')!;
    expect(checklist).toBeTruthy();
    const docPayload = {
      commandId: randomUUID(),
      subjectRegistrationId: created.body.id,
      checklistId: checklist.id,
      context: 'admission',
    };
    const document = await request(app.getHttpServer())
      .post('/api/v1/document-management/requests')
      .set('authorization', auth)
      .send(docPayload)
      .expect(201);
    expect(document.body.request.subject).toMatchObject({
      registrationId: created.body.id,
      userId: null,
    });
    const persisted = await prisma.documentRequest.findUniqueOrThrow({
      where: { id: document.body.request.id },
    });
    expect(persisted.subjectUserId).toBeNull();
    expect(persisted.subjectRegistrationId).toBe(created.body.id);
    await request(app.getHttpServer())
      .get('/api/v1/document-management/requests/' + persisted.id)
      .set('authorization', auth)
      .expect(200);
    await request(app.getHttpServer())
      .get(
        '/api/v1/document-management/registrations/' +
          created.body.id +
          '/export.xlsx',
      )
      .set('authorization', auth)
      .expect(200)
      .expect('Content-Type', /spreadsheetml/);
    await request(app.getHttpServer())
      .get(
        '/api/v1/document-management/registrations/' +
          created.body.id +
          '/files.zip',
      )
      .set('authorization', auth)
      .expect(200)
      .expect('Content-Type', /application\/zip/);
    await prisma.tenantAuditLog.create({
      data: {
        companyId: tenantId,
        actorUserId: (
          await prisma.routingCompany.findUniqueOrThrow({
            where: { id: created.body.id as string },
          })
        ).createdByUserId,
        action: 'REGISTRATION_CREATED',
        targetType: 'registration',
        targetId: created.body.id as string,
        metadata: { commandId: payload.commandId },
      },
    });
    const operations = await request(app.getHttpServer())
      .get('/api/v1/administration/usage/operations')
      .set('authorization', auth)
      .expect(200);
    expect(operations.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: created.body.id,
          module: 'Cadastro',
        }),
      ]),
    );
    const grouped = (
      operations.body.data as { id: string; events: unknown[] }[]
    ).find((operation) => operation.id === payload.commandId);
    expect(grouped?.events).toHaveLength(2);
    const metricActor = await prisma.routingCompany.findUniqueOrThrow({
      where: { id: created.body.id as string },
    });
    const metric = await prisma.apiRequestMetric.create({
      data: {
        companyId: tenantId,
        userId: metricActor.createdByUserId,
        method: 'GET',
        route: '/registrations',
        statusCode: 404,
        durationMs: 12,
      },
    });
    const activity = await request(app.getHttpServer())
      .get('/api/v1/administration/usage/activity?pageSize=100')
      .set('authorization', auth)
      .expect(200);
    expect(activity.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'operation', id: payload.commandId }),
        expect.objectContaining({
          kind: 'request',
          request: expect.objectContaining({ statusCode: expect.any(Number) }),
        }),
      ]),
    );
    const dates = (activity.body.data as { createdAt: string }[]).map(
      (item: { createdAt: string }) => Date.parse(item.createdAt),
    );
    expect(dates).toEqual([...dates].sort((a: number, b: number) => b - a));
    const failedActivity = await request(app.getHttpServer())
      .get('/api/v1/administration/usage/activity?status=client-error')
      .set('authorization', auth)
      .expect(200);
    expect(failedActivity.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'request:' + metric.id,
          kind: 'request',
        }),
      ]),
    );
    expect(
      (
        failedActivity.body.data as {
          kind: string;
          request: { statusCode: number };
        }[]
      ).every(
        (item: { kind: string; request: { statusCode: number } }) =>
          item.kind === 'request' &&
          item.request.statusCode >= 400 &&
          item.request.statusCode < 500,
      ),
    ).toBe(true);
  });

  it('materializa o catálogo de agentes de forma idempotente em banco novo', async () => {
    await app.get(ProductionBootstrapService).execute();

    const [agents, runtimes] = await Promise.all([
      prisma.lumeAgent.findMany({
        where: { companyId: tenantId },
        select: { code: true },
        orderBy: { code: 'asc' },
      }),
      prisma.agentRuntimeConfigVersion.findMany({
        where: { companyId: tenantId },
        select: { agentId: true, credentialRef: true },
      }),
    ]);

    expect(agents.map((agent) => agent.code)).toEqual(
      PLATFORM_AGENT_CATALOG.map((agent) => agent.code).sort(),
    );
    expect(runtimes).toHaveLength(PLATFORM_AGENT_CATALOG.length);
    expect(new Set(runtimes.map((runtime) => runtime.agentId)).size).toBe(
      PLATFORM_AGENT_CATALOG.length,
    );
    expect(new Set(runtimes.map((runtime) => runtime.credentialRef)).size).toBe(
      PLATFORM_AGENT_CATALOG.length,
    );
  });

  it('reutiliza o administrador pelo CPF quando usuário e e-mail configurados mudam', async () => {
    const administrator = await prisma.user.findUniqueOrThrow({
      where: { cpfNormalized: '11144477735' },
      select: { id: true },
    });
    await prisma.user.update({
      where: { id: administrator.id },
      data: {
        username: 'administrador.legado.e2e',
        usernameNormalized: 'administrador.legado.e2e',
        email: 'administrador.legado.e2e@example.test',
        emailNormalized: 'administrador.legado.e2e@example.test',
      },
    });

    const result = await app.get(ProductionBootstrapService).execute();

    expect(result.administratorId).toBe(administrator.id);
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: administrator.id },
        select: {
          usernameNormalized: true,
          emailNormalized: true,
          cpfNormalized: true,
        },
      }),
    ).resolves.toEqual({
      usernameNormalized: 'admin.e2e',
      emailNormalized: 'admin.e2e@example.test',
      cpfNormalized: '11144477735',
    });
  });

  it('aceita corpos JSON normais e rejeita payloads acima de 1 MB', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        identifier: 'admin.e2e',
        password: 'SenhaFinalE2E@2026',
        remember: false,
      })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        identifier: 'x'.repeat(1_048_576),
        password: 'SenhaFinalE2E@2026',
        remember: false,
      })
      .expect(413);
  });

  it('atualiza usuário com versão, comando idempotente e auditoria atômica', async () => {
    const targetKey = randomUUID();
    const target = await prisma.user.create({
      data: {
        companyId: tenantId,
        name: 'Usuário Versionado E2E',
        username: `usuario.versionado.${targetKey.slice(0, 8)}`,
        usernameNormalized: `usuario.versionado.${targetKey.slice(0, 8)}`,
        email: `usuario.versionado.${targetKey}@example.test`,
        emailNormalized: `usuario.versionado.${targetKey}@example.test`,
        passwordHash: 'hash-e2e-sem-uso',
        departments: ['operations'],
        permissionCodes: ['operations:view'],
      },
    });
    const commandId = randomUUID();
    const payload = {
      commandId,
      expectedVersion: target.version,
      name: 'Usuário Atualizado E2E',
    };

    await request(app.getHttpServer())
      .patch(`/api/v1/users/${target.id}`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({ name: 'Sem controle concorrente' })
      .expect(400);

    const [first, concurrentReplay] = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/v1/users/${target.id}`)
        .set('authorization', `Bearer ${accessToken}`)
        .send(payload)
        .expect(200),
      request(app.getHttpServer())
        .patch(`/api/v1/users/${target.id}`)
        .set('authorization', `Bearer ${accessToken}`)
        .send(payload)
        .expect(200),
    ]);
    expect([first.body, concurrentReplay.body]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Usuário Atualizado E2E',
          version: target.version + 1,
          idempotent: false,
        }),
        expect.objectContaining({
          name: 'Usuário Atualizado E2E',
          version: target.version + 1,
          idempotent: true,
        }),
      ]),
    );

    await request(app.getHttpServer())
      .patch(`/api/v1/users/${target.id}`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: target.version,
        email: 'stale.user@example.test',
      })
      .expect(409);

    await expect(
      Promise.all([
        prisma.userUpdateHistory.count({
          where: { companyId: tenantId, commandId },
        }),
        prisma.tenantAuditLog.count({
          where: {
            companyId: tenantId,
            targetType: 'user',
            targetId: target.id,
            action: 'USER_UPDATED',
          },
        }),
      ]),
    ).resolves.toEqual([1, 1]);

    const documentCommandId = randomUUID();
    const documentPayload = {
      commandId: documentCommandId,
      expectedVersion: target.version + 1,
      jobTitle: 'Motorista',
    };
    const synchronizedReplays = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/v1/users/${target.id}`)
        .set('authorization', `Bearer ${accessToken}`)
        .send(documentPayload),
      request(app.getHttpServer())
        .patch(`/api/v1/users/${target.id}`)
        .set('authorization', `Bearer ${accessToken}`)
        .send(documentPayload),
    ]);
    expect(
      synchronizedReplays.map(({ status }) => status),
      JSON.stringify(synchronizedReplays.map(({ body }) => body)),
    ).toEqual([200, 200]);

    const [documentHistory, documentRequest, synchronizationAuditCount] =
      await Promise.all([
        prisma.userUpdateHistory.findUniqueOrThrow({
          where: {
            companyId_commandId: {
              companyId: tenantId,
              commandId: documentCommandId,
            },
          },
          select: {
            documentSyncFingerprint: true,
            documentSynchronizedAt: true,
            documentRequestId: true,
            documentSyncResult: true,
          },
        }),
        prisma.documentRequest.findUniqueOrThrow({
          where: {
            companyId_commandId: {
              companyId: tenantId,
              commandId: documentCommandId,
            },
          },
          select: { id: true, version: true },
        }),
        prisma.tenantAuditLog.count({
          where: {
            companyId: tenantId,
            action: 'document.request.synchronize-profile',
            targetType: 'document-request',
          },
        }),
      ]);
    expect(documentHistory).toMatchObject({
      documentSyncFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      documentSynchronizedAt: expect.any(Date),
      documentRequestId: documentRequest.id,
      documentSyncResult: expect.objectContaining({
        requestId: documentRequest.id,
        createdRequest: true,
      }),
    });
    expect(documentRequest.version).toBe(1);
    expect(synchronizationAuditCount).toBe(1);
  });

  it('persiste inbound antes da outbox e trata webhook duplicado', async () => {
    const payload = webhookPayload(
      'provider-first-contact',
      '5511988881111',
      'Olá',
    );
    const first = await signedWebhook(app, payload).expect(202);
    const duplicate = await signedWebhook(app, payload).expect(202);

    expect(first.body).toMatchObject({
      accepted: true,
      duplicate: false,
      automationAllowed: true,
    });
    expect(duplicate.body).toMatchObject({
      accepted: true,
      duplicate: true,
    });
    conversationId = first.body.conversationId as string;

    const [messages, inbox, outbox] = await Promise.all([
      prisma.whatsAppMessage.findMany({
        where: { companyId: tenantId, conversationId },
      }),
      prisma.integrationInbox.findMany({
        where: { companyId: tenantId, source: 'evolution' },
      }),
      prisma.integrationOutbox.findMany({
        where: {
          companyId: tenantId,
          topic: 'whatsapp.inbound.persisted',
        },
      }),
    ]);
    expect(messages).toHaveLength(1);
    expect(inbox).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].payload).toMatchObject({
      automationAllowed: true,
      canGenerateReply: true,
      canSendReply: true,
      isFirstContact: true,
      conversation: {
        id: conversationId,
        flowStep: 'main-menu',
      },
    });
    expect(messages[0].createdAt.valueOf()).toBeLessThanOrEqual(
      outbox[0].createdAt.valueOf(),
    );

    const conversation = await prisma.whatsAppConversation.findUniqueOrThrow({
      where: { id_companyId: { id: conversationId, companyId: tenantId } },
    });
    expect(conversation).toMatchObject({
      conversationState: 'BOT_ACTIVE',
      flowStep: 'MAIN_MENU',
      requestStatus: 'NOT_STARTED',
      version: 1,
    });
  });

  it('aceita o token estático configurável da Evolution sem header dinâmico', async () => {
    const response = await tokenWebhook(
      app,
      webhookPayload(
        'provider-static-token',
        '5511988882222',
        'Primeiro contato por token',
      ),
    ).expect(202);

    expect(response.body).toMatchObject({
      accepted: true,
      duplicate: false,
      automationAllowed: true,
      isFirstContact: true,
    });
  });

  it('persiste saída do App/Web e assume controle humano sem acionar automação', async () => {
    const phone = '5511988776604';
    const inbound = await signedWebhook(
      app,
      webhookPayload(
        'provider-external-web-inbound',
        phone,
        'Mensagem recebida antes da resposta externa',
      ),
    ).expect(202);
    const externalConversationId = inbound.body.conversationId as string;
    const before = await prisma.whatsAppConversation.findUniqueOrThrow({
      where: {
        id_companyId: { id: externalConversationId, companyId: tenantId },
      },
    });
    const inboundOutboxBefore = await prisma.integrationOutbox.count({
      where: {
        companyId: tenantId,
        topic: {
          in: [
            'whatsapp.inbound.persisted',
            'whatsapp.inbound.human-notification',
          ],
        },
      },
    });
    const base = webhookPayload(
      'provider-external-web',
      phone,
      'Enviada pelo WhatsApp Web',
    );
    const payload = {
      ...base,
      data: {
        ...base.data,
        key: {
          ...base.data.key,
          remoteJid: '123456789012345@lid',
          remoteJidAlt: `${phone}@s.whatsapp.net`,
          participant: '999999999999999@lid',
          fromMe: true,
        },
      },
    };

    const first = await signedWebhook(app, payload).expect(202);
    const duplicate = await signedWebhook(app, payload).expect(202);

    expect(first.body).toMatchObject({
      accepted: true,
      duplicate: false,
      automationAllowed: false,
      canGenerateReply: false,
      canSendReply: false,
      conversationId: externalConversationId,
    });
    expect(duplicate.body).toMatchObject({
      accepted: true,
      duplicate: true,
      conversationId: externalConversationId,
    });

    const [message, after, contacts, conversations, inboundOutboxAfter] =
      await Promise.all([
        prisma.whatsAppMessage.findUniqueOrThrow({
          where: {
            companyId_channelId_providerMessageId: {
              companyId: tenantId,
              channelId,
              providerMessageId: 'provider-external-web',
            },
          },
        }),
        prisma.whatsAppConversation.findUniqueOrThrow({
          where: {
            id_companyId: {
              id: externalConversationId,
              companyId: tenantId,
            },
          },
        }),
        prisma.whatsAppContact.count({
          where: { companyId: tenantId, phoneNormalized: phone },
        }),
        prisma.whatsAppConversation.count({
          where: {
            companyId: tenantId,
            channelId,
            contactId: before.contactId,
          },
        }),
        prisma.integrationOutbox.count({
          where: {
            companyId: tenantId,
            topic: {
              in: [
                'whatsapp.inbound.persisted',
                'whatsapp.inbound.human-notification',
              ],
            },
          },
        }),
      ]);
    expect(message).toMatchObject({
      conversationId: externalConversationId,
      direction: MessageDirection.OUTBOUND,
      deliveryStatus: DeliveryStatus.SENT,
      text: 'Enviada pelo WhatsApp Web',
      recipientPhone: phone,
    });
    expect(after).toMatchObject({
      unreadCount: before.unreadCount,
      version: before.version + 1,
      conversationState: 'SENT_TO_HUMAN',
      flowStep: 'HUMAN_SERVICE',
    });
    expect(contacts).toBe(1);
    expect(conversations).toBe(1);
    expect(inboundOutboxAfter).toBe(inboundOutboxBefore);
  });

  it('não duplica a mensagem local do painel quando chega o eco da Evolution', async () => {
    const phone = '5511988776605';
    const inbound = await signedWebhook(
      app,
      webhookPayload(
        'provider-panel-echo-inbound',
        phone,
        'Conversa usada para testar o eco do painel',
      ),
    ).expect(202);
    const panelConversationId = inbound.body.conversationId as string;
    const conversation = await prisma.whatsAppConversation.findUniqueOrThrow({
      where: {
        id_companyId: { id: panelConversationId, companyId: tenantId },
      },
    });
    const providerMessageId = 'provider-panel-echo-outbound';
    const localPanelMessage = await prisma.whatsAppMessage.create({
      data: {
        companyId: tenantId,
        conversationId: panelConversationId,
        channelId,
        contactId: conversation.contactId,
        providerMessageId,
        direction: MessageDirection.OUTBOUND,
        deliveryStatus: DeliveryStatus.SENT,
        kind: MessageKind.TEXT,
        text: 'Mensagem enviada pelo painel',
        recipientPhone: phone,
        correlationId: `e2e-panel:${randomUUID()}`,
        occurredAt: new Date(),
      },
    });
    const echo = webhookPayload(
      providerMessageId,
      phone,
      'Mensagem enviada pelo painel',
    );
    echo.data.key.fromMe = true;

    await signedWebhook(app, echo)
      .expect(202)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          accepted: true,
          duplicate: true,
          messageId: localPanelMessage.id,
          conversationId: panelConversationId,
        }),
      );

    expect(
      await prisma.whatsAppMessage.count({
        where: { companyId: tenantId, channelId, providerMessageId },
      }),
    ).toBe(1);
  });

  it('serializa duas primeiras mensagens concorrentes em uma conversa aberta', async () => {
    const [first, second] = await Promise.all([
      signedWebhook(
        app,
        webhookPayload(
          'provider-race-first',
          '5511988883333',
          'Primeira mensagem',
        ),
      ),
      signedWebhook(
        app,
        webhookPayload(
          'provider-race-second',
          '5511988883333',
          'Segunda mensagem',
        ),
      ),
    ]);

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(first.body.conversationId).toBe(second.body.conversationId);
    expect(
      [first.body.isFirstContact, second.body.isFirstContact].sort(),
    ).toEqual([false, true]);
    const contact = await prisma.whatsAppContact.findUniqueOrThrow({
      where: {
        companyId_phoneNormalized: {
          companyId: tenantId,
          phoneNormalized: '5511988883333',
        },
      },
    });
    expect(
      await prisma.whatsAppConversation.count({
        where: {
          companyId: tenantId,
          channelId,
          contactId: contact.id,
          closedAt: null,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.whatsAppMessage.count({
        where: {
          companyId: tenantId,
          conversationId: first.body.conversationId as string,
        },
      }),
    ).toBe(2);
  });

  it('cria outbound pending antes do resultado Evolution', async () => {
    const commandId = randomUUID();
    const outboundBody = {
      commandId,
      expectedVersion: 1,
      purpose: 'main-menu' as const,
      kind: 'text' as const,
      text: 'Mensagem automática',
    };
    const response = {
      body: await createAutomaticOutbound({
        ...outboundBody,
        conversationId,
      }),
    };

    expect(response.body).toMatchObject({
      deliveryStatus: 'pending',
      providerMessageId: null,
    });
    expect(response.body.attempts[0]).toMatchObject({ status: 'pending' });
    const persisted = await prisma.whatsAppMessage.findUniqueOrThrow({
      where: {
        id_companyId: { id: response.body.id, companyId: tenantId },
      },
    });
    expect(persisted.deliveryStatus).toBe('PENDING');
    expect(persisted.providerMessageId).toBeNull();

    const claim = {
      body: await claimEvolution({
        messageId: response.body.id,
        commandId: randomUUID(),
        attemptId: response.body.attempts[0].id,
      }),
    };
    expect(claim.body).toMatchObject({
      shouldSend: true,
      state: 'leased',
    });
    await recordEvolution({
      messageId: response.body.id,
      commandId: randomUUID(),
      attemptId: response.body.attempts[0].id,
      status: 'sent',
      providerMessageId: 'evolution-main-menu',
    });
    const replay = {
      body: await createAutomaticOutbound({
        ...outboundBody,
        conversationId,
      }),
    };
    expect(replay.body).toMatchObject({
      id: response.body.id,
      deliveryStatus: 'sent',
      providerMessageId: 'evolution-main-menu',
      idempotent: true,
      attempts: [
        {
          id: response.body.attempts[0].id,
          status: 'succeeded',
          dispatchState: 'succeeded',
          providerMessageId: 'evolution-main-menu',
        },
      ],
    });
    expect(
      (
        await prisma.whatsAppConversation.findUniqueOrThrow({
          where: { id_companyId: { id: conversationId, companyId: tenantId } },
        })
      ).mainMenuPresentedAt,
    ).toBeInstanceOf(Date);
  });

  it('responde inbound não textual com texto fixo sem reabrir a automação humana', async () => {
    const unsupportedPayload = webhookPayload(
      `provider-unsupported-${randomUUID()}`,
      '5511988883311',
      'placeholder',
    );
    unsupportedPayload.data.message = {
      imageMessage: {
        mimetype: 'image/jpeg',
        fileLength: 128,
        url: 'https://evolution.example.test/media/image.jpg',
      },
    } as unknown as typeof unsupportedPayload.data.message;
    const inbound = await signedMediaWebhook(app, unsupportedPayload);
    expect(inbound.status, JSON.stringify(inbound.body)).toBe(202);
    const unsupportedConversationId = inbound.body.conversationId as string;
    const inboundMessageId = inbound.body.messageId as string;

    await expect(
      createAutomaticOutbound({
        conversationId: unsupportedConversationId,
        commandId: randomUUID(),
        expectedVersion: 1,
        purpose: 'unsupported-message-kind',
        inReplyToMessageId: inboundMessageId,
        kind: 'text',
        text: 'Não consigo processar a imagem.',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const reply = {
      body: await createAutomaticOutbound({
        conversationId: unsupportedConversationId,
        commandId: randomUUID(),
        expectedVersion: 1,
        purpose: 'unsupported-message-kind',
        inReplyToMessageId: inboundMessageId,
        kind: 'text',
        text: UNSUPPORTED_MESSAGE_KIND_REPLY_TEXT,
      }),
    };
    expect(reply.body).toMatchObject({
      automationPurpose: 'unsupported-message-kind',
      deliveryStatus: 'pending',
      kind: 'text',
      text: UNSUPPORTED_MESSAGE_KIND_REPLY_TEXT,
    });

    const forwarded = {
      body: await transitionSystem({
        conversationId: unsupportedConversationId,
        commandId: randomUUID(),
        expectedVersion: 1,
        name: 'forward',
        targetDepartment: 'commercial',
      }),
    };
    expect(forwarded.body).toMatchObject({
      conversationState: 'sent-to-human',
      flowStep: 'human-service',
      version: 2,
    });

    await expect(
      createAutomaticOutbound({
        conversationId: unsupportedConversationId,
        commandId: randomUUID(),
        expectedVersion: 2,
        purpose: 'main-menu',
        kind: 'text',
        text: UNSUPPORTED_MESSAGE_KIND_REPLY_TEXT,
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'A sessão não permite geração ou envio de resposta automática.',
      details: { controlMode: 'human', status: 'waiting_human' },
    });

    expect(
      await prisma.whatsAppConversation.findUniqueOrThrow({
        where: {
          id_companyId: {
            id: unsupportedConversationId,
            companyId: tenantId,
          },
        },
      }),
    ).toMatchObject({
      conversationState: 'SENT_TO_HUMAN',
      flowStep: 'HUMAN_SERVICE',
      version: 2,
    });
  });

  it.each([
    ['imageMessage', 'image', 'image/jpeg', 'image/jpeg', 'imagem.jpg'],
    ['videoMessage', 'video', 'video/mp4', 'video/mp4', 'video.mp4'],
    [
      'audioMessage',
      'audio',
      'audio/ogg; codecs=opus',
      'audio/ogg',
      'audio.ogg',
    ],
    [
      'documentMessage',
      'document',
      'application/pdf',
      'application/pdf',
      'documento.pdf',
    ],
    ['stickerMessage', 'sticker', 'image/webp', 'image/webp', 'figurinha.webp'],
  ] as const)(
    'persiste %s como mídia %s sem transformar o conteúdo em texto para a IA',
    async (
      providerKind,
      expectedKind,
      providerMimeType,
      mimeType,
      fileName,
    ) => {
      const providerMessageId = `provider-media-${expectedKind}-${randomUUID()}`;
      const expectedStoredSize = Buffer.byteLength(
        `retained:${providerMessageId}`,
      );
      const mediaPayload = webhookPayload(
        providerMessageId,
        `5511988${Math.floor(100000 + Math.random() * 899999)}`,
        'placeholder',
      );
      mediaPayload.data.message = {
        [providerKind]: {
          mimetype: providerMimeType,
          fileLength: { low: 256, high: 0, unsigned: true },
          fileName,
          url: `https://evolution.example.test/media/${fileName}`,
        },
      } as unknown as typeof mediaPayload.data.message;

      const inbound = await signedMediaWebhook(app, mediaPayload);
      expect(inbound.status, JSON.stringify(inbound.body)).toBe(202);
      const persisted = await prisma.whatsAppMessage.findUniqueOrThrow({
        where: {
          companyId_channelId_providerMessageId: {
            companyId: tenantId,
            channelId,
            providerMessageId,
          },
        },
      });

      expect(inbound.body).toMatchObject({
        messageId: persisted.id,
        automationAllowed: true,
        mediaRetention: 'stored',
      });
      expect(persisted.kind.toLowerCase()).toBe(expectedKind);
      expect(persisted.text).toBeNull();
      expect(persisted.media).toMatchObject({
        mimeType,
        size: expectedStoredSize,
        fileName,
      });
      expect(persisted.media).not.toHaveProperty('url');
      expect(persisted).toMatchObject({
        mediaStorageKey: expect.any(String),
        mediaMimeType: mimeType,
        mediaSizeBytes: expectedStoredSize,
        mediaOriginalName: fileName,
        mediaSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        mediaStoredAt: expect.any(Date),
      });

      const durableContent = await request(app.getHttpServer())
        .get(
          `/api/v1/whatsapp/conversations/${inbound.body.conversationId}/messages/${persisted.id}/content`,
        )
        .set('authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(durableContent.headers['content-type']).toContain(mimeType);
      expect(Buffer.from(durableContent.body as Buffer).toString('utf8')).toBe(
        `retained:${providerMessageId}`,
      );

      const duplicate = await signedWebhook(app, mediaPayload).expect(202);
      expect(duplicate.body).toMatchObject({
        duplicate: true,
        mediaRetention: 'already-stored',
        messageId: persisted.id,
      });

      const history = await request(app.getHttpServer())
        .get(
          `/api/v1/whatsapp/conversations/${inbound.body.conversationId}/messages`,
        )
        .set('authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(history.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: persisted.id,
            kind: expectedKind,
            text: null,
            media: expect.objectContaining({
              mimeType,
              size: expectedStoredSize,
              fileName,
            }),
          }),
        ]),
      );
    },
  );

  it('retém mídia enviada externamente e a exibe como outbound no histórico', async () => {
    const providerMessageId = `provider-external-media-${randomUUID()}`;
    const mediaPayload = webhookPayload(
      providerMessageId,
      '5511988776603',
      'placeholder',
    );
    mediaPayload.data.key.fromMe = true;
    mediaPayload.data.message = {
      imageMessage: {
        mimetype: 'image/jpeg',
        fileLength: 256,
        fileName: 'imagem-enviada.jpg',
      },
    } as unknown as typeof mediaPayload.data.message;

    const outbound = await signedMediaWebhook(app, mediaPayload);
    expect(outbound.status, JSON.stringify(outbound.body)).toBe(202);
    expect(outbound.body).toMatchObject({
      accepted: true,
      duplicate: false,
      automationAllowed: false,
      mediaRetention: 'stored',
    });

    const persisted = await prisma.whatsAppMessage.findUniqueOrThrow({
      where: {
        companyId_channelId_providerMessageId: {
          companyId: tenantId,
          channelId,
          providerMessageId,
        },
      },
    });
    expect(persisted).toMatchObject({
      direction: MessageDirection.OUTBOUND,
      deliveryStatus: DeliveryStatus.SENT,
      kind: MessageKind.IMAGE,
      mediaStorageKey: expect.any(String),
      mediaStoredAt: expect.any(Date),
    });

    const history = await request(app.getHttpServer())
      .get(
        `/api/v1/whatsapp/conversations/${outbound.body.conversationId}/messages`,
      )
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(history.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: persisted.id,
          direction: 'outbound',
          kind: 'image',
        }),
      ]),
    );
  });

  it('reprocessa uma falha transitória de retenção sem duplicar mensagem ou evento', async () => {
    const providerMessageId = `provider-media-retry-${randomUUID()}`;
    const mediaPayload = webhookPayload(
      providerMessageId,
      '5511988776602',
      'placeholder',
    );
    mediaPayload.data.message = {
      imageMessage: {
        mimetype: 'image/jpeg',
        fileLength: 128,
        fileName: 'imagem-reprocessada.jpg',
        url: 'https://evolution.example.test/media/imagem-reprocessada.jpg',
      },
    } as unknown as typeof mediaPayload.data.message;

    const unavailableFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 503 }));
    try {
      await signedWebhook(app, mediaPayload)
        .expect(503)
        .expect(({ body }) =>
          expect(body).toMatchObject({
            code: 'EXTERNAL_SERVICE_UNAVAILABLE',
          }),
        );
    } finally {
      unavailableFetch.mockRestore();
    }

    const retried = await signedMediaWebhook(app, mediaPayload);
    expect(retried.status, JSON.stringify(retried.body)).toBe(202);
    expect(retried.body).toMatchObject({
      duplicate: true,
      mediaRetention: 'stored',
    });

    const messages = await prisma.whatsAppMessage.findMany({
      where: { companyId: tenantId, channelId, providerMessageId },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      mediaStorageKey: expect.any(String),
      mediaStoredAt: expect.any(Date),
    });
    expect(
      await prisma.integrationInbox.count({
        where: {
          companyId: tenantId,
          source: 'evolution',
          externalEventId: providerMessageId,
        },
      }),
    ).toBe(1);
  });

  it.each([
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage',
  ] as const)('persiste mídia encapsulada em %s', async (wrapperKind) => {
    const providerMessageId = `provider-wrapped-${wrapperKind}-${randomUUID()}`;
    const expectedStoredSize = Buffer.byteLength(
      `retained:${providerMessageId}`,
    );
    const mediaPayload = webhookPayload(
      providerMessageId,
      `5511977${Math.floor(100000 + Math.random() * 899999)}`,
      'placeholder',
    );
    mediaPayload.data.message = {
      [wrapperKind]: {
        message: {
          imageMessage: {
            mimetype: 'image/jpeg',
            fileLength: { low: 512, high: 0, unsigned: true },
            fileName: 'imagem-encapsulada.jpg',
            url: 'https://evolution.example.test/media/imagem-encapsulada.jpg',
          },
        },
      },
    } as unknown as typeof mediaPayload.data.message;

    const inbound = await signedMediaWebhook(app, mediaPayload);
    expect(inbound.status, JSON.stringify(inbound.body)).toBe(202);
    const persisted = await prisma.whatsAppMessage.findUniqueOrThrow({
      where: {
        companyId_channelId_providerMessageId: {
          companyId: tenantId,
          channelId,
          providerMessageId,
        },
      },
    });

    expect(persisted.kind.toLowerCase()).toBe('image');
    expect(persisted.media).toMatchObject({
      mimeType: 'image/jpeg',
      size: expectedStoredSize,
      fileName: 'imagem-encapsulada.jpg',
    });
  });

  it('reabre a conversa canônica e agenda o menu inicial quando a primeira mensagem após o encerramento é mídia', async () => {
    const phone = '5511988776601';
    const first = await signedWebhook(
      app,
      webhookPayload(`provider-before-close-${randomUUID()}`, phone, 'Olá'),
    ).expect(202);
    const canonicalConversationId = first.body.conversationId as string;

    const closed = await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${canonicalConversationId}/actions/close`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: 1,
        reason: 'Encerramento de teste',
      })
      .expect(201);
    expect(closed.body).toMatchObject({
      conversationState: 'closed',
      flowStep: 'closed',
    });

    const mediaPayload = webhookPayload(
      `provider-reopen-media-${randomUUID()}`,
      phone,
      'placeholder',
    );
    mediaPayload.data.message = {
      imageMessage: {
        mimetype: 'image/jpeg',
        fileLength: 128,
        fileName: 'primeiro-contato.jpg',
        url: 'https://evolution.example.test/media/primeiro-contato.jpg',
      },
    } as unknown as typeof mediaPayload.data.message;

    const reopened = await signedMediaWebhook(app, mediaPayload);
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(202);
    expect(reopened.body).toMatchObject({
      conversationId: canonicalConversationId,
      isFirstContact: false,
      reopenedAfterClosure: true,
      mediaRetention: 'stored',
    });

    const conversation = await prisma.whatsAppConversation.findUniqueOrThrow({
      where: {
        id_companyId: {
          id: canonicalConversationId,
          companyId: tenantId,
        },
      },
    });
    expect(conversation).toMatchObject({
      conversationState: 'BOT_ACTIVE',
      flowStep: 'MAIN_MENU',
      closedAt: null,
    });
    expect(
      await prisma.whatsAppConversation.count({
        where: { companyId: tenantId, contactId: conversation.contactId },
      }),
    ).toBe(1);
    expect(
      await prisma.integrationOutbox.findFirstOrThrow({
        where: {
          companyId: tenantId,
          topic: 'whatsapp.inbound.persisted',
          correlationId: (
            await prisma.whatsAppMessage.findUniqueOrThrow({
              where: {
                id_companyId_conversationId: {
                  id: reopened.body.messageId as string,
                  companyId: tenantId,
                  conversationId: canonicalConversationId,
                },
              },
              select: { correlationId: true },
            })
          ).correlationId,
        },
      }),
    ).toMatchObject({
      payload: expect.objectContaining({
        reopenedAfterClosure: true,
        isFirstContact: false,
        message: expect.objectContaining({ kind: 'image', text: null }),
      }),
    });
  });

  it('persiste a coleta departamental, notifica o telefone interno e mantém a mensagem fora do painel', async () => {
    const inbound = await signedWebhook(
      app,
      webhookPayload(
        'provider-department-contact',
        '5511988887777',
        'Quero falar com a manutenção',
      ),
    ).expect(202);
    const departmentConversationId = inbound.body.conversationId as string;

    const collecting = {
      body: await transitionSystem({
        conversationId: departmentConversationId,
        commandId: randomUUID(),
        expectedVersion: 1,
        name: 'start-department-contact',
        targetDepartment: 'maintenance',
        metadata: { departmentOption: '7' },
      }),
    };
    expect(collecting.body).toMatchObject({
      department: 'maintenance',
      conversationState: 'bot-active',
      flowStep: 'main-menu',
      departmentContactOption: '7',
      version: 2,
    });

    const collectedName = await signedWebhook(
      app,
      webhookPayload(
        'provider-department-contact-name',
        '5511988887777',
        'Taiane',
      ),
    ).expect(202);
    const collectedReason = await signedWebhook(
      app,
      webhookPayload(
        'provider-department-contact-reason',
        '5511988887777',
        'Preciso de apoio com um veículo parado',
      ),
    ).expect(202);

    const [nameOutbox, reasonOutbox] = await Promise.all([
      prisma.integrationOutbox.findFirstOrThrow({
        where: {
          companyId: tenantId,
          topic: 'whatsapp.inbound.persisted',
          payload: {
            path: ['messageId'],
            equals: collectedName.body.messageId,
          },
        },
      }),
      prisma.integrationOutbox.findFirstOrThrow({
        where: {
          companyId: tenantId,
          topic: 'whatsapp.inbound.persisted',
          payload: {
            path: ['messageId'],
            equals: collectedReason.body.messageId,
          },
        },
      }),
    ]);

    const durableBatch = {
      body: automationBody(
        await whatsappRepository.getAutomationBatch(
          tenantId,
          departmentConversationId,
          nameOutbox.correlationId,
          120,
        ),
      ),
    };
    expect(durableBatch.body).toMatchObject({
      conversation: {
        id: departmentConversationId,
        departmentContactOption: '7',
      },
      batch: {
        sourceEventId: nameOutbox.correlationId,
        messages: [
          {
            messageId: collectedName.body.messageId,
            sourceEventId: nameOutbox.correlationId,
            kind: 'text',
            text: 'Taiane',
          },
          {
            messageId: collectedReason.body.messageId,
            sourceEventId: reasonOutbox.correlationId,
            kind: 'text',
            text: 'Preciso de apoio com um veículo parado',
          },
        ],
      },
    });
    expect(reasonOutbox.payload).toMatchObject({
      conversation: { departmentContactOption: '7' },
    });

    const notification = {
      body: await createAutomaticOutbound({
        conversationId: departmentConversationId,
        commandId: randomUUID(),
        expectedVersion: 2,
        purpose: 'department-notification',
        recipientPhone: '5534998385144',
        kind: 'text',
        text: 'Telefone do cliente: 5511988887777\nNome e motivo informados: Cliente E2E - manutenção',
      }),
    };
    expect(notification.body).toMatchObject({
      deliveryStatus: 'pending',
      automationPurpose: 'department-notification',
      recipientPhone: '5534998385144',
    });

    const claim = {
      body: await claimEvolution({
        messageId: notification.body.id,
        commandId: randomUUID(),
        attemptId: notification.body.attempts[0].id,
      }),
    };
    expect(claim.body).toMatchObject({ shouldSend: true });
    await recordEvolution({
      messageId: notification.body.id,
      commandId: randomUUID(),
      attemptId: notification.body.attempts[0].id,
      status: 'sent',
      providerMessageId: 'evolution-department-notification',
    });

    const persisted = await prisma.whatsAppConversation.findUniqueOrThrow({
      where: {
        id_companyId: {
          id: departmentConversationId,
          companyId: tenantId,
        },
      },
    });
    expect(persisted.lastOutboundAt).toBeNull();

    const panelMessages = await request(app.getHttpServer())
      .get(
        `/api/v1/whatsapp/conversations/${departmentConversationId}/messages`,
      )
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(panelMessages.body.meta.total).toBe(3);
    expect(panelMessages.body.data).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: notification.body.id }),
      ]),
    );

    await expect(
      createAutomaticOutbound({
        conversationId: departmentConversationId,
        commandId: randomUUID(),
        expectedVersion: 2,
        purpose: 'main-menu',
        recipientPhone: '5534998385144',
        kind: 'text',
        text: 'Não deve aceitar destinatário alternativo',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const completed = {
      body: await transitionSystem({
        conversationId: departmentConversationId,
        commandId: randomUUID(),
        expectedVersion: 2,
        name: 'return-to-main-menu',
        targetDepartment: 'maintenance',
        metadata: {
          departmentOption: '7',
          reason: 'department-contact-forwarded',
        },
      }),
    };
    expect(completed.body).toMatchObject({
      department: 'maintenance',
      conversationState: 'bot-active',
      flowStep: 'main-menu',
      departmentContactOption: null,
      unreadCount: 0,
    });
    const closureMessage = await prisma.whatsAppMessage.findFirstOrThrow({
      where: {
        companyId: tenantId,
        conversationId: departmentConversationId,
        automationPurpose: 'department-contact-finalization',
      },
    });
    expect(closureMessage).toMatchObject({
      direction: 'OUTBOUND',
      deliveryStatus: 'PENDING',
      automationPurpose: 'department-contact-finalization',
      text: 'Sua solicitação foi enviada para o departamento Manutenção. O responsável entrará em contato em breve.',
    });
    const finalizationOutbox = await prisma.integrationOutbox.findFirstOrThrow({
      where: {
        companyId: tenantId,
        topic: 'whatsapp.outbound.requested',
        aggregateId: departmentConversationId,
        payload: { path: ['messageId'], equals: closureMessage.id },
      },
    });
    expect(finalizationOutbox.payload).toMatchObject({
      messageId: closureMessage.id,
      automatic: true,
      canGenerateReply: false,
      canSendReply: true,
    });
  });

  it('mantém filas distintas por departamento, estado e status exclusivamente comercial', async () => {
    const registeredDepartments = await prisma.tenantDepartment.findMany({
      where: { companyId: tenantId },
      select: { code: true },
    });
    expect(registeredDepartments.map(({ code }) => code).sort()).toEqual(
      [
        'CLIENT_COMPANY',
        'COMMERCIAL',
        'CONTROLLING',
        'DIRECTORATE',
        'FINANCIAL',
        'HUMAN_RESOURCES',
        'INFORMATION_TECHNOLOGY',
        'MAINTENANCE',
        'MANAGEMENT',
        'MONITORING',
        'OPERATIONS',
        'PERSONNEL_DEPARTMENT',
        'PURCHASING',
      ].sort(),
    );

    const queueFixtures = [
      {
        phone: '5511910000001',
        department: 'CONTROLLING',
        requestStatus: 'NOT_STARTED',
      },
      {
        phone: '5511910000002',
        department: 'FINANCIAL',
        requestStatus: 'NOT_STARTED',
      },
      {
        phone: '5511910000003',
        department: 'MANAGEMENT',
        requestStatus: 'NOT_STARTED',
      },
      {
        phone: '5511910000004',
        department: 'OPERATIONS',
        requestStatus: 'NOT_STARTED',
      },
      {
        phone: '5511910000005',
        department: 'COMMERCIAL',
        requestStatus: 'UNDER_REVIEW',
      },
    ] as const;

    const queueConversationIds = new Map<string, string>();
    for (const fixture of queueFixtures) {
      const contact = await prisma.whatsAppContact.create({
        data: {
          companyId: tenantId,
          phoneNormalized: fixture.phone,
          phoneDisplay: formatWhatsAppPhone(fixture.phone),
          displayName: fixture.department,
        },
      });
      const conversation = await prisma.whatsAppConversation.create({
        data: {
          companyId: tenantId,
          channelId,
          contactId: contact.id,
          department: fixture.department,
          conversationState: 'SENT_TO_HUMAN',
          flowStep: 'HUMAN_SERVICE',
          requestStatus: fixture.requestStatus,
        },
      });
      queueConversationIds.set(fixture.department, conversation.id);
    }

    for (const department of [
      'controlling',
      'financial',
      'management',
      'operations',
    ]) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/whatsapp/conversations')
        .query({ department, control: 'paused', pageSize: 100 })
        .set('authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        id: queueConversationIds.get(department.toUpperCase()),
        department,
        conversationState: 'sent-to-human',
      });
      expect(response.body.meta).toMatchObject({
        page: 1,
        pageSize: 100,
        total: 1,
        totalPages: 1,
      });
      expect(response.body.summary).toMatchObject({
        total: 1,
        botActive: 0,
        attendantActive: 0,
        automationPaused: 1,
        unreadMessages: 0,
        unreadConversations: 0,
      });
    }

    const commercialStatus = await request(app.getHttpServer())
      .get('/api/v1/whatsapp/conversations')
      .query({ requestStatus: 'under-review', pageSize: 100 })
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(commercialStatus.body.data).toHaveLength(1);
    expect(commercialStatus.body.data[0]).toMatchObject({
      id: queueConversationIds.get('COMMERCIAL'),
      department: 'commercial',
      requestStatus: 'under-review',
    });

    await request(app.getHttpServer())
      .get('/api/v1/whatsapp/conversations')
      .query({
        department: 'maintenance',
        requestStatus: 'under-review',
      })
      .set('authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('aplica matriz, commandId idempotente e conflito expectedVersion', async () => {
    await expect(
      transitionSystem({
        conversationId,
        commandId: randomUUID(),
        expectedVersion: 1,
        name: 'take-over',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'O ator system não pode executar a transição take-over.',
    });

    const commandId = randomUUID();
    selectedCommandId = commandId;
    const selected = await transitionSystem({
      conversationId,
      commandId,
      expectedVersion: 1,
      name: 'select-commercial',
    });
    expect(selected).toMatchObject({
      flowStep: 'commercial-menu',
      version: 2,
      idempotent: false,
    });

    const duplicate = await transitionSystem({
      conversationId,
      commandId,
      expectedVersion: 1,
      name: 'select-commercial',
    });
    expect(duplicate).toMatchObject({ version: 2, idempotent: true });
    expect(
      await prisma.whatsAppConversationTransition.count({
        where: { companyId: tenantId, commandId },
      }),
    ).toBe(1);
    await expect(
      transitionSystem({
        conversationId,
        commandId,
        expectedVersion: 1,
        name: 'start-quote',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await expect(
      transitionSystem({
        conversationId,
        commandId: randomUUID(),
        expectedVersion: 1,
        name: 'start-quote',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { currentVersion: 2 },
    });
  });

  it('preserva dados na correção e confirmação nunca fecha a conversa', async () => {
    const transition = async (
      name: string,
      expectedVersion: number,
    ): Promise<Record<string, unknown>> =>
      transitionSystem({
        conversationId,
        commandId: randomUUID(),
        expectedVersion,
        name,
      });

    const collecting = await transition('start-quote', 2);
    const oldReplay = await transitionSystem({
      conversationId,
      commandId: selectedCommandId,
      expectedVersion: 1,
      name: 'select-commercial',
    });
    expect(oldReplay).toMatchObject({
      version: 2,
      flowStep: 'commercial-menu',
      idempotent: true,
    });
    quoteRequestId = (collecting.currentQuoteRequest as Record<string, string>)
      .id;
    const departureAt = parseBusinessDateTime(
      '2026-08-01T10:00:00.000Z',
      'departureAt',
    );
    await patchQuoteFromAutomation(quoteRequestId, {
      commandId: randomUUID(),
      expectedVersion: 1,
      contactName: 'Cliente E2E',
      serviceType: 'Fretamento eventual',
      origin: 'São Paulo',
      destination: 'Campinas',
      departureDate: dateOnlyFromDateTime(departureAt),
      departureAt,
      passengerCount: 12,
    });
    await transition('present-quote-summary', 3);
    const awaitingReply = await signedWebhook(
      app,
      webhookPayload(
        'provider-summary-correction',
        '5511988881111',
        'Quero corrigir',
      ),
    ).expect(202);
    expect(awaitingReply.body).toMatchObject({
      automationAllowed: true,
      version: 5,
    });
    const waitingState = await prisma.whatsAppConversation.findUniqueOrThrow({
      where: { id_companyId: { id: conversationId, companyId: tenantId } },
    });
    expect(waitingState).toMatchObject({
      conversationState: 'BOT_ACTIVE',
      flowStep: 'QUOTE_SUMMARY_CONFIRMATION',
      requestStatus: 'WAITING_FOR_CUSTOMER',
      version: 5,
    });

    await transition('correct-quote', 5);

    const preserved = await prisma.quoteRequest.findUniqueOrThrow({
      where: {
        id_companyId: { id: quoteRequestId, companyId: tenantId },
      },
    });
    expect(preserved).toMatchObject({
      origin: 'São Paulo',
      destination: 'Campinas',
      passengerCount: 12,
      status: 'COLLECTING_INFORMATION',
    });

    await transition('present-quote-summary', 6);
    const confirmed = await transition('confirm-quote', 7);
    expect(confirmed).toMatchObject({
      conversationState: 'bot-active',
      flowStep: 'commercial-follow-up-menu',
      requestStatus: 'under-review',
      closedAt: null,
    });
    expect(confirmed.conversationState).not.toBe('closed');
    const persistedQuote = await prisma.quoteRequest.findUniqueOrThrow({
      where: {
        id_companyId: { id: quoteRequestId, companyId: tenantId },
      },
    });
    expect(persistedQuote.confirmedAt).toBeInstanceOf(Date);
    expect(persistedQuote.confirmedVersion).toBe(persistedQuote.version);
    expect(persistedQuote.confirmedSummary).toMatchObject({
      origin: 'São Paulo',
      destination: 'Campinas',
      passengerCount: 12,
    });
    const pendingAfterConfirmation = await request(app.getHttpServer())
      .get('/api/v1/whatsapp/quote-proposals?page=1&pageSize=100')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(pendingAfterConfirmation.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: quoteRequestId,
          quoteRequest: expect.objectContaining({
            status: 'under-review',
          }),
          conversation: expect.objectContaining({
            id: conversationId,
            conversationState: 'bot-active',
            flowStep: 'commercial-follow-up-menu',
          }),
        }),
      ]),
    );
    await expect(
      patchQuoteFromAutomation(quoteRequestId, {
        commandId: randomUUID(),
        expectedVersion: persistedQuote.version,
        origin: 'Origem indevidamente alterada',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      transitionSystem({
        conversationId,
        commandId: randomUUID(),
        expectedVersion: 8,
        name: 'start-quote',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('mantém o bot ativo em análise e preserva o histórico após take-over', async () => {
    const phone = '5511988881199';
    const contact = await prisma.whatsAppContact.create({
      data: {
        companyId: tenantId,
        phoneNormalized: phone,
        phoneDisplay: formatWhatsAppPhone(phone),
        displayName: 'Cliente análise e take-over',
      },
    });
    const analysisConversation = await prisma.whatsAppConversation.create({
      data: {
        companyId: tenantId,
        channelId,
        contactId: contact.id,
        department: 'COMMERCIAL',
        conversationState: 'BOT_ACTIVE',
        flowStep: 'COMMERCIAL_FOLLOW_UP_MENU',
        requestStatus: 'UNDER_REVIEW',
        version: 8,
      },
    });
    const conversationId = analysisConversation.id;
    await prisma.quoteRequest.create({
      data: {
        companyId: tenantId,
        conversationId,
        sequence: 1,
        status: 'UNDER_REVIEW',
        confirmedAt: new Date(),
        confirmedVersion: 1,
      },
    });
    const beforeAutomatedInbounds =
      await prisma.whatsAppConversation.findUniqueOrThrow({
        where: { id_companyId: { id: conversationId, companyId: tenantId } },
      });
    expect(beforeAutomatedInbounds).toMatchObject({
      conversationState: 'BOT_ACTIVE',
      flowStep: 'COMMERCIAL_FOLLOW_UP_MENU',
      version: 8,
    });
    const automatedInbounds = [
      {
        providerMessageId: 'provider-complementary-contact-1',
        text: 'Complemento: levaremos bagagens.',
      },
      {
        providerMessageId: 'provider-complementary-contact-2',
        text: 'Serão duas malas grandes.',
      },
      {
        providerMessageId: 'provider-complementary-contact-3',
        text: 'Precisamos embarcar pelo portão lateral.',
      },
    ];
    const automatedResponses = await Promise.all(
      automatedInbounds.map(({ providerMessageId, text }) =>
        signedWebhook(app, webhookPayload(providerMessageId, phone, text)),
      ),
    );
    for (const response of automatedResponses) {
      expect(response.status).toBe(202);
      expect(response.body).toMatchObject({
        accepted: true,
        duplicate: false,
        automationAllowed: true,
      });
    }
    expect(
      await prisma.whatsAppConversation.findUniqueOrThrow({
        where: { id_companyId: { id: conversationId, companyId: tenantId } },
      }),
    ).toMatchObject({
      conversationState: 'BOT_ACTIVE',
      flowStep: 'COMMERCIAL_FOLLOW_UP_MENU',
      version: 8,
      unreadCount:
        beforeAutomatedInbounds.unreadCount + automatedInbounds.length,
    });

    await prisma.whatsAppConversation.update({
      where: { id_companyId: { id: conversationId, companyId: tenantId } },
      data: { contextualFollowUpAt: new Date(Date.now() - 1_000) },
    });
    const contextual = await signedWebhook(
      app,
      webhookPayload('provider-contextual-contact', phone, 'E o orçamento?'),
    ).expect(202);
    expect(contextual.body).toMatchObject({
      automationAllowed: true,
      version: 9,
    });

    const state = await request(app.getHttpServer())
      .get(`/api/v1/whatsapp/conversations/${conversationId}`)
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(state.body).toMatchObject({
      conversationState: 'bot-active',
      flowStep: 'commercial-follow-up-menu',
      requestStatus: 'under-review',
      version: 9,
    });

    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${conversationId}/actions/take-over`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({ commandId: randomUUID(), expectedVersion: 9 })
      .expect(201);

    const humanMessage = await request(app.getHttpServer())
      .post(`/api/v1/whatsapp/conversations/${conversationId}/messages`)
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({
        commandId: randomUUID(),
        idempotencyKey: randomUUID(),
        expectedVersion: 10,
        text: 'Recebemos sua solicitação e vamos verificar.',
      })
      .expect(201);
    expect(humanMessage.body).toMatchObject({
      idempotent: false,
      message: {
        deliveryStatus: 'pending',
        direction: 'outbound',
        sentBy: {
          id: commercialAttendant.id,
          name: commercialAttendant.name,
        },
      },
      conversation: {
        conversationState: 'human-active',
        version: 11,
      },
    });
    const requested = await prisma.integrationOutbox.findFirstOrThrow({
      where: {
        companyId: tenantId,
        topic: 'whatsapp.outbound.requested',
        aggregateId: conversationId,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(requested.payload).toMatchObject({
      messageId: humanMessage.body.message.id,
      attemptId: humanMessage.body.message.attempts[0].id,
      automationAllowed: false,
      canGenerateReply: false,
      canSendReply: true,
    });

    const competingClaimBodies = [randomUUID(), randomUUID()].map(
      (commandId) => ({
        commandId,
        attemptId: humanMessage.body.message.attempts[0].id as string,
      }),
    );
    const competingClaims = await Promise.all(
      competingClaimBodies.map((body) =>
        claimEvolution({
          messageId: humanMessage.body.message.id as string,
          ...body,
        }),
      ),
    );
    expect(
      competingClaims.filter((response) => response.shouldSend === true),
    ).toHaveLength(1);
    const winningClaimIndex = competingClaims.findIndex(
      (response) => response.shouldSend === true,
    );
    const claimBody = competingClaimBodies[winningClaimIndex];
    const duplicateClaim = await claimEvolution({
      messageId: humanMessage.body.message.id as string,
      ...claimBody,
    });
    expect(duplicateClaim.shouldSend).toBe(false);
    await prisma.whatsAppMessageAttempt.update({
      where: {
        id_companyId: {
          id: claimBody.attemptId,
          companyId: tenantId,
        },
      },
      data: { dispatchLeaseUntil: new Date(Date.now() - 1_000) },
    });
    const unknownClaim = await claimEvolution({
      messageId: humanMessage.body.message.id as string,
      ...claimBody,
    });
    expect(unknownClaim).toMatchObject({
      shouldSend: false,
      state: 'unknown',
      requiresReconciliation: true,
    });
    const reconciledClaim = await claimEvolution({
      messageId: humanMessage.body.message.id as string,
      commandId: randomUUID(),
      attemptId: claimBody.attemptId,
      reconciliation: 'confirmed-not-sent',
    });
    expect(reconciledClaim).toMatchObject({
      shouldSend: true,
      state: 'leased',
    });
    const [sentResult, failedResult] = await Promise.all([
      recordEvolution({
        messageId: humanMessage.body.message.id as string,
        commandId: randomUUID(),
        attemptId: claimBody.attemptId,
        status: 'sent',
        providerMessageId: 'evolution-human-message',
      }),
      recordEvolution({
        messageId: humanMessage.body.message.id as string,
        commandId: randomUUID(),
        attemptId: claimBody.attemptId,
        status: 'failed',
        errorCode: 'CONCURRENT_FAILURE',
        errorMessage: 'Resultado concorrente simulado.',
      }),
    ]);
    expect([sentResult.deliveryStatus, failedResult.deliveryStatus]).toContain(
      'sent',
    );
    expect(
      await prisma.whatsAppMessage.findUniqueOrThrow({
        where: {
          id_companyId: {
            id: humanMessage.body.message.id as string,
            companyId: tenantId,
          },
        },
        include: { attempts: true },
      }),
    ).toMatchObject({
      deliveryStatus: 'SENT',
      providerMessageId: 'evolution-human-message',
      attempts: [
        {
          status: 'SUCCEEDED',
          dispatchState: 'SUCCEEDED',
          providerMessageId: 'evolution-human-message',
        },
      ],
    });

    const beforeHumanInbounds =
      await prisma.whatsAppConversation.findUniqueOrThrow({
        where: { id_companyId: { id: conversationId, companyId: tenantId } },
      });
    expect(beforeHumanInbounds).toMatchObject({
      conversationState: 'HUMAN_ACTIVE',
      flowStep: 'HUMAN_SERVICE',
      version: 11,
    });

    const humanInbounds = [
      {
        providerMessageId: 'provider-human-contact-1',
        text: 'Ainda aguardando.',
      },
      {
        providerMessageId: 'provider-human-contact-2',
        text: 'Também preciso incluir duas malas grandes.',
      },
      {
        providerMessageId: 'provider-human-contact-3',
        text: 'E o embarque deve ser pelo portão lateral.',
      },
    ];
    const inboundResponses = await Promise.all(
      humanInbounds.map(({ providerMessageId, text }) =>
        signedWebhook(app, webhookPayload(providerMessageId, phone, text)),
      ),
    );
    for (const response of inboundResponses) {
      expect(response.status).toBe(202);
      expect(response.body).toMatchObject({
        accepted: true,
        duplicate: false,
        automationAllowed: false,
      });
    }

    const afterHumanInbounds =
      await prisma.whatsAppConversation.findUniqueOrThrow({
        where: { id_companyId: { id: conversationId, companyId: tenantId } },
      });
    expect(afterHumanInbounds).toMatchObject({
      conversationState: 'HUMAN_ACTIVE',
      flowStep: 'HUMAN_SERVICE',
      version: 11,
      unreadCount: beforeHumanInbounds.unreadCount + humanInbounds.length,
    });

    const history = await request(app.getHttpServer())
      .get(
        `/api/v1/whatsapp/conversations/${conversationId}/messages?page=1&pageSize=100`,
      )
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    const capturedByProviderId = new Map(
      (
        history.body.data as Array<{
          providerMessageId: string | null;
          direction: string;
          deliveryStatus: string;
          text: string | null;
        }>
      ).map((message) => [message.providerMessageId, message]),
    );
    const allCapturedInbounds = [...automatedInbounds, ...humanInbounds];
    for (const inbound of allCapturedInbounds) {
      expect(capturedByProviderId.get(inbound.providerMessageId)).toMatchObject(
        {
          providerMessageId: inbound.providerMessageId,
          direction: 'inbound',
          deliveryStatus: 'received',
          text: inbound.text,
        },
      );
    }

    const humanNotificationProviderIds = new Set(
      humanInbounds.map(({ providerMessageId }) => providerMessageId),
    );
    const humanNotifications = (
      await prisma.integrationOutbox.findMany({
        where: {
          companyId: tenantId,
          aggregateId: conversationId,
          topic: 'whatsapp.inbound.human-notification',
        },
      })
    ).filter((event) => {
      const eventPayload = event.payload as {
        message?: { providerMessageId?: string };
      };
      return humanNotificationProviderIds.has(
        eventPayload.message?.providerMessageId ?? '',
      );
    });
    expect(humanNotifications).toHaveLength(humanInbounds.length);
    expect(
      humanNotifications.every((event) => event.status === 'PENDING'),
    ).toBe(true);

    await expect(
      createAutomaticOutbound({
        conversationId,
        commandId: randomUUID(),
        expectedVersion: 11,
        kind: 'text',
        text: 'Não pode enviar',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'A sessão não permite geração ou envio de resposta automática.',
      details: { controlMode: 'human', status: 'open' },
    });
    const after = await prisma.whatsAppConversation.findUniqueOrThrow({
      where: { id_companyId: { id: conversationId, companyId: tenantId } },
    });
    expect(after.conversationState).toBe('HUMAN_ACTIVE');
  });

  it('isola consultas do painel por companyId e nova solicitação cria novo registro', async () => {
    const ownedPhone = '5511966666677';
    const ownedContact = await prisma.whatsAppContact.create({
      data: {
        companyId: tenantId,
        phoneNormalized: ownedPhone,
        phoneDisplay: formatWhatsAppPhone(ownedPhone),
        displayName: 'Cliente isolado do tenant E2E',
      },
    });
    const ownedConversation = await prisma.whatsAppConversation.create({
      data: {
        companyId: tenantId,
        channelId,
        contactId: ownedContact.id,
        department: 'COMMERCIAL',
        conversationState: 'HUMAN_ACTIVE',
        flowStep: 'HUMAN_SERVICE',
        requestStatus: 'UNDER_REVIEW',
        resumeState: 'BOT_ACTIVE',
        resumeFlowStep: 'COMMERCIAL_FOLLOW_UP_MENU',
        assignedToUserId: commercialAttendant.id,
      },
    });
    const conversationId = ownedConversation.id;
    await prisma.quoteRequest.create({
      data: {
        companyId: tenantId,
        conversationId,
        sequence: 1,
        status: 'UNDER_REVIEW',
        confirmedAt: new Date(),
        confirmedVersion: 1,
      },
    });
    const foreignCompanyId = '00000000-0000-4000-8000-000000000299';
    await prisma.company.create({
      data: {
        id: foreignCompanyId,
        legalName: 'Tenant externo',
        taxId: '11222333000181',
      },
    });
    const foreignProvider = await prisma.whatsAppProvider.create({
      data: {
        companyId: foreignCompanyId,
        name: 'Foreign Evolution',
        baseUrl: 'https://foreign.example.test',
        apiKeyHash: 'a'.repeat(64),
      },
    });
    const foreignChannel = await prisma.whatsAppChannel.create({
      data: {
        companyId: foreignCompanyId,
        providerId: foreignProvider.id,
        name: 'Foreign channel',
        phoneNumber: '5511977777777',
        instanceName: 'foreign',
        webhookSecretHash: 'b'.repeat(64),
      },
    });
    const foreignContact = await prisma.whatsAppContact.create({
      data: {
        companyId: foreignCompanyId,
        phoneNormalized: '5511966666666',
        phoneDisplay: formatWhatsAppPhone('5511966666666'),
      },
    });
    const foreignConversation = await prisma.whatsAppConversation.create({
      data: {
        companyId: foreignCompanyId,
        channelId: foreignChannel.id,
        contactId: foreignContact.id,
      },
    });

    const list = await request(app.getHttpServer())
      .get('/api/v1/whatsapp/conversations')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(
      (list.body.data as Array<{ id: string }>).some(
        (item) => item.id === foreignConversation.id,
      ),
    ).toBe(false);
    await request(app.getHttpServer())
      .get(`/api/v1/whatsapp/conversations/${foreignConversation.id}`)
      .set('authorization', `Bearer ${accessToken}`)
      .expect(404);

    const current = await prisma.whatsAppConversation.findUniqueOrThrow({
      where: { id_companyId: { id: conversationId, companyId: tenantId } },
    });
    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${conversationId}/actions/return-to-bot`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({ commandId: randomUUID(), expectedVersion: current.version })
      .expect(201);
    const returned = await prisma.whatsAppConversation.findUniqueOrThrow({
      where: { id_companyId: { id: conversationId, companyId: tenantId } },
    });
    await transitionSystem({
      conversationId,
      commandId: randomUUID(),
      expectedVersion: returned.version,
      name: 'new-quote-request',
    });
    expect(
      await prisma.quoteRequest.count({
        where: { companyId: tenantId, conversationId },
      }),
    ).toBe(2);
  });

  it('permite que um token autorizado devolva a conversa ao bot e preserva o responsável anterior', async () => {
    const otherAttendantSuffix = randomUUID().slice(0, 8);
    const otherAttendant = await prisma.user.create({
      data: {
        companyId: tenantId,
        name: 'Atendente responsável pelo retorno',
        username: `responsavel.${otherAttendantSuffix}`,
        usernameNormalized: `responsavel.${otherAttendantSuffix}`,
        email: `${randomUUID()}@example.test`,
        emailNormalized: `${randomUUID()}@example.test`,
        passwordHash: 'hash-e2e-sem-uso',
        departments: ['commercial'],
      },
    });
    const contact = await prisma.whatsAppContact.create({
      data: {
        companyId: tenantId,
        phoneNormalized: '5511988877241',
        phoneDisplay: '(11) 98887-7241',
        displayName: 'Cliente atribuído a outro atendente',
      },
    });
    const conversation = await prisma.whatsAppConversation.create({
      data: {
        companyId: tenantId,
        channelId,
        contactId: contact.id,
        department: 'COMMERCIAL',
        conversationState: 'HUMAN_ACTIVE',
        flowStep: 'HUMAN_SERVICE',
        requestStatus: 'UNDER_REVIEW',
        resumeState: 'BOT_ACTIVE',
        resumeFlowStep: 'COMMERCIAL_FOLLOW_UP_MENU',
        assignedToUserId: otherAttendant.id,
      },
    });
    const commandId = randomUUID();

    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${conversation.id}/actions/return-to-bot`,
      )
      .set('authorization', `Bearer ${accessToken}`)
      .send({ commandId, expectedVersion: conversation.version })
      .expect(201);

    await expect(
      prisma.whatsAppConversation.findUniqueOrThrow({
        where: {
          id_companyId: { id: conversation.id, companyId: tenantId },
        },
      }),
    ).resolves.toMatchObject({
      conversationState: 'BOT_ACTIVE',
      assignedToUserId: null,
      version: conversation.version + 1,
    });
    await expect(
      prisma.whatsAppConversationTransition.findUniqueOrThrow({
        where: {
          companyId_commandId: { companyId: tenantId, commandId },
        },
      }),
    ).resolves.toMatchObject({
      actorUserId: expect.any(String),
      metadata: {
        assignment: {
          previousAssignedToUserId: otherAttendant.id,
          resultingAssignedToUserId: null,
          changedByUserId: expect.any(String),
          cause: 'return-to-bot',
        },
        quoteRequestId: null,
      },
    });
  });

  it('não expõe conversa, mensagens, transições, orçamento ou mídia fora do departamento', async () => {
    const secretMarker = `segredo-idor-${randomUUID()}`;
    const providerMessageId = `provider-idor-media-${randomUUID()}`;
    const mediaPayload = webhookPayload(
      providerMessageId,
      '5511988877243',
      secretMarker,
    );
    mediaPayload.data.pushName = secretMarker;
    mediaPayload.data.message = {
      imageMessage: {
        mimetype: 'image/jpeg',
        fileLength: 128,
        fileName: `${secretMarker}.jpg`,
        url: 'https://evolution.example.test/media/idor.jpg',
      },
    } as unknown as typeof mediaPayload.data.message;
    const inbound = await signedMediaWebhook(app, mediaPayload);
    expect(inbound.status, JSON.stringify(inbound.body)).toBe(202);
    const restrictedConversationId = inbound.body.conversationId as string;
    const mediaMessage = await prisma.whatsAppMessage.findUniqueOrThrow({
      where: {
        companyId_channelId_providerMessageId: {
          companyId: tenantId,
          channelId,
          providerMessageId,
        },
      },
    });
    await prisma.quoteRequest.create({
      data: {
        companyId: tenantId,
        conversationId: restrictedConversationId,
        sequence: 1,
        status: 'COLLECTING_INFORMATION',
        confirmedSummary: { secretMarker },
      },
    });
    await transitionSystem({
      conversationId: restrictedConversationId,
      commandId: randomUUID(),
      expectedVersion: inbound.body.version as number,
      name: 'start-department-contact',
      targetDepartment: 'operations',
      metadata: { departmentOption: '2' },
    });

    const restrictedPaths = [
      `/api/v1/whatsapp/conversations/${restrictedConversationId}`,
      `/api/v1/whatsapp/conversations/${restrictedConversationId}/messages`,
      `/api/v1/whatsapp/conversations/${restrictedConversationId}/transitions`,
      `/api/v1/whatsapp/conversations/${restrictedConversationId}/quote-request`,
      `/api/v1/whatsapp/conversations/${restrictedConversationId}/messages/${mediaMessage.id}/content`,
    ];
    for (const path of restrictedPaths) {
      const response = await request(app.getHttpServer())
        .get(path)
        .set('authorization', `Bearer ${commercialAccessToken}`)
        .expect(404);
      expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
      expect(JSON.stringify(response.body)).not.toContain(secretMarker);
      expect(response.headers['x-whatsapp-media-filename']).toBeUndefined();
      expect(response.headers['x-whatsapp-media-kind']).toBeUndefined();
    }
  });

  it('permite substituição entre atendentes autorizados e mantém o isolamento departamental', async () => {
    const suffix = randomUUID().slice(0, 8);
    const [otherCommercialOwner, operationsOwner] = await Promise.all([
      prisma.user.create({
        data: {
          companyId: tenantId,
          name: 'Outro atendente Comercial',
          username: `outro.comercial.${suffix}`,
          usernameNormalized: `outro.comercial.${suffix}`,
          email: `outro.comercial.${suffix}@example.test`,
          emailNormalized: `outro.comercial.${suffix}@example.test`,
          passwordHash: 'hash-e2e-sem-uso',
          departments: ['commercial'],
        },
      }),
      prisma.user.create({
        data: {
          companyId: tenantId,
          name: 'Atendente Operacional',
          username: `operacional.${suffix}`,
          usernameNormalized: `operacional.${suffix}`,
          email: `operacional.${suffix}@example.test`,
          emailNormalized: `operacional.${suffix}@example.test`,
          passwordHash: 'hash-e2e-sem-uso',
          departments: ['operations'],
        },
      }),
    ]);
    const [commercialContact, operationsContact] = await Promise.all([
      prisma.whatsAppContact.create({
        data: {
          companyId: tenantId,
          phoneNormalized: '5511988877244',
          phoneDisplay: '(11) 98887-7244',
          displayName: 'Cliente de outro atendente',
        },
      }),
      prisma.whatsAppContact.create({
        data: {
          companyId: tenantId,
          phoneNormalized: '5511988877245',
          phoneDisplay: '(11) 98887-7245',
          displayName: 'Cliente do Operacional',
        },
      }),
    ]);
    const [assignedConversation, otherDepartmentConversation] =
      await Promise.all([
        prisma.whatsAppConversation.create({
          data: {
            companyId: tenantId,
            channelId,
            contactId: commercialContact.id,
            department: 'COMMERCIAL',
            conversationState: 'HUMAN_ACTIVE',
            flowStep: 'HUMAN_SERVICE',
            assignedToUserId: otherCommercialOwner.id,
          },
        }),
        prisma.whatsAppConversation.create({
          data: {
            companyId: tenantId,
            channelId,
            contactId: operationsContact.id,
            department: 'OPERATIONS',
            conversationState: 'HUMAN_ACTIVE',
            flowStep: 'HUMAN_SERVICE',
            assignedToUserId: operationsOwner.id,
          },
        }),
      ]);
    const replyCommandId = randomUUID();
    const reply = await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${assignedConversation.id}/messages`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({
        commandId: replyCommandId,
        idempotencyKey: randomUUID(),
        expectedVersion: assignedConversation.version,
        text: 'Outro atendente autorizado deu continuidade ao atendimento.',
      })
      .expect(201);
    expect(reply.body).toMatchObject({
      message: {
        sentBy: {
          id: commercialAttendant.id,
          name: commercialAttendant.name,
        },
      },
      conversation: {
        assignedTo: {
          id: otherCommercialOwner.id,
          name: otherCommercialOwner.name,
        },
        version: assignedConversation.version + 1,
      },
    });
    const authorizedCommandId = randomUUID();
    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${assignedConversation.id}/actions/close`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({
        commandId: authorizedCommandId,
        expectedVersion: reply.body.conversation.version,
        reason: 'Atendimento concluído por outro atendente autorizado.',
      })
      .expect(201);
    await expect(
      prisma.whatsAppConversation.findUniqueOrThrow({
        where: {
          id_companyId: {
            id: assignedConversation.id,
            companyId: tenantId,
          },
        },
      }),
    ).resolves.toMatchObject({
      conversationState: 'CLOSED',
      assignedToUserId: null,
      version: assignedConversation.version + 2,
    });
    await expect(
      prisma.whatsAppConversationTransition.findUniqueOrThrow({
        where: {
          companyId_commandId: {
            companyId: tenantId,
            commandId: authorizedCommandId,
          },
        },
      }),
    ).resolves.toMatchObject({
      actorUserId: commercialAttendant.id,
      metadata: {
        assignment: {
          previousAssignedToUserId: otherCommercialOwner.id,
          resultingAssignedToUserId: null,
          changedByUserId: commercialAttendant.id,
          cause: 'close',
        },
        quoteRequestId: null,
        reason: 'Atendimento concluído por outro atendente autorizado.',
      },
    });

    const deniedCommandId = randomUUID();
    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${otherDepartmentConversation.id}/actions/close`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({
        commandId: deniedCommandId,
        expectedVersion: otherDepartmentConversation.version,
        reason: 'Tentativa fora do departamento responsável.',
      })
      .expect(403);
    await expect(
      prisma.whatsAppConversation.findUniqueOrThrow({
        where: {
          id_companyId: {
            id: otherDepartmentConversation.id,
            companyId: tenantId,
          },
        },
      }),
    ).resolves.toMatchObject({
      conversationState: 'HUMAN_ACTIVE',
      assignedToUserId: operationsOwner.id,
      version: otherDepartmentConversation.version,
    });
    await expect(
      prisma.whatsAppConversationTransition.count({
        where: { companyId: tenantId, commandId: deniedCommandId },
      }),
    ).resolves.toBe(0);
  });

  it('solicita e aceita transferência somente pelo departamento de destino', async () => {
    const outsiderSuffix = randomUUID().slice(0, 8);
    const destinationSuffix = randomUUID().slice(0, 8);
    const outsiderEmail = `${randomUUID()}@example.test`;
    const destinationEmail = `${randomUUID()}@example.test`;
    const [outsider, destinationAttendant] = await Promise.all([
      prisma.user.create({
        data: {
          companyId: tenantId,
          name: 'Atendente fora do destino',
          username: `fora.${outsiderSuffix}`,
          usernameNormalized: `fora.${outsiderSuffix}`,
          email: outsiderEmail,
          emailNormalized: outsiderEmail,
          passwordHash: 'hash-e2e-sem-uso',
          departments: ['commercial'],
          permissionCodes: ['whatsapp-conversations:attend'],
        },
      }),
      prisma.user.create({
        data: {
          companyId: tenantId,
          name: 'Atendente do destino',
          username: `destino.${destinationSuffix}`,
          usernameNormalized: `destino.${destinationSuffix}`,
          email: destinationEmail,
          emailNormalized: destinationEmail,
          passwordHash: 'hash-e2e-sem-uso',
          departments: ['operations'],
          permissionCodes: ['whatsapp-conversations:attend'],
        },
      }),
    ]);
    const [outsiderToken, destinationToken] = await Promise.all([
      accessTokens.sign({
        sub: outsider.id,
        companyId: tenantId,
        tokenVersion: outsider.tokenVersion,
      }),
      accessTokens.sign({
        sub: destinationAttendant.id,
        companyId: tenantId,
        tokenVersion: destinationAttendant.tokenVersion,
      }),
    ]);
    const inbound = await signedWebhook(
      app,
      webhookPayload(
        `provider-transfer-${randomUUID()}`,
        '5511988877242',
        'Preciso falar com o Operacional',
      ),
    ).expect(202);
    const conversationId = inbound.body.conversationId as string;
    const taken = await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${conversationId}/actions/take-over`,
      )
      .set('authorization', `Bearer ${outsiderToken}`)
      .send({ commandId: randomUUID(), expectedVersion: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${conversationId}/actions/request-transfer`,
      )
      .set('authorization', `Bearer ${outsiderToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: taken.body.version,
        targetDepartment: 'operations',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${conversationId}/actions/request-transfer`,
      )
      .set('authorization', `Bearer ${outsiderToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: taken.body.version,
        reason: 'Transferência operacional necessária.',
      })
      .expect(400);
    await expect(
      prisma.whatsAppConversation.findUniqueOrThrow({
        where: { id_companyId: { id: conversationId, companyId: tenantId } },
      }),
    ).resolves.toMatchObject({
      conversationState: 'HUMAN_ACTIVE',
      assignedToUserId: expect.any(String),
      version: taken.body.version,
    });

    const requestCommandId = randomUUID();
    const requested = await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${conversationId}/actions/request-transfer`,
      )
      .set('authorization', `Bearer ${outsiderToken}`)
      .send({
        commandId: requestCommandId,
        expectedVersion: taken.body.version,
        targetDepartment: 'operations',
        reason: 'Transferência operacional necessária.',
      })
      .expect(201);
    expect(requested.body).toMatchObject({
      department: 'commercial',
      conversationState: 'human-active',
      assignedTo: taken.body.assignedTo,
      pendingTransfer: {
        targetDepartment: 'operations',
        reason: 'Transferência operacional necessária.',
        requestedAt: expect.any(String),
        requestedBy: taken.body.assignedTo,
      },
      version: taken.body.version + 1,
    });
    await expect(
      prisma.whatsAppConversationTransition.findUniqueOrThrow({
        where: {
          companyId_commandId: {
            companyId: tenantId,
            commandId: requestCommandId,
          },
        },
      }),
    ).resolves.toMatchObject({
      name: 'request-transfer',
      metadata: {
        source: 'panel-transfer-request',
        reason: 'Transferência operacional necessária.',
        transfer: {
          status: 'requested',
          sourceDepartment: 'commercial',
          targetDepartment: 'operations',
          reason: 'Transferência operacional necessária.',
          requestedByUserId: taken.body.assignedTo.id,
          requestedAt: expect.any(String),
        },
      },
    });

    await request(app.getHttpServer())
      .get('/api/v1/whatsapp/conversations?department=operations')
      .set('authorization', `Bearer ${destinationToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: conversationId,
              department: 'commercial',
              assignedTo: taken.body.assignedTo,
              pendingTransfer: expect.objectContaining({
                targetDepartment: 'operations',
              }),
            }),
          ]),
        );
      });

    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${conversationId}/actions/accept-transfer`,
      )
      .set('authorization', `Bearer ${outsiderToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: requested.body.version,
      })
      .expect(403);
    await expect(
      prisma.whatsAppConversation.findUniqueOrThrow({
        where: { id_companyId: { id: conversationId, companyId: tenantId } },
      }),
    ).resolves.toMatchObject({
      department: 'COMMERCIAL',
      conversationState: 'HUMAN_ACTIVE',
      assignedToUserId: taken.body.assignedTo.id,
      pendingTransferDepartment: 'OPERATIONS',
      pendingTransferReason: 'Transferência operacional necessária.',
      version: requested.body.version,
    });

    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${conversationId}/actions/accept-transfer`,
      )
      .set('authorization', `Bearer ${destinationToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: requested.body.version,
      })
      .expect(201)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          department: 'operations',
          conversationState: 'human-active',
          assignedTo: {
            id: destinationAttendant.id,
            name: destinationAttendant.name,
          },
          pendingTransfer: null,
          version: requested.body.version + 1,
        }),
      );
  });

  it('devolve orçamento confirmado ao bot e publica o próximo inbound para o menu de acompanhamento', async () => {
    const phone = '5511988884444';
    const first = await signedWebhook(
      app,
      webhookPayload('provider-follow-up-return-start', phone, 'Olá'),
    ).expect(202);
    const followUpConversationId = first.body.conversationId as string;

    const transition = async (
      name: TransitionCommand['name'],
      expectedVersion: number,
      targetDepartment?: TransitionCommand['targetDepartment'],
    ) => ({
      body: await transitionSystem({
        conversationId: followUpConversationId,
        commandId: randomUUID(),
        expectedVersion,
        name,
        ...(targetDepartment ? { targetDepartment } : {}),
      }),
    });

    await transition('select-commercial', 1);
    await transition('start-quote', 2);
    const quote = await prisma.quoteRequest.findFirstOrThrow({
      where: {
        companyId: tenantId,
        conversationId: followUpConversationId,
      },
      orderBy: { sequence: 'desc' },
    });
    const departureAt = parseBusinessDateTime(
      '2026-08-10T10:00:00.000Z',
      'departureAt',
    );
    await patchQuoteFromAutomation(quote.id, {
      commandId: randomUUID(),
      expectedVersion: quote.version,
      contactName: 'Cliente acompanhamento',
      serviceType: 'Fretamento eventual',
      origin: 'Uberlândia',
      destination: 'Goiânia',
      departureDate: dateOnlyFromDateTime(departureAt),
      departureAt,
      passengerCount: 20,
    });
    await transition('present-quote-summary', 3);
    await transition('confirm-quote', 4);

    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${followUpConversationId}/actions/take-over`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({ commandId: randomUUID(), expectedVersion: 5 })
      .expect(201);
    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${followUpConversationId}/actions/return-to-bot`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: 6,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${followUpConversationId}/actions/take-over`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({ commandId: randomUUID(), expectedVersion: 7 })
      .expect(201);
    const returned = await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${followUpConversationId}/actions/return-to-bot`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({ commandId: randomUUID(), expectedVersion: 8 })
      .expect(201);

    expect(returned.body).toMatchObject({
      conversationState: 'bot-active',
      flowStep: 'commercial-follow-up-menu',
      requestStatus: 'under-review',
      resumeFlowStep: null,
      followUpMenuPresentedAt: null,
    });

    const nextInbound = await signedWebhook(
      app,
      webhookPayload('provider-follow-up-return-next', phone, 'Olá novamente'),
    ).expect(202);
    expect(nextInbound.body).toMatchObject({
      accepted: true,
      automationAllowed: true,
      canGenerateReply: true,
      canSendReply: true,
      version: 10,
    });
    const followUpEvent = await prisma.integrationOutbox.findFirstOrThrow({
      where: {
        companyId: tenantId,
        aggregateId: followUpConversationId,
        topic: 'whatsapp.inbound.persisted',
      },
      orderBy: { aggregateSequence: 'desc' },
    });
    expect(followUpEvent.payload).toMatchObject({
      contextualTransition: true,
      automationAllowed: true,
      canGenerateReply: true,
      canSendReply: true,
      conversation: {
        conversationState: 'bot-active',
        flowStep: 'commercial-follow-up-menu',
        requestStatus: 'under-review',
        version: 10,
      },
    });

    const menuOutbound = {
      body: await createAutomaticOutbound({
        conversationId: followUpConversationId,
        commandId: randomUUID(),
        expectedVersion: 10,
        purpose: 'commercial-follow-up-menu',
        kind: 'text',
        text: 'Menu de acompanhamento',
      }),
    };
    const menuClaim = {
      body: await claimEvolution({
        messageId: menuOutbound.body.id,
        commandId: randomUUID(),
        attemptId: menuOutbound.body.attempts[0].id,
      }),
    };
    expect(menuClaim.body.shouldSend).toBe(true);
    await recordEvolution({
      messageId: menuOutbound.body.id,
      commandId: randomUUID(),
      attemptId: menuOutbound.body.attempts[0].id,
      status: 'sent',
      providerMessageId: 'evolution-follow-up-menu',
    });
    expect(
      (
        await prisma.whatsAppConversation.findUniqueOrThrow({
          where: {
            id_companyId: {
              id: followUpConversationId,
              companyId: tenantId,
            },
          },
        })
      ).followUpMenuPresentedAt,
    ).toBeInstanceOf(Date);

    const forwarded = await transition('forward', 10, 'commercial');
    expect(forwarded.body).toMatchObject({
      conversationState: 'sent-to-human',
      flowStep: 'human-service',
      requestStatus: 'under-review',
      resumeFlowStep: 'commercial-follow-up-menu',
    });

    await prisma.quoteRequest.update({
      where: {
        id_companyId: { id: quote.id, companyId: tenantId },
      },
      data: {
        status: 'APPROVED',
        decidedAt: new Date(),
      },
    });
    await prisma.whatsAppConversation.update({
      where: {
        id_companyId: {
          id: followUpConversationId,
          companyId: tenantId,
        },
      },
      data: {
        conversationState: 'HUMAN_ACTIVE',
        flowStep: 'HUMAN_SERVICE',
        requestStatus: 'APPROVED',
        assignedToUserId: (
          await prisma.user.findFirstOrThrow({
            where: {
              companyId: tenantId,
              usernameNormalized: 'admin.e2e',
            },
            select: { id: true },
          })
        ).id,
      },
    });
    const approvedReturn = await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${followUpConversationId}/actions/return-to-bot`,
      )
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: forwarded.body.version,
      })
      .expect(201);
    expect(approvedReturn.body).toMatchObject({
      conversationState: 'bot-active',
      flowStep: 'commercial-follow-up-menu',
      requestStatus: 'approved',
      assignedTo: null,
      hasApprovedQuoteRequest: true,
      followUpMenuPresentedAt: null,
      contextualFollowUpAt: '1970-01-01T00:00:00.000Z',
    });
  });

  it('conclui atomicamente os eventos inbound incorporados ao lote durável', async () => {
    const aggregateId = randomUUID();
    const executionId = randomUUID();
    const firstSourceEventId = `batch:${randomUUID()}`;
    const secondSourceEventId = `batch:${randomUUID()}`;
    const [processing, pending] = await prisma.$transaction([
      prisma.integrationOutbox.create({
        data: {
          companyId: tenantId,
          topic: 'whatsapp.inbound.persisted',
          aggregateType: 'whatsapp-conversation',
          aggregateId,
          aggregateSequence: 1,
          correlationId: firstSourceEventId,
          payload: { order: 1 },
          status: 'PROCESSING',
          executionId,
          acceptedAt: new Date(),
          executionLeaseUntil: new Date(Date.now() + 60_000),
        },
      }),
      prisma.integrationOutbox.create({
        data: {
          companyId: tenantId,
          topic: 'whatsapp.inbound.persisted',
          aggregateType: 'whatsapp-conversation',
          aggregateId,
          aggregateSequence: 2,
          correlationId: secondSourceEventId,
          payload: { order: 2 },
        },
      }),
    ]);

    const completion = {
      body: await completeAutomationOutbox({
        eventId: processing.id,
        commandId: randomUUID(),
        executionId,
        aggregateType: 'whatsapp-conversation',
        aggregateId,
        outcome: 'succeeded',
        consumedSourceEventIds: [firstSourceEventId, secondSourceEventId],
      }),
    };

    expect(completion.body).toMatchObject({
      eventId: processing.id,
      status: 'delivered',
      consumedEventCount: 1,
    });
    await expect(
      prisma.integrationOutbox.findUniqueOrThrow({
        where: { id: pending.id },
      }),
    ).resolves.toMatchObject({
      status: 'DELIVERED',
      executionId: null,
      acceptedAt: null,
    });
  });

  it('cancela e audita o ciclo under-review substituído sem deixá-lo na fila ou notificação', async () => {
    const actor = await prisma.user.findFirstOrThrow({
      where: { companyId: tenantId, usernameNormalized: 'admin.e2e' },
    });
    const baselineNotifications = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    const contact = await prisma.whatsAppContact.create({
      data: {
        companyId: tenantId,
        phoneNormalized: '5511977773131',
        phoneDisplay: formatWhatsAppPhone('5511977773131'),
        displayName: 'Cliente ciclo substituído',
      },
    });
    const conversation = await prisma.whatsAppConversation.create({
      data: {
        companyId: tenantId,
        channelId,
        contactId: contact.id,
        department: 'COMMERCIAL',
        conversationState: 'BOT_ACTIVE',
        flowStep: 'COMMERCIAL_FOLLOW_UP_MENU',
        requestStatus: 'UNDER_REVIEW',
      },
    });
    const supersededQuote = await prisma.quoteRequest.create({
      data: {
        companyId: tenantId,
        conversationId: conversation.id,
        sequence: 1,
        status: 'UNDER_REVIEW',
        contactName: 'Cliente ciclo substituído',
        serviceType: 'Fretamento eventual',
        origin: 'Uberlândia',
        destination: 'Goiânia',
        departureAt: new Date('2026-08-14T12:00:00.000Z'),
        passengerCount: 12,
        confirmedAt: new Date(),
        confirmedVersion: 1,
        confirmedSummary: { source: 'superseded-cycle-e2e' },
      },
    });
    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n',
    );
    const upload = await request(app.getHttpServer())
      .post(`/api/v1/whatsapp/quote-proposals/${supersededQuote.id}/documents`)
      .set('authorization', `Bearer ${accessToken}`)
      .field('commandId', randomUUID())
      .field('expectedVersion', '1')
      .attach('file', pdf, {
        filename: 'orcamento-ciclo-substituido.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    const uploadedDocumentId = upload.body.proposalDocument.id as string;

    const notificationsWithPendingQuote = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(notificationsWithPendingQuote.body).toMatchObject({
      total: baselineNotifications.body.total + 1,
      unreadTotal: baselineNotifications.body.unreadTotal + 1,
    });
    await request(app.getHttpServer())
      .get('/api/v1/whatsapp/quote-proposals?page=1&pageSize=100')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: supersededQuote.id }),
          ]),
        );
      });

    const commandId = randomUUID();
    const transitionRequest = () =>
      transitionSystem({
        conversationId: conversation.id,
        commandId,
        expectedVersion: 1,
        name: 'new-quote-request',
      });
    const newCycle = { body: await transitionRequest() };
    expect(newCycle.body).toMatchObject({
      idempotent: false,
      conversationState: 'bot-active',
      flowStep: 'quote-data-collection',
      requestStatus: 'collecting-information',
      version: 2,
      currentQuoteRequest: {
        sequence: 2,
        status: 'collecting-information',
      },
    });
    await expect(transitionRequest()).resolves.toMatchObject({
      idempotent: true,
    });

    const quotes = await prisma.quoteRequest.findMany({
      where: { companyId: tenantId, conversationId: conversation.id },
      orderBy: { sequence: 'asc' },
    });
    expect(quotes).toHaveLength(2);
    expect(
      quotes.map(({ sequence, status, version }) => [
        sequence,
        status,
        version,
      ]),
    ).toEqual([
      [1, 'CANCELLED', 2],
      [2, 'COLLECTING_INFORMATION', 1],
    ]);
    expect(quotes[0]).toMatchObject({
      decisionReason: 'Substituído por uma nova solicitação de orçamento.',
      decidedAt: expect.any(Date),
    });
    const currentQuote = quotes[1];
    const transition =
      await prisma.whatsAppConversationTransition.findUniqueOrThrow({
        where: {
          companyId_commandId: {
            companyId: tenantId,
            commandId,
          },
        },
      });
    expect(transition.metadata).toMatchObject({
      quoteRequestId: currentQuote.id,
      supersededQuoteRequest: {
        id: supersededQuote.id,
        fromStatus: 'under-review',
        toStatus: 'cancelled',
        previousVersion: 1,
        resultingVersion: 2,
      },
    });
    expect(
      await prisma.tenantAuditLog.findMany({
        where: {
          companyId: tenantId,
          action: 'whatsapp.quote-request.superseded',
          targetId: supersededQuote.id,
        },
      }),
    ).toEqual([
      expect.objectContaining({
        actorUserId: null,
        metadata: expect.objectContaining({
          conversationId: conversation.id,
          newQuoteRequestId: currentQuote.id,
          transitionId: transition.id,
          commandId,
          fromStatus: 'under-review',
          toStatus: 'cancelled',
          previousVersion: 1,
          resultingVersion: 2,
        }),
      }),
    ]);

    await request(app.getHttpServer())
      .get('/api/v1/whatsapp/quote-proposals?page=1&pageSize=100')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        const ids = (body.items as Array<{ id: string }>).map(({ id }) => id);
        expect(ids).not.toContain(supersededQuote.id);
        expect(ids).not.toContain(currentQuote.id);
      });
    await request(app.getHttpServer())
      .get(
        `/api/v1/whatsapp/quote-proposals?stage=cancelled&search=${encodeURIComponent(
          'Cliente ciclo substituído',
        )}&page=1&pageSize=100`,
      )
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: supersededQuote.id,
              quoteRequest: expect.objectContaining({
                status: 'cancelled',
                decision: expect.objectContaining({
                  status: 'cancelled',
                  classification: 'superseded',
                  reason: 'Substituído por uma nova solicitação de orçamento.',
                  decidedAt: expect.any(String),
                  decidedBy: null,
                }),
              }),
            }),
          ]),
        ),
      );
    await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.total).toBe(baselineNotifications.body.total);
        expect(body.unreadTotal).toBe(baselineNotifications.body.unreadTotal);
      });
    await request(app.getHttpServer())
      .post(`/api/v1/whatsapp/quote-proposals/${supersededQuote.id}/send`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: 2,
        proposalDocumentId: uploadedDocumentId,
        batchId: randomUUID(),
        batchDocumentIds: [uploadedDocumentId],
      })
      .expect(400);
    expect(
      await prisma.quoteProposalDocument.findUniqueOrThrow({
        where: {
          id_companyId: {
            id: uploadedDocumentId,
            companyId: tenantId,
          },
        },
      }),
    ).toMatchObject({
      status: 'UPLOADED',
      uploadedByUserId: actor.id,
    });
  });

  it('envia a proposta do ciclo confirmado mesmo após encaminhamento para atendimento', async () => {
    const actor = await prisma.user.findFirstOrThrow({
      where: { companyId: tenantId, usernameNormalized: 'admin.e2e' },
    });
    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n',
    );
    const contact = await prisma.whatsAppContact.create({
      data: {
        companyId: tenantId,
        phoneNormalized: '5511987654321',
        phoneDisplay: formatWhatsAppPhone('5511987654321'),
        displayName: 'Cliente proposta após acompanhamento',
      },
    });
    const conversation = await prisma.whatsAppConversation.create({
      data: {
        companyId: tenantId,
        channelId,
        contactId: contact.id,
        department: 'COMMERCIAL',
        conversationState: 'BOT_ACTIVE',
        flowStep: 'COMMERCIAL_FOLLOW_UP_MENU',
        requestStatus: 'UNDER_REVIEW',
      },
    });
    const quote = await prisma.quoteRequest.create({
      data: {
        companyId: tenantId,
        conversationId: conversation.id,
        sequence: 1,
        status: 'UNDER_REVIEW',
        contactName: 'Cliente proposta após acompanhamento',
        serviceType: 'Fretamento eventual',
        origin: 'Uberlândia',
        destination: 'Goiânia',
        departureAt: new Date('2026-08-15T12:00:00.000Z'),
        passengerCount: 18,
        confirmedAt: new Date(),
        confirmedVersion: 1,
        confirmedSummary: {
          contactName: 'Cliente proposta após acompanhamento',
          serviceType: 'Fretamento eventual',
          origin: 'Uberlândia',
          destination: 'Goiânia',
          departureAt: '2026-08-15T12:00:00.000Z',
          passengerCount: 18,
        },
      },
    });
    const upload = await request(app.getHttpServer())
      .post(`/api/v1/whatsapp/quote-proposals/${quote.id}/documents`)
      .set('authorization', `Bearer ${accessToken}`)
      .field('commandId', randomUUID())
      .field('expectedVersion', '1')
      .attach('file', pdf, {
        filename: 'orcamento-acompanhamento.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    const documentId = upload.body.proposalDocument.id as string;

    await expect(
      transitionSystem({
        conversationId: conversation.id,
        commandId: randomUUID(),
        expectedVersion: 1,
        name: 'forward',
        targetDepartment: 'commercial',
      }),
    ).resolves.toMatchObject({
      conversationState: 'sent-to-human',
      flowStep: 'human-service',
      requestStatus: 'under-review',
      version: 2,
    });

    await request(app.getHttpServer())
      .get('/api/v1/whatsapp/quote-proposals?page=1&pageSize=100')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: quote.id,
              quoteRequest: expect.objectContaining({
                status: 'under-review',
              }),
              conversation: expect.objectContaining({
                id: conversation.id,
                conversationState: 'sent-to-human',
                flowStep: 'human-service',
                requestStatus: 'under-review',
                currentQuoteRequest: expect.objectContaining({
                  id: quote.id,
                  status: 'under-review',
                }),
              }),
            }),
          ]),
        );
      });

    const sent = await request(app.getHttpServer())
      .post(`/api/v1/whatsapp/quote-proposals/${quote.id}/send`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: 2,
        proposalDocumentId: documentId,
        batchId: randomUUID(),
        batchDocumentIds: [documentId],
      })
      .expect(201);
    expect(sent.body).toMatchObject({
      message: {
        direction: 'outbound',
        kind: 'document',
        sentBy: { id: actor.id, name: actor.name },
      },
      conversation: {
        id: conversation.id,
        conversationState: 'human-active',
        flowStep: 'quote-send-pending',
        requestStatus: 'under-review',
        assignedTo: { id: actor.id, name: actor.name },
        version: 3,
      },
      proposalDocument: {
        id: documentId,
        status: 'queued',
        sentBy: { id: actor.id, name: actor.name },
      },
    });
    await expect(
      transitionSystem({
        conversationId: conversation.id,
        commandId: randomUUID(),
        expectedVersion: 3,
        name: 'new-quote-request',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      prisma.quoteRequest.count({
        where: { companyId: tenantId, conversationId: conversation.id },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.quoteRequest.findUniqueOrThrow({
        where: { id_companyId: { id: quote.id, companyId: tenantId } },
      }),
    ).resolves.toMatchObject({
      status: 'UNDER_REVIEW',
      confirmedAt: expect.any(Date),
    });

    const createBlockedFixture = async (
      suffix: string,
      input: {
        conversationState: 'BOT_ACTIVE' | 'CLOSED';
        flowStep: 'COMMERCIAL_FOLLOW_UP_MENU' | 'CLOSED';
        requestStatus: 'APPROVED' | 'UNDER_REVIEW';
        quoteStatus: 'APPROVED' | 'UNDER_REVIEW';
        closedAt?: Date;
      },
    ) => {
      const blockedContact = await prisma.whatsAppContact.create({
        data: {
          companyId: tenantId,
          phoneNormalized: `551197777${suffix}`,
          phoneDisplay: formatWhatsAppPhone(`551197777${suffix}`),
          displayName: `Cliente bloqueado ${suffix}`,
        },
      });
      const blockedConversation = await prisma.whatsAppConversation.create({
        data: {
          companyId: tenantId,
          channelId,
          contactId: blockedContact.id,
          department: 'COMMERCIAL',
          conversationState: input.conversationState,
          flowStep: input.flowStep,
          requestStatus: input.requestStatus,
          closedAt: input.closedAt,
        },
      });
      const blockedQuote = await prisma.quoteRequest.create({
        data: {
          companyId: tenantId,
          conversationId: blockedConversation.id,
          sequence: 1,
          status: input.quoteStatus,
          confirmedAt: new Date(),
          confirmedVersion: 1,
        },
      });
      const blockedDocument = await prisma.quoteProposalDocument.create({
        data: {
          companyId: tenantId,
          conversationId: blockedConversation.id,
          quoteRequestId: blockedQuote.id,
          uploadedByUserId: actor.id,
          sequence: 1,
          fileName: `orcamento-${suffix}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: pdf.byteLength,
          sha256: 'a'.repeat(64),
          content: Uint8Array.from(pdf),
        },
      });
      return {
        conversation: blockedConversation,
        quote: blockedQuote,
        document: blockedDocument,
      };
    };
    const approved = await createBlockedFixture('3434', {
      conversationState: 'BOT_ACTIVE',
      flowStep: 'COMMERCIAL_FOLLOW_UP_MENU',
      requestStatus: 'APPROVED',
      quoteStatus: 'APPROVED',
    });
    await request(app.getHttpServer())
      .post(`/api/v1/whatsapp/quote-proposals/${approved.quote.id}/send`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: approved.conversation.version,
        proposalDocumentId: approved.document.id,
        batchId: randomUUID(),
        batchDocumentIds: [approved.document.id],
      })
      .expect(400);

    const closed = await createBlockedFixture('3535', {
      conversationState: 'CLOSED',
      flowStep: 'CLOSED',
      requestStatus: 'UNDER_REVIEW',
      quoteStatus: 'UNDER_REVIEW',
      closedAt: new Date(),
    });
    await request(app.getHttpServer())
      .post(`/api/v1/whatsapp/quote-proposals/${closed.quote.id}/send`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: closed.conversation.version,
        proposalDocumentId: closed.document.id,
        batchId: randomUUID(),
        batchDocumentIds: [closed.document.id],
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('QUOTE_CONVERSATION_CLOSED');
      });
  });

  it('altera o status comercial por operador autorizado e registra auditoria', async () => {
    const actor = await prisma.user.findFirstOrThrow({
      where: { companyId: tenantId, usernameNormalized: 'admin.e2e' },
    });
    const contact = await prisma.whatsAppContact.create({
      data: {
        companyId: tenantId,
        phoneNormalized: '5511977773232',
        phoneDisplay: formatWhatsAppPhone('5511977773232'),
        displayName: 'Cliente status manual',
      },
    });
    const conversation = await prisma.whatsAppConversation.create({
      data: {
        companyId: tenantId,
        channelId,
        contactId: contact.id,
        department: 'COMMERCIAL',
        conversationState: 'HUMAN_ACTIVE',
        flowStep: 'HUMAN_SERVICE',
        requestStatus: 'COLLECTING_INFORMATION',
        assignedToUserId: actor.id,
      },
    });
    const quote = await prisma.quoteRequest.create({
      data: {
        companyId: tenantId,
        conversationId: conversation.id,
        sequence: 1,
        status: 'COLLECTING_INFORMATION',
        contactName: contact.displayName,
        serviceType: 'Fretamento eventual',
        origin: 'Uberlândia',
        destination: 'Goiânia',
        departureDate: new Date('2026-08-10T00:00:00.000Z'),
      },
    });
    const commandId = randomUUID();

    await request(app.getHttpServer())
      .patch(`/api/v1/whatsapp/quote-proposals/${quote.id}/status`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId,
        expectedVersion: conversation.version,
        status: 'under-review',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: quote.id,
          stage: 'pending',
          idempotent: false,
          quoteRequest: { status: 'under-review' },
          conversation: {
            id: conversation.id,
            requestStatus: 'under-review',
            version: conversation.version + 1,
          },
        });
      });

    await request(app.getHttpServer())
      .patch(`/api/v1/whatsapp/quote-proposals/${quote.id}/status`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId,
        expectedVersion: conversation.version,
        status: 'under-review',
      })
      .expect(200)
      .expect(({ body }) => expect(body.idempotent).toBe(true));

    await request(app.getHttpServer())
      .patch(`/api/v1/whatsapp/quote-proposals/${quote.id}/status`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: conversation.version + 1,
        status: 'waiting-for-customer',
      })
      .expect(400);

    const cancellationReason = 'Cliente desistiu antes do envio da proposta.';
    await request(app.getHttpServer())
      .patch(`/api/v1/whatsapp/quote-proposals/${quote.id}/status`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: conversation.version + 1,
        status: 'cancelled',
        closureClassification: 'opportunity-abandoned',
        reason: cancellationReason,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          stage: 'cancelled',
          quoteRequest: {
            status: 'cancelled',
            decision: {
              classification: 'opportunity-abandoned',
              reason: cancellationReason,
              decidedBy: { id: actor.id, name: actor.name },
            },
          },
          conversation: {
            requestStatus: 'cancelled',
            version: conversation.version + 2,
          },
        });
      });

    expect(
      await prisma.tenantAuditLog.findFirstOrThrow({
        where: {
          companyId: tenantId,
          action: 'whatsapp.quote-proposal.status-change',
          targetId: quote.id,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ).toMatchObject({
      actorUserId: actor.id,
      metadata: expect.objectContaining({
        fromStatus: 'under-review',
        toStatus: 'cancelled',
        closureClassification: 'opportunity-abandoned',
        reason: cancellationReason,
      }),
    });
  });

  it('persiste PDF, enfileira envio idempotente e só aguarda cliente após confirmação Evolution', async () => {
    const actor = await prisma.user.findFirstOrThrow({
      where: { companyId: tenantId, usernameNormalized: 'admin.e2e' },
    });
    const contact = await prisma.whatsAppContact.create({
      data: {
        companyId: tenantId,
        phoneNormalized: '5511977773333',
        phoneDisplay: formatWhatsAppPhone('5511977773333'),
        displayName: 'Cliente proposta PDF',
      },
    });
    const proposalConversation = await prisma.whatsAppConversation.create({
      data: {
        companyId: tenantId,
        channelId,
        contactId: contact.id,
        department: 'COMMERCIAL',
        conversationState: 'BOT_ACTIVE',
        flowStep: 'QUOTE_SEND_PENDING',
        requestStatus: 'UNDER_REVIEW',
      },
    });
    const proposalQuote = await prisma.quoteRequest.create({
      data: {
        companyId: tenantId,
        conversationId: proposalConversation.id,
        sequence: 1,
        status: 'UNDER_REVIEW',
        contactName: 'Cliente proposta PDF',
        serviceType: 'Fretamento eventual',
        origin: 'Uberlândia',
        destination: 'Goiânia',
        departureAt: new Date('2026-08-10T12:00:00.000Z'),
        passengerCount: 20,
        confirmedAt: new Date(),
        confirmedVersion: 1,
        confirmedSummary: {
          contactName: 'Cliente proposta PDF',
          serviceType: 'Fretamento eventual',
          origin: 'Uberlândia',
          destination: 'Goiânia',
          departureAt: '2026-08-10T12:00:00.000Z',
          passengerCount: 20,
        },
      },
    });
    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n',
    );

    const queue = await request(app.getHttpServer())
      .get('/api/v1/whatsapp/quote-proposals?page=1&pageSize=100')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(queue.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: proposalQuote.id,
          quoteRequest: expect.objectContaining({
            status: 'under-review',
            origin: 'Uberlândia',
            destination: 'Goiânia',
          }),
          conversation: expect.objectContaining({
            id: proposalConversation.id,
            version: 1,
          }),
          proposalDocument: null,
        }),
      ]),
    );

    await request(app.getHttpServer())
      .post(`/api/v1/whatsapp/quote-proposals/${proposalQuote.id}/documents`)
      .set('authorization', `Bearer ${accessToken}`)
      .field('commandId', randomUUID())
      .field('expectedVersion', '1')
      .attach('file', Buffer.from('not a pdf'), {
        filename: 'orcamento.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);

    const uploadCommandId = randomUUID();
    const upload = await request(app.getHttpServer())
      .post(`/api/v1/whatsapp/quote-proposals/${proposalQuote.id}/documents`)
      .set('authorization', `Bearer ${accessToken}`)
      .field('commandId', uploadCommandId)
      .field('expectedVersion', '1')
      .attach('file', pdf, {
        filename: 'orcamento-e2e.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    expect(upload.body).toMatchObject({
      idempotent: false,
      proposalDocument: {
        quoteRequestId: proposalQuote.id,
        conversationId: proposalConversation.id,
        status: 'uploaded',
        fileName: 'orcamento-e2e.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdf.byteLength,
      },
      conversation: { id: proposalConversation.id, version: 1 },
    });
    expect(upload.body.proposalDocument.sha256).toMatch(/^[0-9a-f]{64}$/);
    const documentId = upload.body.proposalDocument.id as string;
    const duplicateUpload = await request(app.getHttpServer())
      .post(`/api/v1/whatsapp/quote-proposals/${proposalQuote.id}/documents`)
      .set('authorization', `Bearer ${accessToken}`)
      .field('commandId', uploadCommandId)
      .field('expectedVersion', '1')
      .attach('file', pdf, {
        filename: 'orcamento-e2e.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    expect(duplicateUpload.body).toMatchObject({
      idempotent: true,
      proposalDocument: { id: documentId },
    });
    expect(
      await prisma.quoteProposalDocument.count({
        where: { companyId: tenantId, quoteRequestId: proposalQuote.id },
      }),
    ).toBe(1);

    const panelDownload = await request(app.getHttpServer())
      .get(
        `/api/v1/whatsapp/quote-proposals/${proposalQuote.id}/documents/${documentId}/content`,
      )
      .set('authorization', `Bearer ${accessToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(panelDownload.body).toEqual(pdf);
    expect(panelDownload.headers['x-content-sha256']).toBe(
      upload.body.proposalDocument.sha256,
    );

    const sendCommandId = randomUUID();
    const sendBatchId = randomUUID();
    const send = await request(app.getHttpServer())
      .post(`/api/v1/whatsapp/quote-proposals/${proposalQuote.id}/send`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId: sendCommandId,
        expectedVersion: 1,
        proposalDocumentId: documentId,
        batchId: sendBatchId,
        batchDocumentIds: [documentId],
      })
      .expect(201);
    expect(send.body).toMatchObject({
      idempotent: false,
      message: {
        direction: 'outbound',
        deliveryStatus: 'pending',
        kind: 'document',
      },
      conversation: {
        id: proposalConversation.id,
        conversationState: 'human-active',
        assignedTo: { id: actor.id, name: actor.name },
        requestStatus: 'under-review',
        version: 2,
      },
      proposalDocument: {
        id: documentId,
        status: 'queued',
      },
    });
    const messageId = send.body.message.id as string;
    const attemptId = send.body.message.attempts[0].id as string;
    const duplicateSend = await request(app.getHttpServer())
      .post(`/api/v1/whatsapp/quote-proposals/${proposalQuote.id}/send`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId: sendCommandId,
        expectedVersion: 1,
        proposalDocumentId: documentId,
        batchId: sendBatchId,
        batchDocumentIds: [documentId],
      })
      .expect(201);
    expect(duplicateSend.body).toMatchObject({
      idempotent: true,
      message: { id: messageId },
      proposalDocument: { id: documentId },
    });
    expect(
      await prisma.whatsAppMessage.count({
        where: { id: messageId, companyId: tenantId },
      }),
    ).toBe(1);
    expect(
      await prisma.whatsAppConversationTransition.findFirstOrThrow({
        where: {
          companyId: tenantId,
          conversationId: proposalConversation.id,
          name: 'take-over',
          actorUserId: actor.id,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ).toMatchObject({
      fromState: 'BOT_ACTIVE',
      toState: 'HUMAN_ACTIVE',
      metadata: {
        source: 'quote-proposal-send',
        quoteRequestId: proposalQuote.id,
        proposalDocumentId: documentId,
      },
    });

    const outbound = await prisma.integrationOutbox.findFirstOrThrow({
      where: {
        companyId: tenantId,
        topic: 'whatsapp.outbound.requested',
        aggregateId: proposalConversation.id,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(outbound.payload).toMatchObject({
      commandId: sendCommandId,
      messageId,
      attemptId,
      automatic: false,
      canGenerateReply: false,
      canSendReply: true,
      message: {
        kind: 'document',
        deliveryStatus: 'pending',
        media: {
          documentId,
          fileName: 'orcamento-e2e.pdf',
          mimetype: 'application/pdf',
          sizeBytes: pdf.byteLength,
          sha256: upload.body.proposalDocument.sha256,
        },
      },
    });
    const outboundExecutionId = randomUUID();
    await prisma.integrationOutbox.update({
      where: { id: outbound.id },
      data: {
        status: 'PROCESSING',
        processingProvider: null,
        executionId: outboundExecutionId,
        acceptedAt: new Date(),
        executionLeaseUntil: new Date(Date.now() + 60_000),
      },
    });
    const outboundCompletion = {
      commandId: randomUUID(),
      executionId: outboundExecutionId,
      aggregateType: outbound.aggregateType,
      aggregateId: outbound.aggregateId,
      outcome: 'succeeded',
    };
    await expect(
      completeAutomationOutbox({
        ...outboundCompletion,
        eventId: outbound.id,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const internalDocument =
      (await commercialQuoteRepository.getQuoteProposalDocument(
        tenantId,
        documentId,
      )) as { content: Buffer };
    expect(internalDocument.content).toEqual(pdf);

    await claimEvolution({
      messageId,
      commandId: randomUUID(),
      attemptId,
    });

    await expect(
      recordEvolution({
        messageId,
        commandId: randomUUID(),
        attemptId,
        status: 'sent',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(
      await prisma.whatsAppConversation.findUniqueOrThrow({
        where: {
          id_companyId: {
            id: proposalConversation.id,
            companyId: tenantId,
          },
        },
      }),
    ).toMatchObject({
      conversationState: 'HUMAN_ACTIVE',
      requestStatus: 'UNDER_REVIEW',
      assignedToUserId: actor.id,
      version: 2,
    });
    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${proposalConversation.id}/actions/forward`,
      )
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: 2,
        targetDepartment: 'operations',
        reason: 'Tentativa de transferência para Operacional.',
      })
      .expect(409);

    const resultCommandId = randomUUID();
    const evolutionResult = {
      messageId,
      commandId: resultCommandId,
      attemptId,
      status: 'sent' as const,
      providerMessageId: 'evolution-proposal-pdf-e2e',
    };
    await recordEvolution(evolutionResult);
    await expect(recordEvolution(evolutionResult)).resolves.toMatchObject({
      idempotent: true,
    });
    await expect(
      completeAutomationOutbox({
        ...outboundCompletion,
        eventId: outbound.id,
      }),
    ).resolves.toMatchObject({
      eventId: outbound.id,
      outcome: 'succeeded',
      status: 'delivered',
    });

    expect(
      await prisma.whatsAppConversation.findUniqueOrThrow({
        where: {
          id_companyId: {
            id: proposalConversation.id,
            companyId: tenantId,
          },
        },
      }),
    ).toMatchObject({
      conversationState: 'WAITING_FOR_CUSTOMER',
      flowStep: 'QUOTE_SEND_PENDING',
      requestStatus: 'WAITING_FOR_CUSTOMER',
      assignedToUserId: null,
      version: 3,
    });
    expect(
      await prisma.quoteRequest.findUniqueOrThrow({
        where: {
          id_companyId: { id: proposalQuote.id, companyId: tenantId },
        },
      }),
    ).toMatchObject({
      status: 'WAITING_FOR_CUSTOMER',
      version: 2,
    });
    expect(
      await prisma.quoteProposalDocument.findUniqueOrThrow({
        where: { id_companyId: { id: documentId, companyId: tenantId } },
      }),
    ).toMatchObject({
      status: 'SENT',
      providerMessageId: 'evolution-proposal-pdf-e2e',
      messageId,
    });
    expect(
      await prisma.whatsAppConversationTransition.findFirstOrThrow({
        where: {
          companyId: tenantId,
          conversationId: proposalConversation.id,
          name: 'proposal-delivery-confirmed',
        },
      }),
    ).toMatchObject({
      expectedVersion: 2,
      resultingVersion: 3,
      toState: 'WAITING_FOR_CUSTOMER',
      toRequestStatus: 'WAITING_FOR_CUSTOMER',
    });

    const queueAfterDelivery = await request(app.getHttpServer())
      .get('/api/v1/whatsapp/quote-proposals?page=1&pageSize=100')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    const remainingItems = queueAfterDelivery.body.items as Array<{
      id: string;
    }>;
    expect(remainingItems.some((item) => item.id === proposalQuote.id)).toBe(
      false,
    );

    const sentProposals = await request(app.getHttpServer())
      .get('/api/v1/whatsapp/quote-proposals?stage=sent&page=1&pageSize=100')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(sentProposals.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: proposalQuote.id,
          stage: 'sent',
          quoteRequest: expect.objectContaining({
            status: 'waiting-for-customer',
          }),
          conversation: expect.objectContaining({
            id: proposalConversation.id,
            conversationState: 'waiting-for-customer',
            requestStatus: 'waiting-for-customer',
          }),
          proposalDocument: expect.objectContaining({
            id: documentId,
            status: 'sent',
            providerMessageId: 'evolution-proposal-pdf-e2e',
          }),
        }),
      ]),
    );

    const customerResponse = await signedWebhook(
      app,
      webhookPayload(
        'proposal-customer-response-e2e',
        contact.phoneNormalized,
        'Tenho uma dúvida sobre o orçamento.',
      ),
    ).expect(202);
    expect(customerResponse.body).toMatchObject({
      automationAllowed: false,
      canGenerateReply: false,
      canSendReply: false,
      conversationId: proposalConversation.id,
      version: 4,
    });
    expect(
      await prisma.whatsAppConversation.findUniqueOrThrow({
        where: {
          id_companyId: {
            id: proposalConversation.id,
            companyId: tenantId,
          },
        },
      }),
    ).toMatchObject({
      conversationState: 'SENT_TO_HUMAN',
      flowStep: 'HUMAN_SERVICE',
      requestStatus: 'WAITING_FOR_CUSTOMER',
      resumeFlowStep: 'COMMERCIAL_FOLLOW_UP_MENU',
      version: 4,
    });
    expect(
      await prisma.whatsAppConversationTransition.findFirstOrThrow({
        where: {
          companyId: tenantId,
          conversationId: proposalConversation.id,
          name: 'proposal-response-received',
        },
      }),
    ).toMatchObject({
      expectedVersion: 3,
      resultingVersion: 4,
      toState: 'SENT_TO_HUMAN',
      toFlowStep: 'HUMAN_SERVICE',
    });
    expect(
      await prisma.integrationOutbox.findFirstOrThrow({
        where: {
          companyId: tenantId,
          aggregateId: proposalConversation.id,
          topic: 'whatsapp.inbound.human-notification',
        },
        orderBy: { createdAt: 'desc' },
      }),
    ).toMatchObject({
      topic: 'whatsapp.inbound.human-notification',
    });

    const decisionCommandId = randomUUID();
    const rejectedProposal = await request(app.getHttpServer())
      .patch(`/api/v1/whatsapp/quote-proposals/${proposalQuote.id}/decision`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId: decisionCommandId,
        expectedVersion: 4,
        decision: 'rejected',
        reason: 'Cliente solicitou uma nova data para a viagem.',
      })
      .expect(200);
    expect(rejectedProposal.body).toMatchObject({
      id: proposalQuote.id,
      stage: 'cancelled',
      quoteRequest: {
        status: 'rejected',
        decision: {
          status: 'rejected',
          reason: 'Cliente solicitou uma nova data para a viagem.',
          decidedBy: { id: actor.id, name: actor.name },
        },
      },
      conversation: {
        id: proposalConversation.id,
        requestStatus: 'rejected',
        version: 5,
      },
      proposalDocument: {
        id: documentId,
        status: 'sent',
        sentBy: { id: actor.id, name: actor.name },
      },
    });
    const cancelledProposals = await request(app.getHttpServer())
      .get(
        '/api/v1/whatsapp/quote-proposals?stage=cancelled&search=Cliente%20proposta%20PDF&page=1&pageSize=100',
      )
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(cancelledProposals.body).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: proposalQuote.id,
          stage: 'cancelled',
          quoteRequest: expect.objectContaining({
            status: 'rejected',
            decision: expect.objectContaining({
              status: 'rejected',
              classification: 'quote-rejected',
              reason: 'Cliente solicitou uma nova data para a viagem.',
              decidedAt: expect.any(String),
              decidedBy: { id: actor.id, name: actor.name },
            }),
          }),
        }),
      ]),
      summary: {
        pending: expect.any(Number),
        sent: expect.any(Number),
        approved: expect.any(Number),
        cancelled: expect.any(Number),
        rejected: expect.any(Number),
        commercialClosures: expect.any(Number),
        cancellationReasons: expect.arrayContaining([
          {
            reason: 'Cliente solicitou uma nova data para a viagem.',
            count: 1,
          },
        ]),
        closureClassifications: expect.arrayContaining([
          { classification: 'quote-rejected', count: 1 },
        ]),
      },
      filters: {
        search: 'Cliente proposta PDF',
        createdFrom: null,
        createdTo: null,
      },
    });
    expect(cancelledProposals.body.summary.cancelled).toBeGreaterThanOrEqual(1);

    const approvedContact = await prisma.whatsAppContact.create({
      data: {
        companyId: tenantId,
        phoneNormalized: '5511977773334',
        phoneDisplay: formatWhatsAppPhone('5511977773334'),
        displayName: 'Cliente proposta aprovada',
      },
    });
    const approvedConversation = await prisma.whatsAppConversation.create({
      data: {
        companyId: tenantId,
        channelId,
        contactId: approvedContact.id,
        department: 'COMMERCIAL',
        conversationState: 'BOT_ACTIVE',
        flowStep: 'COMMERCIAL_FOLLOW_UP_MENU',
        requestStatus: 'APPROVED',
      },
    });
    const approvedQuote = await prisma.quoteRequest.create({
      data: {
        companyId: tenantId,
        conversationId: approvedConversation.id,
        sequence: 1,
        status: 'APPROVED',
      },
    });

    await request(app.getHttpServer())
      .get(
        '/api/v1/whatsapp/quote-proposals?stage=approved&page=1&pageSize=100',
      )
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.summary.approved).toBeGreaterThanOrEqual(1);
        expect(
          (body.items as Array<{ id: string }>).map(({ id }) => id),
        ).toContain(approvedQuote.id);
        expect(
          (body.items as Array<{ quoteRequest: { status: string } }>).every(
            (item) => item.quoteRequest.status === 'approved',
          ),
        ).toBe(true);
      });
    await request(app.getHttpServer())
      .patch(`/api/v1/whatsapp/quote-proposals/${proposalQuote.id}/decision`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId: decisionCommandId,
        expectedVersion: 4,
        decision: 'rejected',
        reason: 'Cliente solicitou uma nova data para a viagem.',
      })
      .expect(200)
      .expect(({ body }) => expect(body.idempotent).toBe(true));

    await request(app.getHttpServer())
      .patch(`/api/v1/whatsapp/quote-proposals/${proposalQuote.id}/decision`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: 5,
        decision: 'approved',
      })
      .expect(409);
    expect(
      await prisma.quoteRequest.findUniqueOrThrow({
        where: {
          id_companyId: {
            id: proposalQuote.id,
            companyId: tenantId,
          },
        },
      }),
    ).toMatchObject({
      status: 'REJECTED',
      decisionReason: 'Cliente solicitou uma nova data para a viagem.',
      decidedByUserId: actor.id,
    });

    const newProposal = await request(app.getHttpServer())
      .post('/api/v1/whatsapp/quote-proposals')
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: 5,
        conversationId: proposalConversation.id,
        contactName: 'Cliente proposta PDF',
        document: null,
        email: 'cliente.proposta@example.test',
        serviceType: 'Fretamento eventual',
        origin: 'Uberlândia',
        destination: 'Brasília',
        departureAt: '2026-09-10T12:00:00.000Z',
        returnAt: null,
        passengerCount: 24,
        vehicleType: 'Ônibus',
        vehicleAtDisposal: false,
        localTransfers: true,
        notes: 'Nova data solicitada pelo cliente.',
      })
      .expect(201);
    expect(newProposal.body).toMatchObject({
      stage: 'pending',
      quoteRequest: {
        sequence: 2,
        status: 'under-review',
        requestedBy: {
          type: 'attendant',
          id: actor.id,
          name: actor.name,
        },
      },
      conversation: {
        id: proposalConversation.id,
        conversationState: 'human-active',
        flowStep: 'quote-send-pending',
        requestStatus: 'under-review',
        assignedTo: { id: actor.id, name: actor.name },
        version: 6,
      },
      proposalDocument: null,
    });
    expect(
      await prisma.quoteRequest.findUniqueOrThrow({
        where: {
          id_companyId: {
            id: newProposal.body.id as string,
            companyId: tenantId,
          },
        },
      }),
    ).toMatchObject({
      sequence: 2,
      requestedByUserId: actor.id,
      status: 'UNDER_REVIEW',
    });

    const reusedProposal = await request(app.getHttpServer())
      .post('/api/v1/whatsapp/quote-proposals')
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: 6,
        conversationId: proposalConversation.id,
        contactName: 'Cliente proposta PDF',
        document: null,
        email: 'cliente.proposta@example.test',
        serviceType: 'Fretamento eventual',
        origin: 'Uberlândia - MG',
        destination: 'Brasília - DF',
        departureAt: '2026-09-10T13:00:00.000Z',
        returnAt: null,
        passengerCount: 25,
        vehicleType: 'Ônibus',
        vehicleAtDisposal: false,
        localTransfers: true,
        notes: 'Solicitação pendente atualizada pelo atendente.',
      })
      .expect(201);
    expect(reusedProposal.body).toMatchObject({
      id: newProposal.body.id,
      quoteRequest: {
        sequence: 2,
        status: 'under-review',
        origin: 'Uberlândia - MG',
        destination: 'Brasília - DF',
        passengerCount: 25,
      },
      conversation: {
        id: proposalConversation.id,
        requestStatus: 'under-review',
        version: 7,
      },
    });
    expect(
      await prisma.quoteRequest.count({
        where: {
          companyId: tenantId,
          conversationId: proposalConversation.id,
        },
      }),
    ).toBe(2);

    const otherAttendantSuffix = randomUUID().slice(0, 8);
    const otherAttendant = await prisma.user.create({
      data: {
        companyId: tenantId,
        name: 'Outro atendente',
        username: `outro.${otherAttendantSuffix}`,
        usernameNormalized: `outro.${otherAttendantSuffix}`,
        email: `${randomUUID()}@example.test`,
        emailNormalized: `${randomUUID()}@example.test`,
        passwordHash: 'hash-e2e-sem-uso',
        departments: ['commercial'],
      },
    });
    await prisma.whatsAppConversation.update({
      where: {
        id_companyId: {
          id: proposalConversation.id,
          companyId: tenantId,
        },
      },
      data: { assignedToUserId: otherAttendant.id },
    });
    const replacedAssignment = await request(app.getHttpServer())
      .post('/api/v1/whatsapp/quote-proposals')
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: 7,
        conversationId: proposalConversation.id,
        contactName: 'Cliente proposta PDF',
        serviceType: 'Fretamento eventual',
        origin: 'Uberlândia',
        destination: 'Brasília',
        departureAt: '2026-10-10T12:00:00.000Z',
        passengerCount: 24,
        vehicleAtDisposal: false,
        localTransfers: false,
      })
      .expect(201);
    expect(replacedAssignment.body).toMatchObject({
      id: newProposal.body.id,
      stage: 'pending',
      idempotent: false,
      quoteRequest: {
        sequence: 2,
        status: 'under-review',
        passengerCount: 24,
      },
      conversation: {
        id: proposalConversation.id,
        assignedTo: { id: actor.id, name: actor.name },
        version: 8,
      },
    });
    expect(
      await prisma.whatsAppConversation.findUniqueOrThrow({
        where: {
          id_companyId: {
            id: proposalConversation.id,
            companyId: tenantId,
          },
        },
      }),
    ).toMatchObject({
      assignedToUserId: actor.id,
      version: 8,
    });
    expect(
      await prisma.quoteRequest.count({
        where: {
          companyId: tenantId,
          conversationId: proposalConversation.id,
        },
      }),
    ).toBe(2);
    await expect(
      prisma.whatsAppConversationTransition.findFirstOrThrow({
        where: {
          companyId: tenantId,
          conversationId: proposalConversation.id,
          actorUserId: actor.id,
          name: 'take-over',
          resultingVersion: 8,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ).resolves.toMatchObject({
      metadata: expect.objectContaining({
        source: 'quote-proposal-create',
        assignment: {
          previousAssignedToUserId: otherAttendant.id,
          resultingAssignedToUserId: actor.id,
          changedByUserId: actor.id,
          cause: 'quote-proposal-create',
        },
      }),
    });
    expect(actor.isActive).toBe(true);
  });

  it('permite encerramento com proposta ativa pela flag padrão e encerra conversa geral', async () => {
    const activeInbound = await signedWebhook(
      app,
      webhookPayload(
        'close-active-proposal-contact',
        '5511988877710',
        'Preciso de orçamento',
      ),
    ).expect(202);
    const activeConversationId = activeInbound.body.conversationId as string;
    await prisma.quoteRequest.create({
      data: {
        companyId: tenantId,
        conversationId: activeConversationId,
        sequence: 1,
        status: 'COLLECTING_INFORMATION',
      },
    });
    const activeConversation = await prisma.whatsAppConversation.update({
      where: {
        id_companyId: {
          id: activeConversationId,
          companyId: tenantId,
        },
      },
      data: {
        conversationState: 'BOT_ACTIVE',
        flowStep: 'QUOTE_DATA_COLLECTION',
        requestStatus: 'COLLECTING_INFORMATION',
        version: { increment: 1 },
      },
    });

    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${activeConversationId}/actions/close`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: activeConversation.version,
        reason: 'Atendimento interrompido.',
      })
      .expect(201)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          conversationState: 'closed',
          requestStatus: 'collecting-information',
          version: activeConversation.version + 1,
        }),
      );
    expect(
      await prisma.whatsAppConversation.findUniqueOrThrow({
        where: {
          id_companyId: {
            id: activeConversationId,
            companyId: tenantId,
          },
        },
      }),
    ).toMatchObject({
      conversationState: 'CLOSED',
      closedAt: expect.any(Date),
      version: activeConversation.version + 1,
    });

    const approvedHistoryInbound = await signedWebhook(
      app,
      webhookPayload(
        'close-approved-history-contact',
        '5511988877713',
        'Atendimento com viagem aprovada',
      ),
    ).expect(202);
    const approvedHistoryConversationId = approvedHistoryInbound.body
      .conversationId as string;
    await prisma.quoteRequest.create({
      data: {
        companyId: tenantId,
        conversationId: approvedHistoryConversationId,
        sequence: 1,
        status: 'APPROVED',
      },
    });
    await prisma.quoteRequest.create({
      data: {
        companyId: tenantId,
        conversationId: approvedHistoryConversationId,
        sequence: 2,
        status: 'REJECTED',
        decisionReason: 'Segundo orçamento recusado.',
        decidedAt: new Date(),
      },
    });
    const approvedHistoryConversation =
      await prisma.whatsAppConversation.update({
        where: {
          id_companyId: {
            id: approvedHistoryConversationId,
            companyId: tenantId,
          },
        },
        data: {
          conversationState: 'SENT_TO_HUMAN',
          flowStep: 'HUMAN_SERVICE',
          requestStatus: 'REJECTED',
          version: { increment: 1 },
        },
      });

    await request(app.getHttpServer())
      .get(`/api/v1/whatsapp/conversations/${approvedHistoryConversationId}`)
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          hasApprovedQuoteRequest: true,
          currentQuoteRequest: { status: 'rejected' },
        }),
      );

    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${approvedHistoryConversationId}/actions/close`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: approvedHistoryConversation.version,
        reason: 'Encerramento solicitado pelo atendente.',
      })
      .expect(201)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          conversationState: 'closed',
          requestStatus: 'rejected',
        }),
      );

    const generalInbound = await signedWebhook(
      app,
      webhookPayload(
        'close-general-contact',
        '5511988877711',
        'Atendimento simples',
      ),
    ).expect(202);
    const generalConversationId = generalInbound.body.conversationId as string;
    const generalConversation =
      await prisma.whatsAppConversation.findUniqueOrThrow({
        where: {
          id_companyId: {
            id: generalConversationId,
            companyId: tenantId,
          },
        },
      });

    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${generalConversationId}/actions/close`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: generalConversation.version + 1,
      })
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          details: { currentVersion: generalConversation.version },
        }),
      );

    const closeCommandId = randomUUID();
    const closedResponse = await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${generalConversationId}/actions/close`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({
        commandId: closeCommandId,
        expectedVersion: generalConversation.version,
      })
      .expect(201);
    expect(closedResponse.body).toMatchObject({
      id: generalConversationId,
      conversationState: 'closed',
      flowStep: 'closed',
      requestStatus: 'not-started',
      version: generalConversation.version + 1,
      closure: {
        transitionName: 'close',
        reason: null,
        actor: {
          type: 'user',
          user: { id: expect.any(String) },
        },
      },
      idempotent: false,
    });
    expect(
      await prisma.whatsAppConversationTransition.findUniqueOrThrow({
        where: {
          companyId_commandId: {
            companyId: tenantId,
            commandId: closeCommandId,
          },
        },
      }),
    ).toMatchObject({
      name: 'close',
      metadata: { reason: null, quoteRequestId: null },
    });
    const farewellMessage = await prisma.whatsAppMessage.findFirstOrThrow({
      where: {
        companyId: tenantId,
        conversationId: generalConversationId,
        direction: 'OUTBOUND',
        actorUserId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      include: { attempts: true },
    });
    expect(farewellMessage).toMatchObject({
      deliveryStatus: 'PENDING',
      kind: 'TEXT',
      text: expect.stringContaining('Foi um prazer te atender!'),
      attempts: [expect.objectContaining({ status: 'PENDING' })],
    });
    expect(
      await prisma.integrationOutbox.findFirstOrThrow({
        where: {
          companyId: tenantId,
          aggregateId: generalConversationId,
          topic: 'whatsapp.outbound.requested',
        },
        orderBy: { aggregateSequence: 'desc' },
      }),
    ).toMatchObject({
      payload: expect.objectContaining({
        messageId: farewellMessage.id,
        automatic: false,
        canSendReply: true,
      }),
    });

    const rejectedInbound = await signedWebhook(
      app,
      webhookPayload(
        'close-rejected-without-reason',
        '5511988877712',
        'Recusei a proposta',
      ),
    ).expect(202);
    const rejectedConversationId = rejectedInbound.body
      .conversationId as string;
    await prisma.quoteRequest.create({
      data: {
        companyId: tenantId,
        conversationId: rejectedConversationId,
        sequence: 1,
        status: 'REJECTED',
      },
    });
    const rejectedConversation = await prisma.whatsAppConversation.update({
      where: {
        id_companyId: {
          id: rejectedConversationId,
          companyId: tenantId,
        },
      },
      data: {
        conversationState: 'SENT_TO_HUMAN',
        flowStep: 'HUMAN_SERVICE',
        requestStatus: 'REJECTED',
        version: { increment: 1 },
      },
    });
    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${rejectedConversationId}/actions/close`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: rejectedConversation.version,
      })
      .expect(400);

    const explicitReason = 'Proposta recusada pelo cliente.';
    const rejectedCloseCommandId = randomUUID();
    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${rejectedConversationId}/actions/close`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({
        commandId: rejectedCloseCommandId,
        expectedVersion: rejectedConversation.version,
        reason: explicitReason,
      })
      .expect(201);
    expect(
      await prisma.whatsAppConversationTransition.findUniqueOrThrow({
        where: {
          companyId_commandId: {
            companyId: tenantId,
            commandId: rejectedCloseCommandId,
          },
        },
      }),
    ).toMatchObject({
      name: 'close',
      metadata: { reason: explicitReason },
    });
  });

  it('encerra uma proposta recusada e o próximo inbound reabre a conversa canônica pelo menu inicial', async () => {
    const phone = '5511988877700';
    const firstInbound = await signedWebhook(
      app,
      webhookPayload('close-rejected-first-contact', phone, 'Olá'),
    ).expect(202);
    const rejectedConversationId = firstInbound.body.conversationId as string;
    const assignee = commercialAttendant;

    const rejected = await prisma.whatsAppConversation.update({
      where: {
        id_companyId: {
          id: rejectedConversationId,
          companyId: tenantId,
        },
      },
      data: {
        conversationState: 'HUMAN_ACTIVE',
        flowStep: 'HUMAN_SERVICE',
        requestStatus: 'REJECTED',
        assignedToUserId: assignee.id,
        version: { increment: 1 },
      },
    });
    const decisionReason = 'Cliente recusou a proposta apresentada.';
    await prisma.quoteRequest.create({
      data: {
        companyId: tenantId,
        conversationId: rejectedConversationId,
        sequence: 1,
        status: 'REJECTED',
        decisionReason,
        decidedAt: new Date(),
        decidedByUserId: assignee.id,
      },
    });

    const closeCommandId = randomUUID();
    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${rejectedConversationId}/actions/close-after-rejection`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({
        commandId: closeCommandId,
        expectedVersion: rejected.version,
      })
      .expect(201);

    const closed = await prisma.whatsAppConversation.findUniqueOrThrow({
      where: {
        id_companyId: {
          id: rejectedConversationId,
          companyId: tenantId,
        },
      },
    });
    expect(closed).toMatchObject({
      conversationState: 'CLOSED',
      flowStep: 'CLOSED',
      requestStatus: 'REJECTED',
      assignedToUserId: null,
      unreadCount: 0,
    });
    expect(closed.closedAt).toBeInstanceOf(Date);

    const closeTransition =
      await prisma.whatsAppConversationTransition.findUniqueOrThrow({
        where: {
          companyId_commandId: {
            companyId: tenantId,
            commandId: closeCommandId,
          },
        },
      });
    expect(closeTransition).toMatchObject({
      name: 'close',
      actorType: 'USER',
      actorUserId: assignee.id,
      resultingVersion: rejected.version + 1,
      metadata: {
        reason: decisionReason,
      },
    });
    expect(closeTransition.createdAt).toEqual(closed.closedAt);
    expect(
      await prisma.tenantAuditLog.findFirstOrThrow({
        where: {
          companyId: tenantId,
          action: 'whatsapp.conversation.close',
          targetId: rejectedConversationId,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ).toMatchObject({
      actorUserId: assignee.id,
      metadata: {
        transitionId: closeTransition.id,
        transitionName: 'close',
        commandId: closeCommandId,
        reason: decisionReason,
      },
      createdAt: closed.closedAt,
    });

    await request(app.getHttpServer())
      .get(`/api/v1/whatsapp/conversations/${rejectedConversationId}`)
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          id: rejectedConversationId,
          conversationState: 'closed',
          closedAt: closed.closedAt?.toISOString(),
          closure: {
            transitionId: closeTransition.id,
            transitionName: 'close',
            occurredAt: closed.closedAt?.toISOString(),
            reason: decisionReason,
            actor: {
              type: 'user',
              user: { id: assignee.id },
            },
          },
        }),
      );

    await request(app.getHttpServer())
      .get(
        `/api/v1/whatsapp/conversations/${rejectedConversationId}/transitions?page=1&pageSize=100`,
      )
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: closeTransition.id,
              name: 'close',
              metadata: expect.objectContaining({ reason: decisionReason }),
              actor: {
                type: 'user',
                user: { id: assignee.id, name: expect.any(String) },
              },
              createdAt: closed.closedAt?.toISOString(),
            }),
          ]),
        ),
      );

    await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${rejectedConversationId}/actions/close`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({
        commandId: closeCommandId,
        expectedVersion: rejected.version,
      })
      .expect(201)
      .expect(({ body }) => expect(body.idempotent).toBe(true));

    const nextInbound = await signedWebhook(
      app,
      webhookPayload('close-rejected-next-contact', phone, 'Novo contato'),
    ).expect(202);
    expect(nextInbound.body).toMatchObject({
      isFirstContact: false,
      reopenedAfterClosure: true,
      automationAllowed: true,
      canGenerateReply: true,
      canSendReply: true,
    });
    expect(nextInbound.body.conversationId).toBe(rejectedConversationId);

    const reopened = await prisma.whatsAppConversation.findUniqueOrThrow({
      where: {
        id_companyId: {
          id: nextInbound.body.conversationId as string,
          companyId: tenantId,
        },
      },
    });
    expect(reopened).toMatchObject({
      conversationState: 'BOT_ACTIVE',
      flowStep: 'MAIN_MENU',
      requestStatus: 'REJECTED',
      closedAt: null,
    });

    expect(
      await prisma.whatsAppConversation.count({
        where: {
          companyId: tenantId,
          channelId,
          contactId: reopened.contactId,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.whatsAppConversationTransition.findFirst({
        where: {
          companyId: tenantId,
          conversationId: rejectedConversationId,
          name: 'reopen-after-customer-message',
        },
        orderBy: { createdAt: 'desc' },
      }),
    ).toMatchObject({
      actorType: 'WEBHOOK',
      fromState: 'CLOSED',
      fromFlowStep: 'CLOSED',
      toState: 'BOT_ACTIVE',
      toFlowStep: 'MAIN_MENU',
    });
  });

  it('mantém múltiplos PDFs no ciclo, atribui o remetente, confirma o lote e abre novo ciclo para o mesmo contato', async () => {
    const actor = await prisma.user.findFirstOrThrow({
      where: { companyId: tenantId, usernameNormalized: 'admin.e2e' },
    });
    await request(app.getHttpServer())
      .post('/api/v1/notifications/commercial.pending-quote-proposals/read')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);

    const contact = await prisma.whatsAppContact.create({
      data: {
        companyId: tenantId,
        phoneNormalized: '5534996305110',
        phoneDisplay: formatWhatsAppPhone('5534996305110'),
        displayName: 'Cliente ciclo múltiplo',
      },
    });
    const conversation = await prisma.whatsAppConversation.create({
      data: {
        companyId: tenantId,
        channelId,
        contactId: contact.id,
        department: 'COMMERCIAL',
        conversationState: 'BOT_ACTIVE',
        flowStep: 'QUOTE_SEND_PENDING',
        requestStatus: 'UNDER_REVIEW',
      },
    });
    const quote = await prisma.quoteRequest.create({
      data: {
        companyId: tenantId,
        conversationId: conversation.id,
        sequence: 1,
        status: 'UNDER_REVIEW',
        contactName: 'Cliente ciclo múltiplo',
        serviceType: 'Fretamento eventual',
        origin: 'Uberlândia',
        destination: 'Goiânia',
        departureAt: new Date('2026-09-10T12:00:00.000Z'),
        passengerCount: 18,
        confirmedAt: new Date(),
        confirmedVersion: 1,
        confirmedSummary: { source: 'multi-pdf-e2e' },
      },
    });
    const notificationBeforeRead = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(notificationBeforeRead.body.unreadTotal).toBeGreaterThanOrEqual(1);
    await request(app.getHttpServer())
      .post('/api/v1/notifications/commercial.pending-quote-proposals/read')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.unreadTotal).toBe(0));

    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n',
    );
    const upload = async (fileName: string, expectedVersion = 1) =>
      request(app.getHttpServer())
        .post(`/api/v1/whatsapp/quote-proposals/${quote.id}/documents`)
        .set('authorization', `Bearer ${accessToken}`)
        .field('commandId', randomUUID())
        .field('expectedVersion', String(expectedVersion))
        .attach('file', pdf, {
          filename: fileName,
          contentType: 'application/pdf',
        })
        .expect(201);
    const firstDocument = (await upload('orcamento-a.pdf')).body
      .proposalDocument;
    const secondDocument = (await upload('orcamento-b.pdf')).body
      .proposalDocument;
    await request(app.getHttpServer())
      .get(`/api/v1/whatsapp/quote-proposals/${quote.id}`)
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        const documents = body.documents as Array<{ id: string }>;
        expect(body.documents).toHaveLength(2);
        expect(documents.map((document) => document.id)).toEqual(
          expect.arrayContaining([firstDocument.id, secondDocument.id]),
        );
      });

    const batchId = randomUUID();
    const batchDocumentIds = [
      firstDocument.id as string,
      secondDocument.id as string,
    ];
    const sendDocument = async (
      documentId: string,
      expectedVersion: number,
      currentBatchId = batchId,
      currentBatchDocumentIds = batchDocumentIds,
    ) =>
      request(app.getHttpServer())
        .post(`/api/v1/whatsapp/quote-proposals/${quote.id}/send`)
        .set('authorization', `Bearer ${accessToken}`)
        .send({
          commandId: randomUUID(),
          expectedVersion,
          proposalDocumentId: documentId,
          batchId: currentBatchId,
          batchDocumentIds: currentBatchDocumentIds,
        })
        .expect(201);
    const firstSend = await sendDocument(firstDocument.id as string, 1);
    expect(firstSend.body).toMatchObject({
      conversation: {
        conversationState: 'human-active',
        assignedTo: { id: actor.id, name: actor.name },
        version: 2,
      },
      message: { sentBy: { id: actor.id, name: actor.name } },
    });
    const recordDelivery = async (
      sent: typeof firstSend,
      status: 'sent' | 'failed',
      providerMessageId?: string,
    ) => {
      const messageId = sent.body.message.id as string;
      const attemptId = sent.body.message.attempts[0].id as string;
      await claimEvolution({
        messageId,
        commandId: randomUUID(),
        attemptId,
      });
      await recordEvolution({
        messageId,
        commandId: randomUUID(),
        attemptId,
        status,
        ...(providerMessageId ? { providerMessageId } : {}),
      });
    };
    await recordDelivery(firstSend, 'sent', 'evolution-multi-a');
    await expect(
      prisma.whatsAppConversation.findUniqueOrThrow({
        where: {
          id_companyId: { id: conversation.id, companyId: tenantId },
        },
      }),
    ).resolves.toMatchObject({
      conversationState: 'HUMAN_ACTIVE',
      requestStatus: 'UNDER_REVIEW',
      assignedToUserId: actor.id,
      version: 2,
    });
    const secondSend = await sendDocument(secondDocument.id as string, 2);
    expect(secondSend.body.conversation).toMatchObject({
      conversationState: 'human-active',
      assignedTo: { id: actor.id, name: actor.name },
      version: 3,
    });
    await recordDelivery(secondSend, 'failed');
    await expect(
      prisma.whatsAppConversation.findUniqueOrThrow({
        where: {
          id_companyId: { id: conversation.id, companyId: tenantId },
        },
      }),
    ).resolves.toMatchObject({
      conversationState: 'HUMAN_ACTIVE',
      requestStatus: 'UNDER_REVIEW',
      assignedToUserId: actor.id,
      version: 3,
    });
    const retrySecond = await sendDocument(secondDocument.id as string, 3);
    expect(retrySecond.body.conversation.version).toBe(4);
    await recordDelivery(retrySecond, 'sent', 'evolution-multi-b-retry');
    await expect(
      prisma.whatsAppConversation.findUniqueOrThrow({
        where: {
          id_companyId: { id: conversation.id, companyId: tenantId },
        },
      }),
    ).resolves.toMatchObject({
      conversationState: 'WAITING_FOR_CUSTOMER',
      requestStatus: 'WAITING_FOR_CUSTOMER',
      assignedToUserId: null,
      version: 5,
    });
    await request(app.getHttpServer())
      .get(`/api/v1/whatsapp/conversations/${conversation.id}/messages`)
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        const messages = body.data as Array<{
          automationPurpose: string | null;
          sentBy: { id: string; name: string } | null;
        }>;
        const sent = messages.filter(
          (message) => message.automationPurpose === 'quote-proposal',
        );
        expect(sent).toHaveLength(3);
        expect(sent).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              sentBy: { id: actor.id, name: actor.name },
            }),
          ]),
        );
      });

    const revisionDocument = (await upload('orcamento-revisado.pdf', 5)).body
      .proposalDocument;
    await prisma.quoteProposalDocument.update({
      where: {
        id_companyId: {
          id: firstDocument.id as string,
          companyId: tenantId,
        },
      },
      data: { deliveryBatchId: null },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/whatsapp/quote-proposals/${quote.id}/send`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: 5,
        proposalDocumentId: revisionDocument.id,
        batchId: randomUUID(),
        batchDocumentIds: [
          revisionDocument.id as string,
          firstDocument.id as string,
        ],
      })
      .expect(400);
    const revisionBatchId = randomUUID();
    const revisionSend = await sendDocument(
      revisionDocument.id as string,
      5,
      revisionBatchId,
      [revisionDocument.id as string],
    );
    expect(revisionSend.body.conversation.version).toBe(6);
    await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.unreadTotal).toBeGreaterThanOrEqual(1));
    await recordDelivery(revisionSend, 'sent', 'evolution-multi-revision');

    const customerResponse = await signedWebhook(
      app,
      webhookPayload(
        `multi-pdf-response-${randomUUID()}`,
        contact.phoneNormalized,
        'Preciso de um novo orçamento.',
      ),
    ).expect(202);
    expect(customerResponse.body.version).toBe(8);
    const takenForNewCycle = await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${conversation.id}/actions/take-over`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: customerResponse.body.version,
      })
      .expect(201);
    const returned = await request(app.getHttpServer())
      .post(
        `/api/v1/whatsapp/conversations/${conversation.id}/actions/return-to-bot`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: takenForNewCycle.body.version,
      })
      .expect(201);
    expect(returned.body).toMatchObject({
      conversationState: 'bot-active',
      flowStep: 'commercial-follow-up-menu',
      requestStatus: 'waiting-for-customer',
      version: customerResponse.body.version + 2,
    });
    const newCycle = {
      body: await transitionSystem({
        conversationId: conversation.id,
        commandId: randomUUID(),
        expectedVersion: returned.body.version,
        name: 'new-quote-request',
      }),
    };
    expect(newCycle.body).toMatchObject({
      flowStep: 'quote-data-collection',
      requestStatus: 'collecting-information',
      version: returned.body.version + 1,
    });
    const quotes = await prisma.quoteRequest.findMany({
      where: { companyId: tenantId, conversationId: conversation.id },
      orderBy: { sequence: 'asc' },
    });
    expect(quotes).toHaveLength(2);
    expect(quotes.map((item) => [item.sequence, item.status])).toEqual([
      [1, 'WAITING_FOR_CUSTOMER'],
      [2, 'COLLECTING_INFORMATION'],
    ]);

    const nextCycleQuote = quotes[1];
    const nextDepartureAt = parseBusinessDateTime(
      '2026-12-10T12:00:00.000Z',
      'departureAt',
    );
    await patchQuoteFromAutomation(nextCycleQuote.id, {
      commandId: randomUUID(),
      expectedVersion: nextCycleQuote.version,
      contactName: 'Cliente ciclo múltiplo',
      serviceType: 'Fretamento eventual',
      origin: 'Uberlândia',
      destination: 'Brasília',
      departureDate: dateOnlyFromDateTime(nextDepartureAt),
      departureAt: nextDepartureAt,
      passengerCount: 22,
    });
    await transitionSystem({
      conversationId: conversation.id,
      commandId: randomUUID(),
      expectedVersion: newCycle.body.version,
      name: 'present-quote-summary',
    });
    await expect(
      transitionSystem({
        conversationId: conversation.id,
        commandId: randomUUID(),
        expectedVersion: newCycle.body.version + 1,
        name: 'confirm-quote',
      }),
    ).resolves.toMatchObject({
      conversationState: 'bot-active',
      flowStep: 'commercial-follow-up-menu',
      requestStatus: 'under-review',
      version: newCycle.body.version + 2,
    });
    await request(app.getHttpServer())
      .get('/api/v1/whatsapp/quote-proposals?page=1&pageSize=100')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: nextCycleQuote.id,
              conversation: expect.objectContaining({ id: conversation.id }),
            }),
          ]),
        ),
      );
  });

  it('returns a public conflict when creating a proposal in a closed conversation', async () => {
    const contact = await prisma.whatsAppContact.create({
      data: {
        companyId: tenantId,
        phoneNormalized: '5534996305220',
        phoneDisplay: formatWhatsAppPhone('5534996305220'),
        displayName: 'Cliente encerrado',
      },
    });
    const conversation = await prisma.whatsAppConversation.create({
      data: {
        companyId: tenantId,
        channelId,
        contactId: contact.id,
        department: 'COMMERCIAL',
        conversationState: 'CLOSED',
        flowStep: 'CLOSED',
        requestStatus: 'NOT_STARTED',
        closedAt: new Date(),
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/whatsapp/quote-proposals')
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        conversationId: conversation.id,
        commandId: randomUUID(),
        expectedVersion: 1,
        contactName: 'Cliente encerrado',
        serviceType: 'Fretamento eventual',
        origin: 'Uberlândia',
        destination: 'Goiânia',
        departureAt: '2026-09-10T12:00:00.000Z',
        passengerCount: 18,
        vehicleAtDisposal: false,
        localTransfers: false,
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 'QUOTE_CONVERSATION_CLOSED',
          message:
            'Não é possível cadastrar proposta em um atendimento encerrado.',
          details: { conversationId: conversation.id },
        });
      });
  });

  it('preserva ao menos um administrador sob despromoção e inativação concorrentes', async () => {
    const isolatedCompanyId = randomUUID();
    await prisma.company.create({
      data: {
        id: isolatedCompanyId,
        legalName: 'Concorrência Administrativa E2E',
        taxId: '99999999000199',
      },
    });
    const [first, second] = await Promise.all([
      prisma.user.create({
        data: {
          companyId: isolatedCompanyId,
          name: 'Administrador A',
          username: 'admin.concorrencia.a',
          usernameNormalized: 'admin.concorrencia.a',
          email: 'admin.concorrencia.a@example.test',
          emailNormalized: 'admin.concorrencia.a@example.test',
          passwordHash: 'hash-sem-uso-e2e-a',
          isAdministrator: true,
        },
      }),
      prisma.user.create({
        data: {
          companyId: isolatedCompanyId,
          name: 'Administrador B',
          username: 'admin.concorrencia.b',
          usernameNormalized: 'admin.concorrencia.b',
          email: 'admin.concorrencia.b@example.test',
          emailNormalized: 'admin.concorrencia.b@example.test',
          passwordHash: 'hash-sem-uso-e2e-b',
          isAdministrator: true,
        },
      }),
    ]);
    const users = app.get(UsersRepository);

    const results = await Promise.all([
      users.updateWithAdministratorInvariant(isolatedCompanyId, first.id, {
        isAdministrator: false,
        departments: ['management'],
        permissionCodes: ['users:manage'],
        command: {
          commandId: randomUUID(),
          expectedVersion: first.version,
          requestFingerprint: 'administrator-concurrency'.padEnd(64, '0'),
          actorUserId: first.id,
          changedFields: ['isAdministrator', 'departments', 'permissionCodes'],
        },
        mutationSnapshot: {
          actorUserId: first.id,
          actorUpdatedAt: first.updatedAt,
          actorVersion: first.version,
          actorAuthorizationFingerprint: userMutationAuthorizationFingerprint({
            ...first,
            companyIsActive: true,
          }),
          targetUpdatedAt: first.updatedAt,
        },
      }),
      users.updateStatusWithAdministratorInvariant(
        isolatedCompanyId,
        second.id,
        {
          status: 'inactive',
          suspendedUntil: null,
          suspensionReason: null,
          changedAt: new Date(),
        },
      ),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(
      prisma.user.count({
        where: {
          companyId: isolatedCompanyId,
          isAdministrator: true,
          isActive: true,
          status: 'ACTIVE',
        },
      }),
    ).resolves.toBe(1);
  });

  it('preserva o nome live de contato sem referência externa no dry-run e apply', async () => {
    const importRoot = await mkdtemp(
      join(tmpdir(), 'lume-whatsapp-import-live-contact-e2e-'),
    );
    try {
      const service = new WhatsAppImportService(prisma, importRoot);
      const phone = `55117${String(Date.now()).slice(-8)}`;
      const contact = await prisma.whatsAppContact.create({
        data: {
          companyId: tenantId,
          phoneNormalized: phone,
          phoneDisplay: formatWhatsAppPhone(phone),
          displayName: 'Nome atual do contato',
        },
      });
      const wallClock = new Date(Date.now() - 6 * 60 * 60 * 1_000);
      const externalConversationId = `legacy-${randomUUID()}`;
      const packagePath = await createLegacyImportPackage({
        root: importRoot,
        directory: 'preserve-live-contact',
        conversations: [
          legacyConversationRow({
            externalId: externalConversationId,
            phone,
            wallClock,
            contactName: 'Nome histórico da planilha',
          }),
        ],
      });
      const batchId = randomUUID();
      const input = {
        companyId: tenantId,
        channelId,
        actorUsername: 'admin.e2e',
        batchName: `e2e-live-contact-${batchId}`,
        batchId,
        packagePath,
        cutoffAt: new Date(Date.now() + 60 * 60 * 1_000),
        confirmation: `APPLY:${batchId}`,
      };

      await expect(service.validate(input)).resolves.toMatchObject({
        valid: true,
        counts: {
          contactsToCreate: 0,
          contactsToUpdate: 0,
          conversationsToCreate: 1,
        },
      });
      await expect(service.apply(input)).resolves.toMatchObject({
        counts: {
          contactsToCreate: 0,
          contactsToUpdate: 0,
          conversationsToCreate: 1,
        },
      });
      await expect(
        prisma.whatsAppContact.findUniqueOrThrow({
          where: {
            id_companyId: { id: contact.id, companyId: tenantId },
          },
        }),
      ).resolves.toMatchObject({
        displayName: 'Nome atual do contato',
      });
      await service.rollback({
        companyId: tenantId,
        batchId,
        actorUsername: 'admin.e2e',
        confirmation: `ROLLBACK:${batchId}`,
      });
    } finally {
      await rm(importRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it('compara backups sobrepostos e importa somente mensagens ainda ausentes', async () => {
    const importRoot = await mkdtemp(
      join(tmpdir(), 'lume-whatsapp-overlapping-backups-e2e-'),
    );
    const appliedBatchIds: string[] = [];
    try {
      const service = new WhatsAppImportService(prisma, importRoot);
      const wallClock = new Date(Date.now() - 6 * 60 * 60 * 1_000);
      const cutoffAt = new Date(Date.now() + 60 * 60 * 1_000);
      const externalConversationId = `overlap-${randomUUID()}`;
      const firstMessageId = `message-${randomUUID()}`;
      const secondMessageId = `message-${randomUUID()}`;
      const phone = `55118${String(Date.now()).slice(-8)}`;
      const conversation = legacyConversationRow({
        externalId: externalConversationId,
        phone,
        wallClock,
        contactName: 'Cliente de backups sobrepostos',
      });
      const firstPackage = await createLegacyImportPackage({
        root: importRoot,
        directory: 'backup-day-17',
        conversations: [conversation],
        messages: [
          legacyMessageRow(externalConversationId, firstMessageId, wallClock),
        ],
      });
      const firstBatchId = randomUUID();
      await service.apply({
        companyId: tenantId,
        channelId,
        actorUsername: 'admin.e2e',
        batchName: `overlap-first-${firstBatchId}`,
        batchId: firstBatchId,
        packagePath: firstPackage,
        cutoffAt,
        confirmation: `APPLY:${firstBatchId}`,
      });
      appliedBatchIds.push(firstBatchId);

      const laterPackage = await createLegacyImportPackage({
        root: importRoot,
        directory: 'backup-day-18',
        conversations: [conversation],
        messages: [
          legacyMessageRow(externalConversationId, firstMessageId, wallClock),
          legacyMessageRow(
            externalConversationId,
            secondMessageId,
            new Date(wallClock.getTime() + 1_000),
          ),
        ],
      });
      const laterBatchId = randomUUID();
      const laterInput = {
        companyId: tenantId,
        channelId,
        actorUsername: 'admin.e2e',
        batchName: `overlap-later-${laterBatchId}`,
        batchId: laterBatchId,
        packagePath: laterPackage,
        cutoffAt,
        confirmation: `APPLY:${laterBatchId}`,
      };

      await expect(service.validate(laterInput)).resolves.toMatchObject({
        valid: true,
        counts: { messagesDuplicate: 1, messagesToCreate: 1 },
      });
      await expect(service.apply(laterInput)).resolves.toMatchObject({
        counts: { messagesDuplicate: 1, messagesToCreate: 1 },
      });
      appliedBatchIds.unshift(laterBatchId);

      const repeatedBatchId = randomUUID();
      await expect(
        service.validate({
          ...laterInput,
          batchName: `overlap-repeated-${repeatedBatchId}`,
        }),
      ).resolves.toMatchObject({
        valid: true,
        counts: { messagesDuplicate: 2, messagesToCreate: 0 },
      });
    } finally {
      for (const batchId of appliedBatchIds) {
        await new WhatsAppImportService(prisma, importRoot)
          .rollback({
            companyId: tenantId,
            batchId,
            actorUsername: 'admin.e2e',
            confirmation: `ROLLBACK:${batchId}`,
          })
          .catch(() => undefined);
      }
      await rm(importRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it('retoma importação parcial consolidando JIDs do mesmo telefone na conversa canônica', async () => {
    const importRoot = await mkdtemp(
      join(tmpdir(), 'lume-whatsapp-canonical-aliases-e2e-'),
    );
    const batchId = randomUUID();
    try {
      const wallClock = new Date(Date.now() - 6 * 60 * 60 * 1_000);
      const cutoffAt = new Date(Date.now() + 60 * 60 * 1_000);
      const phone = `55117${String(Date.now()).slice(-8)}`;
      const firstExternalId = `${phone}@s.whatsapp.net`;
      const secondExternalId = `${randomUUID()}@lid`;
      const packagePath = await createLegacyImportPackage({
        root: importRoot,
        directory: 'canonical-aliases',
        conversations: [
          legacyConversationRow({
            externalId: firstExternalId,
            phone,
            wallClock,
            contactName: 'Cliente com aliases E2E',
          }),
          legacyConversationRow({
            externalId: secondExternalId,
            phone,
            wallClock: new Date(wallClock.getTime() + 1_000),
            contactName: 'Cliente com aliases E2E',
          }),
        ],
        messages: [
          legacyMessageRow(
            firstExternalId,
            `message-${randomUUID()}`,
            wallClock,
          ),
          legacyMessageRow(
            secondExternalId,
            `message-${randomUUID()}`,
            new Date(wallClock.getTime() + 1_000),
          ),
        ],
      });
      let transactionCalls = 0;
      let interruptSecondAlias = true;
      const faultInjectingPrisma = new Proxy(prisma, {
        get(target, property) {
          if (property === '$transaction') {
            const executeTransaction = target.$transaction.bind(target);
            return (...args: unknown[]) => {
              transactionCalls += 1;
              if (interruptSecondAlias && transactionCalls === 2) {
                interruptSecondAlias = false;
                return Promise.reject(
                  new Error(
                    'Interrupção parcial simulada após o primeiro JID.',
                  ),
                );
              }
              return Reflect.apply(
                executeTransaction,
                undefined,
                args,
              ) as unknown;
            };
          }
          return Reflect.get(target, property, target) as unknown;
        },
      });
      const service = new WhatsAppImportService(
        faultInjectingPrisma,
        importRoot,
      );
      const input = {
        companyId: tenantId,
        channelId,
        actorUsername: 'admin.e2e',
        batchName: `canonical-aliases-${batchId}`,
        batchId,
        packagePath,
        cutoffAt,
        confirmation: `APPLY:${batchId}`,
      };

      await expect(service.validate(input)).resolves.toMatchObject({
        valid: true,
        counts: {
          conversationsToCreate: 1,
          conversationsToUpdate: 1,
        },
      });
      await expect(service.apply(input)).rejects.toThrow(
        'Interrupção parcial simulada',
      );
      await expect(
        prisma.whatsAppImportBatch.findUniqueOrThrow({
          where: { id: batchId },
          select: { status: true },
        }),
      ).resolves.toMatchObject({ status: WhatsAppImportBatchStatus.FAILED });
      await expect(
        prisma.whatsAppImportRecord.count({ where: { batchId } }),
      ).resolves.toBe(1);

      await expect(service.apply(input)).resolves.toMatchObject({
        status: 'applied',
        idempotentReplay: false,
        counts: {
          conversations: 2,
          conversationsToCreate: 1,
          conversationsToUpdate: 1,
          messagesToCreate: 2,
        },
      });
      const references = await prisma.whatsAppImportExternalRef.findMany({
        where: {
          companyId: tenantId,
          entityType: 'conversation',
          sourceSystem: 'legacy-e2e',
          externalId: { in: [firstExternalId, secondExternalId] },
        },
        orderBy: { externalId: 'asc' },
      });
      expect(references).toHaveLength(2);
      expect(
        new Set(references.map((reference) => reference.internalId)),
      ).toEqual(new Set([references[0].internalId]));
      await expect(
        prisma.whatsAppConversation.count({
          where: {
            id: references[0].internalId,
            companyId: tenantId,
            channelId,
            contact: { phoneNormalized: phone },
          },
        }),
      ).resolves.toBe(1);
      await expect(
        prisma.whatsAppMessage.count({
          where: {
            companyId: tenantId,
            conversationId: references[0].internalId,
          },
        }),
      ).resolves.toBe(2);
      await expect(service.apply(input)).resolves.toMatchObject({
        status: 'applied',
        idempotentReplay: true,
      });

      await service.rollback({
        companyId: tenantId,
        batchId,
        actorUsername: 'admin.e2e',
        confirmation: `ROLLBACK:${batchId}`,
      });
    } finally {
      await rm(importRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it('importa historico silenciosamente, retoma lote, reconcilia e protege rollback', async () => {
    const importRoot = await mkdtemp(
      join(tmpdir(), 'lume-whatsapp-import-e2e-'),
    );
    try {
      const service = new WhatsAppImportService(prisma, importRoot);
      const wallClock = new Date(Date.now() - 6 * 60 * 60 * 1_000);
      const cutoffAt = new Date(Date.now() + 60 * 60 * 1_000);
      const externalConversationId = `legacy-${randomUUID()}`;
      const externalMessageId = `message-${randomUUID()}`;
      const externalDocumentId = `document-${randomUUID()}`;
      const phone = `55119${String(Date.now()).slice(-8)}`;
      const firstPackage = await createLegacyImportPackage({
        root: importRoot,
        directory: 'first-batch',
        conversations: [
          legacyConversationRow({
            externalId: externalConversationId,
            phone,
            wallClock,
            contactName: 'Cliente importado E2E',
            origin: 'Uberlandia',
            destination: 'Goiania',
            quoteSequence: 1,
          }),
        ],
        messages: [
          legacyMessageRow(
            externalConversationId,
            externalMessageId,
            wallClock,
          ),
        ],
        documents: [
          legacyDocumentRow(externalConversationId, externalDocumentId, 1),
        ],
        includePdf: true,
      });
      const batchId = randomUUID();
      const batchName = `e2e-${batchId}`;
      const input = {
        companyId: tenantId,
        channelId,
        actorUsername: 'admin.e2e',
        batchName,
        batchId,
        packagePath: firstPackage,
        cutoffAt,
        confirmation: `APPLY:${batchId}`,
      };

      const dryRun = await service.validate(input);
      expect(dryRun).toMatchObject({
        valid: true,
        zeroWrites: true,
        counts: {
          conversations: 1,
          messagesToCreate: 1,
          documentsToCreate: 1,
        },
      });
      const outboxBefore = await prisma.integrationOutbox.count({
        where: { companyId: tenantId },
      });
      const applied = await service.apply(input);
      expect(applied).toMatchObject({
        status: 'applied',
        idempotentReplay: false,
        outboxCreatedByImporter: 0,
        counts: {
          conversations: 1,
          contactsToCreate: 1,
          conversationsToCreate: 1,
          quoteRequestsToCreate: 1,
          messagesToCreate: 1,
          documentsToCreate: 1,
        },
      });
      await expect(
        prisma.integrationOutbox.count({
          where: { companyId: tenantId },
        }),
      ).resolves.toBe(outboxBefore);

      const conversationReference =
        await prisma.whatsAppImportExternalRef.findUniqueOrThrow({
          where: {
            companyId_entityType_sourceSystem_externalId: {
              companyId: tenantId,
              entityType: 'conversation',
              sourceSystem: 'legacy-e2e',
              externalId: externalConversationId,
            },
          },
        });
      const importedConversation =
        await prisma.whatsAppConversation.findUniqueOrThrow({
          where: {
            id_companyId: {
              id: conversationReference.internalId,
              companyId: tenantId,
            },
          },
          include: {
            quoteRequests: true,
            messages: true,
            proposalDocuments: true,
          },
        });
      expect(importedConversation.quoteRequests).toHaveLength(1);
      expect(importedConversation.messages).toHaveLength(1);
      expect(importedConversation.proposalDocuments).toHaveLength(1);
      expect(
        Buffer.from(importedConversation.proposalDocuments[0].content)
          .subarray(0, 5)
          .toString('ascii'),
      ).toBe('%PDF-');
      await expect(
        prisma.tenantAuditLog.count({
          where: {
            companyId: tenantId,
            action: 'legacy-conversation-imported',
            targetId: importedConversation.id,
          },
        }),
      ).resolves.toBe(1);

      await expect(service.apply(input)).resolves.toMatchObject({
        idempotentReplay: true,
        outboxCreatedByImporter: 0,
      });
      await prisma.whatsAppImportBatch.update({
        where: { id: batchId },
        data: {
          claimId: randomUUID(),
          leaseUntil: new Date(Date.now() + 60_000),
        },
      });
      await expect(service.apply(input)).rejects.toThrow(
        /rollback reivindicado/i,
      );
      await prisma.whatsAppImportBatch.update({
        where: { id: batchId },
        data: { claimId: null, leaseUntil: null },
      });
      await expect(
        service.apply({
          ...input,
          cutoffAt: new Date(cutoffAt.getTime() + 1),
        }),
      ).rejects.toThrow(/conteúdo diferente.*integridade dos dados/i);

      await prisma.whatsAppImportBatch.update({
        where: { id: batchId },
        data: { status: WhatsAppImportBatchStatus.FAILED },
      });
      const resumed = await service.apply(input);
      expect(resumed).toMatchObject({
        idempotentReplay: false,
        counts: {
          conversations: 1,
          conversationsToCreate: 1,
          messagesToCreate: 1,
          documentsToCreate: 1,
        },
      });
      const reconciled = await service.reconcile(tenantId, batchId);
      expect(reconciled).toMatchObject({
        valid: true,
        counts: {
          records: 1,
          conversations: 1,
          messages: 1,
          documents: 1,
          outboxDeltaDuringApply: 0,
        },
      });

      const persistedBatch = await prisma.whatsAppImportBatch.findUniqueOrThrow(
        {
          where: { id: batchId },
        },
      );
      const originalAppliedCounts =
        persistedBatch.appliedCounts as Prisma.InputJsonValue;
      await prisma.whatsAppImportBatch.update({
        where: { id: batchId },
        data: {
          appliedCounts: {
            ...(originalAppliedCounts as Record<string, Prisma.JsonValue>),
            messagesToCreate: 99,
          },
        },
      });
      const inconsistent = await service.reconcile(tenantId, batchId);
      expect(inconsistent.valid).toBe(false);
      expect(inconsistent.issues).toContainEqual(
        expect.objectContaining({ code: 'MESSAGE_COUNT_MISMATCH' }),
      );
      await prisma.whatsAppImportBatch.update({
        where: { id: batchId },
        data: { appliedCounts: originalAppliedCounts },
      });

      const updatePackage = await createLegacyImportPackage({
        root: importRoot,
        directory: 'update-batch',
        conversations: [
          legacyConversationRow({
            externalId: externalConversationId,
            phone,
            wallClock,
            contactName: 'Cliente importado atualizado',
            origin: 'Araguari',
            destination: 'Goiania',
            quoteSequence: 1,
          }),
        ],
      });
      const updateBatchId = randomUUID();
      const updateInput = {
        companyId: tenantId,
        channelId,
        actorUsername: 'admin.e2e',
        batchName: `e2e-update-${updateBatchId}`,
        batchId: updateBatchId,
        packagePath: updatePackage,
        cutoffAt,
        confirmation: `APPLY:${updateBatchId}`,
      };
      await expect(service.apply(updateInput)).resolves.toMatchObject({
        counts: {
          conversationsToUpdate: 1,
          quoteRequestsToUpdate: 1,
        },
      });
      const changedQuote = await prisma.quoteRequest.findFirstOrThrow({
        where: {
          companyId: tenantId,
          conversationId: importedConversation.id,
          sequence: 1,
        },
      });
      expect(changedQuote.origin).toBe('Araguari');

      await expect(
        service.rollback({
          companyId: tenantId,
          batchId: updateBatchId,
          actorUsername: 'admin.e2e',
          confirmation: `ROLLBACK:${updateBatchId}`,
        }),
      ).resolves.toMatchObject({
        status: 'rolled-back',
        recordsRolledBack: 1,
      });
      const restoredQuote = await prisma.quoteRequest.findFirstOrThrow({
        where: {
          companyId: tenantId,
          conversationId: importedConversation.id,
          sequence: 1,
        },
      });
      expect(restoredQuote).toMatchObject({
        sequence: 1,
        origin: 'Uberlandia',
      });

      const guardedExternalId = `legacy-${randomUUID()}`;
      const guardedPhone = `55118${String(Date.now()).slice(-8)}`;
      const guardedPackage = await createLegacyImportPackage({
        root: importRoot,
        directory: 'rollback-guard-batch',
        conversations: [
          legacyConversationRow({
            externalId: guardedExternalId,
            phone: guardedPhone,
            wallClock,
          }),
        ],
      });
      const guardedBatchId = randomUUID();
      const guardedCutoff = new Date(Date.now() - 60 * 1_000);
      await service.apply({
        companyId: tenantId,
        channelId,
        actorUsername: 'admin.e2e',
        batchName: `e2e-guard-${guardedBatchId}`,
        batchId: guardedBatchId,
        packagePath: guardedPackage,
        cutoffAt: guardedCutoff,
        confirmation: `APPLY:${guardedBatchId}`,
      });
      const guardedRecord = await prisma.whatsAppImportRecord.findFirstOrThrow({
        where: {
          companyId: tenantId,
          batchId: guardedBatchId,
        },
      });
      const realMessage = await prisma.whatsAppMessage.create({
        data: {
          companyId: tenantId,
          conversationId: guardedRecord.conversationId,
          channelId,
          contactId: guardedRecord.contactId,
          direction: MessageDirection.INBOUND,
          deliveryStatus: DeliveryStatus.RECEIVED,
          kind: MessageKind.TEXT,
          text: 'Interacao posterior ao corte',
          correlationId: `e2e-real-${randomUUID()}`,
          occurredAt: new Date(),
        },
      });
      await expect(
        service.rollback({
          companyId: tenantId,
          batchId: guardedBatchId,
          actorUsername: 'admin.e2e',
          confirmation: `ROLLBACK:${guardedBatchId}`,
        }),
      ).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'POST_CUTOFF_INTERACTION' }),
        ]),
      });
      await prisma.whatsAppMessage.delete({
        where: {
          id_companyId: {
            id: realMessage.id,
            companyId: tenantId,
          },
        },
      });
      await service.rollback({
        companyId: tenantId,
        batchId: guardedBatchId,
        actorUsername: 'admin.e2e',
        confirmation: `ROLLBACK:${guardedBatchId}`,
      });

      await expect(
        service.rollback({
          companyId: tenantId,
          batchId,
          actorUsername: 'admin.e2e',
          confirmation: `ROLLBACK:${batchId}`,
        }),
      ).resolves.toMatchObject({
        status: 'rolled-back',
        recordsRolledBack: 1,
      });
      await expect(
        service.rollback({
          companyId: tenantId,
          batchId,
          actorUsername: 'admin.e2e',
          confirmation: `ROLLBACK:${batchId}`,
        }),
      ).resolves.toMatchObject({
        recordsRolledBack: 0,
      });
    } finally {
      await rm(importRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it('permite à Gerência operar Cadastro temporário somente com SEC-01/02 atribuídas', async () => {
    const suffix = randomUUID().slice(0, 8);
    const manager = await prisma.user.create({
      data: {
        companyId: tenantId,
        name: 'Gerente de Cadastros E2E',
        username: `ger.cad.${suffix}`,
        usernameNormalized: `ger.cad.${suffix}`,
        email: `ger.cad.${suffix}@example.test`,
        emailNormalized: `ger.cad.${suffix}@example.test`,
        passwordHash: 'hash-e2e-sem-uso',
        departments: ['management'],
        permissionCodes: ['clients:view', 'clients:create', 'clients:update'],
      },
      select: { id: true, tokenVersion: true },
    });
    const managerToken = await accessTokens.sign({
      sub: manager.id,
      companyId: tenantId,
      tokenVersion: manager.tokenVersion,
    });

    await request(app.getHttpServer())
      .get('/api/v1/registrations/catalog')
      .set('authorization', `Bearer ${managerToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.roles).toEqual(
          expect.arrayContaining([expect.objectContaining({ code: 'client' })]),
        );
      });

    const registrationPayload = {
      type: 'pf',
      firstName: 'Cadastro',
      lastName: 'Emergencial E2E',
      isTemporary: true,
      temporaryReason: 'Atendimento emergencial autorizado pela Gerência.',
      roleCodes: ['client'],
      phones: [
        {
          number: '5511970000001',
          type: 'mobile',
          isPrimary: true,
          hasWhatsApp: true,
        },
      ],
      commandId: randomUUID(),
    };
    const created = await request(app.getHttpServer())
      .post('/api/v1/registrations')
      .set('authorization', `Bearer ${managerToken}`)
      .send(registrationPayload)
      .expect(201);
    expect(created.body).toMatchObject({
      type: 'pf',
      isTemporary: true,
      temporaryReason: registrationPayload.temporaryReason,
      temporaryResponsible: { id: manager.id },
      version: 1,
    });

    await request(app.getHttpServer())
      .get(`/api/v1/registrations/${created.body.id as string}`)
      .set('authorization', `Bearer ${managerToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.id).toBe(created.body.id));
    await request(app.getHttpServer())
      .get('/api/v1/registrations?temporary=true')
      .set('authorization', `Bearer ${managerToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: created.body.id, isTemporary: true }),
          ]),
        );
      });

    await request(app.getHttpServer())
      .patch(`/api/v1/registrations/${created.body.id as string}`)
      .set('authorization', `Bearer ${managerToken}`)
      .send({
        ...registrationPayload,
        lastName: 'Emergencial Revisado E2E',
        commandId: randomUUID(),
        expectedVersion: 1,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: created.body.id,
          displayName: 'Cadastro Emergencial Revisado E2e',
          isTemporary: true,
          version: 2,
        });
      });

    await request(app.getHttpServer())
      .get(`/api/v1/registrations/${created.body.id as string}/history`)
      .set('authorization', `Bearer ${managerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/registrations/catalog/roles')
      .set('authorization', `Bearer ${managerToken}`)
      .send({ code: `gerencia-${suffix}`, name: 'Papel não autorizado' })
      .expect(403);
  });

  it('mantém a criação de Cadastro idempotente sob concorrência e devolve o snapshot original', async () => {
    const suffix = randomUUID().slice(0, 8);
    const commandId = randomUUID();
    const payload = {
      type: 'pf',
      firstName: 'Cadastro',
      lastName: `Idempotente ${suffix}`,
      roleCodes: ['client'],
      phones: [
        {
          number: '5511970000052',
          type: 'mobile',
          isPrimary: true,
          hasWhatsApp: false,
        },
      ],
      commandId,
    };

    const concurrentCreates = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app.getHttpServer())
          .post('/api/v1/registrations')
          .set('authorization', `Bearer ${accessToken}`)
          .send(payload),
      ),
    );
    expect(
      concurrentCreates.map(({ status }) => status),
      JSON.stringify(concurrentCreates.map(({ body }) => body)),
    ).toEqual([201, 201]);
    expect(concurrentCreates[1].body).toEqual(concurrentCreates[0].body);

    const original = concurrentCreates[0].body as {
      id: string;
      displayName: string;
      version: number;
    };
    await expect(
      prisma.routingCompanyHistory.count({
        where: { companyId: tenantId, commandId },
      }),
    ).resolves.toBe(1);

    await request(app.getHttpServer())
      .post('/api/v1/registrations')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ ...payload, lastName: `Com outro conteúdo ${suffix}` })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('CONFLICT'));

    await request(app.getHttpServer())
      .patch(`/api/v1/registrations/${original.id}`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        ...payload,
        lastName: `Atualizado ${suffix}`,
        commandId: randomUUID(),
        expectedVersion: original.version,
      })
      .expect(200)
      .expect(({ body }) => expect(body.version).toBe(original.version + 1));

    await request(app.getHttpServer())
      .post('/api/v1/registrations')
      .set('authorization', `Bearer ${accessToken}`)
      .send(payload)
      .expect(201)
      .expect(({ body }) => expect(body).toEqual(original));
  });

  it('mantém a consolidação de Cadastros fail-closed enquanto a aplicação não existe', async () => {
    const [principal, duplicate] = await Promise.all([
      prisma.routingCompany.create({
        data: {
          companyId: tenantId,
          taxId: `pf${randomUUID().replaceAll('-', '').slice(0, 12)}`,
          legalName: 'Pessoa Principal da Consolidação',
          clientType: 'PF',
          firstName: 'Pessoa Principal',
          individualName: 'Pessoa Principal da Consolidação',
        },
      }),
      prisma.routingCompany.create({
        data: {
          companyId: tenantId,
          taxId: `pf${randomUUID().replaceAll('-', '').slice(0, 12)}`,
          legalName: 'Pessoa Duplicada da Consolidação',
          clientType: 'PF',
          firstName: 'Pessoa Duplicada',
          individualName: 'Pessoa Duplicada da Consolidação',
        },
      }),
    ]);

    await request(app.getHttpServer())
      .get(
        `/api/v1/registrations/${principal.id}/consolidation-preview?duplicateRegistrationId=${duplicate.id}`,
      )
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: 'preview',
          principalRegistrationId: principal.id,
          duplicateRegistrationId: duplicate.id,
          canApply: false,
          blockers: [{ code: 'application-not-available' }],
        });
      });

    await expect(
      prisma.routingCompany.findUniqueOrThrow({
        where: {
          id_companyId: { id: duplicate.id, companyId: tenantId },
        },
      }),
    ).resolves.toMatchObject({ id: duplicate.id, version: 1 });
  });

  it('associa Usuário a Pessoa com idempotência e isolamento por tenant', async () => {
    const otherCompanyId = randomUUID();
    await prisma.company.create({
      data: {
        id: otherCompanyId,
        legalName: 'Tenant estrangeiro de identidade E2E',
        taxId: '99887766554433',
      },
    });
    const person = await prisma.routingCompany.create({
      data: {
        companyId: tenantId,
        taxId: '52998224725',
        legalName: 'Pessoa Identidade E2E',
        clientType: 'PF',
        firstName: 'Pessoa',
        lastName: 'Identidade E2E',
        individualName: 'Pessoa Identidade E2E',
        cpf: '52998224725',
      },
    });
    await prisma.routingCompany.create({
      data: {
        companyId: otherCompanyId,
        taxId: '52998224725',
        legalName: 'Pessoa Homônima de Outro Tenant',
        clientType: 'PF',
        firstName: 'Pessoa',
        individualName: 'Pessoa Homônima de Outro Tenant',
        cpf: '52998224725',
      },
    });
    const suffix = randomUUID().slice(0, 8);
    const subject = await prisma.user.create({
      data: {
        companyId: tenantId,
        name: 'Usuário Identidade E2E',
        username: `ident.${suffix}`,
        usernameNormalized: `ident.${suffix}`,
        email: `ident.${suffix}@example.test`,
        emailNormalized: `ident.${suffix}@example.test`,
        cpfNormalized: '52998224725',
        passwordHash: 'hash-e2e-sem-uso',
      },
    });
    const foreignUser = await prisma.user.create({
      data: {
        companyId: otherCompanyId,
        name: 'Usuário de Outro Tenant',
        username: `foreign.${suffix}`,
        usernameNormalized: `foreign.${suffix}`,
        email: `foreign.${suffix}@example.test`,
        emailNormalized: `foreign.${suffix}@example.test`,
        passwordHash: 'hash-e2e-sem-uso',
      },
    });

    const association = {
      mode: 'automatic',
      commandId: randomUUID(),
      expectedVersion: 1,
    };
    const first = await request(app.getHttpServer())
      .post(`/api/v1/identity/users/${subject.id}/person-association`)
      .set('authorization', `Bearer ${accessToken}`)
      .send(association)
      .expect(201);
    expect(first.body).toMatchObject({
      userId: subject.id,
      personRegistrationId: person.id,
      associationVersion: 2,
      source: 'unique-exact-cpf',
      idempotent: false,
    });

    await request(app.getHttpServer())
      .post(`/api/v1/identity/users/${subject.id}/person-association`)
      .set('authorization', `Bearer ${accessToken}`)
      .send(association)
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          userId: subject.id,
          personRegistrationId: person.id,
          associationVersion: 2,
          idempotent: true,
        });
      });

    await expect(
      prisma.userPersonAssociationHistory.count({
        where: { companyId: tenantId, userId: subject.id },
      }),
    ).resolves.toBe(1);
    await request(app.getHttpServer())
      .post(`/api/v1/identity/users/${foreignUser.id}/person-association`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({ ...association, commandId: randomUUID() })
      .expect(404);
  });

  it('permite RH e DP, serializa criação concorrente, resolve e revoga acesso seguro de pré-admissão', async () => {
    const suffix = randomUUID().slice(0, 8);
    const humanResources = await prisma.user.create({
      data: {
        companyId: tenantId,
        name: 'RH legado Pré-admissão E2E',
        username: `rh.preadm.${suffix}`,
        usernameNormalized: `rh.preadm.${suffix}`,
        email: `rh.preadm.${suffix}@example.test`,
        emailNormalized: `rh.preadm.${suffix}@example.test`,
        passwordHash: 'hash-e2e-sem-uso',
        departments: ['human-resources'],
        permissionCodes: ['documents:manage'],
      },
      select: { id: true, tokenVersion: true },
    });
    const humanResourcesToken = await accessTokens.sign({
      sub: humanResources.id,
      companyId: tenantId,
      tokenVersion: humanResources.tokenVersion,
    });
    const personnelDepartment = await prisma.user.create({
      data: {
        companyId: tenantId,
        name: 'Departamento Pessoal Pré-admissão E2E',
        username: `dp.preadm.${suffix}`,
        usernameNormalized: `dp.preadm.${suffix}`,
        email: `dp.preadm.${suffix}@example.test`,
        emailNormalized: `dp.preadm.${suffix}@example.test`,
        passwordHash: 'hash-e2e-sem-uso',
        departments: ['personnel-department'],
        permissionCodes: ['documents:manage'],
      },
      select: { id: true, tokenVersion: true },
    });
    const personnelDepartmentToken = await accessTokens.sign({
      sub: personnelDepartment.id,
      companyId: tenantId,
      tokenVersion: personnelDepartment.tokenVersion,
    });
    const person = await prisma.routingCompany.create({
      data: {
        companyId: tenantId,
        taxId: '93541134780',
        legalName: 'Candidata Pré-admissão E2E',
        clientType: 'PF',
        firstName: 'Candidata',
        lastName: 'Pré-admissão E2E',
        individualName: 'Candidata Pré-admissão E2E',
        cpf: '93541134780',
      },
    });
    const documentType = await prisma.documentType.create({
      data: {
        companyId: tenantId,
        code: `preadm-e2e-${suffix}`,
        name: 'Documento de admissão E2E',
        acceptedMimeTypes: ['application/pdf'],
        maxFileSizeBytes: 2_000_000,
      },
    });
    const createPayload = {
      commandId: randomUUID(),
      expectedVersion: 0,
      personRegistrationId: person.id,
      requestedDocuments: [
        {
          documentTypeId: documentType.id,
          instructions: 'Envie o documento completo e legível.',
        },
      ],
    };

    const concurrentReplay = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app.getHttpServer())
          .post('/api/v1/pre-admission/accesses')
          .set('authorization', `Bearer ${personnelDepartmentToken}`)
          .send(createPayload),
      ),
    );
    expect(concurrentReplay.map(({ status }) => status)).toEqual([201, 201]);
    expect(concurrentReplay.map(({ body }) => body.id)).toEqual([
      concurrentReplay[0].body.id,
      concurrentReplay[0].body.id,
    ]);
    expect(
      concurrentReplay
        .map(({ body }) => body.idempotent as boolean)
        .sort((left, right) => Number(left) - Number(right)),
    ).toEqual([false, true]);
    const created = concurrentReplay.find(
      ({ body }) => body.idempotent === false,
    )!;
    expect(created.body).toMatchObject({
      personRegistrationId: person.id,
      status: 'active',
      version: 1,
      uploadAvailable: false,
      idempotent: false,
      token: expect.any(String),
      requestedDocuments: [
        expect.objectContaining({
          documentTypeId: documentType.id,
          code: documentType.code,
        }),
      ],
    });
    const token = created.body.token as string;

    await request(app.getHttpServer())
      .post('/api/v1/pre-admission/public/resolve')
      .send({ token })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          personName: 'Candidata Pré-admissão E2E',
          status: 'active',
          version: 1,
          uploadAvailable: false,
          requestedDocuments: [
            expect.objectContaining({ code: documentType.code }),
          ],
        });
        expect(body).not.toHaveProperty('personRegistrationId');
      });

    await prisma.routingCompany.update({
      where: { id_companyId: { id: person.id, companyId: tenantId } },
      data: { status: 'INACTIVE' },
    });
    const inactivePersonResolve = await request(app.getHttpServer())
      .post('/api/v1/pre-admission/public/resolve')
      .send({ token });
    await prisma.routingCompany.update({
      where: { id_companyId: { id: person.id, companyId: tenantId } },
      data: { status: 'ACTIVE' },
    });
    expect(inactivePersonResolve.status).toBe(401);
    expect(inactivePersonResolve.body).toMatchObject({
      code: 'INVALID_PREADMISSION_TOKEN',
    });
    expect(inactivePersonResolve.body).not.toHaveProperty('personName');
    expect(inactivePersonResolve.body).not.toHaveProperty('requestedDocuments');

    await prisma.company.update({
      where: { id: tenantId },
      data: { status: 'SUSPENDED' },
    });
    const inactiveCompanyResolve = await request(app.getHttpServer())
      .post('/api/v1/pre-admission/public/resolve')
      .send({ token });
    await prisma.company.update({
      where: { id: tenantId },
      data: { status: 'ACTIVE' },
    });
    expect(inactiveCompanyResolve.status).toBe(401);
    expect(inactiveCompanyResolve.body).toMatchObject({
      code: 'INVALID_PREADMISSION_TOKEN',
    });
    expect(inactiveCompanyResolve.body).not.toHaveProperty('personName');
    expect(inactiveCompanyResolve.body).not.toHaveProperty(
      'requestedDocuments',
    );

    await request(app.getHttpServer())
      .post(
        `/api/v1/pre-admission/accesses/${created.body.id as string}/revoke`,
      )
      .set('authorization', `Bearer ${humanResourcesToken}`)
      .send({ commandId: randomUUID(), expectedVersion: 1 })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: created.body.id,
          status: 'revoked',
          version: 2,
          idempotent: false,
        });
        expect(body).not.toHaveProperty('token');
      });
    await request(app.getHttpServer())
      .post('/api/v1/pre-admission/public/resolve')
      .send({ token })
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('INVALID_PREADMISSION_TOKEN');
      });

    const competingCreates = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app.getHttpServer())
          .post('/api/v1/pre-admission/accesses')
          .set('authorization', `Bearer ${personnelDepartmentToken}`)
          .send({ ...createPayload, commandId: randomUUID() }),
      ),
    );
    expect(
      competingCreates.map(({ status }) => status).sort((a, b) => a - b),
    ).toEqual([201, 409]);
    expect(
      competingCreates.find(({ status }) => status === 409)?.body,
    ).toMatchObject({ code: 'CONFLICT' });
    await expect(
      prisma.preAdmissionAccess.count({
        where: {
          companyId: tenantId,
          personRegistrationId: person.id,
          revokedAt: null,
        },
      }),
    ).resolves.toBe(1);
  });

  it('separa aceite, Serviço Confirmado e criação manual da Viagem eventual', async () => {
    const numericSuffix = randomUUID()
      .replace(/\D/g, '')
      .padEnd(9, '0')
      .slice(0, 9);
    const contact = await prisma.whatsAppContact.create({
      data: {
        companyId: tenantId,
        phoneNormalized: `5511${numericSuffix}`,
        phoneDisplay: `+55 11 ${numericSuffix}`,
        displayName: 'Cliente Eventual E2E',
      },
    });
    const conversation = await prisma.whatsAppConversation.create({
      data: {
        companyId: tenantId,
        channelId,
        contactId: contact.id,
        department: 'COMMERCIAL',
        conversationState: 'HUMAN_ACTIVE',
        flowStep: 'HUMAN_SERVICE',
        requestStatus: 'APPROVED',
        resumeState: 'BOT_ACTIVE',
        resumeFlowStep: 'COMMERCIAL_FOLLOW_UP_MENU',
        assignedToUserId: commercialAttendant.id,
      },
    });
    const quoteActor = await prisma.user.findFirstOrThrow({
      where: { companyId: tenantId, usernameNormalized: 'admin.e2e' },
      select: { id: true },
    });
    const quote = await prisma.quoteRequest.create({
      data: {
        companyId: tenantId,
        conversationId: conversation.id,
        sequence: 1,
        status: RequestStatus.APPROVED,
        version: 4,
        serviceType: 'Fretamento eventual',
        origin: 'Uberlândia',
        destination: 'Goiânia',
        departureDate: new Date('2026-09-20T00:00:00.000Z'),
        returnDate: new Date('2026-09-21T00:00:00.000Z'),
        passengerCount: 30,
        vehicleType: 'Ônibus executivo',
        decidedAt: new Date('2026-09-01T12:00:00.000Z'),
        decidedByUserId: quoteActor.id,
      },
    });

    await expect(
      prisma.confirmedService.count({
        where: { companyId: tenantId, sourceQuoteRequestId: quote.id },
      }),
    ).resolves.toBe(0);
    const [financialActor, operationalActor] = await Promise.all([
      prisma.user.create({
        data: {
          companyId: tenantId,
          name: 'Financeiro Confirmação E2E',
          username: `financeiro.confirmacao.${numericSuffix}`,
          usernameNormalized: `financeiro.confirmacao.${numericSuffix}`,
          email: `financeiro.confirmacao.${numericSuffix}@example.test`,
          emailNormalized: `financeiro.confirmacao.${numericSuffix}@example.test`,
          passwordHash: 'hash-e2e-sem-uso',
          departments: ['financial'],
          permissionCodes: ['financial:approve'],
        },
        select: { id: true, tokenVersion: true },
      }),
      prisma.user.create({
        data: {
          companyId: tenantId,
          name: 'Operacional Confirmação E2E',
          username: `operacional.confirmacao.${numericSuffix}`,
          usernameNormalized: `operacional.confirmacao.${numericSuffix}`,
          email: `operacional.confirmacao.${numericSuffix}@example.test`,
          emailNormalized: `operacional.confirmacao.${numericSuffix}@example.test`,
          passwordHash: 'hash-e2e-sem-uso',
          departments: ['operations'],
          permissionCodes: ['operations:manage'],
        },
        select: { id: true, tokenVersion: true },
      }),
    ]);
    const [financialToken, operationalToken] = await Promise.all([
      accessTokens.sign({
        sub: financialActor.id,
        companyId: tenantId,
        tokenVersion: financialActor.tokenVersion,
      }),
      accessTokens.sign({
        sub: operationalActor.id,
        companyId: tenantId,
        tokenVersion: operationalActor.tokenVersion,
      }),
    ]);

    await request(app.getHttpServer())
      .post(
        `/api/v1/commercial/quote-requests/${quote.id}/financial-attestation`,
      )
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: 4,
        evidence: 'Tentativa indevida pelo Comercial.',
      })
      .expect(403);

    const financialPayload = {
      commandId: randomUUID(),
      expectedVersion: 4,
      evidence: 'Pagamento aplicável confirmado pelo Financeiro.',
    };
    await request(app.getHttpServer())
      .post(
        `/api/v1/commercial/quote-requests/${quote.id}/financial-attestation`,
      )
      .set('authorization', `Bearer ${financialToken}`)
      .send(financialPayload)
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          attestation: {
            sourceQuoteRequestId: quote.id,
            sourceQuoteVersion: 4,
            kind: 'financial',
            actorUserId: financialActor.id,
          },
          idempotent: false,
        });
      });
    await request(app.getHttpServer())
      .post(
        `/api/v1/commercial/quote-requests/${quote.id}/financial-attestation`,
      )
      .set('authorization', `Bearer ${financialToken}`)
      .send(financialPayload)
      .expect(201)
      .expect(({ body }) => expect(body.idempotent).toBe(true));

    await request(app.getHttpServer())
      .post(
        `/api/v1/commercial/quote-requests/${quote.id}/operational-attestation`,
      )
      .set('authorization', `Bearer ${operationalToken}`)
      .send({
        commandId: randomUUID(),
        expectedVersion: 4,
        evidence: 'Disponibilidade validada pelo Operacional.',
      })
      .expect(201);

    const confirmationPayload = {
      commandId: randomUUID(),
      expectedVersion: 4,
      confirmationBasis:
        'Aceite e requisitos aplicáveis conferidos para operação eventual.',
    };
    await request(app.getHttpServer())
      .post(`/api/v1/commercial/quote-requests/${quote.id}/confirmed-services`)
      .set('authorization', `Bearer ${operationalToken}`)
      .send(confirmationPayload)
      .expect(403);
    const confirmed = await request(app.getHttpServer())
      .post(`/api/v1/commercial/quote-requests/${quote.id}/confirmed-services`)
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send(confirmationPayload)
      .expect(201);
    expect(confirmed.body).toMatchObject({
      service: {
        sourceQuoteRequestId: quote.id,
        sourceQuoteVersion: 4,
        sourceItemKey: 'legacy-primary',
        version: 1,
      },
      idempotent: false,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/commercial/quote-requests/${quote.id}/confirmed-services`)
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send(confirmationPayload)
      .expect(201)
      .expect(({ body }) => expect(body.idempotent).toBe(true));

    const confirmedServiceId = confirmed.body.service.id as string;
    await request(app.getHttpServer())
      .get(
        `/api/v1/commercial/quote-requests/${quote.id}/confirmed-service-readiness`,
      )
      .set('authorization', `Bearer ${operationalToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          quote: { id: quote.id, status: 'approved', version: 4 },
          confirmedService: { id: confirmedServiceId },
        });
        expect(body.attestations).toHaveLength(2);
      });
    await request(app.getHttpServer())
      .patch(`/api/v1/whatsapp/quote-proposals/${quote.id}/status`)
      .set('authorization', `Bearer ${commercialAccessToken}`)
      .send({
        status: 'cancelled',
        closureClassification: 'acceptance-cancelled',
        reason: 'Cliente solicitou cancelamento depois da confirmação.',
        expectedVersion: conversation.version,
        commandId: randomUUID(),
      })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('CONFLICT'));
    await expect(
      prisma.operationalTrip.count({
        where: { companyId: tenantId, confirmedServiceId },
      }),
    ).resolves.toBe(0);
    await request(app.getHttpServer())
      .post('/api/v1/trips')
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        sourceKind: 'confirmed-service',
        confirmedServiceId,
        expectedConfirmedServiceVersion: 1,
        serviceDate: '2026-09-21',
        code: `EVENT-DATE-CONFLICT-${numericSuffix}`,
        legs: [{ sequence: 1, label: 'Uberlândia → Goiânia' }],
        commandId: randomUUID(),
      })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('VALIDATION_ERROR'));
    const eventTrip = await request(app.getHttpServer())
      .post('/api/v1/trips')
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        sourceKind: 'confirmed-service',
        confirmedServiceId,
        expectedConfirmedServiceVersion: 1,
        code: `EVENT-${numericSuffix}`,
        legs: [{ sequence: 1, label: 'Uberlândia → Goiânia' }],
        commandId: randomUUID(),
      })
      .expect(201);
    expect(eventTrip.body).toMatchObject({
      trip: {
        source: {
          kind: 'confirmed-service',
          confirmedServiceId,
          sourceVersion: 1,
        },
        plan: { serviceDate: '2026-09-20' },
        status: 'draft',
        version: 1,
      },
      idempotent: false,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/trips/${eventTrip.body.trip.id as string}/commands`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        type: 'schedule',
        expectedVersion: 1,
        commandId: randomUUID(),
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.trip).toMatchObject({
          status: 'scheduled',
          version: 2,
        });
      });
  });

  it('cria viagem manual de contrato contínuo e preserva os ciclos suspensão e interrupção', async () => {
    const customer = await request(app.getHttpServer())
      .post('/api/v1/registrations')
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        type: 'pj',
        legalName: 'Cliente Contrato Contínuo E2E Ltda.',
        tradeName: 'Cliente Contínuo E2E',
        cnpj: '11.222.333/0001-81',
        roleCodes: ['client'],
        commandId: randomUUID(),
      })
      .expect(201);
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const routeActor = await prisma.user.findFirstOrThrow({
      where: { companyId: tenantId, usernameNormalized: 'admin.e2e' },
      select: { id: true },
    });
    const contract = await prisma.routingContract.create({
      data: {
        companyId: tenantId,
        routingCompanyId: customer.body.id,
        code: `CTR-${suffix}`,
        name: 'Contrato contínuo E2E',
        operationType: 'Fretamento contínuo',
        routeType: RoutingRouteType.MUNICIPAL,
        status: 'ACTIVE',
        periodicity: 'DAILY',
        contractedVehicleCount: 1,
        predictedVehicleName: 'Ônibus E2E',
        predictedVehicleCapacity: 46,
        plannedKm: 20,
        maxWalkingDistanceMeters: 500,
        requiresDocumentation: false,
        requiredDocumentTypeCodes: [],
        unitName: 'Unidade E2E',
        originLabel: 'Garagem E2E',
        originStreet: 'Rua de Origem',
        originNumber: '100',
        originDistrict: 'Centro',
        originPostalCode: '38400000',
        originCity: 'Uberlândia',
        originState: 'MG',
        destinationLabel: 'Unidade E2E',
        destinationStreet: 'Rua de Destino',
        destinationNumber: '200',
        destinationDistrict: 'Distrito Industrial',
        destinationPostalCode: '38408000',
        destinationCity: 'Uberlândia',
        destinationState: 'MG',
        validFrom: new Date('2026-09-01T00:00:00.000Z'),
        validUntil: new Date('2026-09-30T00:00:00.000Z'),
        createdByUserId: routeActor.id,
      },
    });
    expect(contract).toMatchObject({ status: 'ACTIVE', version: 1 });

    const tripPayload = {
      contractId: contract.id,
      expectedContractVersion: contract.version,
      code: `TRIP-${suffix}`,
      serviceDate: '2026-09-10',
      legs: [
        { sequence: 1, label: 'Garagem E2E → Unidade E2E' },
        { sequence: 2, label: 'Unidade E2E → Garagem E2E' },
      ],
      commandId: randomUUID(),
    };
    const created = await request(app.getHttpServer())
      .post('/api/v1/trips')
      .set('authorization', `Bearer ${accessToken}`)
      .send(tripPayload)
      .expect(201);
    expect(created.body).toMatchObject({
      trip: {
        code: tripPayload.code,
        source: {
          kind: 'continuous-contract',
          contractId: contract.id,
          sourceVersion: 1,
        },
        status: 'draft',
        version: 1,
      },
      idempotent: false,
    });
    const tripId = created.body.trip.id as string;

    const routeId = randomUUID();
    const approvedRouteSnapshot = {
      route: {
        id: routeId,
        companyId: tenantId,
        contractId: contract.id,
        routingCompanyId: customer.body.id,
        code: `ROUTE-${suffix}`,
        name: 'Plano aprovado E2E',
        shift: 'Manhã',
        type: 'municipal',
        origin: { label: 'Garagem E2E' },
        destination: { label: 'Unidade E2E' },
        plannedOutboundKm: 10,
        plannedReturnKm: 10,
        plannedTotalKm: 20,
        estimatedDurationMinutes: 45,
      },
      points: [{ sequence: 1, address: { label: 'Ponto E2E' } }],
      assignments: [
        {
          passengerName: 'Nome pessoal que não pode sair no resumo',
          accessibilityNotes: 'Dado sensível que não pode sair no resumo',
        },
      ],
    };
    await prisma.routingRoute.create({
      data: {
        id: routeId,
        companyId: tenantId,
        routingCompanyId: customer.body.id,
        contractId: contract.id,
        code: `ROUTE-${suffix}`,
        name: 'Plano aprovado E2E',
        shift: 'Manhã',
        requiredArrivalTime: '08:00',
        type: RoutingRouteType.MUNICIPAL,
        requiresDocumentation: false,
        requiredDocumentTypeCodes: [],
        originLabel: 'Garagem E2E',
        originStreet: 'Rua de Origem',
        originNumber: '100',
        originDistrict: 'Centro',
        originPostalCode: '38400000',
        originCity: 'Uberlândia',
        originState: 'MG',
        destinationLabel: 'Unidade E2E',
        destinationStreet: 'Rua de Destino',
        destinationNumber: '200',
        destinationDistrict: 'Distrito Industrial',
        destinationPostalCode: '38408000',
        destinationCity: 'Uberlândia',
        destinationState: 'MG',
        predictedVehicleName: 'Ônibus E2E',
        predictedVehicleCapacity: 46,
        maxWalkingDistanceMeters: 500,
        validFrom: new Date('2026-09-01T00:00:00.000Z'),
        validUntil: new Date('2026-09-30T00:00:00.000Z'),
        status: RoutingRouteStatus.APPROVED,
        version: 2,
        planVersion: 1,
        approvedVersion: 2,
        plannedOutboundKm: 10,
        plannedReturnKm: 10,
        plannedTotalKm: 20,
        estimatedDurationMinutes: 45,
        createdByUserId: routeActor.id,
      },
    });
    await prisma.routingRouteVersion.create({
      data: {
        companyId: tenantId,
        routeId,
        version: 2,
        planVersion: 1,
        snapshot: approvedRouteSnapshot,
      },
    });
    await prisma.routingRouteApproval.create({
      data: {
        companyId: tenantId,
        routeId,
        approvedVersion: 2,
        approvedByUserId: routeActor.id,
      },
    });

    const routeSelectionPayload = {
      routeId,
      expectedRouteVersion: 2,
      commandId: randomUUID(),
      expectedVersion: 1,
    };
    const selectedRoutePlan = await request(app.getHttpServer())
      .post(`/api/v1/trips/${tripId}/route-plan`)
      .set('authorization', `Bearer ${accessToken}`)
      .send(routeSelectionPayload)
      .expect(201);
    expect(selectedRoutePlan.body).toMatchObject({
      trip: { id: tripId, version: 2 },
      selection: {
        sourceRouteId: routeId,
        sourceRouteVersion: 2,
        sourcePlanVersion: 1,
        usedForExecutionAt: null,
        planSummary: {
          code: `ROUTE-${suffix}`,
          name: 'Plano aprovado E2E',
        },
      },
      idempotent: false,
    });
    expect(JSON.stringify(selectedRoutePlan.body)).not.toContain(
      'Nome pessoal que não pode sair no resumo',
    );
    const persistedRoutePlan =
      await prisma.operationalTripRoutePlanSelection.findUniqueOrThrow({
        where: {
          id_companyId: {
            id: selectedRoutePlan.body.selection.id as string,
            companyId: tenantId,
          },
        },
        select: { sourceSnapshot: true },
      });
    expect(JSON.stringify(persistedRoutePlan.sourceSnapshot)).not.toContain(
      'Nome pessoal que não pode sair no resumo',
    );
    expect(JSON.stringify(persistedRoutePlan.sourceSnapshot)).not.toContain(
      'Dado sensível que não pode sair no resumo',
    );

    await prisma.routingRouteVersion.create({
      data: {
        companyId: tenantId,
        routeId,
        version: 3,
        planVersion: 2,
        snapshot: approvedRouteSnapshot,
      },
    });
    const invalidSelectionAt = new Date('2026-09-01T12:30:00.000Z');
    await expect(
      prisma.operationalTripRoutePlanSelection.create({
        data: {
          id: randomUUID(),
          companyId: tenantId,
          tripId,
          sourceRouteId: routeId,
          sourceRouteVersion: 3,
          sourcePlanVersion: 2,
          routeAggregateVersionAtSelection: 3,
          sourceSnapshot: { route: approvedRouteSnapshot.route, points: [] },
          commandId: randomUUID(),
          selectedByUserId: routeActor.id,
          reason: 'Versão sem aprovação não pode orientar a Viagem.',
          selectedAt: invalidSelectionAt,
          supersededAt: invalidSelectionAt,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });

    await request(app.getHttpServer())
      .post(`/api/v1/trips/${tripId}/route-plan`)
      .set('authorization', `Bearer ${accessToken}`)
      .send(routeSelectionPayload)
      .expect(201)
      .expect(({ body }) => expect(body.idempotent).toBe(true));

    const apply = async (
      expectedVersion: number,
      body: Record<string, unknown>,
      expectedStatus: string,
    ) => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/trips/${tripId}/commands`)
        .set('authorization', `Bearer ${accessToken}`)
        .send({ ...body, commandId: randomUUID(), expectedVersion })
        .expect(201);
      expect(response.body.trip).toMatchObject({
        id: tripId,
        status: expectedStatus,
        version: expectedVersion + 1,
      });
      return response.body;
    };

    await apply(2, { type: 'schedule' }, 'scheduled');
    await apply(3, { type: 'start' }, 'in-execution');
    await request(app.getHttpServer())
      .get(`/api/v1/trips/${tripId}/route-plans`)
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          tripId,
          currentSelectionId: selectedRoutePlan.body.selection.id,
          executionSelectionId: selectedRoutePlan.body.selection.id,
          items: [
            expect.objectContaining({
              id: selectedRoutePlan.body.selection.id,
              usedForExecutionAt: expect.any(String),
            }),
          ],
        });
      });
    await apply(
      4,
      { type: 'suspend', reason: 'Bloqueio temporário da via.' },
      'suspended',
    );
    await apply(
      5,
      { type: 'resume', reason: 'Via liberada para circulação.' },
      'in-execution',
    );
    await apply(
      6,
      {
        type: 'interrupt',
        reason: 'Falha mecânica impediu a continuidade.',
        evidence: [
          {
            kind: 'manual-note',
            description: 'Ocorrência registrada pelo Operacional no E2E.',
          },
        ],
      },
      'interrupted',
    );
    await apply(
      7,
      { type: 'close-early', reason: 'Encerramento antecipado autorizado.' },
      'early-terminated',
    );

    await request(app.getHttpServer())
      .get(`/api/v1/trips/${tripId}/history`)
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(8);
        const history = body as Array<{ toStatus: string }>;
        expect(history.map((entry) => entry.toStatus)).toEqual([
          'draft',
          'draft',
          'scheduled',
          'in-execution',
          'suspended',
          'in-execution',
          'interrupted',
          'early-terminated',
        ]);
      });
  });
  it('publica a sessão nativa e permite assumir pelo admin e pelo Comercial', async () => {
    const operator = await prisma.user.create({
      data: {
        companyId: tenantId,
        name: 'Operador sessão E2E',
        username: 'session.operator',
        usernameNormalized: 'session.operator',
        email: 'session.operator@example.test',
        emailNormalized: 'session.operator@example.test',
        passwordHash: 'hash-e2e-sem-uso',
        departments: ['commercial'],
        permissionCodes: [
          'whatsapp-conversations:view',
          'whatsapp-conversations:attend',
          'service:view',
          'service:assume',
        ],
      },
    });
    const operatorToken = await accessTokens.sign({
      sub: operator.id,
      companyId: tenantId,
      tokenVersion: operator.tokenVersion,
    });
    for (const [index, token] of [accessToken, operatorToken].entries()) {
      const inbound = await signedWebhook(
        app,
        webhookPayload(
          'native-session-' + index,
          '551198887700' + index,
          'Olá',
        ),
      ).expect(202);
      const conversationId = inbound.body.conversationId as string;
      const detail = await request(app.getHttpServer())
        .get('/api/v1/whatsapp/conversations/' + conversationId)
        .set('authorization', 'Bearer ' + token)
        .expect(200);
      const session = detail.body.currentServiceSession;
      expect(session.id).not.toBe(conversationId);
      expect(session.availableActions).toContain('ASSUME');
      await request(app.getHttpServer())
        .post('/api/v1/service/sessions/' + session.id + '/actions/assume')
        .set('authorization', 'Bearer ' + token)
        .send({ commandId: randomUUID(), expectedVersion: session.version })
        .expect(201);
      const updated = await request(app.getHttpServer())
        .get('/api/v1/whatsapp/conversations/' + conversationId)
        .set('authorization', 'Bearer ' + token)
        .expect(200);
      expect(updated.body.currentServiceSession).toMatchObject({
        id: session.id,
        controlMode: 'human',
        version: session.version + 1,
      });
      expect(updated.body).toMatchObject({
        conversationState: 'human-active',
        flowStep: 'human-service',
        assignedTo: {
          id: updated.body.currentServiceSession.responsibleUserId,
        },
      });
      await expect(
        whatsappRepository.authorizeHumanOutbound({
          companyId: tenantId,
          conversationId,
          actorUserId: updated.body.currentServiceSession
            .responsibleUserId as string,
          commandId: randomUUID(),
          idempotencyKey: randomUUID(),
          expectedVersion: updated.body.version as number,
          text: 'Validação sem criar nem enviar mensagem.',
        }),
      ).resolves.toBeUndefined();
      if (index === 1)
        expect(updated.body.currentServiceSession.responsibleUserId).toBe(
          operator.id,
        );
      await request(app.getHttpServer())
        .post(
          '/api/v1/service/sessions/' + session.id + '/actions/return-to-ai',
        )
        .set('authorization', 'Bearer ' + accessToken)
        .send({
          commandId: randomUUID(),
          expectedVersion: updated.body.currentServiceSession.version,
        })
        .expect(201);
      const returned = await request(app.getHttpServer())
        .get('/api/v1/whatsapp/conversations/' + conversationId)
        .set('authorization', 'Bearer ' + token)
        .expect(200);
      expect(returned.body).toMatchObject({
        conversationState: 'bot-active',
        flowStep: 'main-menu',
        assignedTo: null,
        currentServiceSession: { controlMode: 'ai', responsibleUserId: null },
      });
    }
  });
  it('habilita IA na primeira mensagem de outro canal conectado', async () => {
    const original = await prisma.whatsAppChannel.findUniqueOrThrow({
      where: { id: channelId },
    });
    const channel = await prisma.whatsAppChannel.create({
      data: {
        companyId: tenantId,
        providerId: original.providerId,
        name: 'Outro dispositivo E2E',
        phoneNumber: '5511991122334',
        instanceName: 'lume-e2e-outro-dispositivo',
        webhookSecretHash: original.webhookSecretHash,
        organizationalStatus: 'ACTIVE',
        connectionStatus: 'CONNECTED',
        routingMode: 'GENERAL_TRIAGE',
        enabled: true,
      },
    });
    const payload = {
      ...webhookPayload(
        'new-channel-first-message',
        '5511988877010',
        'Quero um orçamento',
      ),
      instance: channel.instanceName,
    };
    const inbound = await signedWebhook(app, payload, channel.id).expect(202);
    expect(inbound.body).toMatchObject({
      accepted: true,
      automationAllowed: true,
      canGenerateReply: true,
      canSendReply: true,
      isFirstContact: true,
    });
    const session = await prisma.serviceSession.findUniqueOrThrow({
      where: { id: inbound.body.serviceSessionId as string },
    });
    expect(session).toMatchObject({
      companyId: tenantId,
      sourceChannelId: channel.id,
      controlMode: 'AI',
      status: 'OPEN',
      isForeground: true,
    });
    const event = await prisma.integrationOutbox.findFirstOrThrow({
      where: {
        companyId: tenantId,
        aggregateId: inbound.body.conversationId as string,
        topic: 'whatsapp.inbound.persisted',
      },
    });
    expect(event.payload).toMatchObject({
      channelId: channel.id,
      serviceSessionId: session.id,
      automationAllowed: true,
    });
  });
  it('publica, repete e restaura instruções do Atendimento Lume', async () => {
    const agent = await prisma.lumeAgent.findFirstOrThrow({
      where: { companyId: tenantId, code: 'customer-service' },
    });
    const path = '/api/v1/agents/' + agent.id + '/tenant-instructions';
    const firstInput = {
      commandId: randomUUID(),
      expectedVersion: 0,
      content:
        'Responda com clareza e considere os dados já fornecidos pelo cliente.',
    };
    const first = await request(app.getHttpServer())
      .post(path)
      .set('authorization', 'Bearer ' + accessToken)
      .send(firstInput)
      .expect(201);
    expect(first.body).toMatchObject({ version: 1, idempotent: false });
    await request(app.getHttpServer())
      .post(path)
      .set('authorization', 'Bearer ' + accessToken)
      .send(firstInput)
      .expect(201)
      .expect(({ body }) =>
        expect(body).toMatchObject({ version: 1, idempotent: true }),
      );
    await request(app.getHttpServer())
      .post(path)
      .set('authorization', 'Bearer ' + accessToken)
      .send({
        commandId: randomUUID(),
        expectedVersion: 1,
        content: 'Seja objetivo e não repita perguntas já respondidas.',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(path + '/' + first.body.promptVersionId + '/rollback')
      .set('authorization', 'Bearer ' + accessToken)
      .send({ commandId: randomUUID(), expectedVersion: 2 })
      .expect(201)
      .expect(({ body }) => expect(body.version).toBe(3));
    const active = await prisma.agentPromptVersion.findFirstOrThrow({
      where: {
        companyId: tenantId,
        agentId: agent.id,
        kind: 'TENANT_INSTRUCTIONS',
        status: 'ACTIVE',
      },
    });
    expect(active.content).toBe(firstInput.content);
  });

  it('desabilita agentes por canal sem perder mensagens e reabilita novas entradas', async () => {
    const original = await prisma.whatsAppChannel.findUniqueOrThrow({
      where: { id: channelId },
    });
    const channel = await prisma.whatsAppChannel.create({
      data: {
        companyId: tenantId,
        providerId: original.providerId,
        name: 'Canal IA E2E',
        phoneNumber: '5511991122335',
        instanceName: 'lume-e2e-agents-toggle',
        webhookSecretHash: original.webhookSecretHash,
        organizationalStatus: 'ACTIVE',
        connectionStatus: 'CONNECTED',
        routingMode: 'GENERAL_TRIAGE',
      },
    });
    const path = '/api/v1/whatsapp/channels/' + channel.id;
    const change = {
      commandId: randomUUID(),
      expectedVersion: channel.version,
      displayName: channel.name,
      departmentId: null,
      routingMode: 'general-triage',
      allowedAutomaticTargetDepartmentIds: [],
      agentsEnabled: false,
    };
    const disabled = await request(app.getHttpServer())
      .patch(path)
      .set('authorization', 'Bearer ' + accessToken)
      .send(change)
      .expect(200);
    expect(disabled.body.agentsEnabled).toBe(false);
    await request(app.getHttpServer())
      .patch(path)
      .set('authorization', 'Bearer ' + accessToken)
      .send({ ...change, commandId: randomUUID() })
      .expect(409);
    const inbound = await signedWebhook(
      app,
      {
        ...webhookPayload('agents-off', '5511988877020', 'Olá, quero viajar'),
        instance: channel.instanceName,
      },
      channel.id,
    ).expect(202);
    expect(inbound.body).toMatchObject({
      accepted: true,
      automationAllowed: false,
      canGenerateReply: false,
      canSendReply: false,
    });
    await expect(
      prisma.whatsAppMessage.count({
        where: {
          companyId: tenantId,
          conversationId: inbound.body.conversationId as string,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      whatsappRepository.assertAutomaticReplyAllowed(
        tenantId,
        inbound.body.conversationId as string,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const enabled = await request(app.getHttpServer())
      .patch(path)
      .set('authorization', 'Bearer ' + accessToken)
      .send({
        ...change,
        commandId: randomUUID(),
        expectedVersion: disabled.body.version,
        agentsEnabled: true,
      })
      .expect(200);
    expect(enabled.body.agentsEnabled).toBe(true);
    const next = await signedWebhook(
      app,
      {
        ...webhookPayload('agents-on', '5511988877020', 'Vamos continuar'),
        instance: channel.instanceName,
      },
      channel.id,
    ).expect(202);
    expect(next.body.automationAllowed).toBe(true);
    await expect(
      whatsappRepository.assertAutomaticReplyAllowed(
        tenantId,
        next.body.conversationId as string,
      ),
    ).resolves.toMatchObject({ allowed: true });
  });
  it('envia somente o aviso autorizado de handoff e preserva o bloqueio das respostas da IA', async () => {
    const inbound = await signedWebhook(
      app,
      webhookPayload(
        'handoff-delivery-fix',
        '5511988877040',
        'Quero falar com uma pessoa',
      ),
    ).expect(202);
    const conversationId = inbound.body.conversationId as string;
    await transitionSystem({
      conversationId,
      commandId: randomUUID(),
      expectedVersion: 1,
      actorUserId: null,
      name: 'forward',
      metadata: {
        reason: 'customer-requested-human',
        targetDepartment: 'commercial',
      },
      automaticHumanHandoff: {
        customerMessage: 'Vou encaminhar para nossa equipe.',
        occurredAt: new Date('2026-09-07T15:00:00Z'),
      },
    });
    const notice = await prisma.whatsAppMessage.findFirstOrThrow({
      where: { companyId: tenantId, conversationId, direction: 'OUTBOUND' },
      include: { attempts: true },
    });
    await prisma.whatsAppMessage.update({
      where: { id: notice.id },
      data: { actorType: 'AI_AGENT' },
    });
    const history = await request(app.getHttpServer())
      .get('/api/v1/whatsapp/conversations/' + conversationId + '/messages')
      .set('authorization', 'Bearer ' + accessToken)
      .expect(200);
    expect(history.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: notice.id,
          actor: expect.objectContaining({ type: 'AI_AGENT' }),
          source: 'AUTOMATION',
          deliveryStatus: 'pending',
        }),
      ]),
    );
    const claim = {
      companyId: tenantId,
      messageId: notice.id,
      attemptId: notice.attempts[0].id,
      commandId: randomUUID(),
      ownerId: e2eDispatchOwnerId,
    };
    await expect(
      whatsappRepository.assertAutomaticReplyAllowed(tenantId, conversationId),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await prisma.whatsAppMessage.update({
      where: { id: notice.id },
      data: { automationPurpose: null },
    });
    await expect(
      whatsappRepository.claimEvolutionDispatch(claim),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await prisma.whatsAppMessage.update({
      where: { id: notice.id },
      data: { automationPurpose: notice.automationPurpose },
    });
    await expect(
      whatsappRepository.claimEvolutionDispatch(claim),
    ).resolves.toMatchObject({ shouldSend: true });
    await prisma.serviceSession.update({
      where: { id: notice.serviceSessionId! },
      data: {
        status: 'OPEN',
        responsibleUserId: (
          await prisma.user.findFirstOrThrow({ where: { companyId: tenantId } })
        ).id,
      },
    });
    await expect(
      whatsappRepository.claimEvolutionDispatch({
        ...claim,
        commandId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('marca falha definitiva antes de despacho sem confundir resultado desconhecido com falha', async () => {
    for (const dispatchState of ['READY', 'UNKNOWN'] as const) {
      const inbound = await signedWebhook(
        app,
        webhookPayload(
          'failed-delivery-' + dispatchState,
          dispatchState === 'READY' ? '5511988877041' : '5511988877042',
          'Falar com atendente',
        ),
      ).expect(202);
      const conversationId = inbound.body.conversationId as string;
      await transitionSystem({
        conversationId,
        commandId: randomUUID(),
        expectedVersion: 1,
        actorUserId: null,
        name: 'forward',
        metadata: {
          reason: 'customer-requested-human',
          targetDepartment: 'commercial',
        },
        automaticHumanHandoff: {
          customerMessage: 'Encaminhando para nossa equipe.',
          occurredAt: new Date('2026-09-07T15:00:00Z'),
        },
      });
      const notice = await prisma.whatsAppMessage.findFirstOrThrow({
        where: { companyId: tenantId, conversationId, direction: 'OUTBOUND' },
        include: { attempts: true },
      });
      const event = await prisma.integrationOutbox.findFirstOrThrow({
        where: {
          companyId: tenantId,
          aggregateId: conversationId,
          topic: 'whatsapp.outbound.requested',
        },
      });
      const executionId = randomUUID();
      await prisma.integrationOutbox.update({
        where: { id: event.id },
        data: { status: 'PROCESSING', executionId, processingProvider: 'API' },
      });
      await prisma.whatsAppAutomationExecution.create({
        data: {
          companyId: tenantId,
          outboxEventId: event.id,
          executionId,
          provider: 'API',
          attemptNumber: 1,
        },
      });
      await prisma.whatsAppMessageAttempt.update({
        where: { id: notice.attempts[0].id },
        data: { dispatchState },
      });
      await completeAutomationOutbox({
        eventId: event.id,
        commandId: randomUUID(),
        executionId,
        aggregateId: conversationId,
        aggregateType: event.aggregateType,
        outcome: 'terminal-failure',
        errorCode: 'DISPATCH_BLOCKED',
        errorMessage: 'Bloqueada antes do envio',
      });
      const final = await prisma.whatsAppMessage.findUniqueOrThrow({
        where: { id: notice.id },
        include: { attempts: true },
      });
      expect(final.deliveryStatus).toBe(
        dispatchState === 'READY' ? 'FAILED' : 'PENDING',
      );
      expect(final.attempts[0].dispatchState).toBe(
        dispatchState === 'READY' ? 'FAILED' : 'UNKNOWN',
      );
    }
  });
  it('transfere pelo painel somente com departamento, sem fila ou responsável, e rejeita repetição com versão antiga', async () => {
    const inbound = await signedWebhook(
      app,
      webhookPayload(
        'department-only-transfer',
        '5511988877050',
        'Preciso falar com Compras',
      ),
    ).expect(202);
    const conversationId = inbound.body.conversationId as string;
    const detail = await request(app.getHttpServer())
      .get('/api/v1/whatsapp/conversations/' + conversationId)
      .set('authorization', 'Bearer ' + accessToken)
      .expect(200);
    const session = detail.body.currentServiceSession;
    const target = await prisma.tenantDepartment.findFirstOrThrow({
      where: { companyId: tenantId, code: 'PURCHASING' },
    });
    const command = {
      commandId: randomUUID(),
      expectedVersion: session.version,
      departmentId: target.id,
    };
    for (let replay = 0; replay < 2; replay++) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/service/sessions/' + session.id + '/actions/transfer')
        .set('authorization', 'Bearer ' + accessToken)
        .send(command);
      expect(response.status, JSON.stringify(response.body)).toBe(
        replay === 0 ? 201 : 409,
      );
    }
    const updated = await request(app.getHttpServer())
      .get('/api/v1/service/sessions/' + session.id)
      .set('authorization', 'Bearer ' + accessToken)
      .expect(200);
    expect(updated.body).toMatchObject({
      currentDepartmentId: target.id,
      queueId: null,
      responsibleUserId: null,
      status: 'waiting-human',
      controlMode: 'human',
      version: session.version + 1,
    });
    expect(
      await prisma.serviceSessionEvent.count({
        where: {
          companyId: tenantId,
          serviceSessionId: session.id,
          commandId: command.commandId,
        },
      }),
    ).toBe(1);
    await expect(
      whatsappRepository.assertAutomaticReplyAllowed(tenantId, conversationId),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('encaminha do Financeiro devolvido à IA para a fila do Comercial e mantém o aviso no outbox', async () => {
    const inbound = await signedWebhook(
      app,
      webhookPayload(
        'financial-quote-handoff',
        '5511988877060',
        'Quero falar sobre meu orçamento',
      ),
    ).expect(202);
    const conversationId = inbound.body.conversationId as string;
    const detail = await request(app.getHttpServer())
      .get('/api/v1/whatsapp/conversations/' + conversationId)
      .set('authorization', 'Bearer ' + accessToken)
      .expect(200);
    const initial = detail.body.currentServiceSession;
    const financial = await prisma.tenantDepartment.findFirstOrThrow({
      where: { companyId: tenantId, code: 'FINANCIAL' },
    });
    const commercial = await prisma.tenantDepartment.findFirstOrThrow({
      where: { companyId: tenantId, code: 'COMMERCIAL' },
    });
    const transferred = await request(app.getHttpServer())
      .post('/api/v1/service/sessions/' + initial.id + '/actions/transfer')
      .set('authorization', 'Bearer ' + accessToken)
      .send({
        commandId: randomUUID(),
        expectedVersion: initial.version,
        departmentId: financial.id,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/service/sessions/' + initial.id + '/actions/return-to-ai')
      .set('authorization', 'Bearer ' + accessToken)
      .send({
        commandId: randomUUID(),
        expectedVersion: transferred.body.version,
      })
      .expect(201);
    const before = await prisma.whatsAppConversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    await transitionSystem({
      conversationId,
      commandId: randomUUID(),
      expectedVersion: before.version,
      actorUserId: null,
      name: 'forward',
      targetDepartment: 'commercial',
      metadata: { targetDepartment: 'commercial', reason: 'quote-discussion' },
      automaticHumanHandoff: {
        customerMessage: 'Vou encaminhar ao Comercial.',
        occurredAt: new Date(),
      },
    });
    const session = await prisma.serviceSession.findUniqueOrThrow({
      where: { id: initial.id },
      include: { queue: true },
    });
    expect(session).toMatchObject({
      currentDepartmentId: commercial.id,
      status: 'WAITING_HUMAN',
      controlMode: 'HUMAN',
      responsibleUserId: null,
      queue: { departmentId: commercial.id },
    });
    const notice = await prisma.whatsAppMessage.findFirstOrThrow({
      where: {
        companyId: tenantId,
        conversationId,
        direction: 'OUTBOUND',
        text: 'Vou encaminhar ao Comercial.',
      },
    });
    expect(notice.deliveryStatus).toBe('PENDING');
    await expect(
      whatsappRepository.assertAutomaticReplyAllowed(tenantId, conversationId),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
