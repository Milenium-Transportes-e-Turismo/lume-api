import { isAbsolute, resolve } from 'node:path';

import { z } from 'zod';

type RawEnvironment = Record<string, unknown>;

const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
const DEFAULT_SUPPORT_RECIPIENT_EMAIL = 'devops@mileniumturismo.com.br';
const DEFAULT_SUPPORT_CC_EMAILS = [
  'taiane.karine@mileniumturismo.com.br',
  'taianekas.dev@outlook.com',
];

function requiredStringSchema(key: string, minimumLength = 1) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : value),
    z.string({ error: `${key} deve ser uma string.` }).min(minimumLength, {
      message: `${key} deve possuir ao menos ${minimumLength} caracteres.`,
    }),
  );
}

function optionalStringSchema(key: string, fallback = '') {
  return z.preprocess(
    (value) => value ?? fallback,
    z
      .string({ error: `${key} deve ser uma string.` })
      .transform((value) => value.trim()),
  );
}

function optionalRawStringSchema(key: string) {
  return z.preprocess(
    (value) =>
      typeof value === 'string'
        ? value.trim()
        : value === undefined
          ? undefined
          : value,
    z.string({ error: `${key} deve ser uma string.` }).optional(),
  );
}

function positiveIntegerSchema(key: string, fallback: number) {
  const message = `${key} deve ser um número inteiro positivo.`;
  return z.coerce
    .number({ error: message })
    .int({ message })
    .positive({ message })
    .default(fallback);
}

function nonNegativeIntegerSchema(key: string, fallback: number) {
  const message = `${key} deve ser um número inteiro não negativo.`;
  return z.coerce
    .number({ error: message })
    .int({ message })
    .nonnegative({ message })
    .default(fallback);
}

function normalizeBoolean(value: unknown): unknown {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
}

function booleanSchema(key: string, fallback: boolean) {
  return z
    .preprocess(
      normalizeBoolean,
      z.boolean({ error: `${key} deve ser true ou false.` }),
    )
    .default(fallback);
}

function optionalBooleanSchema(key: string) {
  return z.preprocess(
    normalizeBoolean,
    z.boolean({ error: `${key} deve ser true ou false.` }).optional(),
  );
}

function httpUrlSchema(key: string, fallback: string) {
  return optionalStringSchema(key, fallback)
    .superRefine((value, context) => {
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        context.addIssue({
          code: 'custom',
          message: `${key} deve ser uma URL válida.`,
        });
        return;
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        context.addIssue({
          code: 'custom',
          message: `${key} deve usar HTTP ou HTTPS.`,
        });
      }
    })
    .transform((value) => new URL(value).toString().replace(/\/$/, ''));
}

function optionalHttpUrlSchema(key: string) {
  return optionalRawStringSchema(key)
    .superRefine((value, context) => {
      if (!value) return;
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        context.addIssue({
          code: 'custom',
          message: `${key} deve ser uma URL válida.`,
        });
        return;
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        context.addIssue({
          code: 'custom',
          message: `${key} deve usar HTTP ou HTTPS.`,
        });
      }
    })
    .transform((value) =>
      value ? new URL(value).toString().replace(/\/$/, '') : value,
    );
}

function emailSchema(key: string, fallback?: string) {
  const schema = z
    .string({ error: `${key} deve ser um e-mail válido.` })
    .trim()
    .max(254, { message: `${key} deve ser um e-mail válido.` })
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
      message: `${key} deve ser um e-mail válido.`,
    });
  return z.preprocess((value) => value ?? fallback, schema);
}

function supportRecipientSchema() {
  return z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim()
        ? value
        : DEFAULT_SUPPORT_RECIPIENT_EMAIL,
    emailSchema('SUPPORT_RECIPIENT_EMAIL'),
  );
}

function supportCcSchema() {
  return z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim()
        ? value
        : DEFAULT_SUPPORT_CC_EMAILS.join(','),
    z
      .string({
        error:
          'SUPPORT_CC_EMAIL deve conter uma lista de e-mails válidos separada por vírgulas.',
      })
      .transform((value, context) => {
        const addresses = value
          .split(',')
          .map((address) => address.trim())
          .filter(Boolean);
        if (
          addresses.length === 0 ||
          addresses.some(
            (address) =>
              address.length > 254 ||
              !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address),
          )
        ) {
          context.addIssue({
            code: 'custom',
            message:
              'SUPPORT_CC_EMAIL deve conter uma lista de e-mails válidos separada por vírgulas.',
          });
          return z.NEVER;
        }
        const seen = new Set<string>();
        return addresses
          .filter((address) => {
            const normalized = address.toLowerCase();
            if (seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
          })
          .join(',');
      }),
  );
}

function commaSeparatedValuesSchema(key: string, fallback: string) {
  return optionalStringSchema(key, fallback).transform((value, context) => {
    const values = value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    if (values.length === 0 || new Set(values).size !== values.length) {
      context.addIssue({
        code: 'custom',
        message: `${key} deve possuir valores únicos separados por vírgula.`,
      });
      return z.NEVER;
    }
    return values.join(',');
  });
}

function optionalIsoDateTimeSchema(key: string) {
  return optionalStringSchema(key).transform((value, context) => {
    if (!value) return '';
    if (
      !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ||
      Number.isNaN(Date.parse(value))
    ) {
      context.addIssue({
        code: 'custom',
        message: `${key} deve ser uma data ISO 8601 com fuso horário explícito.`,
      });
      return z.NEVER;
    }
    return new Date(value).toISOString();
  });
}

function optionalUuidSchema(key: string) {
  return optionalStringSchema(key).superRefine((value, context) => {
    if (
      value &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: `${key} deve ser um UUID válido.`,
      });
    }
  });
}

function addIssue(
  context: z.core.$RefinementCtx,
  message: string,
  path?: PropertyKey[],
): void {
  context.addIssue({ code: 'custom', message, path });
}

function minimumLength(
  context: z.core.$RefinementCtx,
  value: string,
  key: string,
  length: number,
): void {
  if (value.length < length) {
    addIssue(context, `${key} deve possuir ao menos ${length} caracteres.`, [
      key,
    ]);
  }
}

function departmentPhoneSchema(key: string) {
  return optionalStringSchema(key).transform((value) =>
    value.replace(/\D/g, ''),
  );
}

