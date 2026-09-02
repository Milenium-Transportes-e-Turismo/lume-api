# Checklist de teste real local — Lume Tenant API + Web

Atualizado em 30/08/2026 para os worktrees:

- `C:\novos projetos\tks-lume\lume-tenant-api-route-planner`;
- `C:\novos projetos\tks-lume\lume-tenant-web-route-planner`.

Este documento separa três níveis de validação:

1. **UI isolada:** Web com autenticação simulada e dados mockados. Valida
   aparência e interações, mas não valida API, banco ou integrações.
2. **Núcleo real local:** PostgreSQL/PostGIS + Tenant API + Tenant Web, com
   migrations, licença, bootstrap, login e persistência reais.
3. **Ponta a ponta completo:** núcleo real + Evolution/WhatsApp + sete
   credenciais OpenAI individuais + storage persistente + serviços externos.

## Resposta objetiva

**Não basta apenas subir os containers e executar `npm run dev` e
`npm run start:dev`.** No estado atual desta máquina, isso não inicia um teste
real porque ainda faltam ambiente, migrations, bootstrap e integrações.

O comando correto de desenvolvimento é:

- API: `npm.cmd run start:dev`;
- Web: `npm.cmd run dev` — a Web não possui script `start:dev`;
- `npm.cmd run start` na Web só deve ser usado depois de `npm.cmd run build`.

O `docker-compose.yml` local da API sobe **somente PostgreSQL/PostGIS**. Ele não
contém Tenant API, Tenant Web, Evolution, Redis, MinIO ou n8n.

## Estado auditado desta máquina

- [x] Node `24.18.0` instalado e compatível com a API.
- [x] npm `11.16.0` instalado.
- [x] Dependências (`node_modules`) presentes nos dois worktrees.
- [x] Docker CLI/Compose instalado.
- [ ] Docker Desktop/daemon em execução — estava parado na auditoria.
- [ ] Arquivo `.env` da API — não existe atualmente.
- [ ] Arquivo `.env.local` da Web — não existe atualmente.
- [x] Portas `3000`, `3333` e `5433` livres durante a auditoria.
- [ ] Evolution disponível — não existe compose dela nestes projetos.
- [ ] Licença válida e sete credenciais OpenAI provisionadas.

## Bloqueios conhecidos e como liberá-los

| Bloqueio | Por que está bloqueado | O que libera | Evidência para encerrar |
| --- | --- | --- | --- |
| PostgreSQL/PostGIS real | As migrations passaram em PGlite com shim espacial, que não é o mesmo motor do PostgreSQL/PostGIS. O Docker local está parado. | Iniciar Docker Desktop, subir o PostGIS, aplicar `prisma:deploy` em banco descartável ou com backup e verificar dados/constraints. | Readiness `200`, migrations concluídas e contagens/backfills conferidos. |
| Catálogo de agentes em banco novo | A migration `20260829000200` semeia agentes para empresas que já existirem. No fluxo documentado, a migration roda antes de o `tenant:bootstrap` criar a empresa, e o `ProductionBootstrapService` usado pelo CLI não chama `ensurePlatformAgentCatalog`. | Corrigir o bootstrap para executar a sincronização idempotente dentro da transação após criar a empresa, ou implementar um seed/backfill operacional idempotente após o bootstrap. Não inserir registros manualmente. | Exatamente sete agentes, sete runtimes e sete referências de credencial distintas para o tenant. |
| Execução do Supervisor | `service-supervisor` existe no catálogo, mas não possui controller, worker ou CLI que o invoque legitimamente. | Implementar um gatilho interno autorizado e auditado, ou registrar decisão explícita de retirá-lo do escopo executável desta entrega; não criar endpoint público improvisado. | Execução real interna do Supervisor com sua própria chave, ou aceite formal de escopo sem declarar que os sete executaram. |
| Permissões do atendimento | Service Sessions usa `service:*`, enquanto painel, envio, contatos, mídia e partes de orçamento ainda exigem `whatsapp-conversations:view/manage`; o guard não cria alias. | Convergir o contrato/autorização ou implementar compatibilidade explícita e testada entre códigos. | Usuários apenas granulares e legados produzem o comportamento decidido, sem ação habilitada na Web terminar em `403` inesperado. |
| Evolution/WhatsApp | Não há serviço Evolution no compose, instância pareada, credenciais nem webhook alcançável. | Disponibilizar Evolution separadamente, conectar um número por QR, configurar URL/chave/segredo e garantir rota de rede de ida e volta. | Mensagem real recebida, persistida e respondida, com reentrega idempotente. |
| Agentes OpenAI | Os testes locais usaram doubles/mocks; não provam autenticação, acesso aos modelos, quota, latência ou falhas reais. | Provisionar sete API keys válidas e diferentes, uma por agente, em segredo server-side; validar todos os caminhos atualmente executáveis e cenários 401/429/timeout. | Sete configurações/credenciais validadas, execuções reais dos agentes com gatilho disponível e nenhuma chave/referência exposta. |
| Knowledge/storage | Testes automatizados não comprovam permissões, durabilidade, backup e restauração do diretório real. | Configurar diretório absoluto privado, testar upload/download e reinício, e incluí-lo no mesmo plano de backup do banco. | Original e versão continuam disponíveis e íntegros após reiniciar a API. |
| QA completa | A inspeção visual local anterior cobriu somente parte das telas/viewports e dados mockados. | Executar jornadas autenticadas com API real, permissões variadas, dois temas e matriz mínima de navegadores/tamanhos. | Checklist visual e funcional abaixo concluído com capturas e erros de console/rede registrados. |
| Compose de produção | O `compose.prod.yml` não injeta `TENANT_API_PUBLIC_URL`, as sete chaves, timeout e `KNOWLEDGE_STORAGE_PATH`; não monta/prepara volume de Knowledge. Com WhatsApp ativo a validação aborta, e as interpolações obrigatórias de Evolution/canal também impedem um perfil core-only incompleto. | Atualizar o compose/override e seu `storage-init` antes de usá-lo, cobrindo configuração e volume privado de Knowledge. | API inicia com `NODE_ENV=production`, readiness saudável, canal provisionável e persistência após recriação do container. |

