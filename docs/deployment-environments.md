# Ambientes e branches

## Estado verificado em 11/08/2026

- o repositório possui CI, mas não possui workflow de deploy automático para a VPS;
- `compose.prod.yml` é versionado e contém `postgres`, `migrate` e `api`;
- `compose.vps.yml` existe na VPS como configuração local e não é versionado;
- o comando executado na VPS com `.env.production`, `compose.prod.yml` e
  `compose.vps.yml` apresentou os serviços `postgres`, `migrate` e `api`;
- a branch remota `staging` foi criada a partir da `main` para separar a
  homologação da produção.

Configurações externas ao repositório, como proxy reverso, DNS, certificados,
gatilhos e diretórios reais de staging, precisam ser conferidas diretamente na
VPS antes do primeiro deploy de homologação.

## Regra obrigatória

- staging usa exclusivamente a branch `staging`;
- produção usa exclusivamente a branch `main`;
- uma branch de trabalho nunca é implantada diretamente;
- `staging` só chega à `main` após validação funcional e autorização explícita;
- arquivos `.env*` reais e `compose.vps.yml` permanecem fora do Git.

## Staging

Use um clone e um projeto Compose independentes da produção, por exemplo em
`/home/taiane/lume-staging/lume-tenant-api`. O ambiente deve possuir banco,
volume de mídias, portas, domínio, credenciais e arquivo `.env.staging`
próprios.

```bash
cd /home/taiane/lume-staging/lume-tenant-api
git fetch origin
git switch staging
git pull --ff-only origin staging
test "$(git branch --show-current)" = "staging"
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

1. `20260830000100_temporary_registration`;
2. `20260830000200_commercial_closure_classification`;
3. `20260830000300_operational_trips`;
4. `20260901000100_user_person_association`;
5. `20260901000200_secure_pre_admission_access`;
6. `20260901000300_pending_conversation_transfer`;
7. `20260901000400_registration_command_idempotency`;
8. `20260901000500_confirmed_commercial_services`;
9. `20260901000600_operational_trip_route_plan_selection`;
10. `20260901000700_confirmed_service_trip_source`;
11. `20260901000800_commercial_service_requirement_attestations`.

As migrations 005–008 formam um único primeiro rollout e ainda não foram
publicadas. A 008 falha fechada se alguém tiver colocado Serviços Confirmados
em uso entre essas migrations, pois não transforma declarações comerciais
legadas em atestes do Financeiro e do Operacional. Se esse cenário for
encontrado em qualquer banco durável, pare o deploy e prepare backfill para
revisão humana; não preencha os dois atestes por inferência.

Antes de aplicar em staging, faça backup recuperável, confirme o banco e a
branch, execute `prisma migrate status` e registre o horário de início. Depois
do serviço `migrate`, confira as onze migrations, FKs compostas por tenant,
índices e constraints. Homologue pelo menos:

- Cadastro temporário, regularização e bloqueio de contrato;
- permissões individuais `clients:view/create/update` da Gerência;
- associação versionada entre Usuário e Pessoa, inclusive repetição do mesmo
  `commandId` e conflito de versão;
- criação por RH e Departamento Pessoal, resolução, renovação e revogação do
  link de pré-admissão, mantendo `uploadAvailable=false`;
- atestes separados com usuários distintos do Financeiro e Operacional,
  confirmação final pelo Comercial e rejeição de bypass administrativo;
- confirmação explícita de Serviço Comercial sem transformar aceite em viagem,
  mantendo `not-applicable` bloqueado;
- criação manual e máquina de estados das Viagens contínuas e eventuais;
- seleção, substituição e congelamento da versão aprovada do Plano de Rota;
- classificação dos encerramentos comerciais sem apagar registros legados;
- devolução ao bot somente pelo responsável e transferência em que a origem
  continua responsável até o aceite do destino;
- leitura e mutação de conversa recusadas para outro tenant ou departamento.

Não execute esse pacote em staging ou produção a partir de uma branch de
trabalho. A aplicação em staging continua dependendo de autorização explícita,
janela definida e acesso ao ambiente correto.

## Produção

Depois da aprovação e do merge autorizado de `staging` em `main`:

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
