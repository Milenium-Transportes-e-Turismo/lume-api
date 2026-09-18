# Lume Tenant API

## PR: navegação e favoritos

### Alterado

- A API passou a tratar navegação e favoritos dentro da empresa e do usuário autenticado.
- O catálogo central (`navigation-favorites.catalog.ts`) define quais itens podem ser favoritados e aplica as regras de permissão.

### Adicionado

- `UserNavigationFavorite` no Prisma e migration `user_navigation_favorites`: guarda o favorito, a empresa, o usuário e a data.
- `NavigationFavoriteDto`: valida a chave recebida pela API.
- `NavigationFavoritesController`: expõe listar, adicionar e remover em `navigation/favorites`.
- `NavigationFavoritesService`: aplica autenticação, tenant, permissões e persistência via Prisma.
- Chave única por `companyId`, `userId` e `navigationKey`, evitando duplicidade.
- Testes unitários do service para listagem, inclusão, remoção e rejeição de itens inválidos.

## Evidência atual

- Branch: `feat/gestor-evolution` → `develop`.
- Teste direcionado: 5/5.
- `prisma validate`: OK.
- SBX com banco restaurado de produção em volume separado; migrations aplicadas; API respondeu 200.
- Ajuste operacional de permissão no Dockerfile foi feito somente no clone do SBX e não faz parte desta PR.

## Checklist antes de produção

1. Revisar API e Web juntos.
2. Executar validação, testes, lint, build e `git diff --check`.
3. Validar login, favoritos e isolamento por tenant.
4. Promover para produção mantendo rollback.
