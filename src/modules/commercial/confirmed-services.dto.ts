import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class AttestCommercialServiceRequirementDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  commandId!: string;

  @ApiProperty({
    minimum: 1,
    description: 'Versão do orçamento aceito que foi conferida pela área.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ minLength: 3, maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  evidence!: string;
}

export class ConfirmServiceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  commandId!: string;

  @ApiProperty({
    minimum: 1,
    description: 'Versão do orçamento aceito consultada antes da confirmação.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({
    minLength: 3,
    maxLength: 500,
    description:
      'Registro humano do fundamento usado para concluir os requisitos aplicáveis.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  confirmationBasis!: string;
}