> O adapter disponível nesta versão usa OpenAI, mas isso não deve virar uma
> proibição arquitetural permanente. O registry deve continuar permitindo a
> inclusão controlada de providers futuros. Hoje, porém, os sete agentes só
> podem ser validados integralmente com modelos e credenciais OpenAI.

## 1. Segurança antes de começar

- [ ] Confirmar que nenhum `.env`, `.env.local`, API key, licença ou senha será
  versionado ou colado em evidências.
- [ ] Abrir Docker Desktop e aguardar o daemon ficar disponível.
- [ ] Conferir se existe container/volume anterior antes de iniciar:

```powershell
docker version
docker compose version
docker compose config
docker ps -a --filter "name=lume-tenant-postgres"
docker volume ls --filter "name=lume_tenant_postgres_data"
```

- [ ] Se houver dados relevantes, fazer backup com `pg_dump` antes das
  migrations.
- [ ] Não executar `docker compose down -v`, `prisma migrate reset` ou exclusão
  manual do volume. Esses comandos apagam dados.
- [ ] Evitar iniciar simultaneamente o repositório antigo da API: ele usa o
  mesmo nome de container e a mesma porta `5433`.
- [ ] Se o container já existir, identificar o volume realmente montado; o nome
  lógico do compose pode receber prefixos diferentes em cada projeto:

```powershell
docker inspect lume-tenant-postgres --format '{{json .Mounts}}'
```

- [ ] Antes de gerar o dump, conferir/restringir a ACL do diretório de destino,
  tratar o arquivo como dado pessoal, criptografá-lo quando aplicável e não o
  sincronizar com repositórios ou nuvens não autorizadas. `New-Item` apenas
  herda a ACL do diretório pai.
- [ ] Quando mídias/imports/Knowledge já existirem, parar os writers e criar um
  snapshot coerente desses três diretórios no mesmo ponto lógico do banco; o
  `pg_dump` isolado não prova um rollback completo.

Exemplo de backup quando o container já estiver saudável:

```powershell
$backupStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = 'C:\novos projetos\tks-lume\local-data\backups'
$containerBackupPath = "/tmp/lume-before-test-$backupStamp.dump"
$hostBackupPath = Join-Path $backupDir "lume-before-test-$backupStamp.dump"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
if (Test-Path -LiteralPath $hostBackupPath) { throw 'O destino do backup já existe.' }
docker exec lume-tenant-postgres pg_dump -U lume -d lume_tenant -Fc -f $containerBackupPath
if ($LASTEXITCODE -ne 0) { throw 'pg_dump falhou; o backup não foi copiado.' }
docker exec lume-tenant-postgres pg_restore --list $containerBackupPath | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'O dump não passou na validação do pg_restore.' }
docker cp "lume-tenant-postgres:$containerBackupPath" $hostBackupPath
if ($LASTEXITCODE -ne 0) { throw 'docker cp falhou.' }
Get-FileHash -Algorithm SHA256 -LiteralPath $hostBackupPath
docker exec lume-tenant-postgres rm -- $containerBackupPath
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível remover apenas o dump temporário do container.' }
```

## 2. Preparar a licença

- [ ] Obter do Lume Control um conjunto válido e correspondente:
  `INSTALLATION_ID`, `LICENSE_PUBLIC_KEY_BASE64` e `LICENSE_DOCUMENT`.
- [ ] Confirmar que o documento foi assinado pela chave privada do Control,
  pertence ao mesmo `INSTALLATION_ID`, não expirou e contém o tenant esperado.
- [ ] Não usar texto fictício: a API valida assinatura Ed25519 ao inicializar e
  não abre a porta com licença inválida.

Se ainda não houver licença, o desbloqueio é feito no `lume-control`: gerar ou
carregar o par Ed25519, criar tenant, criar instalação e emitir a licença. Gerar
somente o par de chaves não cria um `LICENSE_DOCUMENT` utilizável.

## 3. Preparar a Tenant API

Em PowerShell:

```powershell
Set-Location 'C:\novos projetos\tks-lume\lume-tenant-api-route-planner'
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item '.env.example' '.env' }
```

