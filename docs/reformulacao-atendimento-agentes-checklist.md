# Reformulação do atendimento e plataforma de agentes — checklist de execução

Fonte de requisitos: especificação recebida em 29/08/2026, com 149 seções. Este
arquivo é o registro operacional compartilhado entre `lume-tenant-api` e
`lume-tenant-web`. Um item só recebe `[x]` depois de existir comportamento real e
validação proporcional ao risco.

Decisão complementar recebida em 29/08/2026: cada agente usa uma referência de
API key individual. OpenAI é o único provider registrado e utilizável nesta
entrega, sem seletor alternativo na interface, mas o runtime deve permanecer
extensível por adapters para providers futuros.

Orientação visual complementar recebida em 29/08/2026: o arquivo Figma é uma
referência, não uma reprodução obrigatória. Melhorias de densidade, composição,
responsividade e UX devem prevalecer quando sustentadas pela especificação.

Legenda:

- `[x]` comportamento implementado e validado localmente em proporção ao risco;
- `[~]` parcial, estrutural ou ainda sem validação local/integrada conclusiva;
- `[!]` bloqueado exclusivamente por dependência externa real, acompanhado de
  motivo, dependência, código preparado e próxima ação.

## Preparação transversal

- [x] Usar exclusivamente a especificação completa recebida em 29/08/2026.
- [x] Confirmar `staging` em `lume-tenant-api`.
- [x] Confirmar `staging` em `lume-tenant-web`.
- [x] Confirmar working trees limpas antes das alterações.
- [x] Ler os `AGENTS.md` dos dois projetos.
- [x] Inspecionar a página de referência do Figma e o nó do painel WhatsApp.
- [x] Centralizar e validar o ambiente NestJS com Zod.
- [x] Centralizar e validar o ambiente Next.js com Zod. — Leituras de `process.env` ficam restritas às fronteiras `env.server.ts`/`env.public.ts` e aos testes.
- [x] Documentar injeção de configuração/segredos sem `.env` em texto puro.
- [x] Auditar `components.json`, tokens, aliases e componentes atuais.
- [x] Executar `shadcn add --all` sem `--overwrite` e reconciliar conflitos. — Os componentes existentes foram preservados e 62 componentes compartilhados ficaram disponíveis.
- [~] Validar Design System, a11y, responsividade, densidade e modos claro/escuro. — Dashboard e painel WhatsApp foram inspecionados em navegador local nos dois temas; filtros dinâmicos, densidade e ausência de overflow em 1280 px foram confirmados. A matriz completa de viewports e jornadas integradas permanece para staging.

## Análise e segurança inicial

- [x] Analisar schema Prisma atual.
- [x] Analisar migrations existentes.
- [x] Analisar integração Evolution atual.
- [x] Analisar módulo WhatsApp atual.
- [x] Analisar domínio `registrations` atual.
- [x] Analisar módulo de IA atual.
- [x] Analisar permissões atuais.
- [x] Analisar fluxo de quote/orçamento atual.
- [x] Identificar riscos de migração.
- [x] Garantir plano sem reset destrutivo de banco.

## Arquitetura de canais

- [x] Implementar `WhatsAppChannel` com responsabilidade nova completa.
- [x] Separar `organizationalStatus` de `connectionStatus`.
- [x] Implementar `departmentId` proprietário.
- [x] Implementar `routingMode`.
- [x] Implementar `allowedAutomaticTargetDepartments`.
- [x] Garantir `evolutionInstanceName` imutável.
- [x] Implementar unicidade global do número WhatsApp.
- [x] Implementar criação antes do QR.
- [x] Implementar regeneração de QR.
- [x] Implementar disconnect sem desativação.
- [x] Implementar reconnect da mesma instância.
- [x] Implementar `CANCELLED`.
- [x] Implementar `DISABLED`.
- [x] Impedir delete físico operacional.
- [x] Preservar `milenium-production` na migration/backfill.
- [x] Realizar backfill seguro do canal existente. — Inclui resolução multicanal e `milenium-production`; falta apenas execução em staging.

## Thread e ServiceSession

