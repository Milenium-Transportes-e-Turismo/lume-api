# Operação em produção

## Preparação

1. Use `.env.production.example` como inventário e cadastre cada chave em um
   gerenciador de segredos. Injete-as diretamente no ambiente do processo; não é
   necessário montar um arquivo `.env` em texto puro no container.
2. Configure banco PostGIS, JWT, licença, e-mail, canal WhatsApp, Evolution, os
   diretórios persistentes `WHATSAPP_MEDIA_STORAGE_PATH` e
   `WHATSAPP_IMPORT_ROOT`, o diretório privado `KNOWLEDGE_STORAGE_PATH` e ao
   menos um provedor de IA. Se o WhatsApp estiver ativo, cadastre as sete
   credenciais individuais listadas abaixo.
3. Use HTTPS para CORS, redefinição de senha e `EVOLUTION_BASE_URL`.
4. Mantenha `SWAGGER_ENABLED=false` salvo durante diagnóstico controlado.
5. Execute `npm ci`, `npm run prisma:deploy`, `npm run build` e `npm test`.

O schema Zod de `src/config/env.ts` é a fronteira única de validação tanto para
valores vindos de `.env` quanto para valores injetados em memória. O
`ConfigModule` o executa globalmente e falha antes do bootstrap se faltar uma
chave obrigatória ou se uma trava operacional de produção for violada. Os
defaults `NODE_ENV=development` e `PORT=3000` existem para desenvolvimento; a
produção deve declarar ambos explicitamente, como no inventário.

O secret manager deve expor somente referências e valores necessários ao
processo da API, com rotação e auditoria próprias. Nunca replique o objeto de
ambiente em logs, respostas HTTP ou artefatos de build. Quando a plataforma de
agentes for habilitada, cada agente deverá resolver sua própria credencial; não
compartilhe uma única API key entre agentes. Somente o adapter OpenAI está
instalado nesta etapa, mas o runtime aceita adapters futuros pelo registry.

Para Docker secrets, monte arquivos individuais sob `/run/secrets` ou defina
`AGENT_DOCKER_SECRETS_ROOT` com outro diretório absoluto. O `credentialRef` do
agente usa `docker-secret://nome-do-arquivo` ou um subdiretório relativo seguro.
Para injeção direta no processo, use `env://NOME_EXATO_DA_VARIAVEL`. O resolver
não lista chaves, não procura alternativas e não usa a credencial de outro
agente quando a referência solicitada estiver ausente ou inválida.

O catálogo inicial usa estas referências independentes:

- `LUME_AGENT_ORCHESTRATOR_OPENAI_API_KEY`;
- `LUME_AGENT_CUSTOMER_SERVICE_OPENAI_API_KEY`;
- `LUME_AGENT_REGISTRATION_OPENAI_API_KEY`;
- `LUME_AGENT_KNOWLEDGE_OPENAI_API_KEY`;
- `LUME_AGENT_MEDIA_OPENAI_API_KEY`;
- `LUME_AGENT_CONTINUITY_OPENAI_API_KEY`;
- `LUME_AGENT_SUPERVISOR_OPENAI_API_KEY`.

O bootstrap recusa chaves repetidas entre agentes. Fallback, quando existir,
pertence ao mesmo agente e precisa apontar para outra configuração/credencial
dele; nunca utiliza silenciosamente o segredo de outro agente.

O adapter OpenAI atual chama somente o endpoint oficial Responses API,
com armazenamento desabilitado (`store=false`). Ajuste
`AGENT_OPENAI_RESPONSES_TIMEOUT_MS` se necessário, entre 1 e 300000 ms. Não há
base URL, modelo ou chave global configurável: cada runtime fornece modelo e
referência da própria credencial. A policy pode fornecer apenas function tools
com JSON Schema estrito; web search, file search, MCP e demais ferramentas
embutidas não são habilitadas.

O executor de function tools não lê permissões do prompt. Ele revalida
`AgentExecution`, tenant, sessão e controle AI, reautoriza os argumentos reais,
usa apenas handlers compilados na allow-list e persiste somente hashes e
resultados limitados. O segundo passe da Responses API usa o mesmo agente,
runtime/modelo/credencial, `tools=[]`, `store=false` e nenhum
`previous_response_id`. Se uma tool falhar ou for negada, a execução falha sem
simular sucesso e sem mudar para um fallback após possível efeito idempotente.

Depois deste deploy, execute novamente o bootstrap idempotente para cada tenant
existente. Ele atualiza os schemas de `registration.read`,
`registration.update` e materializa `registration.draft.start`,
`registration.draft.patch` e `registration.draft.abandon`; nenhuma migration de
banco substitui essa etapa operacional.

