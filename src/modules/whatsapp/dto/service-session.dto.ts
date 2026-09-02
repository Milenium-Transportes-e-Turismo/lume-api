import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  SERVICE_CONTROL_MODES,
  SERVICE_PRIORITIES,
  SERVICE_SESSION_STATUSES,
} from '../../../domain/whatsapp/service-session';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class ServiceSessionListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ enum: SERVICE_SESSION_STATUSES })
  @IsOptional()
  @IsIn(SERVICE_SESSION_STATUSES)
  status?: (typeof SERVICE_SESSION_STATUSES)[number];

  @ApiPropertyOptional({ enum: SERVICE_CONTROL_MODES })
  @IsOptional()
  @IsIn(SERVICE_CONTROL_MODES)
  controlMode?: (typeof SERVICE_CONTROL_MODES)[number];

  @ApiPropertyOptional({ enum: SERVICE_PRIORITIES })
  @IsOptional()
  @IsIn(SERVICE_PRIORITIES)
  priority?: (typeof SERVICE_PRIORITIES)[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  responsibleUserId?: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @IsString()
  @MaxLength(160)
  search?: string;
}

export class ServiceSessionCommandDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  commandId!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ReturnServiceSessionToQueueDto extends ServiceSessionCommandDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  queueId!: string;
}

export class TransferServiceSessionDto extends ServiceSessionCommandDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  departmentId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  queueId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @ApiPropertyOptional({ minLength: 3, maxLength: 500 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @ValidateIf((_object, value: unknown) => value !== '')
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}

export class ChangeServiceSessionPriorityDto extends ServiceSessionCommandDto {
  @ApiProperty({ enum: SERVICE_PRIORITIES })
  @IsIn(SERVICE_PRIORITIES)
  priority!: (typeof SERVICE_PRIORITIES)[number];

  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) => trim(value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class CloseServiceSessionDto extends ServiceSessionCommandDto {
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) => trim(value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