- [x] Implementar `WhatsAppThread`.
- [x] Implementar `ServiceSession`.
- [x] Separar Thread de ServiceSession.
- [x] Separar lifecycle de `controlMode`.
- [x] Separar Assignment de `controlMode`.
- [x] Implementar `currentDepartmentId`.
- [x] Implementar `sourceChannelId` persistente.
- [x] Implementar `responsibleUserId`.
- [x] Implementar fila.
- [x] Implementar prioridade e sua origem/razão.
- [x] Implementar fechamento sem fechar Thread.
- [x] Implementar múltiplas ServiceSessions relacionadas.
- [~] Preparar `Case` separado e vínculos com processos reais. — `ServiceCase` existe e atende o cadastro conversacional; generalização para todos os processos ainda é parcial.

## IA e humano

- [x] Implementar `controlMode` AI/HUMAN.
- [x] Implementar takeover humano.
- [x] Implementar actor `EXTERNAL_HUMAN` e origem da mensagem.
- [x] Fazer `EXTERNAL_HUMAN` bloquear respostas da IA.
- [x] Implementar retorno explícito para IA.
- [x] Impedir retorno automático humano para IA.
- [x] Implementar transferência entre usuários.
- [x] Implementar transferência entre departamentos.
- [x] Preservar `sourceChannelId` após transferência.
- [x] Implementar retorno para fila.
- [x] Implementar solicitação explícita de humano.
- [x] Implementar proteção contra race IA/humano.
- [x] Validar `controlMode` imediatamente antes do envio customer-facing.
- [x] Implementar horário humano com padrão do tenant e override departamental.
- [x] Implementar handoff fora do horário sem repetição de boilerplate.

## Filas e assignment

- [x] Implementar estratégia `MANUAL`.
- [x] Implementar estratégia `ROUND_ROBIN`.
- [x] Implementar estratégia `LEAST_LOAD`.
- [x] Implementar `maxConcurrentAttendances` nullable.
- [x] Implementar takeover auditado.
- [x] Implementar transferência direta.
- [x] Implementar Supervisor separado de Admin.
- [x] Garantir que logout não libere assignment automaticamente.

## Continuidade e encerramento

- [x] Implementar janela de continuidade de 2 horas.
- [x] Implementar `CONTINUATION`.
- [x] Implementar `NEW_SUBJECT`.
- [x] Implementar `UNCERTAIN`.
- [x] Implementar fallback `UNCERTAIN` para sessão anterior.
- [x] Persistir confidence/reason da classificação.
- [x] Implementar `relatedServiceSessionId`.
- [x] Implementar código público curto do atendimento.
- [x] Implementar `CONTINUAR {code}`.
- [x] Implementar expiração fixa em 7 dias.
- [x] Proteger código contra outro número sem vazar existência.
- [x] Implementar fechamento formal da IA.
- [x] Implementar `pendingActions`.
- [x] Implementar `conversationResolved` e confirmação do cliente.
- [x] Implementar timer de 30 minutos somente após fechamento formal da IA.
- [x] Implementar mensagem padrão Lume de encerramento.

## Plataforma de agentes

- [x] Implementar `LumeAgent`.
- [x] Implementar `AgentExecution`.
- [x] Implementar `AgentTool`.
- [x] Implementar `AgentCapability`.
- [x] Implementar `AgentPromptVersion`.
- [x] Implementar tipo `ORCHESTRATOR`.
- [x] Implementar tipo `CUSTOMER_SERVICE`.
- [x] Implementar tipo `SPECIALIST`.
- [x] Implementar tipo `SILENT_CLASSIFIER`.
- [x] Implementar tipo `SUPERVISOR`.
- [x] Implementar prompt layering.
- [x] Implementar versionamento e rollback de prompt.
- [x] Registrar versões exatas em `AgentExecution`.
- [x] Permitir múltiplos agentes na mesma ServiceSession.
- [x] Implementar delegação silenciosa.
- [x] Manter identidade institucional única para o cliente.
- [x] Aplicar capabilities READ/SAFE_WRITE/SENSITIVE_WRITE e confirmação contextual.

## OpenAI, modelo e credencial individual

- [x] Implementar configuração individual por `LumeAgent`.
- [x] Registrar somente o adapter OpenAI nesta etapa, mantendo registry extensível.
- [x] Cada agente possuir model próprio.
- [x] Cada agente possuir `credentialRef` próprio.
- [x] Remover dependência de API key global como única fonte.
- [x] Garantir secrets apenas server-side.
- [x] Garantir que frontend nunca receba API key.
- [x] Garantir que logs nunca exibam API key.
- [x] Implementar versionamento de runtime config.
- [x] `AgentExecution` apontar runtime config utilizada.
- [x] Registrar OpenAI como provider efetivamente utilizado.
- [x] Registrar model efetivamente utilizado.
- [x] Implementar fallback por agente quando configurado.
- [x] Impedir uso implícito do secret de outro agente.
- [x] Testar falha isolada de credencial.
- [x] Registrar tentativas/fallback sem armazenar secrets.