- [ ] Preencher `.env` sem alterar `.env.example`.
- [ ] Configurar, no mínimo:
  - `DATABASE_URL=postgresql://lume:lume@127.0.0.1:5433/lume_tenant?schema=public`;
  - `PORT=3333`;
  - `JWT_ACCESS_SECRET` aleatório com pelo menos 32 caracteres/bytes;
  - `INSTALLATION_ID`, `LICENSE_PUBLIC_KEY_BASE64` e `LICENSE_DOCUMENT` reais;
  - `HEIGIT_API_KEY` real, com pelo menos 10 caracteres — a configuração atual exige esse valor; uma
    chave inválida permite no máximo fluxos sem roteirização e não constitui
    teste real do módulo de rotas;
  - `CORS_ORIGINS=http://localhost:3000`;
  - `TENANT_LEGAL_NAME`, `TENANT_TRADE_NAME` e CNPJ válido em `TENANT_TAX_ID`;
  - `TENANT_ADMIN_NAME`, `TENANT_ADMIN_USERNAME`, `TENANT_ADMIN_EMAIL`;
  - `TENANT_ADMIN_PASSWORD` com pelo menos 12 caracteres no primeiro bootstrap;
  - CPF válido em `TENANT_ADMIN_CPF`, se informado.
- [ ] Para validar primeiro apenas o núcleo, manter:

```dotenv
WHATSAPP_ENABLED=false
EMAIL_DELIVERY_ENABLED=false
```

- [ ] Gerar `JWT_ACCESS_SECRET` e, mais tarde, `SESSION_SECRET` com duas
  execuções independentes do comando abaixo; não reutilizar a mesma saída e não
  incluí-la em captura ou log compartilhado:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

- [ ] Confirmar que `.env` está ignorado pelo Git:

```powershell
git status --short -- .env
```

## 4. Subir PostGIS, aplicar migrations e bootstrap

```powershell
Set-Location 'C:\novos projetos\tks-lume\lume-tenant-api-route-planner'
docker compose up -d --wait
docker compose ps
docker exec lume-tenant-postgres pg_isready -U lume -d lume_tenant
npm.cmd run prisma:validate
npm.cmd run prisma:generate
npm.cmd run prisma:deploy
npm.cmd run tenant:bootstrap
```

- [ ] Container `lume-tenant-postgres` aparece como `healthy`.
- [ ] `prisma:deploy` termina sem migration pendente ou falha.
- [ ] Bootstrap cria a empresa licenciada e o administrador.
- [ ] Remover `TENANT_ADMIN_PASSWORD` do `.env` depois da criação inicial.
- [ ] Reexecutar `tenant:bootstrap` e confirmar idempotência, sem duplicações.
- [ ] Conferir a tabela de migrations:

```powershell
docker exec lume-tenant-postgres psql -U lume -d lume_tenant -c 'SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at;'
```

### Bloqueio P0 para o teste dos agentes em instalação nova

- [ ] Corrigir o bootstrap/seed descrito em “Bloqueios conhecidos”.
- [ ] Depois da correção, reexecutar `npm.cmd run tenant:bootstrap`.
- [ ] Confirmar sete agentes:

```powershell
docker exec lume-tenant-postgres psql -U lume -d lume_tenant -c 'SELECT company_id, COUNT(*) AS agents FROM lume_agents GROUP BY company_id;'
```

- [ ] Confirmar, por tenant, sete agentes, exatamente um runtime ativo por
  agente, provider atual `openai` e sete referências distintas, sem consultar
  nem imprimir os valores das API keys:

```powershell
docker exec lume-tenant-postgres psql -U lume -d lume_tenant -c "SELECT a.company_id, COUNT(DISTINCT a.id) AS agents, COUNT(r.id) AS active_runtimes, COUNT(DISTINCT r.agent_id) AS agents_with_active_runtime, COUNT(DISTINCT r.credential_ref) AS credential_refs, string_agg(DISTINCT r.provider, ',') AS providers FROM lume_agents a LEFT JOIN agent_runtime_config_versions r ON r.company_id = a.company_id AND r.agent_id = a.id AND r.status = 'active' GROUP BY a.company_id;"
```

Resultado esperado para o tenant: `agents=7`, `active_runtimes=7`,
`agents_with_active_runtime=7`, `credential_refs=7` e `providers=openai`. Até
isso ocorrer, nenhum teste da plataforma de agentes deve ser marcado como
aprovado.

## 5. Iniciar e validar a API

Em um terminal dedicado:

```powershell
Set-Location 'C:\novos projetos\tks-lume\lume-tenant-api-route-planner'
npm.cmd run start:dev
```

Em outro terminal:

```powershell
Invoke-RestMethod 'http://localhost:3333/api/v1/health'
Invoke-RestMethod 'http://localhost:3333/api/v1/health/ready'
```

- [ ] Liveness retorna `status=ok`.
- [ ] Readiness retorna `status=ready`, `database=up` e licença `active` ou
  `grace`.
- [ ] Swagger abre em `http://localhost:3333/docs`.
- [ ] Nenhuma chave, licença, senha ou token aparece nos logs.

> A readiness prova processo, banco, licença e contadores de outbox. Ela **não**
> chama Evolution, OpenAI nem testa permissões/durabilidade dos diretórios.

## 6. Preparar e iniciar a Tenant Web

