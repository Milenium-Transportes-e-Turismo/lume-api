# Identificação e Cadastro pela conversa

Esta fatia usa os modelos persistentes `WhatsAppContact`,
`ConversationParticipant`, `RoutingCompany` (Cadastro),
`RegistrationRelationship` e `RegistrationDataReview`. Ela não cria um segundo
domínio de clientes e não transforma vínculo em autorização.

## Ordem antes da resposta do agente

No runtime `RunAgentExecutionUseCase`, a ordem é:

1. localizar a sessão e o `WhatsAppContact` do tenant;
2. resolver o participante a partir do contexto confirmado e dos telefones de
   Cadastro;
3. carregar a configuração do agente;
4. autorizar functions no catálogo server-side;
5. criar a execução e chamar o modelo.

Um telefone ligado de forma direta e inequívoca pode resolver um Cadastro. Um
telefone compartilhado não escolhe uma pessoa arbitrariamente: a resolução
retorna `ambiguous` e fornece ao modelo somente uma instrução genérica para
pedir os dados mínimos. Nomes, documentos e valores armazenados não entram
nesse contexto.

## Draft e confirmação

O draft é um `ServiceCase` aberto, ligado à sessão, com versão otimista. Nenhum
`RoutingCompany` é criado durante início, coleta ou preview. O preview valida o
draft e mostra somente os valores fornecidos pelo cliente na conversa.

A confirmação exige `customerConfirmedFinalSummary=true` e ocorre em uma única
transação. Ela reutiliza CPF/CNPJ já existentes no tenant, cria PF e, no fluxo
empresarial, PJ e `RegistrationRelationship`. Um relacionamento registra o
vínculo e nunca concede permissão. Divergências de PF pedem decisão explícita
`replace` ou `keep-existing`; a alteração só acontece dentro da confirmação.
Divergência de razão social de uma PJ existente cria uma
`RegistrationDataReview` pendente sem alterar o Cadastro.

Abandono ou recusa cancela o draft, substitui o payload por hash e metadados
sem PII e retorna `continueOriginalDemand=true`. Portanto cadastro não é
pré-requisito para orçamento.

## Functions executáveis do agente

O especialista de cadastro recebe somente as functions materializadas pelo
catálogo da plataforma:

- `registration.draft.start`: inicia draft `personal` ou `company`, sem criar
  Cadastro;
- `registration.draft.patch`: recebe `draftId`, `expectedDraftVersion` e uma
  lista sem campos duplicados de operações `set`/`clear` sobre campos
  permitidos;
- `registration.read`: resolve a identidade segura da sessão ou retorna apenas
  estado/campos presentes e ausentes de um draft, nunca seus valores;
- `registration.update`: confirma o draft versionado somente com
  `customerConfirmedFinalSummary=true` e uma mensagem inbound afirmativa do
  mesmo contato/sessão, posterior à última alteração do draft;
- `registration.draft.abandon`: exige mensagem inbound explícita de
  recusa/desistência e chama o cancelamento que scrubba o draft sem persistir
  Registration incompleta.

Tenant, sessão, contato e `AgentExecution` nunca são argumentos da function:
são derivados e revalidados no servidor imediatamente antes da mutação. Um
`confirmationToken` não existe. Toda chamada é registrada em `AgentToolCall`
como `REQUESTED`, `ALLOWED`/`DENIED` e `SUCCEEDED`/`FAILED`; auditoria e resultado
persistido contêm hash/estado limitado, não argumentos, PII ou mensagens de
erro internas. O `commandId` determinístico torna replays seguros e todas as
mutações continuam usando a idempotência e a versão otimista do repositório de
cadastro.

Após as functions terminarem, o runtime faz uma única segunda chamada ao mesmo
agente, runtime, modelo e credencial com `tools=[]`. Os resultados limitados são
marcados como dados não confiáveis, `store=false` continua obrigatório e não se
usa `previous_response_id`. Falha ou negação da tool encerra a execução sem
fallback de runtime, pois uma mutação pode já ter ocorrido idempotentemente.

`ensurePlatformAgentCatalog` atualiza definitions, schemas e vínculos de forma
idempotente. A migration `20260829000200_seed_platform_agent_catalog` já semeia
as seis definitions e os vínculos iniciais; o bootstrap continua sendo a
reconciliação idempotente para tenants já provisionados.

## APIs

As rotas de conversa são internas e exigem a identidade de serviço já usada
pela automação:

- `POST /internal/registration-conversations/sessions/:sessionId/identity-resolution`
- `POST /internal/registration-conversations/sessions/:sessionId/drafts`
- `PATCH /internal/registration-conversations/sessions/:sessionId/drafts/:draftId`
- `POST /internal/registration-conversations/sessions/:sessionId/drafts/:draftId/preview`
- `POST /internal/registration-conversations/sessions/:sessionId/drafts/:draftId/confirm`
- `POST /internal/registration-conversations/sessions/:sessionId/abandon`

Toda mutação recebe UUID `commandId`; alterações de draft também recebem
`expectedDraftVersion`. O tenant vem da identidade de serviço e o repositório
confere sessão, contato e execução do agente antes da operação.

Revisões humanas usam autenticação de usuário e `clients:manage`:

- `GET /registration-data-reviews?status=pending|approved|rejected`
- `POST /registration-data-reviews/:reviewId/decision`

Rejeição exige motivo. Aprovação compara a versão do Cadastro gravada no
snapshot da revisão, aplica apenas campos suportados, mantém a versão otimista
e persiste histórico, responsável, instante e decisão. Não existe endpoint de
delete para revisão.

## Integração com a automação

A precedência de identificação e as functions acima estão conectadas ao runtime
de `AgentExecution` usado pelo `PlatformWhatsAppConversationAgent`. A automação
do WhatsApp passa por esse adapter antes da resposta customer-facing; as rotas
internas permanecem disponíveis para operação controlada sem dar ao n8n acesso
direto ao banco.
