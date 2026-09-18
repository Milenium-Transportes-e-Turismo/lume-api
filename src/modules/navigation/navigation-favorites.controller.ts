import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { NavigationFavoritesService } from './navigation-favorites.service';
import { NavigationFavoriteDto } from './dto/navigation-favorite.dto';

@ApiTags('Navegação')
@ApiBearerAuth()
@Controller('navigation/favorites')
export class NavigationFavoritesController {
  constructor(private readonly favorites: NavigationFavoritesService) {}

  @Get()
  list(@CurrentUser() current: AuthenticatedPrincipal) {
    return this.favorites.list(current.companyId, current.id);
  }

  @Post()
  add(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: NavigationFavoriteDto,
  ) {
    return this.favorites.add(current, body.navigationKey);
  }

  @Delete()
  remove(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: NavigationFavoriteDto,
  ) {
    return this.favorites.remove(
      current.companyId,
      current.id,
      body.navigationKey,
    );
  }
}
