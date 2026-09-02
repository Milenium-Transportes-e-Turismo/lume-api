import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import type {
  ConversationRelationshipType,
  PersonalDivergenceDecision,
  RegistrationDataReviewStatus,
} from '../../../application/contracts/conversation-registration.repository';

const RELATIONSHIP_TYPES = [
  'owner',
  'partner',
  'employee',
  'department-responsible',
  'buyer',
  'service-provider',
  'third-party',
  'other',
] as const;

export class ConversationSourceDto {
  @IsUUID('4')
  whatsappContactId!: string;

  @IsOptional()
  @IsUUID('4')
  agentExecutionId?: string;
}

export class ConversationCommandDto extends ConversationSourceDto {
  @IsUUID('4')
  commandId!: string;
}

export class StartRegistrationDraftDto extends ConversationCommandDto {
  @IsIn(['personal', 'company'])
  kind!: 'personal' | 'company';
}

export class PersonRegistrationPatchDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  cpf?: string;

  @IsOptional()
  @IsString()
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
}

export class CompanyRegistrationPatchDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  cnpj?: string;
}

export class RelationshipRegistrationPatchDto {
  @IsOptional()
  @IsIn(RELATIONSHIP_TYPES)
  type?: ConversationRelationshipType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string | null;
}

export class UpdateRegistrationDraftDto extends ConversationCommandDto {
  @IsInt()
  @Min(1)
  expectedDraftVersion!: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => PersonRegistrationPatchDto)
  person?: PersonRegistrationPatchDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CompanyRegistrationPatchDto)
  company?: CompanyRegistrationPatchDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RelationshipRegistrationPatchDto)
  relationship?: RelationshipRegistrationPatchDto;
}

export class PreviewRegistrationDraftDto extends ConversationSourceDto {}

export class PersonalDivergenceDecisionsDto {
  @IsOptional()
  @IsIn(['replace', 'keep-existing'])
  name?: PersonalDivergenceDecision;

  @IsOptional()
  @IsIn(['replace', 'keep-existing'])
  email?: PersonalDivergenceDecision;

  @IsOptional()
  @IsIn(['replace', 'keep-existing'])
  phone?: PersonalDivergenceDecision;
}

export class ConfirmRegistrationDraftDto extends ConversationCommandDto {
  @IsInt()
  @Min(1)
  expectedDraftVersion!: number;

  @IsBoolean()
  customerConfirmedFinalSummary!: boolean;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PersonalDivergenceDecisionsDto)
  fieldDecisions?: PersonalDivergenceDecisionsDto;
}

export class AbandonRegistrationDraftDto extends ConversationCommandDto {
  @IsOptional()
  @IsUUID('4')
  draftId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedDraftVersion?: number;
}

export class RegistrationDataReviewQueryDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: RegistrationDataReviewStatus;
}

export class DecideRegistrationDataReviewDto {
  @IsUUID('4')
  commandId!: string;

  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
