import { z } from 'zod';
import { validationError, forbidden } from '../../core/errors/app-error';
import { isValidCnpj } from '../../shared/utils/brazilian-documents';
import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';

export const resources = [
  'companies',
  'fleet',
  'catalogs',
  'affiliations',
  'contracts',
  'routes',
] as const;
export type TransportResource = (typeof resources)[number];
const text = (max: number) => z.string().trim().min(1).max(max);
const id = z.uuid();
const nullableId = id.nullable().optional();
export const civilDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }, 'Data civil inválida');
const km = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,3})?$/)
  .nullable()
  .optional();
const command = z.object({
  commandId: id,
  expectedVersion: z.number().int().nonnegative(),
});
export const schemas = {
  companies: z.object({
    registrationId: id.optional(),
    cnpj: text(18)
      .transform((value) => value.replace(/\D/g, ''))
      .refine(isValidCnpj, 'CNPJ inválido'),
    legalName: text(160),
    tradeName: text(120),
    active: z.boolean().optional(),
  }),
  fleet: z.object({
    validFrom: civilDate.optional(),
    provider: text(40).nullable().optional(),
    externalVehicleId: text(200).nullable().optional(),
    fleetCode: text(80),
    supplierRegistrationId: id,
    plate: text(20).nullable().optional(),
    serviceTypeId: nullableId,
    vehicleTypeId: nullableId,
    categoryId: nullableId,
    axles: z.number().int().min(1).max(100).nullable().optional(),
    passengers: z.number().int().min(0).max(1000).nullable().optional(),
    model: text(160).nullable().optional(),
    active: z.boolean().optional(),
  }),
  catalogs: z.object({
    kind: z.enum(['service-type', 'vehicle-type', 'category']),
    name: text(120),
    active: z.boolean().optional(),
  }),
  affiliations: z.object({
    registrationId: id,
    supplierRegistrationId: id,
    role: z.enum(['client', 'employee']),
    validFrom: civilDate,
    validUntil: civilDate.nullable().optional(),
  }),
  contracts: z.object({
    existingContractId: id.optional(),
    clientRegistrationId: id,
    supplierRegistrationId: id,
    code: text(80),
    name: text(160),
    modality: z.enum(['continuous', 'occasional', 'rental']),
    validFrom: civilDate,
    validUntil: civilDate.nullable().optional(),
    status: z.enum(['draft', 'active', 'suspended', 'ended']).optional(),
  }),
  routes: z.object({
    provider: text(40),
    externalId: text(200).nullable().optional(),
    name: text(200),
  }),
};
export const conditionSchema = command.extend({
  validFrom: civilDate,
  validUntil: civilDate.nullable().optional(),
  period: z.enum(['daily', 'monthly']),
  allowanceKm: km,
  includeGarage: z.boolean(),
  transitionMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .nullable()
    .optional(),
  transitionAllowanceKm: km,
});
export const assignmentSchema = command.extend({
  contractId: id,
  validFrom: civilDate,
  validUntil: civilDate.nullable().optional(),
});
export const closePeriodSchema = command.extend({ validUntil: civilDate });
export const commandSchema = command;
export interface TransportInput {
  existingContractId?: string;
  commandId: string;
  expectedVersion: number;
  registrationId?: string;
  cnpj?: string;
  legalName?: string;
  tradeName?: string;
  active?: boolean;
  externalVehicleId?: string | null;
  fleetCode?: string;
  supplierRegistrationId?: string;
  plate?: string | null;
  serviceTypeId?: string | null;
  vehicleTypeId?: string | null;
  categoryId?: string | null;
  axles?: number | null;
  passengers?: number | null;
  model?: string | null;
  kind?: string;
  code?: string;
  name?: string;
  role?: string;
  validFrom?: string;
  validUntil?: string | null;
  clientRegistrationId?: string;
  modality?: string;
  status?: 'draft' | 'active' | 'suspended' | 'ended';
  provider?: string | null;
  externalId?: string | null;
  period?: string;
  allowanceKm?: string | null;
  includeGarage?: boolean;
  transitionMonth?: string | null;
  transitionAllowanceKm?: string | null;
  contractId?: string;
}
export function parseInput(
  resource: TransportResource,
  input: unknown,
  update: boolean,
): TransportInput {
  const schema = update
    ? schemas[resource].partial().extend(command.shape).strict()
    : schemas[resource].extend(command.shape).strict();
  return parse(schema, input);
}
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw validationError(
      result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
    );
  return result.data;
}
export function validateInterval(from: string, until?: string | null) {
  if (until && until < from)
    throw validationError(
      'O fim da vigência deve ser igual ou posterior ao início.',
    );
}
export function assertDepartmentForSupplierDeactivation(
  current: AuthenticatedPrincipal,
) {
  if (
    !current.departments.some(
      (value) => value === 'management' || value === 'directorate',
    )
  )
    throw forbidden(
      'Somente diretoria ou gerência podem inativar uma empresa prestadora.',
    );
}
export const DEFAULT_CATALOGS = [
  ['service-type', 'continuous', 'Contínuo (operacional)'],
  ['service-type', 'occasional', 'Eventual (turístico)'],
  ['service-type', 'rental', 'Locação (eventual/curta distância)'],
  ['vehicle-type', 'bus', 'Ônibus'],
  ['vehicle-type', 'van', 'Van'],
  ['vehicle-type', 'mini-van', 'Mini Van'],
  ['vehicle-type', 'car', 'Carro'],
  ['vehicle-type', 'minibus', 'Micro-ônibus'],
  ['category', 'conventional', 'Convencional'],
  ['category', 'executive', 'Executivo'],
  ['category', 'executive-dd', 'Executivo/DD'],
  ['category', 'commercial', 'Comercial'],
] as const;

export const fleetOwnershipSchema = command.extend({
  supplierRegistrationId: id,
  validFrom: civilDate,
  validUntil: civilDate.nullable().optional(),
});
