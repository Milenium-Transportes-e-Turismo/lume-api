# Lume Tenant API

## PR: navegação e favoritos

Esta PR cria a base de navegação personalizada do Lume e permite que cada usuário mantenha seus atalhos sem misturar dados entre empresas.

### Alterado

- A API passou a tratar navegação e favoritos dentro da empresa e do usuário autenticado.
- O catálogo central (`navigation-favorites.catalog.ts`) define quais itens podem ser favoritados e aplica as regras de permissão.
- A validação usa o principal autenticado da requisição; o cliente não escolhe livremente `companyId` ou `userId`.

### Adicionado

- `UserNavigationFavorite` no Prisma e migration `user_navigation_favorites`: guarda o favorito, a empresa, o usuário e a data.
- `NavigationFavoriteDto`: valida a chave recebida pela API.
- `NavigationFavoritesController`: expõe listar, adicionar e remover em `navigation/favorites`.
- `NavigationFavoritesService`: aplica autenticação, tenant, permissões e persistência via Prisma.
- Chave única por `companyId`, `userId` e `navigationKey`, evitando duplicidade.
- Testes unitários do service para listagem, inclusão, remoção e rejeição de itens inválidos.

### Fluxo da API

1. O Web envia a `navigationKey` do item selecionado.
2. O controller obtém o usuário e a empresa a partir da autenticação.
3. O catálogo verifica se o item existe e se o usuário pode utilizá-lo.
4. O service grava ou remove o favorito no PostgreSQL.
5. A listagem retorna somente os favoritos daquele usuário naquela empresa.

Itens de grupo ou chaves desconhecidas são rejeitados antes da gravação. O `upsert` torna a inclusão idempotente: repetir a mesma ação não cria registros duplicados.

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