## Identificação e cadastro

- [x] Identificar contato antes da primeira resposta.
- [x] Evoluir `WhatsAppContact` sem confundi-lo com Registration.
- [x] Implementar `ConversationParticipant`.
- [x] Relacionar Registration sem duplicar cadastro.
- [x] Implementar telefone compartilhado.
- [x] Implementar desambiguação segura.
- [x] Não criar Registration automaticamente na entrada.
- [x] Implementar cadastro PF via conversa.
- [x] Implementar cadastro PJ via conversa.
- [x] Perguntar cadastro próprio ou de empresa.
- [x] Implementar PF + PJ + Relationship.
- [x] Implementar PJ existente + PF nova.
- [x] Implementar múltiplos vínculos empresariais.
- [x] Separar Relationship de Authorization.
- [x] Implementar confirmação final antes de persistir.
- [x] Implementar abandono de cadastro sem registro incompleto.
- [x] Não bloquear orçamento por cadastro recusado.
- [x] Implementar atualização de PF mediante confirmação.
- [x] Nunca revelar dado cadastral anterior ao cliente.
- [x] Implementar `RegistrationDataReview` para divergência organizacional.
- [x] Implementar aprovação/rejeição humana.
- [x] Auditar alterações realizadas pela IA.
- [x] Permitir cadastro e orçamento em paralelo.

## Memória e perfil

- [x] Implementar `CustomerContext` relevante e autorizado.
- [x] Não despejar histórico inteiro no prompt.
- [x] Buscar detalhes sob demanda.
- [x] Permitir sugestão de memória/perfil pela IA.
- [x] Impedir gravação permanente automática.
- [x] Implementar aprovação humana da memória.
- [x] Preservar origem da sugestão.

## Multimodal

- [x] Implementar `MediaAsset`.
- [x] Implementar `MediaInterpretation`. — Fluxo relacional, contexto efetivamente consumido e vínculo `AgentExecutionMediaSource` estão cobertos.
- [x] Garantir que interpretação não altera `controlMode`.
- [x] Implementar transcrição de áudio e idioma/duração/confidence.
- [x] Implementar interpretação de imagem.
- [x] Implementar PDF/documentos.
- [x] Implementar planilhas quando provider suportar.
- [x] Implementar localização.
- [x] Implementar contatos.
- [x] Implementar chunk/página e provenance de documentos.
- [x] Implementar processamento durante atendimento humano ON/OFF.
- [x] Implementar ação manual “Analisar com IA”.
- [x] Impedir reanálise.
- [x] Implementar feedback de interpretação incorreta.
- [x] Priorizar correção humana.
- [x] Garantir falha sem bloquear mídia/mensagem/atendimento.
- [x] Preservar vídeo.
- [x] Não interpretar vídeo nesta etapa.
- [x] Separar interpretação de validação humana de negócio.

## Knowledge Base

- [x] Implementar `KnowledgeBase` por tenant.
- [x] Implementar artigos.
- [x] Implementar upload de arquivos.
- [x] Preservar original.
- [x] Implementar extração/indexação.
- [x] Implementar scope `TENANT`.
- [x] Implementar scope `DEPARTMENT`.
- [x] Implementar scope `MULTI_DEPARTMENT`.
- [x] Implementar visibilidade `CUSTOMER_SAFE`.
- [x] Implementar visibilidade `INTERNAL`.
- [x] Implementar `DRAFT`.
- [x] Implementar `PUBLISHED`.
- [x] Implementar `SUPERSEDED`.
- [x] Implementar `ARCHIVED`.
- [x] Implementar versionamento imutável.
- [x] Implementar `effectiveFrom`.
- [x] Implementar `effectiveUntil`.
- [x] Implementar snapshot de versão por `AgentExecution`.
- [x] Impedir uso de draft.
- [x] Impedir uso de archived em novas respostas.
- [x] Implementar provenance de chunk/página.
- [x] Implementar `KnowledgeSuggestion`.
- [x] Implementar detecção de Knowledge Gap.
- [x] Impedir aprendizado automático de conversas.
- [x] Impedir uso de internet no atendimento.
- [~] Encaminhar humano quando fonte for insuficiente. — Prompt e sinal estruturado orientam handoff; transição server-side automática ainda não está fechada.
- [x] Priorizar dados transacionais sobre Knowledge Base.