Para habilitar o Lume Routing Core, configure uma chave HeiGIT exclusiva no
backend em `HEIGIT_API_KEY` e mantenha
`TOLL_ALLOW_DEVELOPMENT_FIXTURES=false`. A pesquisa assistida de pedágios exige
outra chave, em `TOLL_INTELLIGENCE_OPENAI_API_KEY`, e permanece desabilitada até
ser validada no staging. Confirme roteamento e geocodificação com
`npm run routing:check-services` antes de liberar a permissão
`route-planner:calculate`. O runbook completo está em
[routing/operations.md](routing/operations.md).

Nunca grave segredos no repositório. A chave da Evolution, o segredo do webhook,
JWTs e chaves de IA permanecem apenas no servidor da Tenant API.

As credenciais dos novos agentes são resolvidas individualmente no servidor a
partir de referências `env://` ou `docker-secret://`. A API administrativa do
tenant não devolve identificador nem referência de credencial. Confirme em
homologação que listagens de agentes, execuções, tentativas, chamadas de tools,
auditoria e logs não contêm API key, `credentialIdentifier` nem `credentialRef`.

OpenAI é o único adapter registrado nesta versão. A configuração técnica é
somente leitura na Tenant API, mesmo para administradores do tenant, porque não
há aqui um papel distinto de administrador da plataforma. Não habilite mutação
de provider, modelo, runtime, system/platform prompt ou credencial por essas
rotas; a única escrita disponível é a criação versionada das instruções do
tenant. Um provider futuro deve entrar pelo registry server-side e passar pelas
mesmas políticas, sem criar seletor até que seja formalmente suportado.

## Publicação

Aplique migrações antes de iniciar a nova versão. A migração de consolidação do
WhatsApp converte marcadores legados, normaliza atendimentos inconsistentes,
unifica conversas duplicadas e cria a chave canônica por empresa, canal e
contato. Faça backup e confira o plano em homologação antes do deploy.

A migração `20260807000100_retain_whatsapp_media_content` adiciona os metadados
da cópia própria. Monte o volume antes de liberar o webhook. Banco e volume de
mídias devem participar da mesma política de backup e restauração.

O volume `lume_tenant_whatsapp_imports` armazena ZIPs e manifestos dos lotes
assistidos. Ele não substitui o backup do banco. Monitore espaço, mantenha a
retenção de rascunhos configurada e remova somente lotes expirados; nunca use a
camada gravável efêmera do container para esse diretório.

`KNOWLEDGE_STORAGE_PATH` também é obrigatório e absoluto em produção. Monte-o
em volume persistente privado, sem servidor de arquivos estáticos, e inclua-o no
mesmo ponto de restauração do PostgreSQL. A API valida SHA-256/tamanho antes de
entregar um original autenticado. A extração de PDF roda localmente, sem acesso
à rede ou execução de JavaScript, e recusa arquivos sem texto extraível; não há
OCR nesta entrega.

O serviço transitório `storage-init` do Compose prepara os volumes de mídias,
importações e Knowledge com permissão de escrita para o usuário da API antes da
inicialização. Mantenha essa dependência ao criar ou restaurar os volumes; sem
ela, o primeiro lote pode falhar antes mesmo de receber o arquivo ZIP.

Suba uma única versão consumidora da outbox. Durante rolling deploy, garanta que
as instâncias usam a mesma versão do contrato e os mesmos limites. O lock no
banco impede execução simultânea do mesmo evento, mas versões divergentes não
devem permanecer ativas por períodos prolongados.

## Evolution e WhatsApp

Configure `TENANT_API_PUBLIC_URL=https://<tenant-api>/api/v1`; essa base pública
é usada ao provisionar cada instância e não deve apontar para endereço interno
do container. O webhook oficial de cada canal será
`POST https://<tenant-api>/api/v1/webhooks/evolution/:channelId`. A assinatura, tamanho,
idade, canal e identificador externo são validados antes da persistência.
Assine o evento `messages.upsert` também para mensagens `fromMe`: ele mantém no
painel o histórico enviado pelo WhatsApp App/Web sem disparar IA ou resposta do
bot. Payloads com `remoteJid=@lid` precisam fornecer `remoteJidAlt` com o número.

