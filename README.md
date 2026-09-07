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
- Knowledge Base versionada, com publicação humana, vigência, scopes e originais
  privados preservados.

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

### Configuração validada

O schema Zod central em `src/config/env.ts` valida e normaliza o ambiente antes
de qualquer provider do Nest ser inicializado. O `ConfigModule` continua global
e entrega as mesmas chaves planas ao `ConfigService`, portanto os serviços e as
CLIs existentes não precisam conhecer a origem da configuração. `NODE_ENV` usa
`development` e `PORT` usa `3000` quando não forem informados; o `.env.example`
define `3333` explicitamente para manter a porta local documentada acima.

O carregamento local por `.env` continua suportado. Em containers, a mesma
aplicação pode receber as chaves diretamente em `process.env`, injetadas pelo
orquestrador ou por um secret manager, sem criar arquivo em disco. Variáveis
desconhecidas são preservadas para consumidores e CLIs legados, enquanto todas
as chaves conhecidas mantêm coerção, defaults e travas de produção. Uma falha de
validação interrompe a inicialização antes de abrir a porta HTTP.

Segredos permanecem exclusivamente server-side: não imprima o objeto `env`, não
o serialize em respostas e não envie chaves ao frontend. Configurações futuras
de agentes devem resolver uma credencial individual por agente no secret
manager; uma chave global compartilhada não é uma alternativa segura. Nesta
entrega, o único adapter registrado é o da OpenAI.

O runtime aceita referências `env://NOME_EXATO_DA_VARIAVEL` e
`docker-secret://caminho/relativo`. Docker secrets são lidos somente dentro de
`AGENT_DOCKER_SECRETS_ROOT` (por padrão, `/run/secrets`) e o caminho canônico não
pode escapar dessa raiz. Referências `secret://` ou `vault://` permanecem
inválidas até existir um adapter server-side explícito; nunca ocorre fallback
para a chave de outro agente.

O adapter atualmente registrado usa `POST /v1/responses` da OpenAI, com
`store=false` e `AGENT_OPENAI_RESPONSES_TIMEOUT_MS` (30 segundos por padrão).
O gateway não oferece web search, file search, MCP ou outra ferramenta
embutida: ele aceita somente funções previamente liberadas pela policy, sempre
com JSON Schema estrito. Modelo e `credentialRef` pertencem ao runtime de cada
agente e não possuem fallback global. O roteamento ocorre por um registry para
que adapters futuros possam ser acrescentados sem mudar esses limites.

Function calls são reautorizadas com seus argumentos reais e executadas por
allow-list interna. Cada transição fica em `AgentToolCall`, sem argumentos, PII
ou segredos. Um resultado limitado volta como dado não confiável em uma única
segunda chamada ao mesmo runtime com `tools=[]`; não se usa
`previous_response_id`. Negação/falha não é apresentada como sucesso e, depois
de iniciar a fase de tools, não há troca de runtime. O bootstrap idempotente
deve ser rerodado em tenants existentes para atualizar definitions e vínculos
do catálogo.

O especialista de Knowledge recebe exclusivamente as funções server-side
`knowledge_gap_observe` e `knowledge_suggestion_create`. Elas derivam tenant,
sessão, execução e evidências inbound no servidor; retornam somente resultados
redigidos. Lacunas são observadas por tópico normalizado e sugestões nascem
sempre `pending`, exigindo revisão humana. Nenhuma delas publica, aprende da
conversa ou habilita internet automaticamente.

Para habilitar WhatsApp, preencha os blocos `WHATSAPP_*`, `EVOLUTION_*` e as
sete credenciais individuais `LUME_AGENT_*_OPENAI_API_KEY` do ambiente antes
de executar o bootstrap idempotente. `WHATSAPP_AI_*` permanece apenas como
compatibilidade de configuração legada e não alimenta o runtime dos agentes.
O contrato completo,
matriz de estados, assinaturas e endpoints está em
[`docs/whatsapp-mvp.md`](docs/whatsapp-mvp.md).
A consolidação, o proxy seguro de mídia e o checklist operacional estão em
[`docs/whatsapp-api.md`](docs/whatsapp-api.md).

## Autonomia

Login, usuários, permissões, banco, licença e integrações locais não consultam
o `lume-control`. A queda do computador da fornecedora não interrompe o
cliente.

A licença assinada possui validade e tolerância locais. O endpoint autenticado
`GET /api/v1/license/status` mostra o estado sem realizar chamadas externas. O
Administrador da Instalação possui acesso total; os demais usuários precisam
simultaneamente do departamento Gerência (`management`) e de `license:view`.

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
`isAdministrator=true` é a autoridade total e separada do Administrador da
Instalação Lume: somente outro administrador pode concedê-la ou removê-la. A
projeção efetiva inclui o catálogo atual completo, inclusive `service:*`, sem
gravar departamentos ou permissões individuais na conta. Diretoria também é
distinta: pertencer a `directorate` não basta; a autoridade ampla de negócio
exige `tenant:manage` atribuída individualmente. A Gerência continua controlada
pelas capacidades estreitas de cada processo. Supervisão é uma capacidade
explícita, não um cargo ou perfil implícito.

