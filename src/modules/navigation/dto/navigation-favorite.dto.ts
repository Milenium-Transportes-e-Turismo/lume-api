import { IsString, MaxLength } from 'class-validator';

export class NavigationFavoriteDto {
  @IsString()
  @MaxLength(160)
  navigationKey!: string;
}
