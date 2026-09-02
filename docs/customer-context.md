# CustomerContext e memória aprovada

O `CustomerContext` é uma visão curta, tenant-isolated e construída pela Tenant
API. Ele não é um histórico completo nem uma memória livre escrita pelo modelo.
A fonte permanente de preferências é `CustomerProfileSuggestion` com status
`APPROVED`, sempre após uma decisão humana autenticada.

## O que entra no contexto

Para uma sessão e seu contato exatos, a API resolve no máximo:

- uma identidade confirmada, sem CPF, CNPJ, telefone ou e-mail;
- cinco empresas relacionadas ativas;
- doze itens de perfil aprovados, mantendo só o mais recente por chave;
- cinco atendimentos recentes, sem conteúdo de mensagens;
- cinco orçamentos recentes com apenas dados operacionais relevantes;
- dez pendências de atendimento, orçamento ou caso.

O mesmo resumo aprovado é usado na visualização humana e no
`CustomerContextResolver` dos agentes. Detalhes são consultados por seção sob
demanda, com limite máximo de 50 itens. O contexto enviado ao modelo é JSON
escapado, marcado explicitamente como dado não confiável e limitado a 16 KiB.
Se o limite for excedido, a execução falha de forma explícita; não se trunca JSON
nem se despeja o histórico da conversa.

No fluxo do agente, a ordem é: resolver identidade, montar `CustomerContext`
aprovado, carregar runtime/configuração, autorizar functions no servidor e só
então chamar o provider. Sugestões `PENDING` ou `IGNORED` nunca entram no
contexto do modelo.

## Sugestões e decisão humana

Uma observação da IA ou de uma pessoa cria somente uma sugestão `PENDING` com
provenance de sessão, ator, execução do agente e mensagem de evidência quando
informada. O valor é normalizado e recusa credenciais e identificadores pessoais
diretos. A criação usa `commandId`, lock transacional e auditoria idempotente; o
audit guarda hashes do conteúdo, não o texto sugerido.

Somente um usuário humano ativo do mesmo tenant pode `APPROVE` ou `IGNORE`.
A decisão exige `commandId` e `expectedUpdatedAt`; grava revisor, instante e
auditoria. `IGNORE` exige motivo. Uma decisão concorrente ou stale é recusada, e
os campos de origem permanecem imutáveis no banco.

## Endpoints de usuário

Todos usam autenticação normal, `Cache-Control: private, no-store` e o tenant do
principal:

- `GET /customer-context/sessions/:serviceSessionId` — `service:view`;
- `GET /customer-context/sessions/:serviceSessionId/details?section=...` —
  `service:view`;
- `POST /customer-context/sessions/:serviceSessionId/suggestions` —
  `service:respond`, cria somente `PENDING`;
- `GET /customer-context/profile-suggestions` — `service:view`;
- `POST /customer-context/profile-suggestions/:suggestionId/decision` —
  `service:respond`, decisão humana com concorrência otimista.

As seções de detalhe são `relationships`, `profile`, `services`, `quotes` e
`pending`.

## Endpoints internos

Os endpoints sob `/internal/customer-context` exigem `ServiceIdentityGuard` e
derivam o tenant da identidade de serviço:

- `GET /internal/customer-context/sessions/:serviceSessionId`;
- `GET /internal/customer-context/sessions/:serviceSessionId/details`;
- `POST /internal/customer-context/sessions/:serviceSessionId/suggestions`.

Não existe endpoint interno para aprovar ou ignorar. A origem agente precisa
referenciar uma `AgentExecution` da mesma sessão/tenant e uma identidade de
serviço ativa do mesmo tenant.

## Function tool do agente

O catálogo da plataforma registra `customer-profile.suggest` como
`SAFE_WRITE`, exige `service:respond` e a atribui somente ao agente
`customer-service`. A function aceita chave permitida, valor, justificativa e
mensagem de evidência; sua saída só pode declarar `status: pending`.

O executor server-side reautoriza os argumentos reais, confere novamente
tenant, sessão, agente e `controlMode`, executa somente a allow-list interna e
grava `AgentToolCall` sem os argumentos nem o valor sugerido. Esta function
chama o caminho in-process `agent-runtime`: ele valida a `AgentExecution` da
mesma sessão e não inventa uma `ServiceIdentity`. A sugestão continua sempre
`PENDING`; aprovação/ignore permanecem exclusivamente humanos.

Depois de uma execução bem-sucedida, somente o resultado limitado
(`suggestionId` opaco e `status: pending`) volta ao mesmo runtime como conteúdo
não confiável. A segunda chamada usa `tools=[]`, não usa
`previous_response_id` e não pode iniciar outro loop de tools.

`ensurePlatformAgentCatalog` materializa de forma idempotente a tool e seu
vínculo durante o bootstrap do tenant. Como esta atualização não altera
migrations, tenants existentes precisam passar novamente por esse bootstrap
para receber o schema/policy vigente.