```powershell
Set-Location 'C:\novos projetos\tks-lume\lume-tenant-web-route-planner'
if (-not (Test-Path -LiteralPath '.env.local')) { Copy-Item '.env.example' '.env.local' }
```

Configuração obrigatória para teste real:

```dotenv
LUME_TENANT_API_URL=http://localhost:3333/api/v1
SESSION_SECRET=<segredo-aleatorio-exclusivo-com-32-ou-mais-bytes>
AUTH_SIMULATION_ENABLED=false
LUME_TENANT_WHATSAPP_DATA_SOURCE=api
```

- [ ] Confirmar que `.env.local` está ignorado pelo Git.
- [ ] Iniciar em terminal dedicado:

```powershell
npm.cmd run dev
```

- [ ] Validar processo e integração com a API:

```powershell
Invoke-RestMethod 'http://localhost:3000/api/health'
Invoke-RestMethod 'http://localhost:3000/api/readiness'
```

- [ ] `/api/health` retorna HTTP `200` com `status=ok`.
- [ ] `/api/readiness` retorna HTTP `200`, `status=ready` e
  `dependencies.tenantApi=ready`.
- [ ] Abrir `http://localhost:3000`.
- [ ] Entrar com o administrador real criado pelo bootstrap e concluir a troca
  obrigatória da senha inicial.
- [ ] Manter DevTools Console/Network aberto e registrar qualquer erro.

> A readiness da Web confirma que o Next alcança a readiness da Tenant API. Ela
> não comprova login, permissões nem jornadas funcionais.

Para teste exclusivamente visual, pode-se usar
`AUTH_SIMULATION_ENABLED=true` e
`LUME_TENANT_WHATSAPP_DATA_SOURCE=mock`, mas esse resultado não vale como teste
real e não valida abas administrativas, persistência nem permissões completas.
Nesse modo, pode-se usar `comercial.teste` / `Milenium@2026`; Tenant
Administration e Orçamentos não ficam disponíveis, e os usuários simulados não
possuem `isAdministrator=true`. Não combinar simulação com datasource `api`,
pois não haverá access token real. Sempre reiniciar o Next e limpar cookies ao
alternar entre modo simulado e real; trocar `SESSION_SECRET` invalida as sessões
existentes.

## 7. Habilitar Evolution, WhatsApp e OpenAI

Somente iniciar esta etapa depois de o núcleo real e o catálogo de sete agentes
estarem saudáveis.

### Storage local persistente

- [ ] Criar diretórios privados e persistentes fora de camadas efêmeras:

```powershell
New-Item -ItemType Directory -Force -Path 'C:\novos projetos\tks-lume\local-data\whatsapp-media'
New-Item -ItemType Directory -Force -Path 'C:\novos projetos\tks-lume\local-data\whatsapp-imports'
New-Item -ItemType Directory -Force -Path 'C:\novos projetos\tks-lume\local-data\whatsapp-imports\incoming'
New-Item -ItemType Directory -Force -Path 'C:\novos projetos\tks-lume\local-data\knowledge'
```

- [ ] Configurar caminhos absolutos no `.env`:
  - `WHATSAPP_MEDIA_STORAGE_PATH`;
  - `WHATSAPP_IMPORT_ROOT`;
  - `WHATSAPP_IMPORT_UPLOAD_TEMP_ROOT`, apontando para o subdiretório
    `incoming` do mesmo storage;
  - `KNOWLEDGE_STORAGE_PATH`.
- [ ] Inspecionar as ACLs herdadas e restringi-las conforme a política local;
  criar o diretório não o torna privado automaticamente.
- [ ] Confirmar que somente a conta que executa a API e operadores autorizados
  possuem acesso necessário.

### Evolution e rede

- [ ] Disponibilizar uma Evolution compatível separadamente.
- [ ] Definir `EVOLUTION_BASE_URL`, `EVOLUTION_INSTANCE_NAME`,
  `EVOLUTION_API_KEY` com pelo menos 16 caracteres e
  `EVOLUTION_WEBHOOK_SECRET` com pelo menos 32 caracteres.
- [ ] Usar nome técnico da instância com letras minúsculas, números e hífens,
  começando/terminando por letra ou número; adotar 3–120 caracteres para evitar
  o caso de dois caracteres recusado pelo client atual.
- [ ] Definir UUID em `WHATSAPP_CHANNEL_ID`, nome em
  `WHATSAPP_CHANNEL_NAME` e número em `WHATSAPP_PHONE_NUMBER`.
- [ ] Confirmar que o telefone normalizado contém de 10 a 15 dígitos.
- [ ] Definir `WHATSAPP_AUTOMATION_ACTIVE_SINCE` em ISO-8601 com fuso para o
  instante da ativação, evitando resposta automática a histórico anterior.
- [ ] Manter `WHATSAPP_IGNORE_GROUPS=true` para persistir grupos sem abrir
  sessão nem disparar IA.
- [ ] Garantir as duas direções de rede:
  - API no host para Evolution containerizada: normalmente
    `EVOLUTION_BASE_URL=http://localhost:<porta-publicada>`;
  - Evolution containerizada para API no host: normalmente
    `TENANT_API_PUBLIC_URL=http://host.docker.internal:3333/api/v1`.
