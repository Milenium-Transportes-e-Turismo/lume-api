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

### Arquivos e responsabilidades

- `src/modules/navigation/navigation.module.ts`: registra o módulo, controller e service no NestJS.
- `src/modules/navigation/navigation-favorites.controller.ts`: define os endpoints HTTP e recebe o principal autenticado.
- `src/modules/navigation/navigation-favorites.service.ts`: concentra as regras de negócio e as operações no Prisma.
- `src/modules/navigation/navigation-favorites.catalog.ts`: mantém as chaves válidas e as permissões de cada item.
- `src/modules/navigation/dto/navigation-favorite.dto.ts`: representa o payload enviado pelo Web.
- `prisma/schema.prisma`: adiciona o modelo e os relacionamentos com empresa e usuário.
- `prisma/migrations/20260916000100_user_navigation_favorites`: cria a tabela, índices e chaves estrangeiras.

### Escopo e limites

Esta PR adiciona a infraestrutura de favoritos e o contrato de navegação. Ela não cria novos módulos de negócio, não altera dados operacionais de viagens e não libera permissões novas por si só. A visibilidade continua dependente das permissões existentes do usuário.

O banco de sandbox foi copiado de produção apenas para validação. A migration deve ser aplicada normalmente no ambiente de destino; a cópia do banco não faz parte do deploy da PR.

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
4. Conferir que a migration foi aplicada antes de iniciar a versão Web.
5. Promover para produção mantendo rollback da API e do Web.