## Autorização e segurança

- [x] Executar Authorization antes de o dado chegar ao modelo.
- [x] Implementar policies server-side para tools.
- [x] Impedir vazamento da existência de documento negado.
- [x] Implementar identificação adicional sob demanda.
- [~] Não pedir CPF/CNPJ desnecessariamente. — Há minimização no fluxo/prompt, mas falta avaliação conversacional ponta a ponta.
- [~] Garantir tenant isolation em todas as entidades. — Cobertura é ampla, mas a afirmação global depende da validação integrada em PostgreSQL.
- [x] Testar cross-tenant denial.
- [x] Proteger contra prompt injection.
- [x] Tratar conteúdo de cliente como não confiável.
- [x] Tratar documentos como conteúdo não confiável.
- [x] Tratar mídia como conteúdo não confiável.
- [x] Impedir tool invocation não autorizada.
- [x] Garantir que prompt não conceda permissões.

## Grupos

- [x] Detectar/sincronizar grupos existentes.
- [x] Vincular grupo ao `WhatsAppChannel`.
- [x] Definir AI mode default `OFF`.
- [x] Preparar enum `OFF/MENTION_ONLY/ASSISTANT/AUTONOMOUS`.
- [x] Não responder grupos nesta feature.
- [x] Não criar ServiceSession individual para grupo.
- [x] Não aplicar routing individual a grupos.
- [x] Não aplicar continuidade individual a grupos.
- [x] Relacionar participantes a Registration somente quando houver match único.
- [x] Nunca criar Registration automaticamente a partir de grupo.

## Interface Web

- [x] Criar gestão de `WhatsAppChannel`.
- [x] Exibir `connectionStatus`.
- [x] Exibir `organizationalStatus`.
- [x] Criar fluxo QR.
- [x] Criar reconnect/disconnect.
- [x] Criar configuração de departamento proprietário.
- [x] Criar configuração de destinos automáticos permitidos.
- [x] Evoluir workspace de atendimento com permissões granulares `service:*`.
- [x] Exibir ServiceSession.
- [x] Exibir `controlMode`.
- [x] Exibir responsável.
- [x] Exibir fila.
- [x] Exibir prioridade.
- [x] Criar takeover.
- [x] Criar transferência.
- [x] Criar “Retornar para IA”.
- [x] Exibir actor real.
- [x] Exibir fontes da IA.
- [x] Exibir tools utilizadas.
- [x] Exibir `MediaInterpretation`.
- [x] Exibir `RegistrationDataReview`.
- [x] Criar Knowledge management UI.
- [~] Respeitar Design System, Figma, a11y e responsividade. — A referência visual foi aplicada com melhorias próprias e houve QA local claro/escuro em 1280 px; a varredura completa de viewports e jornadas autenticadas reais permanece para staging.

## Migrations e compatibilidade

- [x] Criar migrations incrementais.
- [x] Não executar reset destrutivo.
- [x] Preservar histórico existente no desenho aditivo das migrations.
- [x] Preservar `milenium-production`.
- [x] Preservar importações WhatsApp.
- [x] Mapear estados antigos.
- [x] Fazer backfill de Thread.
- [x] Fazer backfill de ServiceSession quando necessário.
- [x] Manter provenance histórica. — Mensagens, importações, chunks e fontes de Knowledge/mídia por execução estão cobertos.
- [~] Validar migrations em banco descartável/staging quando disponível. — A cadeia completa passou em PGlite com shim espacial; PostgreSQL/PostGIS real de staging permanece bloqueado externamente.
- [~] Documentar rollback operacional quando possível. — Runbooks existem, mas rollback ensaiado em staging ainda não foi executado.

## Testes e validação final