O bootstrap idempotente sincroniza o catálogo fixo atual: Empresa Cliente e as
áreas internas RH, Comercial, Compras, Controladoria, Departamento Pessoal,
Financeiro, Gerência, Diretoria, Manutenção, Monitoramento, Operacional e TI. A
conta administrativa inicial é vinculada à autoridade administrativa
explícita; seus vínculos diretos ficam vazios para não confundir administração
global com Gerência ou Diretoria.

RH e Departamento Pessoal são departamentos separados com o mesmo teto de
capacidades documentais. O catálogo do runtime ainda é fechado no código e no
enum do banco; criar departamentos internos dinamicamente continua sendo uma
lacuna. Quando essa extensão existir, capacidades transversais devem alcançar os
novos departamentos sem incluir `client-company`.

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
- `PATCH /api/v1/users/:id` exige `commandId` e `expectedVersion`, incrementa a
  versão do cadastro e grava recibo idempotente, histórico e auditoria na mesma
  transação; repetição divergente ou versão antiga retorna conflito;
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

### Administração segura de agentes

`GET /api/v1/agents` e `GET /api/v1/agents/:agentId/executions` são consultas
isoladas pelo tenant. Elas mostram status, modelo, provider e somente o
versionamento técnico necessário; nunca retornam `credentialIdentifier`,
`credentialRef` ou API key.
`POST /api/v1/agents/:agentId/tenant-instructions` cria uma nova versão das
instruções do tenant com `commandId`, `expectedVersion` e auditoria. A rota não
altera nem substitui system prompt ou platform prompt.

OpenAI é o único adapter de modelo registrado agora, sem seletor de provider na
interface. O runtime usa um registry de adapters para manter a extensão futura
explícita, mas a Tenant API não expõe mutação de provider, modelo, runtime ou
credencial: o modelo de autorização atual não possui um papel separado de
administrador da plataforma. Essas mudanças técnicas devem continuar em uma
superfície de controle própria antes de serem habilitadas.

### Knowledge Base

As rotas `/api/v1/knowledge/*` permitem criar bases, artigos e uploads em draft,
versionar/publicar sem sobrescrever versões anteriores, arquivar sem delete e
revisar sugestões/gaps. O tenant vem sempre do JWT; scopes de departamento são
revalidados no banco. TXT, CSV, XLSX e DOCX possuem extração local limitada.
PDF textual também é extraído localmente com limites, rede/JavaScript
desabilitados e provenance por página; PDF somente com imagem exige OCR, que não
faz parte desta entrega. O contrato e o runbook estão em
[docs/knowledge-base.md](docs/knowledge-base.md).

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
`documents:manage` automaticamente. RH e Departamento Pessoal permanecem
opções atribuíveis e separadas. Definir a responsabilidade por tipo documental
ainda é uma lacuna; igualdade de permissões não escolhe o departamento
responsável.

### Atendimento WhatsApp transversal

`whatsapp-conversations:attend` é atribuída individualmente e pode ser usada
por qualquer departamento interno catalogado, nunca por `client-company`.
`whatsapp-conversations:manage` permanece como capacidade ampla legada para
administração do canal e operações de proposta Comercial; ela não deve ser
concedida apenas para liberar atendimento. O responsável da conversa é uma
referência corrente, não uma trava exclusiva: outro usuário autorizado pode
atuar ou assumir, com `expectedVersion` e histórico do ator e da substituição.
Supervisão segue a mesma regra de capacidade explícita, sem perfil fixo.
O Administrador da Instalação recebe automaticamente todas as capacidades
`service:*` e pode assumir um atendimento de qualquer departamento; ele não é
incluído automaticamente na escala de distribuição das filas.

### Aceite e confirmação comercial

Aceite não confirma serviço nem cria Viagem. Para o serviço singular do
orçamento legado, o Financeiro registra o ateste em
`POST /api/v1/commercial/quote-requests/:id/financial-attestation`, o
Operacional registra o seu em `operational-attestation` e somente então o
Comercial finaliza em `confirmed-services`. Cada etapa possui ator, evidência,
`commandId`, versão do orçamento, idempotência e revalidação de acesso dentro da
transação. O estado pode ser recuperado em `confirmed-service-readiness`.