- [ ] Tratar `host.docker.internal` apenas como solução da topologia Windows +
  Docker Desktop + API no host. Em WSL/Linux/outro compose pode ser necessário
  `host-gateway`, DNS ou endereço de rede; se a API também estiver em container,
  `localhost` deixa de representar o outro serviço.
- [ ] Antes de ler o QR, provar do processo da API o acesso à Evolution e, do
  container/host da Evolution, o acesso ao endpoint público da Tenant API.
- [ ] Se a Evolution estiver em outro servidor, não usar `localhost` no
  callback. Publicar a API em URL HTTPS alcançável ou usar túnel controlado.
- [ ] Liberar a porta necessária no firewall apenas para a origem prevista.

### Credenciais individuais dos agentes

- [ ] Provisionar sete API keys OpenAI válidas, não repetidas e com acesso aos
  modelos configurados:
  - `LUME_AGENT_ORCHESTRATOR_OPENAI_API_KEY`;
  - `LUME_AGENT_CUSTOMER_SERVICE_OPENAI_API_KEY`;
  - `LUME_AGENT_REGISTRATION_OPENAI_API_KEY`;
  - `LUME_AGENT_KNOWLEDGE_OPENAI_API_KEY`;
  - `LUME_AGENT_MEDIA_OPENAI_API_KEY`;
  - `LUME_AGENT_CONTINUITY_OPENAI_API_KEY`;
  - `LUME_AGENT_SUPERVISOR_OPENAI_API_KEY`.
- [ ] Não reutilizar uma chave entre agentes; a validação da API rejeita
  duplicatas.
- [ ] Confirmar quota, faturamento, acesso aos modelos e limites por chave.
- [ ] Nunca expor as chaves ao Next.js, variáveis `NEXT_PUBLIC_*`, banco, UI,
  payloads, logs ou capturas.

### E-mail, quando o fluxo exigir entrega real

- [ ] Manter `EMAIL_DELIVERY_ENABLED=false` apenas para o primeiro smoke test
  local; nesse estado, recuperação de senha por e-mail e entrega real de
  solicitações não ficam comprovadas.
- [ ] Para testar entrega, configurar `EMAIL_DELIVERY_ENABLED=true`, uma
  `RESEND_API_KEY` válida, remetente/domínio autorizado e destinatários de
  suporte; verificar recebimento sem registrar tokens nos logs.
- [ ] Se `DOCUMENT_REVIEW_PROVIDER=openai` ou inteligência de pedágio for
  habilitada, usar suas credenciais próprias documentadas; não reaproveitar as
  chaves individuais dos agentes.

Depois, parar a API atual com `Ctrl+C`, configurar `WHATSAPP_ENABLED=true`,
reexecutar o bootstrap e iniciar novamente a API:

```powershell
Set-Location 'C:\novos projetos\tks-lume\lume-tenant-api-route-planner'
npm.cmd run tenant:bootstrap
npm.cmd run start:dev
```

- [ ] Criar ou reconciliar o canal na tela de canais.
- [ ] Ler o QR e confirmar estado conectado.
- [ ] Confirmar que o webhook usa o `channelId` correto e o segredo esperado.

## 8. Casos reais obrigatórios

### Banco, autenticação e autorização

- [ ] Reiniciar API/Web e confirmar que empresa, usuários e configurações
  persistem.
- [ ] Login, refresh e logout reais.
- [ ] Primeiro acesso, recuperação e troca de senha.
- [ ] Contas `active`, `inactive` e `suspended` se comportam corretamente.
- [ ] Administrador enxerga áreas restritas; usuário limitado não enxerga e
  recebe `403`/redirecionamento seguro ao tentar acesso direto.
- [ ] Criar usuários reais não administradores para Comercial, TI e revisão de
  Knowledge, além de uma conta deliberadamente limitada; não usar contas
  simuladas para validar a matriz de autorização.
- [ ] Validar cada permissão `service:view/respond/assume/transfer/priority/close`
  removendo uma por vez.
- [ ] Criar também contas com apenas `service:*`, apenas
  `whatsapp-conversations:view/manage` e com ambos. Registrar o desalinhamento
  atual entre Web/Service Sessions e endpoints legados e não aprovar a matriz
  até o contrato convergir ou a compatibilidade ficar explícita e testada.

### Cadastro e conciliação

- [ ] Criar, editar e consultar PF/PJ com nomes normalizados para capitalização
  de apresentação e situação traduzida (`Ativo`/`Inativo`).
- [ ] CPF e CNPJ exibem máscara sem alterar a normalização persistida.
- [ ] Promover uma sugestão cria um único cadastro, retorna sucesso e não mostra
  toast de erro depois de a operação ter sido concluída.
- [ ] Repetir uma requisição/duplo clique não duplica o cadastro e produz
  resposta idempotente/coerente.
- [ ] Filtros de Cadastros, Conciliação, Revisões, WhatsApp, Contatos,
  Orçamentos, Agentes, Knowledge e Usuários são dinâmicos, com debounce quando
  necessário e sem depender de botão “Filtrar”.
- [ ] Limpar filtro, voltar/avançar e alterar critérios rapidamente não deixam
  resposta antiga sobrescrever a nova nem causam rajada desnecessária de
  requisições.
