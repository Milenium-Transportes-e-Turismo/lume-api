import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infra/database/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { forbidden, validationError } from '../../core/errors/app-error';
import {
  canFavoriteNavigationKey,
  isFavorableNavigationKey,
} from './navigation-favorites.catalog';

@Injectable()
export class NavigationFavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string, userId: string) {
    const favorites = await this.prisma.userNavigationFavorite.findMany({
      where: { companyId, userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, navigationKey: true, createdAt: true },
    });

    return favorites.map((favorite) => ({
      id: favorite.id,
      navigationKey: favorite.navigationKey,
      createdAt: favorite.createdAt.toISOString(),
    }));
  }

  async add(current: AuthenticatedPrincipal, navigationKey: string) {
    this.assertFavorable(navigationKey);

    if (!canFavoriteNavigationKey(current, navigationKey)) {
      throw forbidden(
        'Você não possui acesso à tela informada para adicioná-la aos favoritos.',
      );
    }

    const favorite = await this.prisma.userNavigationFavorite.upsert({
      where: {
        companyId_userId_navigationKey: {
          companyId: current.companyId,
          userId: current.id,
          navigationKey,
        },
      },
      create: {
        companyId: current.companyId,
        userId: current.id,
        navigationKey,
      },
      update: {},
      select: { id: true, navigationKey: true, createdAt: true },
    });

    return {
      id: favorite.id,
      navigationKey: favorite.navigationKey,
      createdAt: favorite.createdAt.toISOString(),
    };
  }

  async remove(companyId: string, userId: string, navigationKey: string) {
    this.assertFavorable(navigationKey);
    await this.prisma.userNavigationFavorite.deleteMany({
      where: { companyId, userId, navigationKey },
    });
    return { navigationKey, removed: true };
  }

  private assertFavorable(navigationKey: string): void {
    if (!isFavorableNavigationKey(navigationKey)) {
      throw validationError(
        'A tela informada não pode ser adicionada aos favoritos.',
      );
    }
  }
}
