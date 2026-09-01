import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class RequestedPreAdmissionDocumentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  documentTypeId!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;
}

export class CreatePreAdmissionAccessDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  commandId!: string;

  @ApiProperty({ enum: [0] })
  @Type(() => Number)
  @IsInt()
  @Equals(0)
  expectedVersion!: 0;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  personRegistrationId!: string;

  @ApiProperty({ type: [RequestedPreAdmissionDocumentDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique((item: RequestedPreAdmissionDocumentDto) => item.documentTypeId)
  @ValidateNested({ each: true })
  @Type(() => RequestedPreAdmissionDocumentDto)
  requestedDocuments!: RequestedPreAdmissionDocumentDto[];
}

export class VersionedPreAdmissionAccessDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  commandId!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ResolvePreAdmissionAccessDto {
  @ApiProperty({
    description:
      'Token opaco recebido no link. Envie no corpo para evitar query strings e logs de URL.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token!: string;
}
