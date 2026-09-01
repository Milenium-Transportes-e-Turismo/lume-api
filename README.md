# Lume Tenant API

O vocabulário canônico e as relações entre os contextos estão em
[`CONTEXT-MAP.md`](CONTEXT-MAP.md). Decisões arquiteturais aprovadas ficam em
[`docs/adr`](docs/adr).

O fluxo reutilizável de checklists, uploads versionados, revisão humana e
renovação está em [`docs/document-management.md`](docs/document-management.md).

Data plane autônomo da plataforma Lume. Cada cliente executa sua própria
instalação, seu próprio PostgreSQL e seus próprios backups.

## Responsabilidades

- autenticação local;
- usuários internos;
- departamentos e permissões individuais;
- sessões e refresh tokens;
- auditoria local;
- outbox/inbox para sincronização tolerante a falhas;
- validação offline da licença;
- contrato de comunicação idempotente com o `lume-edge-agent`.
- backend oficial de WhatsApp com Evolution, automação e IA na própria API;
- conversas, mensagens, solicitações e transições isoladas por tenant;
- inbox/outbox confiáveis, concorrência otimista e retenção configurável.
- cópia durável de mídias recebidas em volume próprio, isolada por tenant.

O projeto não possui master global, operadores da fornecedora ou cadastro de
outros tenants. Uma instalação aceita exatamente um tenant.

O `lume-edge-agent` é mantido em repositório separado e executado na mesma rede
privada do cliente. O contrato de comandos, eventos e assinatura HMAC está em
[`docs/edge-contract.md`](docs/edge-contract.md).

## Inicialização

O `lume-control` entrega:

- `INSTALLATION_ID`;
- `LICENSE_PUBLIC_KEY_BASE64`;
- `LICENSE_DOCUMENT`.

Depois:

```powershell
Copy-Item .env.example .env
npm.cmd install
docker compose up -d
npm.cmd run prisma:deploy
npm.cmd run tenant:bootstrap
npm.cmd run start:dev
```

Preencha no `.env` com os dados do tenant e do primeiro administrador antes do
bootstrap. Remova `TENANT_ADMIN_PASSWORD` do ambiente depois da criação.

A API usa `http://localhost:3333/api/v1`. O Swagger local fica em
`http://localhost:3333/docs`.

Para habilitar WhatsApp, preencha os blocos `WHATSAPP_*`, `EVOLUTION_*` e as
chaves `WHATSAPP_AI_*`
do ambiente antes de executar o bootstrap idempotente. O contrato completo,
matriz de estados, assinaturas e endpoints está em
[`docs/whatsapp-mvp.md`](docs/whatsapp-mvp.md).
A consolidação, o proxy seguro de mídia e o checklist operacional estão em
[`docs/whatsapp-api.md`](docs/whatsapp-api.md).

## Autonomia

Login, usuários, permissões, banco, licença e integrações locais não consultam
o `lume-control`. A queda do computador da fornecedora não interrompe o
cliente.

A licença assinada possui validade e tolerância locais. O endpoint autenticado
`GET /api/v1/license/status` mostra o estado sem realizar chamadas externas e
exige simultaneamente o departamento Gerência (`management`) e a permissão
`license:view`.

O vínculo público de acesso é composto por um ou mais departamentos e por
`permissionCodes` selecionadas individualmente. As permissões efetivas nunca
ultrapassam o teto da união desses departamentos. Não existem cargos, papéis ou
relações indiretas de autorização no domínio, no contrato HTTP ou no schema
atual. Assim, um usuário apenas Comercial não recebe acesso administrativo, e
um usuário apenas Gerência não recebe acesso aos fluxos comerciais. Por decisão
explícita de produto, Gerência pode receber individualmente `clients:create` e
`clients:update`, além de `clients:view`, para consultar, criar e editar
Cadastros normais e temporários. Isso não concede `clients:manage`, histórico
ou permissões comerciais.
`isAdministrator=true` é uma autoridade explícita e separada: somente outro
administrador pode concedê-la ou removê-la, e ela apresenta todos os
departamentos e permissões do catálogo atual.

O bootstrap idempotente sincroniza as nove áreas operacionais: Comercial,
Compras, Controladoria, Departamento Pessoal, Financeiro, Gerência, Manutenção,
Monitoramento e Operacional. A conta administrativa inicial é vinculada à
autoridade administrativa explícita; seus vínculos diretos ficam vazios para
não confundir administração global com o departamento Gerência.

## Contas e acesso

