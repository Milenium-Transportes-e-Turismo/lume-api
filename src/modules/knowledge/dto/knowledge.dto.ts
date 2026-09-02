import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import type {
  KnowledgeDocumentScope,
  KnowledgeDocumentVisibility,
  KnowledgeGapStatus,
  KnowledgeGapReview,
  KnowledgeSuggestionStatus,
  KnowledgeSuggestionReview,
} from '../../../application/contracts/knowledge.repository';

const SCOPES = ['tenant', 'department', 'multi-department'] as const;
const VISIBILITIES = ['customer-safe', 'internal'] as const;

function departmentArray(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  if (value.trim().startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [value];
    } catch {
      return [value];
    }
  }
  return value.split(',').map((entry) => entry.trim());
}

export class KnowledgeCommandDto {
  @IsUUID('4')
  commandId!: string;
}

export class VersionedKnowledgeCommandDto extends KnowledgeCommandDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreateKnowledgeBaseDto extends KnowledgeCommandDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  description?: string;
}

export class ListKnowledgeDocumentsQueryDto {
  @IsOptional()
  @IsUUID('4')
  knowledgeBaseId?: string;
}

export class KnowledgeDocumentMetadataDto extends KnowledgeCommandDto {
  @IsUUID('4')
  knowledgeBaseId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  description?: string;

  @IsIn(SCOPES)
  scope!: KnowledgeDocumentScope;

  @IsIn(VISIBILITIES)
  visibility!: KnowledgeDocumentVisibility;

  @Transform(({ value }) => departmentArray(value))
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  departmentIds: string[] = [];

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:?\d{2})$/u)
  effectiveFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:?\d{2})$/u)
  effectiveUntil?: string;
}

export class CreateKnowledgeArticleDto extends KnowledgeDocumentMetadataDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2_097_152)
  content!: string;
}

export class UploadKnowledgeOriginalDto extends KnowledgeDocumentMetadataDto {}

export class CreateNextKnowledgeDraftDto extends VersionedKnowledgeCommandDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2_097_152)
  content?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:?\d{2})$/u)
  effectiveFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:?\d{2})$/u)
  effectiveUntil?: string;
}

export class UpdateKnowledgeDraftDto extends VersionedKnowledgeCommandDto {
  @Matches(/^[a-f0-9]{64}$/u)
  expectedContentHash!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2_097_152)
  content!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:?\d{2})$/u)
  effectiveFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:?\d{2})$/u)
  effectiveUntil?: string;
}

export class KnowledgeSuggestionQueryDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'published'])
  status?: KnowledgeSuggestionStatus;
}

export class AgentKnowledgeObservationDto extends KnowledgeCommandDto {
  @IsUUID('4')
  serviceSessionId!: string;

  @IsUUID('4')
  agentExecutionId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  evidenceMessageIds!: string[];
}

export class CreateAgentKnowledgeSuggestionDto extends AgentKnowledgeObservationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(16_384)
  proposedContent!: string;
}

export class ObserveAgentKnowledgeGapDto extends AgentKnowledgeObservationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  topic!: string;
}

export class KnowledgeGapQueryDto {
  @IsOptional()
  @IsIn(['open', 'acknowledged', 'resolved', 'dismissed'])
  status?: KnowledgeGapStatus;
}

export class ReviewKnowledgeSuggestionDto extends KnowledgeCommandDto {
  @IsIn(['approved', 'rejected'])
  decision!: KnowledgeSuggestionReview;
}

export class ReviewKnowledgeGapDto extends KnowledgeCommandDto {
  @IsIn(['acknowledged', 'resolved', 'dismissed'])
  decision!: KnowledgeGapReview;
}
