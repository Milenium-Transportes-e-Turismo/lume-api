import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import {
  TRIP_COMMAND_TYPES,
  TRIP_EVIDENCE_KINDS,
  TRIP_STATUSES,
  type TripCommandType,
  type TripEvidenceKind,
  type TripStatus,
} from '../../domain/trips/trip';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const COMMANDS_WITH_PLAN: readonly TripCommandType[] = [
  'edit-draft',
  'revise-schedule',
];
const COMMANDS_WITH_REASON: readonly TripCommandType[] = [
  'revise-schedule',
  'suspend',
  'resume',
  'interrupt',
  'close-early',
  'cancel',
  'record-occurrence',
  'record-deviation',
];

export class OperationalTripLegDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sequence!: number;

  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  label!: string;
}

export class OperationalTripPlanDto {
  @ApiPropertyOptional({
    nullable: true,
    example: '2026-09-10',
    description: 'Data civil no fuso operacional America/Sao_Paulo.',
  })
  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @Matches(DATE_ONLY_PATTERN)
  serviceDate?: string | null;

  @ApiProperty({ type: [OperationalTripLegDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OperationalTripLegDto)
  legs!: OperationalTripLegDto[];
}

export class CreateOperationalTripDto extends OperationalTripPlanDto {
  @ApiPropertyOptional({
    enum: ['continuous-contract', 'confirmed-service'],
    default: 'continuous-contract',
  })
  @IsOptional()
  @IsIn(['continuous-contract', 'confirmed-service'])
  sourceKind?: 'continuous-contract' | 'confirmed-service';

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(
    (object: CreateOperationalTripDto) =>
      object.sourceKind !== 'confirmed-service',
  )
  @IsDefined()
  @IsUUID()
  contractId?: string;

  @ApiPropertyOptional({
    minimum: 1,
    description: 'Versão do contrato que o usuário consultou antes de criar.',
  })
  @ValidateIf(
    (object: CreateOperationalTripDto) =>
      object.sourceKind !== 'confirmed-service',
  )
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedContractVersion?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(
    (object: CreateOperationalTripDto) =>
      object.sourceKind === 'confirmed-service',
  )
  @IsDefined()
  @IsUUID()
  confirmedServiceId?: string;

  @ApiPropertyOptional({
    minimum: 1,
    description:
      'Versão do Serviço Confirmado consultada antes de criar a Viagem eventual.',
  })
  @ValidateIf(
    (object: CreateOperationalTripDto) =>
      object.sourceKind === 'confirmed-service',
  )
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedConfirmedServiceVersion?: number;

  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  code!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  commandId!: string;
}

export class ListOperationalTripsQueryDto {
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

  @ApiPropertyOptional({ enum: TRIP_STATUSES })
  @IsOptional()
  @IsIn(TRIP_STATUSES)
  status?: TripStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  contractId?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN)
  serviceFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN)
  serviceTo?: string;
}

export class SelectOperationalTripRoutePlanDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  routeId!: string;

  @ApiProperty({
    minimum: 1,
    description: 'Versão agregada da Rota consultada pelo usuário.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRouteVersion!: number;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  commandId!: string;

  @ApiProperty({
    minimum: 1,
    description: 'Versão atual da Viagem consultada pelo usuário.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({
    maxLength: 1000,
    description: 'Obrigatório ao substituir uma seleção vigente.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason?: string;
}

export class OperationalTripEvidenceDto {
  @ApiProperty({ enum: TRIP_EVIDENCE_KINDS })
  @IsIn(TRIP_EVIDENCE_KINDS)
  kind!: TripEvidenceKind;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  description!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  referenceId?: string | null;
}

export class ApplyOperationalTripCommandDto {
  @ApiProperty({ enum: TRIP_COMMAND_TYPES })
  @IsIn(TRIP_COMMAND_TYPES)
  type!: TripCommandType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  commandId!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ type: OperationalTripPlanDto })
  @ValidateIf((object: ApplyOperationalTripCommandDto) =>
    COMMANDS_WITH_PLAN.includes(object.type),
  )
  @IsDefined()
  @ValidateNested()
  @Type(() => OperationalTripPlanDto)
  plan?: OperationalTripPlanDto;

  @ApiPropertyOptional({ maxLength: 1000 })
  @ValidateIf((object: ApplyOperationalTripCommandDto) =>
    COMMANDS_WITH_REASON.includes(object.type),
  )
  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional({ type: [OperationalTripEvidenceDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OperationalTripEvidenceDto)
  evidence?: OperationalTripEvidenceDto[];
}