- `POST /api/v1/auth/password/forgot` recebe usuário ou e-mail e sempre
  responde de forma genérica, sem revelar se a conta existe; em produção o
  Resend é obrigatório, e indisponibilidade de configuração retorna HTTP 503
  antes de consultar o identificador;
- `POST /api/v1/auth/password/change` consome o token opaco, expirável e de uso
  único enviado pelo provedor configurado;
- a senha inicial definida pelo administrador nunca cria sessão; o login
  retorna `ACCOUNT_PASSWORD_SETUP_REQUIRED` com um desafio opaco de primeiro
  acesso para troca imediata, sem depender do fluxo de recuperação por e-mail;
- usuários podem estar `active`, `inactive` ou `suspended`; suspensões revogam
  sessões e expiram automaticamente na data registrada;
- `GET /api/v1/users` aceita paginação, pesquisa e filtros por departamento,
  permissão e status;
- `users:update` altera dados, departamentos, permissões e solicita recuperação
  de senha; `users:manage` fica restrito ao ciclo de estado da conta
  (ativar novamente, desativar ou suspender);
- `users:delete` não faz parte do catálogo delegável; `DELETE /api/v1/users/:id`
  exige administrador, impede autoexclusão e preserva históricos por exclusão
  lógica;
- nomes de usuário possuem 3–40 caracteres permitidos e obrigatoriamente ao
  menos uma letra, evitando ambiguidade com documentos;
- `PATCH /api/v1/users/:id/status` ativa, desativa ou suspende por data/dias,
  com motivo obrigatório para suspensão;
- a foto de perfil aceita somente JPEG, PNG ou WebP cuja assinatura corresponda
  ao MIME informado, até 512 KB e entre 128 e 2048 pixels;
- `GET /api/v1/notifications` é autenticado e deriva o resumo somente dos
  departamentos do usuário. No MVP, Comercial recebe a contagem de orçamentos
  pendentes e os demais departamentos recebem uma lista vazia. A leitura é
  persistida por usuário em
  `POST /api/v1/notifications/commercial.pending-quote-proposals/read`; uma nova
  solicitação pendente volta a incrementar o contador não lido;
- `POST /api/v1/support/requests` envia a solicitação pelo Resend e deriva nome,
  usuário e e-mail exclusivamente do JWT. Falhas de configuração ou do provedor
  retornam um código público e `details.fallbackAllowed=true`, permitindo que o
  painel ofereça o aplicativo de e-mail somente como contingência. O destinatário
  é configurado em `SUPPORT_RECIPIENT_EMAIL`; `SUPPORT_CC_EMAIL` aceita múltiplas
  cópias separadas por vírgulas.

## Dados

Os dados permanecem no PostgreSQL do cliente. O banco deve receber backup,
monitoramento e política de retenção próprios. Sessões não devem ser exportadas
em uma migração para outro fornecedor.

### Orçamentos com horário opcional

A data de saída continua obrigatória para apresentar ou confirmar um resumo de
orçamento. O horário pode permanecer vazio e ser informado posteriormente. A
API mantém a data civil separada do instante completo para evitar mudança de dia
por fuso horário; quando houver horário, ambos devem representar o mesmo dia em
`America/Sao_Paulo`.

A mesma regra vale para o cadastro manual feito pelo atendente. Retorno é
opcional, mas nunca pode ser anterior à saída.

O atendente responsável também pode corrigir manualmente o status comercial da
solicitação atual. A API aplica concorrência otimista, limita a alteração ao
orçamento corrente de uma conversa aberta e registra autor, data e motivo na
auditoria. Aprovação ou recusa continuam exigindo uma proposta efetivamente
enviada; recusa exige motivo e novos cancelamentos exigem motivo e classificação
explícita como `opportunity-abandoned` ou `acceptance-cancelled`. Ciclos antigos
cancelados ficam como `legacy-unclassified`, enquanto a abertura de outro ciclo
registra `superseded` sem presumir uma perda comercial.

### Cadastros temporários

Cadastros emergenciais são identificados por `isTemporary`, motivo, responsável
ativo do tenant e vencimento de regularização limitado a sete dias. A resposta
expõe as pendências que impedem ações críticas. Enquanto faltar CPF ou CNPJ de
cliente/fornecedor, a criação ou alteração de contrato é bloqueada. A
regularização usa `POST /api/v1/registrations/:registrationId/regularize`, com
`commandId`, `expectedVersion` e histórico preservado.

