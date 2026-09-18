# Lume Tenant API

## PR: navegação e favoritos

### Alterado

- API trata navegação e favoritos por empresa e usuário autenticado.
- Catálogo de navegação centralizado no módulo de navegação.

### Adicionado

- Migration, DTO, controller e service de favoritos.
- Unicidade por `companyId`, `userId` e `navigationKey`.
- Testes do service.

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