O navegador nunca acessa a Evolution. A API baixa cada mídia durante o webhook,
grava no volume próprio e a rota autenticada aplica autorização da empresa. A
leitura normal usa somente a cópia persistida. Defina
`EVOLUTION_MEDIA_CONTENT_TIMEOUT_MS` acima do timeout esperado da Evolution e
abaixo do timeout do proxy reverso.

Mantenha `WHATSAPP_MAX_ATTACHMENT_BYTES=52428800` (50 MiB) na API. Esse valor
fica abaixo do limite aproximado de 55 MiB do proxy. Arquivos maiores continuam
no histórico com indicação de limite excedido, mas não são baixados nem gravados.

`WHATSAPP_MEDIA_STORAGE_PATH` é obrigatório e absoluto em produção. No Compose,
o caminho é `/app/var/whatsapp-media`. Não use a camada gravável efêmera do
container. Monitore espaço livre e erros de escrita; uma falha temporária de
download ou armazenamento deve provocar reentrega do webhook.

Quando `WHATSAPP_ENABLED=true`, a automação própria da API é iniciada. Não há
seletor de consumidor. Não execute outro processo lendo a mesma outbox.

Mensagens recebidas enquanto `WHATSAPP_ENABLED=false` continuam no histórico,
mas o evento registra que a resposta automática não foi autorizada. Ao ligar o
bot posteriormente, esses eventos podem ser concluídos pela outbox sem enviar
respostas retroativas aos contatos.

Em cada transição de desligado para ligado, defina
`WHATSAPP_AUTOMATION_ACTIVE_SINCE` com o instante UTC da ativação. A API conclui
eventos cujo `occurredAt` seja anterior a esse marco sem criar mensagem de
saída, inclusive quando o webhook antigo chega atrasado. Se a variável estiver
vazia, o início do processo é usado como barreira conservadora.

## Verificações pós-deploy

- PostGIS ativo, migrations de pedágio aplicadas e providers geográficos
  respondendo somente pela rede privada;
- cálculo controlado em `/api/v1/routing/calculations` devolve geometria,
  distância e combustível; base tarifária ausente é sinalizada sem valores
  fictícios;
- readiness e login sem mensagem de erro após redirecionamento;
- recebimento repetido do mesmo webhook gera uma única mensagem;
- mensagem enviada no WhatsApp App/Web aparece como saída no painel e não gera
  resposta automática;
- o eco de uma mensagem enviada pelo painel não cria uma segunda mensagem;
- menu inicial, IA, coleta e encaminhamento funcionam;
- assumir atendimento define responsável e libera o campo de resposta;
- devolver ao bot preserva contexto; encerrar aguarda o próximo contato;
- retorno textual ou por mídia reutiliza a conversa, preserva histórico e
  orçamentos e começa pelo menu inicial;
- envio de texto e PDF muda a fila e os contadores sem recarregar a página;
- imagem, áudio, vídeo, figurinha, documento e PDF abrem no painel antes e
  depois de reiniciar a API;
- desligar temporariamente o acesso à Evolution não afeta mídias já armazenadas;
- conteúdo não textual não avança menus nem coleta da IA e recebe orientação
  somente quando o bot está ativo;
- durante atendimento humano, texto e qualquer mídia são persistidos sem nenhuma
  resposta automática;
- logs e interface não exibem segredos nem detalhes internos ao usuário.

## Recuperação

Se a automação apresentar comportamento incorreto, defina
`WHATSAPP_ENABLED=false`, reinicie a API e preserve banco e outbox para análise.
Corrija a causa e valide um evento sintético antes de reativar. Eventos isolados
só devem ser reabertos depois de confirmar que não foram processados ou enviados.

Restaure banco somente como último recurso e sempre junto da mesma versão das
migrações. Nunca apague mensagens ou conversas para corrigir duplicidade; use a
chave canônica e a trilha de correlação para reconciliar o estado.

Restaure o volume de mídias junto do banco. Para registros históricos ainda sem
cópia própria, use o endpoint autenticado de retenção enquanto a mídia continuar
disponível na Evolution. Arquivos que já expiraram são irrecuperáveis e devem ser
apresentados como indisponíveis, sem substituição silenciosa.

## Busca de locais, pareamento e atividade administrativa — setembro de 2026

GET /routing/locations aceita CEP brasileiro com oito dígitos, com ou sem hífen. A API consulta ViaCEP sem enviar a chave HeiGIT, resolve o endereço no Pelias e devolve sugestão nomeada. GET /routing/locations/reverse valida latitude/longitude e devolve o nome do local mantendo o ponto escolhido. O cálculo preserva rótulos enviados com coordenadas e resolve nomes de coordenadas sem rótulo. Falhas externas não produzem locais fictícios.