Os previews de migração não escrevem dados: a consolidação pode ser inspecionada
em `GET /api/v1/registrations/:registrationId/consolidation-preview`, a possível
associação de usuário em `GET /api/v1/identity/users/:userId/person-match-preview`
e o titular legado de um envio em
`GET /api/v1/document-management/submissions/:submissionId/legacy-subject-preview`.
Uma recomendação por CPF não é apresentada como vínculo já confirmado. A
associação é uma mutação separada em
`POST /api/v1/identity/users/:userId/person-association`, exige `users:manage`,
`commandId` e `expectedVersion`, e possui histórico em
`GET /api/v1/identity/users/:userId/person-association-history`. Somente um CPF
único e idêntico permite associação automática; escolhas por CPF ou e-mail
exigem confirmação humana e motivo. Sem Pessoa aplicável, a API cria um Cadastro
temporário para regularização sem alterar permissões nem o escopo legado do
Usuário.

### Pré-admissão por link seguro

RH ou Departamento Pessoal com `documents:manage` pode criar um acesso de 30
dias para uma Pessoa do Cadastro Principal em
`POST /api/v1/pre-admission/accesses`, sem criar `User`.
Renovação rotaciona o token; revogação o bloqueia imediatamente. O token bruto
aparece somente nas respostas de criação/renovação e apenas seu hash permanece
no PostgreSQL. O endpoint público recebe o token no corpo e expõe somente o
escopo de tipos documentais solicitados, nunca arquivos por ID.

O recebimento dos arquivos ainda não faz parte desta primeira fatia: a resposta
declara `uploadAvailable=false` enquanto o legado documental depender de
titular e autor do tipo `User`. A adaptação seguinte deve reutilizar a gestão e
o armazenamento documentais existentes com Titular Principal genérico, sem
conta fictícia ou repositório paralelo.

Os dois departamentos possuem o mesmo teto de capacidades `documents:*`, mas a
autorização continua individual: pertencer ao departamento não concede
`documents:manage` automaticamente. `human-resources` permanece aceito para
contas legadas e Departamento Pessoal permanece como a opção atribuível no
catálogo atual.

### Aceite e confirmação comercial

Aceite não confirma serviço nem cria Viagem. Para o serviço singular do
orçamento legado, o Financeiro registra o ateste em
`POST /api/v1/commercial/quote-requests/:id/financial-attestation`, o
Operacional registra o seu em `operational-attestation` e somente então o
Comercial finaliza em `confirmed-services`. Cada etapa possui ator, evidência,
`commandId`, versão do orçamento, idempotência e revalidação de acesso dentro da
transação. O estado pode ser recuperado em `confirmed-service-readiness`.

Dispensas `not-applicable` permanecem bloqueadas até a definição de uma
capacidade específica de Gerência/Diretoria. O modelo legado ainda representa
um serviço por orçamento; itens comerciais múltiplos e cancelamento
pós-confirmação continuam lacunas explícitas, sem fallback que apague o estágio
alcançado.

### Viagens operacionais

`POST /api/v1/trips` cria manualmente um rascunho a partir de contrato contínuo
ativo e vigente ou de um Serviço Confirmado eventual. A origem contínua informa
`expectedContractVersion`; a eventual informa `sourceKind=confirmed-service`,
`confirmedServiceId` e `expectedConfirmedServiceVersion`. O aceite do orçamento
não cria viagem: antes, as três áreas precisam concluir os atos separados. A
origem eventual é bloqueada e revalidada, usa a data de saída confirmada e não
aceita uma data divergente enviada pelo cliente.

Mudanças seguintes usam `POST /api/v1/trips/:tripId/commands` com `commandId` e
`expectedVersion`. A máquina preserva os caminhos `Em execução → Suspensa → Em
execução` e `Em execução → Interrompida → encerramento antecipado`, mantendo
programações versionadas, ocorrências, evidências e histórico consultável.

Para contratos contínuos, `POST /api/v1/trips/:tripId/route-plan` seleciona a
versão aprovada de uma Rota e preserva cada seleção anterior. A versão vigente é
congelada no início da Viagem; mudanças posteriores são desvios de execução.
`GET /api/v1/trips/:tripId/route-plans` devolve somente um resumo operacional,
sem nomes ou dados sensíveis de passageiros. Rotas eventuais, veículo/motorista,
quilometragem, custos e efeitos financeiros/documentais ainda não compõem esta
fatia.

