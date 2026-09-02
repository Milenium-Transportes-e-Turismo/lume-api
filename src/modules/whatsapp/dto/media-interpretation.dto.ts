import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CorrectMediaInterpretationDto {
  @ApiProperty({
    description:
      'Correção humana que passa a ter prioridade no contexto posterior.',
  })
  @IsString()
  @MinLength(1)
  correction!: string;

  @ApiPropertyOptional({
    description:
      'Feedback auditável sobre o problema, sem disparar nova análise.',
  })
  @IsOptional()
  @IsString()
  feedback?: string;
}
