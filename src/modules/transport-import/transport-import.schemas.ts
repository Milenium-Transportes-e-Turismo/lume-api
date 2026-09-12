import { z } from 'zod';
import { validationError } from '../../core/errors/app-error';

export const civilDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const date = new Date(v + 'T00:00:00Z');
    return (
      Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v
    );
  }, 'Data civil inválida.');
export const commandSchema = z.object({ commandId: z.string().uuid() });
export const rangeSchema = z
  .object({ from: civilDate, to: civilDate })
  .refine((v) => v.from <= v.to, 'Período inválido.');
export const settingsSchema = z
  .object({
    externalIdField: z.string().max(80).default(''),
    sourceUtcOffset: z
      .string()
      .regex(/^([+-](0\d|1[0-4]):[0-5]\d)?$/)
      .default(''),
    scheduleTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default('04:00'),
    timezone: z
      .string()
      .max(80)
      .default('America/Sao_Paulo')
      .refine((v) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }),
    lookbackDays: z.number().int().min(1).max(90).default(7),
    maxTripKm: z.number().positive().max(10000000).nullable().default(null),
    maxGapKm: z.number().positive().max(10000000).nullable().default(null),
    sequenceComplete: z.boolean().default(false),
  })
  .strict();
export const integrationSchema = commandSchema
  .extend({
    expectedVersion: z.number().int().min(0),
    enabled: z.boolean(),
    settings: settingsSchema,
  })
  .strict();
export const importSchema = commandSchema
  .extend({
    from: civilDate,
    to: civilDate,
    vehicleIds: z.array(z.string().min(1).max(160)).min(1).max(1000),
  })
  .strict()
  .refine((v) => v.from <= v.to, 'Período inválido.');
export const analysisSchema = commandSchema
  .extend({
    vehicleId: z.string().min(1).max(160),
    from: civilDate,
    to: civilDate,
  })
  .strict()
  .refine((v) => v.from <= v.to, 'Período inválido.');
export const pageSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  vehicleId: z.string().max(160).optional(),
  from: civilDate.optional(),
  to: civilDate.optional(),
  status: z
    .enum(['OPEN', 'RESOLVED', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'])
    .optional(),
});
export const justificationSchema = commandSchema
  .extend({
    expectedVersion: z.number().int().min(1),
    text: z.string().trim().min(1).max(4000),
  })
  .strict();
export const resumeSchema = commandSchema
  .extend({ expectedVersion: z.number().int().min(1) })
  .strict();
export type TransportSettings = z.infer<typeof settingsSchema>;
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw validationError(result.error.issues.map((i) => i.message).join(' '));
  return result.data;
}