Os endpoints reconhecem as permissões canônicas `trips:view`, `trips:create`,
`trips:update` e `trips:manage`. Durante a transição, os códigos equivalentes
`routes:*` continuam aceitos para os usuários já provisionados; isso é
compatibilidade de acesso, não uma fusão entre Plano de Rota e Viagem.

O estado preciso dos contratos que o frontend pode consumir está em
[docs/tenant-web-contract-readiness.md](./docs/tenant-web-contract-readiness.md).
O quadro separa capacidades disponíveis, parciais e ainda sem endpoint para que
o Tenant Web não transforme proteção visual ou mock em regra de negócio.

Ao encerrar um atendimento, a mesma transação persiste uma mensagem de
despedida e sua outbox antes de fechar a conversa. A saudação usa manhã, tarde
ou noite conforme `America/Sao_Paulo`; uma falha ao agendar o envio reverte
também o encerramento.

### Importação, exportação e conversão

O módulo `GET /api/v1/data-exchange/capabilities` publica somente adaptadores
realmente ativos. No MVP:

- PDF é validado e pode gerar outra cópia PDF;
- CSV e TSV podem ser importados como XLSX;
- XLSX pode ser validado ou exportado para CSV/TSV;
- XLSX com várias abas exige `sheetName` na exportação tabular;
- XLS e ODS são reconhecidos, mas recusados até receberem adaptador próprio.

Uploads possuem limite individual, quota temporária por tenant, retenção,
idempotência e auditoria. Arquivos CSV/TSV também possuem limites de linhas,
colunas, células e tamanho de célula. As permissões são distintas: criar permite
upload, visualizar permite consulta/download e gerenciar permite conversão.
Novos formatos devem reutilizar `DataExchangeUseCase`,
`DataExchangeRepository` e `DataExchangeConverter`.

### Roteirização orientada por contrato

O tenant continua sendo a Milenium. Os clientes atendidos são `RoutingCompany`,
podem usar CPF ou CNPJ e podem possuir usuários cliente PF ou PJ isolados por
`routingCompanyId`. Funcionários internos autorizados também podem operar mais
de um cliente; o cliente é selecionado na aplicação e não repetido na planilha.

`RoutingContract` é a raiz da operação e concentra centros de custo, unidade,
vigência, tipo, turnos, horários, veículos, capacidade, KM e periodicidade. A
API não expõe criação manual de rota: ela gera sugestões a partir do contrato e
dos colaboradores elegíveis, registra revisão e aprovação versionadas e publica
somente a versão aprovada.

Pontos fixos recebem código próprio, podem ser globais ou exclusivos de um
cliente e são usados como origem/destino do contrato e embarque do colaborador.
O modelo oficial usa colunas legíveis e a importação aceita XLSX, CSV ou TSV.
Linhas sem CEP ficam pendentes para correção assistida pelo ViaCEP. Rotas aprovadas oferecem
PDF/XLSX operacional e XLSX/CSV para Google My Maps. Centro de custo permanece
no contrato e no XLSX operacional, mas não integra os formatos do My Maps.

### Prisma Studio

Com o PostgreSQL local em execução:

```powershell
npm.cmd run prisma:studio
```

O navegador pode ser aberto manualmente em `http://localhost:5555`. Bancos fora
de loopback ficam bloqueados. Uma janela administrativa remota exige
`PRISMA_STUDIO_ALLOW_REMOTE=true` e
`PRISMA_STUDIO_CONFIRM_TARGET=host/banco`; produção exige também
`PRISMA_STUDIO_ALLOW_PRODUCTION=true`. Essas flags não devem permanecer
configuradas.

## Qualidade

```powershell
npm.cmd run prisma:validate
npm.cmd run prisma:generate
npm.cmd run format:check
npm.cmd run lint
npm.cmd run test:cov
npm.cmd run build
npm.cmd run prisma:deploy
npm.cmd run test:e2e
docker build --target production -t lume-tenant-api:local .
```

Consulte [architecture.md](docs/architecture.md),
[production.md](docs/production.md), [offboarding.md](docs/offboarding.md),
[edge-contract.md](docs/edge-contract.md) e
[whatsapp-mvp.md](docs/whatsapp-mvp.md). O contrato extensível de arquivos está
em [data-exchange.md](docs/data-exchange.md). A carga silenciosa de atendimentos
WhatsApp atuais pela interface ou por CLI está em
[whatsapp-conversation-import.md](docs/whatsapp-conversation-import.md). O
runbook da migração controlada da automação está em
[whatsapp-automation-migration.md](docs/whatsapp-automation-migration.md).