- [ ] A área de filtros possui título claro.
- [ ] Em Conciliação, `Clientes PDF`, `Contatos WhatsApp` e `Trilha de decisões`
  aparecem como abas separadas somente para administradores.
- [ ] Telefones/WhatsApp permanecem alinhados e dentro do layout.
- [ ] “Abrir conversa” abre modal somente leitura, sem nova aba/reload, com
  pesquisa funcional e sem possibilidade de enviar mensagem.
- [ ] Evidências usam texto humano e explicam a sugestão; não exibem códigos
  como `TELEFONE_EXATO` nem `Score` cru sem contexto.

### WhatsApp e atendimento humano

- [ ] Conectar canal existente e criar novo canal por QR.
- [ ] Desconectar, reconectar, cancelar tentativa e desabilitar conforme as
  permissões.
- [ ] Receber mensagem real e confirmar persistência antes da automação.
- [ ] Reentregar o mesmo webhook e confirmar ausência de duplicação.
- [ ] Enviar texto e mídia e confirmar ACK/estado final da Evolution.
- [ ] Mensagem enviada pelo WhatsApp App/Web (`fromMe`) aparece no histórico sem
  disparar IA.
- [ ] Grupo é persistido, mas não cria sessão nem recebe resposta automática.
- [ ] Assumir atendimento, responder, transferir, alterar prioridade, retornar
  para IA e fechar.
- [ ] Validar atendimento externo (`EXTERNAL_HUMAN`) e ausência de concorrência
  entre humano e IA.
- [ ] Validar continuidade (`CONTINUAR`), novo assunto e caso incerto entre
  sessões.
- [ ] Simular timeout/erro da Evolution e confirmar retry/outbox sem falso
  sucesso nem envio duplicado.

### Agentes e OpenAI

- [ ] Orquestrador classifica sem falar diretamente com o cliente.
- [ ] Atendimento responde com identidade institucional única.
- [ ] Especialistas de Cadastro e Knowledge atuam silenciosamente.
- [ ] Mídia e Continuidade usam o agente e a chave correspondentes.
- [ ] Supervisor permanece interno e sem poderes administrativos indevidos.
  Atualmente não existe gatilho de execução; validar apenas catálogo/segredo e
  manter o item de execução bloqueado até existir um caminho interno legítimo e
  auditado.
- [ ] Tools são reautorizadas pelo servidor e negadas quando não permitidas.
- [ ] Trocar/revogar uma única chave afeta somente o agente correspondente; não
  ocorre fallback para chave de outro agente.
- [ ] Validar 401, 429, timeout e resposta inválida sem expor segredo ou mostrar
  falso sucesso.
- [ ] Confirmar `store=false` nas chamadas do adapter atual e ausência de
  tools externas não autorizadas.

### Knowledge e multimodal

- [ ] Upload de PDF textual, criação de versão, revisão e publicação humana.
- [ ] Documento apenas imagem informa claramente que OCR não está disponível.
- [ ] Conhecimento interno orienta sem ser copiado ao cliente.
- [ ] Lacuna e sugestão ficam pendentes; nada é publicado/aprendido
  automaticamente.
- [ ] Original baixado possui tamanho e SHA-256 esperados.
- [ ] Reiniciar a API e confirmar persistência de originais e metadados.
- [ ] Testar imagem, áudio e documento; vídeo não deve ser interpretado nesta
  etapa.
- [ ] Confirmar provenance por mensagem/página/chunk e confiança registrada.

### Interface, densidade e acessibilidade

- [ ] Dashboard, Profile, Support, Documents/Document Management, Cadastros
  (lista/novo/detalhe/edição), Conciliação, Revisões, WhatsApp, Canais, Agentes,
  Knowledge, Customer Context, Contatos, Orçamentos, Rotas, Usuários e Licença
  abrem com dados reais e estados de loading, vazio, erro e sem permissão.
- [ ] Cards usam densidade compatível com o conteúdo e não desperdiçam altura
  em todas as rotas, dialogs, menus e tabelas; medir também a quantidade de
  informação útil visível acima da dobra.
- [ ] Cadastro, Conciliação/detalhe, Revisões, Canais, Agentes, Knowledge,
  Usuários, Contatos e Orçamentos não possuem scroll horizontal em estados
  normal, vazio, carregando e erro.
- [ ] Painel WhatsApp mantém três regiões úteis em `1920×1080`, `1366×768` e
  `1280×720`, sem scroll horizontal.
- [ ] Testar os dois lados dos breakpoints: larguras `767/768`, `1023/1024` e
  `1279/1280`, além de `390×844`, `360×800` e um mobile em landscape; registrar
  se o teste foi emulado ou feito em aparelho físico.
- [ ] Testar temas claro/escuro, zoom de 200%, teclado, foco visível,
  `Tab`/`Shift+Tab`/`Enter`/`Escape`, nomes acessíveis e associação
  `label`/campo.
- [ ] Em modal/drawer, validar focus trap, foco inicial, fechamento por
  `Escape`, retorno ao gatilho e anúncio de erros; executar ao menos uma jornada
  com Narrador ou NVDA e conferir contraste nos dois temas.