const departmentPhoneShape = {
  MILENIUM_DIRECTOR_PHONE: departmentPhoneSchema('MILENIUM_DIRECTOR_PHONE'),
  MILENIUM_DEPARTMENT_PURCHASES_PHONE: departmentPhoneSchema(
    'MILENIUM_DEPARTMENT_PURCHASES_PHONE',
  ),
  MILENIUM_DEPARTMENT_CONTROLLING_PHONE: departmentPhoneSchema(
    'MILENIUM_DEPARTMENT_CONTROLLING_PHONE',
  ),
  MILENIUM_DEPARTMENT_DP_PHONE: departmentPhoneSchema(
    'MILENIUM_DEPARTMENT_DP_PHONE',
  ),
  MILENIUM_DEPARTMENT_FINANCE_PHONE: departmentPhoneSchema(
    'MILENIUM_DEPARTMENT_FINANCE_PHONE',
  ),
  MILENIUM_DEPARTMENT_MANAGEMENT_PHONE: departmentPhoneSchema(
    'MILENIUM_DEPARTMENT_MANAGEMENT_PHONE',
  ),
  MILENIUM_DEPARTMENT_MAINTENANCE_PHONE: departmentPhoneSchema(
    'MILENIUM_DEPARTMENT_MAINTENANCE_PHONE',
  ),
  MILENIUM_DEPARTMENT_MONITORING_PHONE: departmentPhoneSchema(
    'MILENIUM_DEPARTMENT_MONITORING_PHONE',
  ),
  MILENIUM_DEPARTMENT_OPERATIONAL_PHONE: departmentPhoneSchema(
    'MILENIUM_DEPARTMENT_OPERATIONAL_PHONE',
  ),
};

const baseEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(NODE_ENVIRONMENTS, {
        error: 'NODE_ENV deve ser development, test ou production.',
      })
      .default('development'),
    PORT: positiveIntegerSchema('PORT', 3000),
    TENANT_API_PUBLIC_URL: optionalHttpUrlSchema('TENANT_API_PUBLIC_URL'),
    DATABASE_URL: requiredStringSchema('DATABASE_URL'),
    TEST_DATABASE_URL: optionalRawStringSchema('TEST_DATABASE_URL'),
    DATABASE_TRANSACTION_MAX_WAIT_MS: positiveIntegerSchema(
      'DATABASE_TRANSACTION_MAX_WAIT_MS',
      15_000,
    ),
    DATABASE_TRANSACTION_TIMEOUT_MS: positiveIntegerSchema(
      'DATABASE_TRANSACTION_TIMEOUT_MS',
      60_000,
    ),
    HEIGIT_BASE_URL: httpUrlSchema('HEIGIT_BASE_URL', 'https://api.heigit.org'),
    HEIGIT_API_KEY: requiredStringSchema('HEIGIT_API_KEY', 10),
    ORS_VERSION: optionalStringSchema('ORS_VERSION'),
    ORS_MAP_DATA_VERSION: optionalStringSchema('ORS_MAP_DATA_VERSION'),
    ROUTING_TIMEOUT_MS: positiveIntegerSchema('ROUTING_TIMEOUT_MS', 15_000),
    NOMINATIM_URL: optionalHttpUrlSchema('NOMINATIM_URL'),
    VALHALLA_URL: optionalHttpUrlSchema('VALHALLA_URL'),
    VALHALLA_VERSION: optionalStringSchema('VALHALLA_VERSION'),
    VALHALLA_MAP_DATA_VERSION: optionalStringSchema(
      'VALHALLA_MAP_DATA_VERSION',
    ),
    TOLL_INTELLIGENCE_ENABLED: booleanSchema(
      'TOLL_INTELLIGENCE_ENABLED',
      false,
    ),
    TOLL_INTELLIGENCE_OPENAI_API_KEY: optionalStringSchema(
      'TOLL_INTELLIGENCE_OPENAI_API_KEY',
    ),
    TOLL_INTELLIGENCE_OPENAI_BASE_URL: httpUrlSchema(
      'TOLL_INTELLIGENCE_OPENAI_BASE_URL',
      'https://api.openai.com/v1',
    ),
    TOLL_INTELLIGENCE_OPENAI_MODEL: optionalStringSchema(
      'TOLL_INTELLIGENCE_OPENAI_MODEL',
      'gpt-5.4-mini',
    ),
    TOLL_INTELLIGENCE_TIMEOUT_MS: positiveIntegerSchema(
      'TOLL_INTELLIGENCE_TIMEOUT_MS',
      90_000,
    ),
    AGENT_OPENAI_RESPONSES_TIMEOUT_MS: positiveIntegerSchema(
      'AGENT_OPENAI_RESPONSES_TIMEOUT_MS',
      30_000,
    ),
    LUME_AGENT_ORCHESTRATOR_OPENAI_API_KEY: optionalRawStringSchema(
      'LUME_AGENT_ORCHESTRATOR_OPENAI_API_KEY',
    ),
    LUME_AGENT_CUSTOMER_SERVICE_OPENAI_API_KEY: optionalRawStringSchema(
      'LUME_AGENT_CUSTOMER_SERVICE_OPENAI_API_KEY',
    ),
    LUME_AGENT_REGISTRATION_OPENAI_API_KEY: optionalRawStringSchema(
      'LUME_AGENT_REGISTRATION_OPENAI_API_KEY',
    ),
    LUME_AGENT_KNOWLEDGE_OPENAI_API_KEY: optionalRawStringSchema(
      'LUME_AGENT_KNOWLEDGE_OPENAI_API_KEY',
    ),
    LUME_AGENT_MEDIA_OPENAI_API_KEY: optionalRawStringSchema(
      'LUME_AGENT_MEDIA_OPENAI_API_KEY',
    ),
    LUME_AGENT_CONTINUITY_OPENAI_API_KEY: optionalRawStringSchema(
      'LUME_AGENT_CONTINUITY_OPENAI_API_KEY',
    ),
    LUME_AGENT_SUPERVISOR_OPENAI_API_KEY: optionalRawStringSchema(
      'LUME_AGENT_SUPERVISOR_OPENAI_API_KEY',
    ),
    TOLL_MATCH_CORRIDOR_METERS: positiveIntegerSchema(
      'TOLL_MATCH_CORRIDOR_METERS',
      60,
    ),
    TOLL_ALLOW_DEVELOPMENT_FIXTURES: booleanSchema(
      'TOLL_ALLOW_DEVELOPMENT_FIXTURES',
      false,
    ),
    JWT_ACCESS_SECRET: requiredStringSchema('JWT_ACCESS_SECRET', 32),
    JWT_ACCESS_TTL_SECONDS: positiveIntegerSchema(
      'JWT_ACCESS_TTL_SECONDS',
      900,
    ),
    JWT_REFRESH_TTL_DAYS: positiveIntegerSchema('JWT_REFRESH_TTL_DAYS', 7),
    JWT_REFRESH_REMEMBER_TTL_DAYS: positiveIntegerSchema(
      'JWT_REFRESH_REMEMBER_TTL_DAYS',
      30,
    ),
    INSTALLATION_ID: requiredStringSchema('INSTALLATION_ID', 36),
    LICENSE_PUBLIC_KEY_BASE64: requiredStringSchema(
      'LICENSE_PUBLIC_KEY_BASE64',
      32,
    ),
    LICENSE_DOCUMENT: requiredStringSchema('LICENSE_DOCUMENT', 32),
    BCRYPT_ROUNDS: positiveIntegerSchema('BCRYPT_ROUNDS', 12),
    PASSWORD_CHANGE_TOKEN_TTL_MINUTES: positiveIntegerSchema(
      'PASSWORD_CHANGE_TOKEN_TTL_MINUTES',
      30,
    ),
    PASSWORD_HISTORY_LIMIT: positiveIntegerSchema('PASSWORD_HISTORY_LIMIT', 10),
    PASSWORD_RESET_URL_BASE: optionalRawStringSchema('PASSWORD_RESET_URL_BASE'),
    PASSWORD_RESET_MIN_RESPONSE_MS: nonNegativeIntegerSchema(
      'PASSWORD_RESET_MIN_RESPONSE_MS',
      750,
    ),
    EMAIL_DELIVERY_ENABLED: booleanSchema('EMAIL_DELIVERY_ENABLED', false),
    RESEND_API_KEY: optionalStringSchema('RESEND_API_KEY'),
    RESEND_FROM_EMAIL: emailSchema(
      'RESEND_FROM_EMAIL',
      'no-reply@localhost.invalid',
    ),
    RESEND_FROM_NAME: optionalStringSchema('RESEND_FROM_NAME', 'Lume'),
    RESEND_API_URL: httpUrlSchema('RESEND_API_URL', 'https://api.resend.com'),
    SUPPORT_RECIPIENT_EMAIL: supportRecipientSchema(),
    SUPPORT_CC_EMAIL: supportCcSchema(),
    RESEND_REQUEST_TIMEOUT_MS: positiveIntegerSchema(
      'RESEND_REQUEST_TIMEOUT_MS',
      10_000,
    ),
    RESEND_MAX_ATTEMPTS: positiveIntegerSchema('RESEND_MAX_ATTEMPTS', 2),
    RESEND_RETRY_DELAY_MS: nonNegativeIntegerSchema(
      'RESEND_RETRY_DELAY_MS',
      150,
    ),
    CORS_ORIGINS: optionalStringSchema('CORS_ORIGINS', 'http://localhost:3000'),
    SWAGGER_ENABLED: optionalBooleanSchema('SWAGGER_ENABLED'),
    PRISMA_STUDIO_PORT: positiveIntegerSchema('PRISMA_STUDIO_PORT', 5555),
    PRISMA_STUDIO_ALLOW_REMOTE: booleanSchema(
      'PRISMA_STUDIO_ALLOW_REMOTE',
      false,
    ),
    PRISMA_STUDIO_ALLOW_PRODUCTION: booleanSchema(
      'PRISMA_STUDIO_ALLOW_PRODUCTION',
      false,
    ),
    PRISMA_STUDIO_CONFIRM_TARGET: optionalStringSchema(
      'PRISMA_STUDIO_CONFIRM_TARGET',
    ),
    TRUST_PROXY_HOPS: nonNegativeIntegerSchema('TRUST_PROXY_HOPS', 0),
    RATE_LIMIT_TTL_MS: positiveIntegerSchema('RATE_LIMIT_TTL_MS', 60_000),
    RATE_LIMIT_MAX: positiveIntegerSchema('RATE_LIMIT_MAX', 100),
    HTTP_MAX_JSON_BODY_BYTES: positiveIntegerSchema(
      'HTTP_MAX_JSON_BODY_BYTES',
      1_048_576,
    ),
    API_USAGE_RETENTION_DAYS: positiveIntegerSchema(
      'API_USAGE_RETENTION_DAYS',
      90,
    ),
    DOCUMENT_REVIEW_ENABLED: booleanSchema('DOCUMENT_REVIEW_ENABLED', false),
    DOCUMENT_REVIEW_PROVIDER: optionalStringSchema(
      'DOCUMENT_REVIEW_PROVIDER',
      'local',
    ),
    OPENAI_API_KEY: optionalStringSchema('OPENAI_API_KEY'),
    OPENAI_DOCUMENT_MODEL: optionalStringSchema(
      'OPENAI_DOCUMENT_MODEL',
      'gpt-5.6-terra',
    ),
    OPENAI_DOCUMENT_TIMEOUT_MS: positiveIntegerSchema(
      'OPENAI_DOCUMENT_TIMEOUT_MS',
      90_000,
    ),
    OPENAI_DOCUMENT_MAX_ATTEMPTS: positiveIntegerSchema(
      'OPENAI_DOCUMENT_MAX_ATTEMPTS',
      3,
    ),
    OPENAI_API_BASE_URL: httpUrlSchema(
      'OPENAI_API_BASE_URL',
      'https://api.openai.com/v1',
    ),
    WHATSAPP_ENABLED: booleanSchema('WHATSAPP_ENABLED', false),
    WHATSAPP_AUTOMATION_ACTIVE_SINCE: optionalIsoDateTimeSchema(
      'WHATSAPP_AUTOMATION_ACTIVE_SINCE',
    ),
    WHATSAPP_IMPORT_ROOT: optionalStringSchema(
      'WHATSAPP_IMPORT_ROOT',
      './var/imports/whatsapp',
    ),
    WHATSAPP_IMPORT_UPLOAD_TEMP_ROOT: optionalStringSchema(
      'WHATSAPP_IMPORT_UPLOAD_TEMP_ROOT',
      './var/imports/whatsapp/incoming',
    ),
    WHATSAPP_IMPORT_APPLY_CONCURRENCY: positiveIntegerSchema(
      'WHATSAPP_IMPORT_APPLY_CONCURRENCY',
      4,
    ),
    WHATSAPP_ANDROID_BACKUP_MAX_DECRYPTED_BYTES: positiveIntegerSchema(
      'WHATSAPP_ANDROID_BACKUP_MAX_DECRYPTED_BYTES',
      4_294_967_296,
    ),
    WHATSAPP_ANDROID_BACKUP_UPLOAD_CHUNK_BYTES: positiveIntegerSchema(
      'WHATSAPP_ANDROID_BACKUP_UPLOAD_CHUNK_BYTES',
      16_777_216,
    ),
    WHATSAPP_ANDROID_IMPORT_CHUNK_MESSAGES: positiveIntegerSchema(
      'WHATSAPP_ANDROID_IMPORT_CHUNK_MESSAGES',
      25_000,
    ),
    WHATSAPP_ANDROID_MEDIA_MAX_FILE_BYTES: positiveIntegerSchema(
      'WHATSAPP_ANDROID_MEDIA_MAX_FILE_BYTES',
      536_870_912,
    ),
    WHATSAPP_ANDROID_MEDIA_ARCHIVE_MAX_BYTES: positiveIntegerSchema(
      'WHATSAPP_ANDROID_MEDIA_ARCHIVE_MAX_BYTES',
      8_589_934_592,
    ),
    WHATSAPP_ANDROID_MEDIA_ARCHIVE_MAX_ENTRIES: positiveIntegerSchema(
      'WHATSAPP_ANDROID_MEDIA_ARCHIVE_MAX_ENTRIES',
      250_000,
    ),
    WHATSAPP_ANDROID_MEDIA_ARCHIVE_MAX_UNCOMPRESSED_BYTES:
      positiveIntegerSchema(
        'WHATSAPP_ANDROID_MEDIA_ARCHIVE_MAX_UNCOMPRESSED_BYTES',
        17_179_869_184,
      ),
    WHATSAPP_ANDROID_MEDIA_ARCHIVE_CONCURRENCY: positiveIntegerSchema(
      'WHATSAPP_ANDROID_MEDIA_ARCHIVE_CONCURRENCY',
      4,
    ),
    WHATSAPP_ANDROID_MEDIA_UPLOAD_CHUNK_BYTES: positiveIntegerSchema(
      'WHATSAPP_ANDROID_MEDIA_UPLOAD_CHUNK_BYTES',
      16_777_216,
    ),
    WHATSAPP_HISTORY_IMPORT_MAX_ARCHIVES: positiveIntegerSchema(
      'WHATSAPP_HISTORY_IMPORT_MAX_ARCHIVES',
      5_000,
    ),
    WHATSAPP_HISTORY_IMPORT_MAX_ARCHIVE_BYTES: positiveIntegerSchema(
      'WHATSAPP_HISTORY_IMPORT_MAX_ARCHIVE_BYTES',
      536_870_912,
    ),
    WHATSAPP_HISTORY_IMPORT_MAX_ENTRIES: positiveIntegerSchema(
      'WHATSAPP_HISTORY_IMPORT_MAX_ENTRIES',
      5_000,
    ),
    WHATSAPP_HISTORY_IMPORT_MAX_UNCOMPRESSED_BYTES: positiveIntegerSchema(
      'WHATSAPP_HISTORY_IMPORT_MAX_UNCOMPRESSED_BYTES',
      2_147_483_648,
    ),
    WHATSAPP_HISTORY_IMPORT_MAX_TEXT_BYTES: positiveIntegerSchema(
      'WHATSAPP_HISTORY_IMPORT_MAX_TEXT_BYTES',
      134_217_728,
    ),
    WHATSAPP_HISTORY_IMPORT_RETENTION_HOURS: positiveIntegerSchema(
      'WHATSAPP_HISTORY_IMPORT_RETENTION_HOURS',
      48,
    ),
    WHATSAPP_HISTORY_IMPORT_LEASE_SECONDS: positiveIntegerSchema(
      'WHATSAPP_HISTORY_IMPORT_LEASE_SECONDS',
      900,
    ),
    WHATSAPP_HISTORY_IMPORT_RECOVERY_INTERVAL_SECONDS: positiveIntegerSchema(
      'WHATSAPP_HISTORY_IMPORT_RECOVERY_INTERVAL_SECONDS',
      15,
    ),
    WHATSAPP_HISTORY_IMPORT_CLEANUP_INTERVAL_MINUTES: positiveIntegerSchema(
      'WHATSAPP_HISTORY_IMPORT_CLEANUP_INTERVAL_MINUTES',
      15,
    ),
    WHATSAPP_HISTORY_IMPORT_MAX_ACTIVE_BATCHES_PER_TENANT:
      positiveIntegerSchema(
        'WHATSAPP_HISTORY_IMPORT_MAX_ACTIVE_BATCHES_PER_TENANT',
        2,
      ),
    WHATSAPP_HISTORY_IMPORT_MAX_TEMPORARY_BYTES_PER_TENANT:
      positiveIntegerSchema(
        'WHATSAPP_HISTORY_IMPORT_MAX_TEMPORARY_BYTES_PER_TENANT',
        17_179_869_184,
      ),
    WHATSAPP_MEDIA_STORAGE_DRIVER: optionalStringSchema(
      'WHATSAPP_MEDIA_STORAGE_DRIVER',
      'filesystem',
    ).transform((value) => value.toLowerCase()),
    WHATSAPP_MEDIA_STORAGE_PATH: optionalRawStringSchema(
      'WHATSAPP_MEDIA_STORAGE_PATH',
    ),
    KNOWLEDGE_STORAGE_DRIVER: optionalStringSchema(
      'KNOWLEDGE_STORAGE_DRIVER',
      'filesystem',
    ).transform((value) => value.toLowerCase()),
    KNOWLEDGE_STORAGE_PATH: optionalRawStringSchema('KNOWLEDGE_STORAGE_PATH'),
    WHATSAPP_API_DISPATCH_INTERVAL_MS: positiveIntegerSchema(
      'WHATSAPP_API_DISPATCH_INTERVAL_MS',
      500,
    ),
    WHATSAPP_API_REQUEST_TIMEOUT_MS: positiveIntegerSchema(
      'WHATSAPP_API_REQUEST_TIMEOUT_MS',
      10_000,
    ),
    WHATSAPP_API_EXECUTION_TIMEOUT_MS: positiveIntegerSchema(
      'WHATSAPP_API_EXECUTION_TIMEOUT_MS',
      480_000,
    ),
    WHATSAPP_API_DISPATCH_BATCH_SIZE: positiveIntegerSchema(
      'WHATSAPP_API_DISPATCH_BATCH_SIZE',
      20,
    ),
    WHATSAPP_API_RETRY_BASE_DELAY_MS: positiveIntegerSchema(
      'WHATSAPP_API_RETRY_BASE_DELAY_MS',
      500,
    ),
    WHATSAPP_API_RETRY_MAX_DELAY_MS: positiveIntegerSchema(
      'WHATSAPP_API_RETRY_MAX_DELAY_MS',
      300_000,
    ),
    WHATSAPP_API_DEBOUNCE_MS: positiveIntegerSchema(
      'WHATSAPP_API_DEBOUNCE_MS',
      2_000,
    ),
    WHATSAPP_API_DEPARTMENT_COLLECTION_MS: positiveIntegerSchema(
      'WHATSAPP_API_DEPARTMENT_COLLECTION_MS',
      120_000,
    ),
    WHATSAPP_CHANNEL_ID: optionalUuidSchema('WHATSAPP_CHANNEL_ID'),
    WHATSAPP_CHANNEL_NAME: optionalStringSchema(
      'WHATSAPP_CHANNEL_NAME',
      'WhatsApp principal',
    ),
    WHATSAPP_PHONE_NUMBER: optionalStringSchema('WHATSAPP_PHONE_NUMBER'),
    WHATSAPP_IGNORE_GROUPS: booleanSchema('WHATSAPP_IGNORE_GROUPS', true),
    WHATSAPP_IGNORE_FROM_ME: booleanSchema('WHATSAPP_IGNORE_FROM_ME', true),
    WHATSAPP_MAX_WEBHOOK_BYTES: positiveIntegerSchema(
      'WHATSAPP_MAX_WEBHOOK_BYTES',
      262_144,
    ),
    WHATSAPP_MAX_ATTACHMENT_BYTES: positiveIntegerSchema(
      'WHATSAPP_MAX_ATTACHMENT_BYTES',
      52_428_800,
    ),
    WHATSAPP_PANEL_MAX_ATTACHMENT_BYTES: positiveIntegerSchema(
      'WHATSAPP_PANEL_MAX_ATTACHMENT_BYTES',
      104_857_600,
    ),
    WHATSAPP_ALLOWED_MIME_TYPES: optionalStringSchema(
      'WHATSAPP_ALLOWED_MIME_TYPES',
      'image/jpeg,image/png,image/webp,image/gif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv,text/vcard,text/x-vcard,application/octet-stream,audio/ogg,audio/mpeg,audio/mp4,audio/aac,audio/wav,video/mp4,video/webm,video/quicktime',
    ),
    WHATSAPP_RETENTION_DAYS: positiveIntegerSchema(
      'WHATSAPP_RETENTION_DAYS',
      365,
    ),
    INTEGRATION_RETENTION_DAYS: positiveIntegerSchema(
      'INTEGRATION_RETENTION_DAYS',
      90,
    ),
    RETENTION_JOB_ENABLED: optionalBooleanSchema('RETENTION_JOB_ENABLED'),
    EVOLUTION_PROVIDER_NAME: optionalStringSchema(
      'EVOLUTION_PROVIDER_NAME',
      'Evolution API',
    ),
    EVOLUTION_BASE_URL: optionalHttpUrlSchema('EVOLUTION_BASE_URL'),
    EVOLUTION_INSTANCE_NAME: optionalStringSchema('EVOLUTION_INSTANCE_NAME'),
    EVOLUTION_API_KEY: optionalStringSchema('EVOLUTION_API_KEY'),
    EVOLUTION_SEND_TEXT_PAYLOAD_MODE: z
      .enum(['number-text', 'legacy-text', 'textMessage'], {
        error:
          'EVOLUTION_SEND_TEXT_PAYLOAD_MODE deve ser number-text, legacy-text ou textMessage.',
      })
      .default('number-text'),
    EVOLUTION_SEND_TEXT_TIMEOUT_MS: positiveIntegerSchema(
      'EVOLUTION_SEND_TEXT_TIMEOUT_MS',
      10_000,
    ),
    EVOLUTION_SEND_MEDIA_TIMEOUT_MS: positiveIntegerSchema(
      'EVOLUTION_SEND_MEDIA_TIMEOUT_MS',
      30_000,
    ),
    EVOLUTION_MANAGEMENT_TIMEOUT_MS: positiveIntegerSchema(
      'EVOLUTION_MANAGEMENT_TIMEOUT_MS',
      15_000,
    ),
    EVOLUTION_MEDIA_CONTENT_TIMEOUT_MS: positiveIntegerSchema(
      'EVOLUTION_MEDIA_CONTENT_TIMEOUT_MS',
      30_000,
    ),
    EVOLUTION_PROFILE_PICTURE_TIMEOUT_MS: positiveIntegerSchema(
      'EVOLUTION_PROFILE_PICTURE_TIMEOUT_MS',
      5_000,
    ),
    EVOLUTION_PROFILE_PICTURE_CACHE_TTL_MS: positiveIntegerSchema(
      'EVOLUTION_PROFILE_PICTURE_CACHE_TTL_MS',
      3_600_000,
    ),
    EVOLUTION_WEBHOOK_SECRET: optionalStringSchema('EVOLUTION_WEBHOOK_SECRET'),
    WEBHOOK_MAX_SKEW_MS: positiveIntegerSchema('WEBHOOK_MAX_SKEW_MS', 300_000),
    WEBHOOK_MAX_EVENT_AGE_MS: positiveIntegerSchema(
      'WEBHOOK_MAX_EVENT_AGE_MS',
      604_800_000,
    ),
    EVOLUTION_DISPATCH_LEASE_MS: positiveIntegerSchema(
      'EVOLUTION_DISPATCH_LEASE_MS',
      90_000,
    ),
    WHATSAPP_FOLLOW_UP_INACTIVITY_MS: positiveIntegerSchema(
      'WHATSAPP_FOLLOW_UP_INACTIVITY_MS',
      1_800_000,
    ),
    WHATSAPP_PREVENT_CLOSE_WITH_APPROVED_QUOTE: booleanSchema(
      'WHATSAPP_PREVENT_CLOSE_WITH_APPROVED_QUOTE',
      false,
    ),
    WHATSAPP_AI_PROVIDER_ORDER: commaSeparatedValuesSchema(
      'WHATSAPP_AI_PROVIDER_ORDER',
      'openai',
    ),
    WHATSAPP_AI_REQUEST_TIMEOUT_MS: positiveIntegerSchema(
      'WHATSAPP_AI_REQUEST_TIMEOUT_MS',
      90_000,
    ),
    WHATSAPP_AI_OPENAI_API_KEY: optionalRawStringSchema(
      'WHATSAPP_AI_OPENAI_API_KEY',
    ),
    WHATSAPP_AI_OPENAI_BASE_URL: httpUrlSchema(
      'WHATSAPP_AI_OPENAI_BASE_URL',
      'https://api.openai.com/v1',
    ),
    WHATSAPP_AI_OPENAI_MODEL: optionalStringSchema(
      'WHATSAPP_AI_OPENAI_MODEL',
      'gpt-5.5',
    ),
    DATA_EXCHANGE_MAX_FILE_BYTES: positiveIntegerSchema(
      'DATA_EXCHANGE_MAX_FILE_BYTES',
      25 * 1024 * 1024,
    ),
    DATA_EXCHANGE_MAX_TENANT_BYTES: positiveIntegerSchema(
      'DATA_EXCHANGE_MAX_TENANT_BYTES',
      250 * 1024 * 1024,
    ),
    DATA_EXCHANGE_RETENTION_DAYS: positiveIntegerSchema(
      'DATA_EXCHANGE_RETENTION_DAYS',
      30,
    ),
    TENANT_LEGAL_NAME: optionalStringSchema('TENANT_LEGAL_NAME'),
    TENANT_TRADE_NAME: optionalStringSchema('TENANT_TRADE_NAME'),
    TENANT_TAX_ID: optionalStringSchema('TENANT_TAX_ID'),
    TENANT_ADMIN_NAME: optionalStringSchema('TENANT_ADMIN_NAME'),
    TENANT_ADMIN_USERNAME: optionalStringSchema('TENANT_ADMIN_USERNAME'),
    TENANT_ADMIN_EMAIL: optionalStringSchema('TENANT_ADMIN_EMAIL'),
    TENANT_ADMIN_CPF: optionalStringSchema('TENANT_ADMIN_CPF'),
    TENANT_ADMIN_PASSWORD: optionalRawStringSchema('TENANT_ADMIN_PASSWORD'),
    ...departmentPhoneShape,
  })
  .loose();