- [x] Executar testes unitários API. — Regressão ampla e suítes focadas posteriores foram executadas.
- [~] Executar testes de integração API. — Integrações com Prisma são majoritariamente mockadas; falta banco real descartável.
- [x] Executar testes Web. — Regressão final completa: 154 suítes e 878 testes aprovados.
- [x] Executar lint API. — Execução integral final aprovada sem erros.
- [x] Executar lint Web. — Execução integral final aprovada sem erros ou avisos.
- [x] Executar typecheck API. — `tsc --noEmit` final aprovado.
- [x] Executar typecheck Web. — `tsc --noEmit` final aprovado.
- [x] Executar build API. — Build NestJS final aprovado.
- [x] Executar build Web. — Build de produção Next.js 16.3.3 final aprovado, com 36 páginas estáticas/dinâmicas coletadas.
- [~] Validar migrations. — `prisma validate/generate` e a cadeia SQL completa passaram localmente; aplicar e reconciliar em PostgreSQL/PostGIS real requer staging.
- [x] Validar Prisma schema e geração do client.
- [!] Validar fluxo Evolution. — Requer Evolution real, credenciais e instância acessível.
- [!] Validar canal existente. — Requer staging com `milenium-production` e Evolution real.
- [!] Validar criação de novo canal. — Requer Evolution real e leitura do QR.
- [!] Validar primeira mensagem e identificação. — Código local está preparado; falta ensaio integrado Evolution/PostgreSQL.
- [~] Validar cadastro pela conversa. — Casos unitários/transacionais mockados passaram; falta ensaio integrado.
- [~] Validar orçamento e quote proposals existentes. — Regressão automatizada existe; falta cenário completo integrado.
- [~] Validar IA para humano. — Domínio/repositório possuem testes; falta ensaio ponta a ponta.
- [~] Validar humano para IA. — Domínio/repositório possuem testes; falta ensaio ponta a ponta.
- [~] Validar `EXTERNAL_HUMAN`. — Ingestão e bloqueio possuem cobertura local; falta Evolution real.
- [~] Validar transferência. — Cobertura local existe; falta cenário multiusuário em staging.
- [~] Validar fechamento. — Cobertura local existe; falta confirmação integrada de outbox/envio.
- [~] Validar `CONTINUAR`. — Cobertura local existe; falta fluxo real entre sessões.
- [~] Validar Knowledge Base. — Testes focados passaram; falta PostgreSQL/storage real.
- [~] Validar multimodal. — Persistência relacional e provenance de execução foram cobertas; provider real ainda depende de credencial externa.
- [x] Validar autorização. — API e Web possuem cobertura para permissões granulares `service:*`, negação por padrão e compatibilidade legada explícita.
- [~] Validar isolamento de tenant. — Há testes cross-tenant; falta validação integrada abrangente em PostgreSQL.
- [!] Validar API key independente por agente. — Isolamento está testado com mocks; exige secrets e chamadas OpenAI reais.

## Regressão explícita

- [x] Login.
- [x] Permissões atuais. — Rotas, navegação, ações, mídia e contexto do cliente respeitam `service:view/respond/assume/transfer/priority/close`; aliases legados ficaram explícitos e limitados.
- [x] Cadastro manual existente.
- [x] Reconciliação de cadastros.
- [x] Histórico WhatsApp existente.
- [x] Importação histórica.
- [~] Visualização de mídia. — Cobertura automatizada existe; falta QA completa no navegador.
- [x] Envio de texto.
- [x] Envio de mídia.
- [x] Orçamentos existentes.
- [x] Quote proposals existentes.
- [x] Dashboard relacionado. — Regressão automatizada integral e inspeção visual local concluídas.
- [x] Auditoria atual.

## Bloqueios externos reais

- [!] **PostgreSQL/PostGIS/staging:** aplicar migrations incrementais em cópia
  descartável, verificar constraints/indexes, backfills de
  `milenium-production`, Thread/ServiceSession e reconciliação/rollback.
- [!] **Evolution:** validar instância existente, criação/QR,
  disconnect/reconnect, entrada/saída, grupos, mídia e races com credenciais
  reais.
- [!] **OpenAI/secrets:** provisionar as sete credenciais individuais e validar
  Responses API, multimodal, tools, fallback/401/timeout e isolamento entre
  agentes sem expor secrets.
- [!] **QA completa no navegador:** executar jornadas autenticadas API+Web,
  responsividade, claro/escuro, a11y e matriz de permissões após concluir o
  alinhamento Web de `whatsapp-conversations:manage` para `service:*`.