GET /whatsapp/channels/:channelId/pairing exige whatsapp-channels:connect, aplica o companyId autenticado, rejeita canais cancelados/desativados e devolve estado do provedor, QR atual e falha segura. A consulta não modifica versão nem gera eventos de auditoria. A confirmação final usa synchronize-connection, com commandId e expectedVersion.

GET /administration/usage/activity exige administrador e settings:view. Une operações de auditoria agrupadas pelo comando e métricas de requisição em ordem cronológica, com uma única paginação e isolamento pelo tenant. Filtros de resultado HTTP se aplicam somente às requisições. Não deduzimos associação entre comandos e requisições por proximidade de horário.

Estas alterações não exigem migration nem novas variáveis de ambiente. O uso de ViaCEP requer saída HTTPS da API. A geração/renovação de QR não prova que o telefone conseguiu parear; essa etapa exige validação no aplicativo WhatsApp.

## Correção de continuidade e assumir atendimento (2026-09-07)

Esta alteração não requer migration nem novas variáveis. Recompile e publique
a Tenant API. O Web já aceita currentServiceSession no contrato publicado.

Valide a leitura da sessão nativa no painel, assumir com administrador e
operador Comercial autorizado, e coleta de dados em áudio seguida de mensagem
que complementa horário/retorno. Não reenvie respostas históricas para validar.
As instruções de negócio do agente são publicadas em Agentes de IA >
Atendimento Lume > Instruções do tenant > Nova versão. A publicação substitui
o conteúdo completo da camada do tenant e preserva o histórico versionado.

Novos canais criados pela aplicação configuram o webhook de recebimento da
Evolution automaticamente. Com WHATSAPP_ENABLED=true, a primeira mensagem de
um contato em outro canal habilitado cria uma sessão em controle AI e publica
o evento de automação. As instruções dos agentes pertencem ao tenant, sem cópia
por número. Sessões assumidas por uma pessoa não recebem respostas automáticas.
O E2E cobre um segundo canal conectado e sua primeira mensagem, sem enviar
mensagens externas nem exigir um dispositivo físico.

## Atualização do controle de agentes por canal

Aplicar a migration 20260907211000_channel_agents_enabled antes da nova API.
Ela adiciona agents_enabled boolean NOT NULL DEFAULT true em whatsapp_channels,
preservando a ativação dos canais existentes. Não há novas variáveis de ambiente.
Publicar a Web compatível depois da API. A opção fica em Canais WhatsApp > Editar
configuração > Agentes de IA habilitados. Na reversão de imagem, a coluna adicional
pode permanecer; não é necessário remover dados ou desfazer a migration.

## Reiniciar staging sem retroceder a versão instalada

Ao recriar somente a API, preservar o identificador imutável da imagem do
container atual. O nome padrão lume-staging-api-api pode apontar para um build
antigo quando o deploy anterior utilizou outro nome ou um override de Compose.
O script scripts/lume-staging.sh da instalação usa um override de imagem obtido
por docker inspect para a opção de reinício; se não conseguir identificar a
imagem, cancela a operação. O reinício não deve executar build, pull ou migration.
Após a operação, conferir tanto a disponibilidade quanto a identidade da imagem.

## Correção de autoria e entrega de avisos

Atualizar API e Web juntas para apresentar autoria e estado real de envio.
Não exige migration ou variável nova. Eventos mortos antigos não são reenviados
automaticamente. Reparar status de mensagem somente após comprovar que nenhuma
tentativa foi enviada, reservada ou ficou com resultado desconhecido.

## Atendimento contextual, transferência e mídia

O atendimento automático não apresenta mais menus numéricos. Mensagens após a
confirmação do orçamento passam pelos agentes com histórico e dados persistidos,
sem reiniciar a coleta. As etapas legadas com nome de menu continuam legíveis no
banco, mas não emitem listas de opções. A confirmação da coleta também não
promete menus futuros. O agente responde somente dentro de suas permissões e
encaminha decisões humanas; o departamento sugerido é validado contra os códigos
internos, e a transferência continua sujeita às validações do tenant. Por exemplo,
pagamento de uma viagem realizada pode ser encaminhado ao Financeiro.

A transferência de ServiceSession aceita somente departmentId. Fila e responsável
são opcionais: quando ausentes, o atendimento aguarda a equipe de destino sob
controle humano, sem herdar a atribuição anterior. Isolamento, versão, auditoria e
idempotência permanecem obrigatórios. O aviso automático de encaminhamento usa o
outbox existente; não há envio paralelo.