export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export const envSchema = baseEnvSchema
  .superRefine((config, context) => {
    let databaseUrl: URL | undefined;
    try {
      databaseUrl = new URL(config.DATABASE_URL);
    } catch {
      addIssue(context, 'DATABASE_URL deve ser uma URL PostgreSQL válida.', [
        'DATABASE_URL',
      ]);
    }
    if (
      databaseUrl &&
      !['postgresql:', 'postgres:'].includes(databaseUrl.protocol)
    ) {
      addIssue(context, 'DATABASE_URL deve apontar para PostgreSQL.', [
        'DATABASE_URL',
      ]);
    }

    if (config.BCRYPT_ROUNDS < 10 || config.BCRYPT_ROUNDS > 15) {
      addIssue(context, 'BCRYPT_ROUNDS deve estar entre 10 e 15.', [
        'BCRYPT_ROUNDS',
      ]);
    }

    if (
      config.NODE_ENV === 'production' &&
      (parseCorsOrigins(config.CORS_ORIGINS).length === 0 ||
        config.CORS_ORIGINS.includes('*'))
    ) {
      addIssue(context, 'CORS_ORIGINS deve ser explícito em produção.', [
        'CORS_ORIGINS',
      ]);
    }
    if (
      config.NODE_ENV === 'production' &&
      config.JWT_ACCESS_SECRET.toLowerCase().includes('replace-with')
    ) {
      addIssue(context, 'Substitua JWT_ACCESS_SECRET em produção.', [
        'JWT_ACCESS_SECRET',
      ]);
    }

    if (config.WHATSAPP_MEDIA_STORAGE_DRIVER !== 'filesystem') {
      addIssue(
        context,
        'WHATSAPP_MEDIA_STORAGE_DRIVER aceita somente filesystem nesta versão.',
        ['WHATSAPP_MEDIA_STORAGE_DRIVER'],
      );
    }
    if (
      config.NODE_ENV === 'production' &&
      config.WHATSAPP_ENABLED &&
      !config.WHATSAPP_MEDIA_STORAGE_PATH
    ) {
      addIssue(
        context,
        'WHATSAPP_MEDIA_STORAGE_PATH é obrigatório em produção quando o WhatsApp está habilitado.',
        ['WHATSAPP_MEDIA_STORAGE_PATH'],
      );
    }
    if (
      config.WHATSAPP_MEDIA_STORAGE_PATH &&
      !isAbsolute(config.WHATSAPP_MEDIA_STORAGE_PATH)
    ) {
      addIssue(
        context,
        'WHATSAPP_MEDIA_STORAGE_PATH deve ser um caminho absoluto.',
        ['WHATSAPP_MEDIA_STORAGE_PATH'],
      );
    }
    if (config.KNOWLEDGE_STORAGE_DRIVER !== 'filesystem') {
      addIssue(
        context,
        'KNOWLEDGE_STORAGE_DRIVER aceita somente filesystem nesta versão.',
        ['KNOWLEDGE_STORAGE_DRIVER'],
      );
    }
    if (config.NODE_ENV === 'production' && !config.KNOWLEDGE_STORAGE_PATH) {
      addIssue(context, 'KNOWLEDGE_STORAGE_PATH é obrigatório em produção.', [
        'KNOWLEDGE_STORAGE_PATH',
      ]);
    }
    if (
      config.KNOWLEDGE_STORAGE_PATH &&
      !isAbsolute(config.KNOWLEDGE_STORAGE_PATH)
    ) {
      addIssue(
        context,
        'KNOWLEDGE_STORAGE_PATH deve ser um caminho absoluto.',
        ['KNOWLEDGE_STORAGE_PATH'],
      );
    }

    if (!['local', 'openai'].includes(config.DOCUMENT_REVIEW_PROVIDER)) {
      addIssue(context, 'DOCUMENT_REVIEW_PROVIDER deve ser local ou openai.', [
        'DOCUMENT_REVIEW_PROVIDER',
      ]);
    }
    if (
      config.DOCUMENT_REVIEW_ENABLED &&
      config.DOCUMENT_REVIEW_PROVIDER === 'openai'
    ) {
      minimumLength(context, config.OPENAI_API_KEY, 'OPENAI_API_KEY', 20);
    }
    if (config.OPENAI_DOCUMENT_MAX_ATTEMPTS > 3) {
      addIssue(context, 'OPENAI_DOCUMENT_MAX_ATTEMPTS deve ser no máximo 3.', [
        'OPENAI_DOCUMENT_MAX_ATTEMPTS',
      ]);
    }
    if (config.TOLL_INTELLIGENCE_ENABLED) {
      minimumLength(
        context,
        config.TOLL_INTELLIGENCE_OPENAI_API_KEY,
        'TOLL_INTELLIGENCE_OPENAI_API_KEY',
        20,
      );
    }
    const agentCredentialEntries = [
      [
        'LUME_AGENT_ORCHESTRATOR_OPENAI_API_KEY',
        config.LUME_AGENT_ORCHESTRATOR_OPENAI_API_KEY,
      ],
      [
        'LUME_AGENT_CUSTOMER_SERVICE_OPENAI_API_KEY',
        config.LUME_AGENT_CUSTOMER_SERVICE_OPENAI_API_KEY,
      ],
      [
        'LUME_AGENT_REGISTRATION_OPENAI_API_KEY',
        config.LUME_AGENT_REGISTRATION_OPENAI_API_KEY,
      ],
      [
        'LUME_AGENT_KNOWLEDGE_OPENAI_API_KEY',
        config.LUME_AGENT_KNOWLEDGE_OPENAI_API_KEY,
      ],
      [
        'LUME_AGENT_MEDIA_OPENAI_API_KEY',
        config.LUME_AGENT_MEDIA_OPENAI_API_KEY,
      ],
      [
        'LUME_AGENT_CONTINUITY_OPENAI_API_KEY',
        config.LUME_AGENT_CONTINUITY_OPENAI_API_KEY,
      ],
      [
        'LUME_AGENT_SUPERVISOR_OPENAI_API_KEY',
        config.LUME_AGENT_SUPERVISOR_OPENAI_API_KEY,
      ],
    ] as const;
    for (const [key, credential] of agentCredentialEntries) {
      if (credential) minimumLength(context, credential, key, 20);
    }
    const configuredAgentCredentials = agentCredentialEntries.flatMap(
      ([, credential]) => (credential ? [credential] : []),
    );
    if (
      new Set(configuredAgentCredentials).size !==
      configuredAgentCredentials.length
    ) {
      addIssue(
        context,
        'Cada agente Lume deve usar uma API key individual; não reutilize a mesma credencial entre agentes.',
      );
    }
    if (
      config.NODE_ENV === 'production' &&
      (config.HEIGIT_API_KEY.toLowerCase().includes('replace-with') ||
        (config.TOLL_INTELLIGENCE_ENABLED &&
          config.TOLL_INTELLIGENCE_OPENAI_API_KEY.toLowerCase().includes(
            'replace-with',
          )))
    ) {
      addIssue(
        context,
        'Substitua as chaves de roteirização e inteligência de pedágios em produção.',
      );
    }
    if (
      config.NODE_ENV === 'production' &&
      (new URL(config.HEIGIT_BASE_URL).protocol !== 'https:' ||
        (config.TOLL_INTELLIGENCE_ENABLED &&
          new URL(config.TOLL_INTELLIGENCE_OPENAI_BASE_URL).protocol !==
            'https:'))
    ) {
      addIssue(
        context,
        'As URLs de roteirização e inteligência de pedágios devem usar HTTPS em produção.',
      );
    }

    if (config.DATA_EXCHANGE_MAX_FILE_BYTES > 50 * 1024 * 1024) {
      addIssue(
        context,
        'DATA_EXCHANGE_MAX_FILE_BYTES não pode ultrapassar 52428800 bytes.',
        ['DATA_EXCHANGE_MAX_FILE_BYTES'],
      );
    }
    if (
      config.DATA_EXCHANGE_MAX_TENANT_BYTES <
      config.DATA_EXCHANGE_MAX_FILE_BYTES
    ) {
      addIssue(
        context,
        'DATA_EXCHANGE_MAX_TENANT_BYTES deve ser maior ou igual a DATA_EXCHANGE_MAX_FILE_BYTES.',
        ['DATA_EXCHANGE_MAX_TENANT_BYTES'],
      );
    }
    if (config.DATA_EXCHANGE_MAX_TENANT_BYTES > 2 * 1024 * 1024 * 1024) {
      addIssue(
        context,
        'DATA_EXCHANGE_MAX_TENANT_BYTES não pode ultrapassar 2147483648 bytes.',
        ['DATA_EXCHANGE_MAX_TENANT_BYTES'],
      );
    }

    const providerOrder = config.WHATSAPP_AI_PROVIDER_ORDER.split(',');
    if (
      providerOrder.some(
        (provider) => !/^[a-z][a-z0-9-]{1,39}$/u.test(provider),
      )
    ) {
      addIssue(
        context,
        'WHATSAPP_AI_PROVIDER_ORDER contém um identificador de provider inválido.',
        ['WHATSAPP_AI_PROVIDER_ORDER'],
      );
    }
    if (config.WHATSAPP_ENABLED) {
      for (const [key, credential] of agentCredentialEntries) {
        if (!credential) {
          addIssue(
            context,
            `WHATSAPP_ENABLED=true exige a credencial individual ${key}.`,
            [key],
          );
        }
      }
      minimumLength(
        context,
        config.WHATSAPP_CHANNEL_NAME,
        'WHATSAPP_CHANNEL_NAME',
        2,
      );
      minimumLength(
        context,
        config.WHATSAPP_PHONE_NUMBER,
        'WHATSAPP_PHONE_NUMBER',
        10,
      );
      minimumLength(
        context,
        config.EVOLUTION_PROVIDER_NAME,
        'EVOLUTION_PROVIDER_NAME',
        2,
      );
      minimumLength(
        context,
        config.EVOLUTION_INSTANCE_NAME,
        'EVOLUTION_INSTANCE_NAME',
        2,
      );
      minimumLength(context, config.EVOLUTION_API_KEY, 'EVOLUTION_API_KEY', 16);
      minimumLength(
        context,
        config.EVOLUTION_WEBHOOK_SECRET,
        'EVOLUTION_WEBHOOK_SECRET',
        32,
      );
      if (!config.WHATSAPP_CHANNEL_ID) {
        addIssue(context, 'WHATSAPP_CHANNEL_ID deve ser um UUID válido.', [
          'WHATSAPP_CHANNEL_ID',
        ]);
      }
      if (!config.EVOLUTION_BASE_URL) {
        addIssue(context, 'EVOLUTION_BASE_URL é obrigatório.', [
          'EVOLUTION_BASE_URL',
        ]);
      }
    }
    if (
      config.NODE_ENV === 'production' &&
      config.WHATSAPP_ENABLED &&
      config.EVOLUTION_BASE_URL &&
      new URL(config.EVOLUTION_BASE_URL).protocol !== 'https:'
    ) {
      addIssue(context, 'EVOLUTION_BASE_URL deve usar HTTPS em produção.', [
        'EVOLUTION_BASE_URL',
      ]);
    }
    if (
      config.NODE_ENV === 'production' &&
      config.TENANT_API_PUBLIC_URL &&
      new URL(config.TENANT_API_PUBLIC_URL).protocol !== 'https:'
    ) {
      addIssue(context, 'TENANT_API_PUBLIC_URL deve usar HTTPS em produção.', [
        'TENANT_API_PUBLIC_URL',
      ]);
    }
    if (
      config.WHATSAPP_API_DEBOUNCE_MS > 300_000 ||
      config.WHATSAPP_API_DEPARTMENT_COLLECTION_MS > 300_000
    ) {
      addIssue(
        context,
        'As janelas WHATSAPP_API_*_MS devem ser de no máximo 300000 milissegundos.',
      );
    }
    const minimumExecutionTimeoutMs =
      config.AGENT_OPENAI_RESPONSES_TIMEOUT_MS +
      Math.max(
        config.EVOLUTION_SEND_TEXT_TIMEOUT_MS,
        config.EVOLUTION_SEND_MEDIA_TIMEOUT_MS,
      ) +
      30_000;
    if (
      config.WHATSAPP_ENABLED &&
      config.WHATSAPP_API_EXECUTION_TIMEOUT_MS < minimumExecutionTimeoutMs
    ) {
      addIssue(
        context,
        `WHATSAPP_API_EXECUTION_TIMEOUT_MS deve ser ao menos ${minimumExecutionTimeoutMs} para cobrir a execução OpenAI e o envio.`,
        ['WHATSAPP_API_EXECUTION_TIMEOUT_MS'],
      );
    }
    if (config.NODE_ENV === 'production' && !config.EMAIL_DELIVERY_ENABLED) {
      addIssue(context, 'EMAIL_DELIVERY_ENABLED deve ser true em produção.', [
        'EMAIL_DELIVERY_ENABLED',
      ]);
    }
    if (config.EMAIL_DELIVERY_ENABLED) {
      minimumLength(context, config.RESEND_API_KEY, 'RESEND_API_KEY', 20);
    }
    if (
      config.RESEND_FROM_NAME.length < 2 ||
      /[\r\n]/.test(config.RESEND_FROM_NAME)
    ) {
      addIssue(
        context,
        'RESEND_FROM_NAME deve possuir ao menos 2 caracteres.',
        ['RESEND_FROM_NAME'],
      );
    }
    if (config.RESEND_MAX_ATTEMPTS > 3) {
      addIssue(context, 'RESEND_MAX_ATTEMPTS deve estar entre 1 e 3.', [
        'RESEND_MAX_ATTEMPTS',
      ]);
    }

    const passwordResetUrl =
      config.PASSWORD_RESET_URL_BASE ??
      `${parseCorsOrigins(config.CORS_ORIGINS)[0] ?? 'http://localhost:3000'}/reset-password`;
    let parsedPasswordResetUrl: URL | undefined;
    try {
      parsedPasswordResetUrl = new URL(passwordResetUrl);
      if (!['http:', 'https:'].includes(parsedPasswordResetUrl.protocol)) {
        parsedPasswordResetUrl = undefined;
      }
    } catch {
      parsedPasswordResetUrl = undefined;
    }
    if (!parsedPasswordResetUrl) {
      addIssue(context, 'PASSWORD_RESET_URL_BASE deve ser uma URL válida.', [
        'PASSWORD_RESET_URL_BASE',
      ]);
    } else if (
      config.NODE_ENV === 'production' &&
      parsedPasswordResetUrl.protocol !== 'https:'
    ) {
      addIssue(
        context,
        'PASSWORD_RESET_URL_BASE deve usar HTTPS em produção.',
        ['PASSWORD_RESET_URL_BASE'],
      );
    }
    if (
      config.NODE_ENV === 'production' &&
      new URL(config.RESEND_API_URL).protocol !== 'https:'
    ) {
      addIssue(context, 'RESEND_API_URL deve usar HTTPS em produção.', [
        'RESEND_API_URL',
      ]);
    }
    if (
      config.NODE_ENV === 'production' &&
      config.EMAIL_DELIVERY_ENABLED &&
      config.RESEND_API_KEY.toLowerCase().includes('replace-with')
    ) {
      addIssue(context, 'Substitua RESEND_API_KEY em produção.', [
        'RESEND_API_KEY',
      ]);
    }
    if (
      config.NODE_ENV === 'production' &&
      config.EMAIL_DELIVERY_ENABLED &&
      config.RESEND_FROM_EMAIL.toLowerCase() === 'onboarding@resend.dev'
    ) {
      addIssue(
        context,
        'RESEND_FROM_EMAIL deve usar um domínio verificado no Resend em produção.',
        ['RESEND_FROM_EMAIL'],
      );
    }
    if (
      config.NODE_ENV === 'production' &&
      config.WHATSAPP_ENABLED &&
      [config.EVOLUTION_WEBHOOK_SECRET, config.EVOLUTION_API_KEY].some(
        (secret) => secret.toLowerCase().includes('replace-with'),
      )
    ) {
      addIssue(context, 'Substitua os segredos de WhatsApp em produção.');
    }
    if (
      config.NODE_ENV === 'production' &&
      config.WHATSAPP_ENABLED &&
      configuredAgentCredentials.some((credential) =>
        credential.toLowerCase().includes('replace-with'),
      )
    ) {
      addIssue(context, 'Substitua os segredos da IA do WhatsApp em produção.');
    }
  })
  .transform((config) => {
    const passwordResetUrl =
      config.PASSWORD_RESET_URL_BASE ??
      `${parseCorsOrigins(config.CORS_ORIGINS)[0] ?? 'http://localhost:3000'}/reset-password`;
    return {
      ...config,
      TENANT_API_PUBLIC_URL:
        config.TENANT_API_PUBLIC_URL ??
        (config.NODE_ENV === 'production'
          ? ''
          : `http://localhost:${config.PORT}/api/v1`),
      PASSWORD_RESET_URL_BASE: new URL(passwordResetUrl)
        .toString()
        .replace(/\/$/, ''),
      SWAGGER_ENABLED:
        config.SWAGGER_ENABLED ?? config.NODE_ENV !== 'production',
      RETENTION_JOB_ENABLED:
        config.RETENTION_JOB_ENABLED ?? config.NODE_ENV !== 'test',
      WHATSAPP_IMPORT_ROOT: resolve(config.WHATSAPP_IMPORT_ROOT),
      WHATSAPP_IMPORT_UPLOAD_TEMP_ROOT: resolve(
        config.WHATSAPP_IMPORT_UPLOAD_TEMP_ROOT,
      ),
      WHATSAPP_MEDIA_STORAGE_PATH: resolve(
        config.WHATSAPP_MEDIA_STORAGE_PATH || './var/whatsapp-media',
      ),
      KNOWLEDGE_STORAGE_PATH: resolve(
        config.KNOWLEDGE_STORAGE_PATH || './var/knowledge',
      ),
      EVOLUTION_BASE_URL: config.EVOLUTION_BASE_URL ?? '',
      WHATSAPP_AI_OPENAI_API_KEY:
        config.WHATSAPP_AI_OPENAI_API_KEY ?? config.OPENAI_API_KEY ?? '',
    };
  });

export type Env = z.output<typeof envSchema>;

let currentEnv: Env | undefined;

function requireCurrentEnv(): Env {
  if (!currentEnv) {
    throw new Error(
      'O ambiente ainda não foi validado. Inicialize o ConfigModule ou chame loadEnvironment().',
    );
  }
  return currentEnv;
}

export const env = new Proxy({} as Env, {
  get: (_target, property): unknown => {
    const value: unknown = Reflect.get(requireCurrentEnv(), property);
    return value;
  },
  has: (_target, property) => Reflect.has(requireCurrentEnv(), property),
  ownKeys: () => Reflect.ownKeys(requireCurrentEnv()),
  getOwnPropertyDescriptor: (_target, property) =>
    Object.getOwnPropertyDescriptor(requireCurrentEnv(), property),
});

export function validateEnvironment(config: RawEnvironment): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(
      result.error.issues.map((issue) => issue.message).join('\n'),
      { cause: result.error },
    );
  }
  currentEnv = result.data;
  return result.data;
}

export function loadEnvironment(config: RawEnvironment = process.env): Env {
  return validateEnvironment(config);
}
