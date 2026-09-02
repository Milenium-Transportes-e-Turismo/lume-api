import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import {
  CUSTOMER_PROFILE_KEYS,
  type CustomerContextDetailSection,
  type CustomerProfileKey,
  type CustomerProfileSuggestionStatus,
} from '../../../application/contracts/customer-context.repository';

export class CustomerContextDetailQueryDto {
  @IsIn(['relationships', 'profile', 'services', 'quotes', 'pending'])
  section!: CustomerContextDetailSection;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class CreateCustomerProfileSuggestionDto {
  @IsUUID('4')
  commandId!: string;

  @IsIn(CUSTOMER_PROFILE_KEYS)
  profileKey!: CustomerProfileKey;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  suggestedValue!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  rationale?: string;

  @IsOptional()
  @IsUUID('4')
  evidenceMessageId?: string;
}

export class CreateAgentCustomerProfileSuggestionDto extends CreateCustomerProfileSuggestionDto {
  @IsUUID('4')
  agentExecutionId!: string;
}

export class CustomerProfileSuggestionQueryDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'ignored'])
  status?: CustomerProfileSuggestionStatus;

  @IsOptional()
  @IsUUID('4')
  serviceSessionId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class DecideCustomerProfileSuggestionDto {
  @IsUUID('4')
  commandId!: string;

  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:?\d{2})$/u)
  expectedUpdatedAt!: string;

  @IsIn(['approved', 'ignored'])
  decision!: 'approved' | 'ignored';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
