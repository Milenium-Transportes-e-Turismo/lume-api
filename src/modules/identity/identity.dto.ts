import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Equals,
  IsDefined,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const USER_PERSON_ASSOCIATION_MODES = [
  'automatic',
  'confirmed',
] as const;

export class AssociateUserPersonDto {
  @ApiProperty({ enum: USER_PERSON_ASSOCIATION_MODES })
  @IsIn(USER_PERSON_ASSOCIATION_MODES)
  mode!: (typeof USER_PERSON_ASSOCIATION_MODES)[number];

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  commandId!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((input: AssociateUserPersonDto) => input.mode === 'confirmed')
  @IsDefined()
  @IsUUID('4')
  personRegistrationId?: string;

  @ApiPropertyOptional({ enum: [true] })
  @ValidateIf((input: AssociateUserPersonDto) => input.mode === 'confirmed')
  @IsDefined()
  @Equals(true)
  confirmed?: boolean;

  @ApiPropertyOptional({ minLength: 3, maxLength: 1000 })
  @ValidateIf((input: AssociateUserPersonDto) => input.mode === 'confirmed')
  @IsDefined()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason?: string;
}
