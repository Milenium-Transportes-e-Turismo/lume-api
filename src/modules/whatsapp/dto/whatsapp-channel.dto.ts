import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { CHANNEL_ROUTING_MODES } from '../../../domain/whatsapp/whatsapp-channel';

function trimmed(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function nullableIdentifier(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === ''
    ? null
    : trimmed(value);
}

export class WhatsAppChannelCommandDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  commandId!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreateWhatsAppChannelDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  agentsEnabled?: boolean;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  commandId!: string;

  @ApiProperty({ minLength: 2, maxLength: 80 })
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName!: string;

  @ApiProperty({ example: '(34) 99999-9999', maxLength: 30 })
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @IsString()
  @MinLength(10)
  @MaxLength(30)
  phoneNumber!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => nullableIdentifier(value))
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsUUID('4')
  departmentId?: string | null;

  @ApiProperty({ enum: CHANNEL_ROUTING_MODES })
  @IsIn(CHANNEL_ROUTING_MODES)
  routingMode!: (typeof CHANNEL_ROUTING_MODES)[number];

  @ApiPropertyOptional({ type: [String], maxItems: 100, default: [] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  allowedAutomaticTargetDepartmentIds: string[] = [];
}

export class UpdateWhatsAppChannelDto extends WhatsAppChannelCommandDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  agentsEnabled?: boolean;

  @ApiProperty({ minLength: 2, maxLength: 80 })
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => nullableIdentifier(value))
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsUUID('4')
  departmentId?: string | null;

  @ApiProperty({ enum: CHANNEL_ROUTING_MODES })
  @IsIn(CHANNEL_ROUTING_MODES)
  routingMode!: (typeof CHANNEL_ROUTING_MODES)[number];

  @ApiPropertyOptional({ type: [String], maxItems: 100, default: [] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  allowedAutomaticTargetDepartmentIds: string[] = [];
}
