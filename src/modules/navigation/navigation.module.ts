import { Module } from '@nestjs/common';

import { NavigationFavoritesController } from './navigation-favorites.controller';
import { NavigationFavoritesService } from './navigation-favorites.service';

@Module({
  controllers: [NavigationFavoritesController],
  providers: [NavigationFavoritesService],
})
export class NavigationModule {}