Uma dispensa `not-applicable` é registrada separadamente com motivo, evidência,
`commandId` e versão esperada. Gerência depende da capacidade estreita
`service-confirmations:approve`; Diretoria depende de `directorate` com
`tenant:manage` individual; e o Administrador da Instalação possui autoridade
total. O modelo legado ainda representa um serviço por orçamento; itens
comerciais múltiplos e cancelamento pós-confirmação continuam lacunas
explícitas, sem fallback que apague o estágio alcançado.

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

### Lume Routing Core

`POST /api/v1/routing/calculations` calcula uma rota técnica com
OpenRouteService, usa o Pelias hospedado pela HeiGIT para geocodificação, cruza
a geometria com a base versionada de pedágios no PostGIS e agrega combustível e
custos. O endpoint suporta coordenadas, até dez paradas manuais e ida/volta
calculadas separadamente. Não depende de QualP nem Google Maps.

Quando a base interna de pedágios está incompleta, um agente opcional pode
pesquisar fontes públicas usando chave exclusiva. O resultado aparece somente
em `tolls.intelligence`, sempre como estimativa citada, e nunca altera
`tolls.total`, o custo verificado ou as tarifas persistidas. Valhalla e Nominatim
permanecem como adaptadores legados compiláveis, mas não são registrados no
módulo em execução.

O cadastro genérico de clientes PF/PJ e seus usuários foi preservado em
`/clients`. O módulo e os endpoints operacionais antigos foram removidos do
runtime; a fundação persistida de contratos, passageiros, pontos fixos e rotas é
mantida temporariamente como compatibilidade para `OperationalTrip` e seleção de
plano, sem reativar o runtime legado. O núcleo novo não pressupõe contrato e
poderá atender tanto o fretamento eventual quanto o contínuo. Consulte
[docs/routing/architecture.md](docs/routing/architecture.md) e
[docs/routing/operations.md](docs/routing/operations.md). A ativação em
homologação está em [docs/routing/staging.md](docs/routing/staging.md).

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
O ciclo completo da Knowledge Base está em
[knowledge-base.md](docs/knowledge-base.md).

## Busca de locais, pareamento e atividade administrativa — setembro de 2026

GET /routing/locations aceita CEP brasileiro com oito dígitos, com ou sem hífen. A API consulta ViaCEP sem enviar a chave HeiGIT, resolve o endereço no Pelias e devolve sugestão nomeada. GET /routing/locations/reverse valida latitude/longitude e devolve o nome do local mantendo o ponto escolhido. O cálculo preserva rótulos enviados com coordenadas e resolve nomes de coordenadas sem rótulo. Falhas externas não produzem locais fictícios.

GET /whatsapp/channels/:channelId/pairing exige whatsapp-channels:connect, aplica o companyId autenticado, rejeita canais cancelados/desativados e devolve estado do provedor, QR atual e falha segura. A consulta não modifica versão nem gera eventos de auditoria. A confirmação final usa synchronize-connection, com commandId e expectedVersion.

GET /administration/usage/activity exige administrador e settings:view. Une operações de auditoria agrupadas pelo comando e métricas de requisição em ordem cronológica, com uma única paginação e isolamento pelo tenant. Filtros de resultado HTTP se aplicam somente às requisições. Não deduzimos associação entre comandos e requisições por proximidade de horário.

Estas alterações não exigem migration nem novas variáveis de ambiente. O uso de ViaCEP requer saída HTTPS da API. A geração/renovação de QR não prova que o telefone conseguiu parear; essa etapa exige validação no aplicativo WhatsApp.

### Continuidade de atendimento e coleta comercial

O painel recebe a sessão nativa vinculada à conversa, com seu identificador,
versão e ações disponíveis. Comandos de atendimento usam essa sessão.
Orquestrador e especialistas recebem histórico limitado da mesma empresa,
conversa e sessão, incluindo transcrição efetiva e correção humana de mídia.
Pedidos de orçamento eventual em linguagem natural iniciam a coleta canônica;
os campos extraídos são persistidos antes da resposta.

## Agentes por canal WhatsApp

A configuração de cada canal inclui agentsEnabled (padrão true). Desabilitar
os agentes preserva a recepção de mensagens e o atendimento humano, mas suspende
respostas automáticas, novas execuções de agentes, análise de mídias e encerramento
automático naquele canal. Ativar novamente permite processar novas entradas;
não reproduz automaticamente eventos já concluídos durante a pausa.

## Autoria e envio no WhatsApp

Mensagens retornam actor e source a partir da autoria persistida. Avisos de
handoff têm autorização específica, limitada à mensagem vinculada à transição
e à sessão ainda aguardando equipe. Respostas comuns de IA continuam bloqueadas
sob controle humano. Falha terminal anterior ao despacho atualiza a mensagem
para failed; resultado desconhecido do provedor exige reconciliação.