- [ ] Testar Chrome/Edge e Firefox para cobrir ao menos dois engines nesta
  máquina; Safari/WebKit permanece limitação externa.
- [ ] Console sem exceções/hydration errors e Network sem segredos. O navegador
  não deve chamar `localhost:3333`, Evolution ou OpenAI diretamente: as chamadas
  funcionais passam pelo BFF/Server Actions em `localhost:3000`; tokens não
  aparecem em Network, Local Storage ou Session Storage e os cookies sensíveis
  são `HttpOnly`.
- [ ] Em Rotas, validar separadamente cálculo autoritativo e carregamento do
  `MAP_STYLE_URL`, tiles, sprites e fontes; registrar falhas de rede/CORS sem
  confundir mapa vazio com falha de roteirização.
- [ ] Recarregar e abrir nova aba preserva tema e sessão conforme esperado;
  logout invalida cookies, refresh automático funciona e nenhum dado do usuário
  anterior permanece após login de outra conta.

### Falhas e concorrência

- [ ] API desligada/timeout produz mensagem segura e nenhuma confirmação falsa.
- [ ] Validar `401`, refresh expirado, `403`, `409` por versão, `423` e `5xx`.
- [ ] Duplo clique/reload/retry não duplica cadastro, mensagem, sessão, revisão
  ou publicação.
- [ ] Dois usuários atualizando a mesma conversa recebem conflito controlado.
- [ ] Voltar/avançar/recarregar preserva somente o estado esperado.

## 9. Validações automatizadas antes da aprovação

Executar após corrigir o bloqueio do catálogo e qualquer ajuste de ambiente:

```powershell
Set-Location 'C:\novos projetos\tks-lume\lume-tenant-api-route-planner'
npm.cmd run prisma:validate
npm.cmd run prisma:generate
npm.cmd run format:check
npm.cmd run lint
npm.cmd run test
npm.cmd run build
git diff --check

Set-Location 'C:\novos projetos\tks-lume\lume-tenant-web-route-planner'
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test -- --runInBand
npm.cmd run build
git diff --check
```

- [ ] Todas as suítes, lint, typecheck e builds passam depois da configuração.
- [ ] Criar o banco `lume_tenant_test` antes de `npm.cmd run test:e2e`.
- [ ] Antes do E2E, conferir manualmente que o destino é **exatamente** o banco
  descartável local abaixo — nunca staging, produção nem o banco do teste
  manual:

```dotenv
TEST_DATABASE_URL=postgresql://lume:lume@127.0.0.1:5433/lume_tenant_test?schema=public
```

- [ ] Reconhecer a única exceção deliberada à regra de não resetar: a suíte
  `test:e2e` executa internamente `prisma migrate reset --force` e apagará todo
  o conteúdo de `lume_tenant_test`. A guarda do código aceita nomes que apenas
  contenham “test”; este checklist exige a URL exata acima para reduzir o risco.
- [ ] Corrigir a fixture E2E atual: ela habilita WhatsApp, mas não fornece as
  sete variáveis individuais exigidas pelo novo schema. Usar segredos sintéticos
  distintos apenas dentro do teste que não chama providers reais.
- [ ] Executar `npm.cmd run test:e2e` contra PostgreSQL/PostGIS descartável e
  não contra o banco manual/staging.

## 10. Explicação das limitações registradas

“Não executado” significa **não comprovado em ambiente real**; não significa
automaticamente que o código não exista.

| Registro | Significado prático | Prova ainda necessária |
| --- | --- | --- |
| Migrations não executadas em PostgreSQL real | O SQL foi validado de forma local/compatível, mas não enfrentou o motor, extensões, volume e dados legados reais. | Aplicar em cópia real, medir tempo/locks, conferir constraints, índices, backfills e reconciliação. |
| Evolution não chamada de verdade | Clientes, webhooks e regras foram testados com mocks; rede, versão do provider, QR e eventos reais não foram exercitados. | Instância pareada, inbound/outbound/mídia/retry/reconnect reais. |
| OpenAI não chamada de verdade | Contratos e isolamento foram testados sem consumir a API externa. | Sete chaves configuradas e distintas; chamadas reais dos agentes executáveis, modelos/custo/quota/latência/falhas; para o Supervisor, primeiro é necessário um gatilho interno legítimo. |
| Knowledge/storage real não validado | Código de filesystem foi testado, mas não há prova operacional do diretório escolhido. | Upload, reinício, permissões, backup e restauração no caminho real. |
| Sem deploy/commit/merge/push | As alterações mais recentes permanecem apenas no working tree local e não estão comprovadas em staging. | Commit revisado, integração da branch, push, deploy e smoke test — somente quando isso for solicitado/autorizado. |
| Sem matriz completa de dispositivos/navegadores | Houve inspeção parcial, não cobertura representativa. | Executar a matriz da seção 8 com dados e autenticação reais. |

## 11. Explicação e tratamento dos riscos

