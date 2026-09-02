# Serviços comerciais confirmados

Esta fatia separa de forma autoritativa **Aceite**, **Atestes das áreas** e
**Confirmação**. Um orçamento `approved` registra a concordância do cliente,
mas não cria Serviço Confirmado nem Viagem automaticamente.

## Contratos disponíveis

O serviço singular do orçamento legado passa por três comandos distintos:

1. `POST /api/v1/commercial/quote-requests/:id/financial-attestation`, por um
   usuário ativo do Financeiro com `financial:approve` ou por autoridade ampla;
2. `POST /api/v1/commercial/quote-requests/:id/operational-attestation`, por um
   usuário ativo do Operacional com `operations:manage` ou por autoridade
   ampla;
3. `POST /api/v1/commercial/quote-requests/:id/confirmed-services`, por um
   usuário ativo do Comercial com `commercial:manage` ou por autoridade ampla.

Neste contexto, autoridade ampla significa o Administrador da Instalação ou um
integrante da Diretoria que recebeu `tenant:manage` individualmente. A Gerência
não entra nessa categoria e continua limitada às capacidades estreitas que lhe
forem atribuídas.

Uma exceção usa
`POST /api/v1/commercial/quote-requests/:id/requirements/:requirement/not-applicable`
com motivo, evidência, `commandId` e versão esperada. Gerência depende da
capacidade estreita `service-confirmations:approve`; Diretoria depende de
`directorate` com `tenant:manage` atribuída individualmente; e o Administrador
da Instalação possui autoridade total.

Cada comando exige `commandId`, a versão atual do orçamento aceito e evidência
ou fundamento textual. Ator, tenant e permissão são recarregados dentro da
transação. A confirmação final só é persistida quando os dois atestes pertencem
ao mesmo tenant, orçamento, versão e item.

Para usuários comuns, as etapas ordinárias continuam segregadas entre
Comercial, Financeiro e Operacional. O Administrador da Instalação e a
Diretoria com `tenant:manage` também podem executar esses atos de negócio; cada
ação preserva o ator real na auditoria. A Gerência com
`service-confirmations:approve` pode decidir a exceção, mas essa capacidade não
lhe concede atestar ou confirmar o serviço. A consulta
`GET /api/v1/commercial/quote-requests/:id/confirmed-service-readiness` permite
recuperar os atestes, inclusive seu resultado, e o identificador do Serviço
Confirmado depois de recarregar a tela.

## Exceções controladas

`not-applicable` é uma decisão humana de exceção, e não ausência de ateste. O
registro preserva requisito, motivo, evidência, ator, versão e histórico. A
Gerência não recebe autoridade ampla: somente a capacidade estreita publicada
para esse processo permite a dispensa. Pertencer à Diretoria sem
`tenant:manage` também não autoriza a operação.

Depois que existe Serviço Confirmado, a API recusa classificar o orçamento como
`acceptance-cancelled`. O cancelamento pós-confirmação precisa de fluxo próprio
para efeitos financeiros, operacionais e documentais. Até esse fluxo existir,
a API falha fechada em vez de apagar a etapa alcançada ou permitir nova Viagem
a partir de um orçamento que deixou de ser elegível.

## Compatibilidade do orçamento legado

O `QuoteRequest` atual descreve um único serviço. Ele é preservado com
`sourceItemKey=legacy-primary` e snapshot imutável da versão aceita. Orçamento
com vários itens versionados continua sendo uma lacuna explícita; esta API não
finge representar sábado e domingo como um único serviço.

Cada confirmação preserva origem, versão, os dois atestes imutáveis,
proveniência, ator, data, `companyId` e `version=1`. Unicidades e transação
serializável protegem concorrência e replay. Repetir o mesmo `commandId` com o
mesmo payload devolve o resultado persistido; reutilizá-lo com outros dados
gera conflito.

O identificador confirmado pode ser usado em `POST /api/v1/trips`. A criação é
manual, bloqueia e revalida o Serviço Confirmado, exige sua versão e usa a data
de saída confirmada. A confirmação não reserva veículo e não produz efeitos
financeiros ou documentais automaticamente.
