# Serviços comerciais confirmados

Esta fatia separa de forma autoritativa **Aceite**, **Atestes das áreas** e
**Confirmação**. Um orçamento `approved` registra a concordância do cliente,
mas não cria Serviço Confirmado nem Viagem automaticamente.

## Contratos disponíveis

O serviço singular do orçamento legado passa por três comandos distintos:

1. `POST /api/v1/commercial/quote-requests/:id/financial-attestation`, por um
   usuário ativo do Financeiro com `financial:approve`;
2. `POST /api/v1/commercial/quote-requests/:id/operational-attestation`, por um
   usuário ativo do Operacional com `operations:manage`;
3. `POST /api/v1/commercial/quote-requests/:id/confirmed-services`, por um
   usuário ativo do Comercial com `commercial:manage`.

Cada comando exige `commandId`, a versão atual do orçamento aceito e evidência
ou fundamento textual. Ator, tenant e permissão são recarregados dentro da
transação. A confirmação final só é persistida quando os dois atestes pertencem
ao mesmo tenant, orçamento, versão e item.

Administradora da plataforma não recebe bypass de negócio nessa operação. A
consulta `GET /api/v1/commercial/quote-requests/:id/confirmed-service-readiness`
permite que Comercial, Financeiro e Operacional autorizados recuperem os
atestes e o identificador do Serviço Confirmado depois de recarregar a tela.

## Exceções que permanecem fechadas

Esta fatia registra somente requisitos efetivamente satisfeitos. Ela não
oferece `not-applicable`, porque ainda não foi definida uma capacidade estreita
que represente a aprovação de exceção pela Gerência ou Diretoria. Enquanto essa
autorização não for decidida, uma contratação que dependa de dispensa não pode
ser confirmada por este contrato; ausência de dado nunca vira pagamento ou
validação operacional.

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