| Risco | O que realmente quer dizer | Tratamento |
| --- | --- | --- |
| Cinco advisories de produção na API | O `npm audit --omit=dev` identificou, no momento da auditoria, três alertas altos na cadeia Prisma/deepmerge e dois moderados em ExcelJS/uuid. Isso não prova invasão nem cinco falhas diretamente exploráveis no Lume; severidade e alcançabilidade são coisas diferentes. | Registrar o audit, avaliar se a rota vulnerável recebe entrada não confiável, acompanhar versões corrigidas e testar atualização. Não usar `npm audit fix --force` cegamente: a sugestão atual envolve downgrades major com risco de regressão. |
| Web com zero advisories reportados | O audit não encontrou advisory de produção conhecido naquele lockfile naquele momento. Não é garantia de segurança absoluta. | Repetir audit no pipeline, manter dependências e revisar entradas/autorização. |
| Backfills e dual-write em volume real | Atualizar dados antigos e gravar estruturas legada/nova pode encontrar anomalias, locks, timeout ou divergência que mocks pequenos não mostram. | Backup, ensaio em cópia, contagens antes/depois, amostragem, métricas de divergência e janela de rollback. |
| Rollback não ensaiado | Existe orientação, mas ainda não foi demonstrado que banco e arquivos voltam juntos e dentro do tempo aceitável. | Ensaiar deploy e restauração em staging, medir RTO/RPO e validar a versão anterior após o restore. |
| Sete credenciais | Uma chave por agente melhora isolamento, mas amplia provisionamento, rotação e monitoramento. | Secret manager ou `.env` local ignorado, owners definidos, quota/alertas, rotação individual, teste de revogação e varredura de logs/UI. |

## 12. Evidências e critério de aprovação

Para cada falha, registrar horário, usuário/permissões, URL/ação, correlation ID,
status HTTP, trecho de log sem segredo e captura quando útil.

### Ensaio de restauração sem tocar no banco ativo

- [ ] Parar temporariamente API/Evolution ou colocar os writers em modo seguro,
  registrar o instante de corte e capturar no mesmo ponto lógico o dump e os
  snapshots de mídias, imports e Knowledge.
- [ ] Criar um banco novo e único; nunca restaurar por cima de `lume_tenant`:

```powershell
$hostBackupPath = 'C:\novos projetos\tks-lume\local-data\backups\lume-before-test-YYYYMMDD-HHMMSS.dump'
if (-not (Test-Path -LiteralPath $hostBackupPath)) { throw 'Selecione um dump validado existente.' }
$restoreStamp = Get-Date -Format 'yyyyMMddHHmmss'
$restoreDatabase = "lume_restore_test_$restoreStamp"
$restoreContainerDump = "/tmp/$restoreDatabase.dump"
docker exec lume-tenant-postgres createdb -U lume $restoreDatabase
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível criar o banco descartável de restore.' }
docker cp $hostBackupPath "lume-tenant-postgres:$restoreContainerDump"
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível copiar o dump para o container.' }
docker exec lume-tenant-postgres pg_restore -U lume -d $restoreDatabase --no-owner --no-privileges $restoreContainerDump
if ($LASTEXITCODE -ne 0) { throw 'O restore do banco descartável falhou.' }
docker exec lume-tenant-postgres rm -- $restoreContainerDump
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível remover apenas o dump temporário do restore.' }
```

- [ ] Restaurar os três snapshots em **novos** diretórios isolados, comparar
  hashes/contagens e não apontar o teste para os diretórios ativos.
- [ ] Em um novo terminal, iniciar uma API de verificação na porta `3334`
  apontando para o banco/diretórios restaurados, com
  `WHATSAPP_ENABLED=false` e `EMAIL_DELIVERY_ENABLED=false`, impedindo qualquer
  envio externo ou consumo de outbox.
- [ ] Validar readiness na porta `3334`, login, contagens essenciais, abertura
  de mídias e download dos originais Knowledge; comparar amostras e hashes com
  o ponto de backup.
- [ ] Registrar duração do backup e do restore, perda máxima observada (RPO),
  tempo até o serviço validado (RTO) e encerrar a API de restauração.
- [ ] Preservar o banco/diretórios descartáveis até a revisão das evidências;
  qualquer limpeza posterior deve ter alvo absoluto conferido e autorização
  operacional própria.

O teste real só pode ser aprovado quando:

- [ ] núcleo PostGIS + API + Web passa com autenticação e persistência reais;
- [ ] bloqueio do catálogo de agentes foi corrigido e há sete agentes/runtimes;
- [ ] fluxo Evolution/WhatsApp foi provado nas duas direções;
- [ ] sete configurações/credenciais estão isoladas; todos os agentes com
  caminho executável foram chamados sem vazamento, e o Supervisor só é marcado
  como executado após possuir um gatilho interno legítimo;
- [ ] storage e restauração foram validados;
- [ ] regressão funcional, permissões, concorrência e matriz visual passaram;
- [ ] não existem erros P0/P1 abertos nem falso sucesso na interface;
- [ ] advisories e riscos residuais possuem decisão registrada.

## 13. Encerramento seguro

- [ ] Encerrar Web e API com `Ctrl+C`.
- [ ] Para parar o banco preservando dados:

```powershell
Set-Location 'C:\novos projetos\tks-lume\lume-tenant-api-route-planner'
docker compose stop
```

- [ ] Confirmar que `.env`, `.env.local`, dumps e diretórios de storage não
  aparecem no Git.
- [ ] Não executar `docker compose down -v` após o teste.
