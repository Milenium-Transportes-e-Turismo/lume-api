import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsDateString,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  REGISTRATION_EMAIL_TYPES,
  REGISTRATION_PHONE_TYPES,
  REGISTRATION_STATUSES,
  REGISTRATION_TYPES,
  type RegistrationDocumentProfile,
  type RegistrationEmailType,
  type RegistrationPhoneType,
  type RegistrationStatus,
  type RegistrationType,
} from '../../../domain/registrations/registration';

function csv(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined;
  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? values : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return value === true || value === 'true';
}

export class RegistrationPhoneDto {
  @IsString() @MaxLength(40) number!: string;
  @IsOptional() @IsString() @MaxLength(40) originalValue?: string | null;
  @IsOptional() @IsIn(REGISTRATION_PHONE_TYPES) type?: RegistrationPhoneType;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsBoolean() hasWhatsApp?: boolean;
  @IsOptional() @IsUUID('4') whatsappContactId?: string | null;
}

export class RegistrationEmailDto {
  @IsString() @MaxLength(254) address!: string;
  @IsOptional() @IsIn(REGISTRATION_EMAIL_TYPES) type?: RegistrationEmailType;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class RegistrationAddressDto {
  @IsString() @MaxLength(160) street!: string;
  @IsString() @MaxLength(30) number!: string;
  @IsOptional() @IsString() @MaxLength(120) complement?: string | null;
  @IsString() @MaxLength(120) district!: string;
  @IsString() @MaxLength(10) postalCode!: string;
  @IsString() @MaxLength(120) city!: string;
  @IsString() @MaxLength(2) state!: string;
}

export class RegistrationFieldsDto {
  @IsOptional()
  @IsObject()
  documentProfile?: RegistrationDocumentProfile | null;
  @IsOptional()
  @ValidateNested()
  @Type(() => RegistrationAddressDto)
  address?: RegistrationAddressDto | null;
  @IsOptional() @IsString() @MaxLength(4000) serviceInstructions?:
    string | null;
  @IsIn(REGISTRATION_TYPES) type!: RegistrationType;
  @IsOptional() @IsIn(REGISTRATION_STATUSES) status?: RegistrationStatus;
  @IsOptional() @IsString() @MaxLength(160) avicExternalId?: string | null;
  @IsOptional() @IsString() @MaxLength(80) firstName?: string | null;
  @IsOptional() @IsString() @MaxLength(120) lastName?: string | null;
  @IsOptional() @IsString() @MaxLength(160) legalName?: string | null;
  @IsOptional() @IsString() @MaxLength(120) tradeName?: string | null;
  @IsOptional() @IsString() @MaxLength(20) cpf?: string | null;
  @IsOptional() @IsString() @MaxLength(20) cnpj?: string | null;
  @IsOptional() @IsBoolean() isTemporary?: boolean;
  @IsOptional() @IsString() @MaxLength(500) temporaryReason?: string | null;
  @IsOptional() @IsDateString() regularizationDueAt?: string | null;
  @IsOptional() @IsUUID('4') temporaryResponsibleUserId?: string | null;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  roleCodes!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  tagCodes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RegistrationPhoneDto)
  phones?: RegistrationPhoneDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RegistrationEmailDto)
  emails?: RegistrationEmailDto[];
}

export class CreateRegistrationDto extends RegistrationFieldsDto {
  @IsUUID('4') commandId!: string;
}

export class UpdateRegistrationDto extends RegistrationFieldsDto {
  @IsUUID('4') commandId!: string;
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
}

export class ListRegistrationsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(REGISTRATION_STATUSES) status?: RegistrationStatus;
  @IsOptional() @IsIn(REGISTRATION_TYPES) type?: RegistrationType;
  @IsOptional()
  @Transform(({ value }) => optionalBoolean(value))
  @IsBoolean()
  temporary?: boolean;
  @IsOptional()
  @IsIn(['pending', 'overdue'])
  regularization?: 'pending' | 'overdue';
  @IsOptional()
  @Transform(({ value }) => csv(value))
  @IsString({ each: true })
  roleCodes?: string[];
  @IsOptional()
  @Transform(({ value }) => csv(value))
  @IsString({ each: true })
  tagCodes?: string[];
  @IsOptional() @IsIn(['name', 'status', 'updated']) sort?:
    'name' | 'status' | 'updated';
}

export class RegistrationConsolidationPreviewQueryDto {
  @IsUUID('4') duplicateRegistrationId!: string;
}

export class CreateCatalogItemDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(64)
  code?: string;
  @IsString() @MaxLength(100) name!: string;
  @IsOptional() @IsString() @MaxLength(24) color?: string | null;
}

export class RegistrationRelationshipDto {
  @IsUUID('4') targetRegistrationId!: string;
  @IsString() @MaxLength(60) type!: string;
  @IsOptional() @IsString() @MaxLength(120) jobTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(120) department?: string | null;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
  @IsUUID('4') commandId!: string;
}

export class UpdateRegistrationRelationshipDto extends RegistrationRelationshipDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
}

export class RemoveRegistrationRelationshipDto {
  @IsUUID('4') commandId!: string;
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
}

export const CANDIDATE_STATUSES = [
  'imported',
  'processing',
  'insufficient-data',
  'ready-for-decision',
  'ambiguous',
  'in-review',
  'unidentified',
  'ignored',
  'approved',
  'promoted',
  'error',
] as const;

export type CandidateStatusDto = (typeof CANDIDATE_STATUSES)[number];

export class ListRegistrationCandidatesQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 30;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional()
  @Transform(({ value }) => csv(value))
  @IsIn(CANDIDATE_STATUSES, { each: true })
  statuses?: CandidateStatusDto[];
  @IsOptional() @IsIn(REGISTRATION_TYPES) type?: RegistrationType;
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(64)
  suggestedRoleCode?: string;
  @IsOptional()
  @Transform(({ value }) => optionalBoolean(value))
  @IsBoolean()
  hasDocument?: boolean;
  @IsOptional()
  @Transform(({ value }) => optionalBoolean(value))
  @IsBoolean()
  hasDocumentIssue?: boolean;
  @IsOptional()
  @Transform(({ value }) => optionalBoolean(value))
  @IsBoolean()
  hasWhatsApp?: boolean;
  @IsOptional()
  @Transform(({ value }) => optionalBoolean(value))
  @IsBoolean()
  hasConversation?: boolean;
  @IsOptional()
  @Transform(({ value }) => optionalBoolean(value))
  @IsBoolean()
  highConfidence?: boolean;
  @IsOptional()
  @Transform(({ value }) => optionalBoolean(value))
  @IsBoolean()
  incomplete?: boolean;
  @IsOptional() @IsString() @MaxLength(120) reviewedBy?: string;
  @IsOptional() @IsUUID('4') batchId?: string;
  @IsOptional() @IsIn(['priority', 'name', 'updated']) sort?:
    'priority' | 'name' | 'updated';
}

export const REVIEW_ACTIONS = [
  'start-review',
  'save-review',
  'mark-unidentified',
  'ignore',
  'approve',
] as const;

export type ReviewActionDto = (typeof REVIEW_ACTIONS)[number];

export class ReviewRegistrationCandidateDto {
  @IsUUID('4') commandId!: string;
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(REVIEW_ACTIONS) action!: ReviewActionDto;
  @IsOptional() @IsObject() confirmedPayload?: RegistrationFieldsDto | null;
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}

export class PromoteRegistrationCandidateDto {
  @IsUUID('4') commandId!: string;
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
}
