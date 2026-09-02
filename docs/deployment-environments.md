# Ambientes e branches

## Estado verificado em 11/08/2026

- o repositório possui CI, mas não possui workflow de deploy automático para a VPS;
- `compose.prod.yml` é versionado e contém `postgres`, `migrate` e `api`;
- `compose.vps.yml` existe na VPS como configuração local e não é versionado;
- o comando executado na VPS com `.env.production`, `compose.prod.yml` e
  `compose.vps.yml` apresentou os serviços `postgres`, `migrate` e `api`;
- a branch `develop` concentra desenvolvimento e homologação; a `main`
  permanece reservada para produção.

Configurações externas ao repositório, como proxy reverso, DNS, certificados,
gatilhos e diretórios reais de staging, precisam ser conferidas diretamente na
VPS antes do primeiro deploy de homologação.

## Regra obrigatória

- staging usa exclusivamente a branch `develop`;
- produção usa exclusivamente a branch `main`;
- uma branch de trabalho nunca é implantada diretamente;
- `develop` só chega à `main` após validação funcional e autorização explícita;
- arquivos `.env*` reais e `compose.vps.yml` permanecem fora do Git.

## Staging

Use um clone e um projeto Compose independentes da produção, por exemplo em
`/home/taiane/lume-staging/lume-tenant-api`. O ambiente deve possuir banco,
volume de mídias, portas, domínio, credenciais e arquivo `.env.staging`
próprios.

```bash
cd /home/taiane/lume-staging/lume-tenant-api
git fetch origin
git switch develop
git pull --ff-only origin develop
test "$(git branch --show-current)" = "develop"
docker compose -p lume-staging \
  --env-file .env.staging \
  -f compose.prod.yml \
  -f compose.vps.yml \
  config --services
docker compose -p lume-staging \
  --env-file .env.staging \
  -f compose.prod.yml \
  -f compose.vps.yml \
  up -d --build
docker compose -p lume-staging \
  --env-file .env.staging \
  -f compose.prod.yml \
  -f compose.vps.yml \
  ps
```

Antes de liberar o teste, confirme o término do serviço `migrate`, a saúde da
API e o endereço de recuperação de senha apontando para o Tenant Web de staging.

### Pacote de migrations da evolução de domínio

O próximo rollout inclui, nesta ordem:

1. `20260830000000_restore_operational_routing_foundation`;
2. `20260830000100_temporary_registration`;
3. `20260830000200_commercial_closure_classification`;
4. `20260830000300_operational_trips`;
5. `20260901000100_user_person_association`;
6. `20260901000200_secure_pre_admission_access`;
7. `20260901000300_pending_conversation_transfer`;
8. `20260901000400_registration_command_idempotency`;
9. `20260901000500_confirmed_commercial_services`;
10. `20260901000600_operational_trip_route_plan_selection`;
11. `20260901000700_confirmed_service_trip_source`;
12. `20260901000800_commercial_service_requirement_attestations`;
13. `20260901001100_commercial_service_requirement_outcomes`;
14. `20260901001200_expand_tenant_access_departments`;
15. `20260901001300_seed_tenant_access_departments`;
16. `20260901001400_user_update_commands`.

A migration `20260830000000_restore_operational_routing_foundation` recompõe,
depois da limpeza `20260825000000_remove_legacy_contract_routing`, as tabelas,
enums, índices, constraints e chaves estrangeiras de Passageiros, Contratos,
Rotas e Pontos Fixos. Ela precisa terminar antes de `operational_trips`, que
referencia `routing_contracts`, e antes da seleção de plano de rota, que
referencia as versões e aprovações de `routing_routes`. As quatro migrations
experimentais removidas não devem ser recolocadas no histórico: esta migration
restauradora é o ponto canônico tanto para bancos novos quanto para bancos que
já executaram a limpeza.

As migrations 005–008 formam um único primeiro rollout e ainda não foram
publicadas. A 008 falha fechada se alguém tiver colocado Serviços Confirmados
em uso entre essas migrations, pois não transforma declarações comerciais
legadas em atestes do Financeiro e do Operacional. Se esse cenário for
encontrado em qualquer banco durável, pare o deploy e prepare backfill para
revisão humana; não preencha os dois atestes por inferência.

Antes de aplicar em staging, faça backup recuperável, confirme o banco e a
branch, execute `prisma migrate status` e registre o horário de início. Depois
do serviço `migrate`, confira as dezesseis migrations, FKs compostas por tenant,
índices e constraints. Homologue pelo menos:

- Cadastro temporário, regularização e bloqueio de contrato;
- permissões individuais `clients:view/create/update` da Gerência;
- associação versionada entre Usuário e Pessoa, inclusive repetição do mesmo
  `commandId` e conflito de versão;
- atualização versionada do Usuário, inclusive replay idempotente, rejeição de
  payload divergente e atomicidade entre histórico e auditoria;
- criação por RH e Departamento Pessoal, resolução, renovação e revogação do
  link de pré-admissão, mantendo `uploadAvailable=false`;
- atestes separados com usuários distintos do Financeiro e Operacional,
  confirmação final pelo Comercial e autoridade de exceção diferenciada para
  Gerência, Diretoria com `tenant:manage` e Administrador da Instalação;
- confirmação explícita de Serviço Comercial sem transformar aceite em viagem,
  incluindo `not-applicable` com motivo, evidência e auditoria;
- criação manual e máquina de estados das Viagens contínuas e eventuais;
- seleção versionada do Plano de Rota em viagem contínua, substituição com
  motivo e congelamento da versão selecionada no início da execução;
- classificação dos encerramentos comerciais sem apagar registros legados;
- atendimento por usuário interno com `whatsapp-conversations:attend`, inclusive
  substituição do Responsável Atual, retorno ao bot e transferência em que a
  origem continua responsável até o aceite do destino;
- bloqueio de `attend` para `client-company`, conflito por `expectedVersion` e
  leitura/mutação recusadas para outro tenant.

Não execute esse pacote em staging ou produção a partir de uma branch de
trabalho. A aplicação em staging continua dependendo de autorização explícita,
janela definida e acesso ao ambiente correto.

## Produção

Depois da aprovação e do merge autorizado de `develop` em `main`:

```bash
cd /home/taiane/lume/lume-tenant-api
git fetch origin
git switch main
git pull --ff-only origin main
test "$(git branch --show-current)" = "main"
docker compose -p lume-production \
  --env-file .env.production \
  -f compose.prod.yml \
  -f compose.vps.yml \
  config --services
docker compose -p lume-production \
  --env-file .env.production \
  -f compose.prod.yml \
  -f compose.vps.yml \
  up -d --build
docker compose -p lume-production \
  --env-file .env.production \
  -f compose.prod.yml \
  -f compose.vps.yml \
  ps
```

Faça backup do banco e do volume de mídias antes das migrações. Valide
`/api/v1/health/ready`, login, recuperação de senha, permissões e os fluxos de
WhatsApp após a publicação.
