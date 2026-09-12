# Atendimento humano, sugestões internas e espera pelo cliente

A confirmação do resumo confirma a solicitação de orçamento e encaminha o
atendimento para a fila do Comercial na mesma transação. O controle passa a
humano, sem atribuir uma pessoa inexistente. O aviso ao cliente fica no outbox
somente após essa gravação; fora do expediente vale a mensagem configurada.

Novas mensagens durante o atendimento humano acionam o Classificador de
Continuidade e o Orquestrador, ambos sem resposta ao cliente e sem ferramentas.
Não existe polling de modelos em conversas sem movimento. Falha de um agente
silencioso não bloqueia a fila de mensagens do atendente.

Um pedido explícito de novo orçamento gera uma sugestão privada no painel:
“Deseja que a Milena assuma a coleta dos dados?”. A opção **Sim** muda o controle para IA,
cria um novo orçamento e agenda a coleta com o contexto do novo pedido. O
orçamento anterior mantém dados, status e histórico. A opção **Não** registra a
dispensa da sugestão e mantém o controle humano. Cliques repetidos não criam outra coleta;
versões desatualizadas retornam conflito para recarregar o painel.

Um assunto novo com departamento identificado oferece encaminhamento para a
fila desse departamento. O atendente decide. Nesta versão, não há resposta
financeira gerada sem fonte para enviar: o painel oferece o encaminhamento.
As sugestões nunca são mensagens WhatsApp e não entram no histórico do cliente.

## Inatividade

A API reconhece a espera por uma pergunta ao cliente a partir da mensagem
persistida com propósito customer-information-request. Só a última mensagem da
sessão vale: novo inbound, resposta humana ou mudança de controle invalida a
espera anterior. Após três horas do envio confirmado, a API agenda um único
lembrete contendo a pergunta pendente. Sem resposta, encerra após mais uma hora
a partir do envio confirmado desse lembrete. Falha ou atraso no envio não conta
como uma hora de espera. Reinícios mantêm essa informação no PostgreSQL.

A regra exige controle de IA e não atua sobre pendência do Comercial, de outro
usuário, documentos ainda não enviados ou demais ações pendentes. A despedida
com resolução declarada conclui sem perguntar novamente se precisa de algo.
“Ok” e “não” depois do encaminhamento não reativam a Milena nem encerram a fila
humana. O código de continuidade e o histórico continuam preservados.

Configurações opcionais: WHATSAPP_CUSTOMER_REMINDER_DELAY_MS=10800000 e
WHATSAPP_CUSTOMER_CLOSURE_DELAY_MS=3600000. As perguntas legadas de fechamento
não são convertidas retroativamente em autorização para expirar atendimento.

## Contrato do painel

GET /whatsapp/conversations/:id inclui assistantSuggestions, somente no detalhe
autorizado do atendimento. Cada sugestão contém id, serviceSessionId, kind,
question, targetDepartment e createdAt. A decisão usa
POST /whatsapp/conversations/:id/assistant-suggestions/:suggestionId/resolve com
commandId, expectedVersion (conversa), expectedSessionVersion e decision
(accept ou dismiss). A API revalida tenant, usuário ativo, área, capacidade e
estado durável. Aceitar exige service:transfer; dispensar, service:respond.

A migração `20260911000100_whatsapp_customer_wait_window` substitui a janela fixa de 30 minutos do banco por uma janela não negativa. Sessões antigas continuam válidas e não são encerradas retroativamente pela nova política.

## Coerência do encaminhamento automático

Durante o controle de IA, um anúncio afirmativo de encaminhamento na resposta
não pode ser tratado como conclusão. A API converte essa contradição em handoff,
solicita ao Orquestrador um departamento válido quando ele não foi informado e
reutiliza a transação de encaminhamento e o outbox. Sem destino válido, não envia
o anúncio. Ofertas, perguntas e condições de encaminhamento não são autorizações.
O destino segue o assunto atual, sem usar o departamento do orçamento anterior
como fallback. Prioridade não determina departamento. As regras de aprovação
privada durante controle humano continuam obrigatórias.

## Continuidade ao iniciar outro orçamento

Um novo orçamento preserva somente o nome já informado do responsável. Datas,
locais, passageiros, modalidade ida/volta e confirmações são coletados para o
novo pedido, mantendo o histórico anterior separado. Para coletas já abertas
sem nome, o agente consulta somente contactName do orçamento anterior da mesma
conversa e tenant; não recebe os dados antigos da viagem.

A Milena reconhece a continuidade, sem se reapresentar ou pedir novamente um
nome conhecido. A primeira pergunta prioriza data ou origem ainda ausente.
A formulação é natural e contextual, sem saudação ou roteiro fixo.

## Busca de localização indisponível

Uma falha técnica da busca não prova inexistência da cidade. A API confirma a
cidade/UF com o cliente e continua a coleta após a resposta, mantendo o local
como customer-confirmed e routingValidationPending=true. Esse estado não
certifica coordenadas, distância ou viabilidade do trajeto. A pendência fica no
contexto do orçamento para conferência da equipe. A confirmação dessa pergunta
não confirma o resumo nem autoriza transferência ou criação duplicada.

A regra funciona também para sessões já presas em phase=unavailable, preserva
origem ao coletar destino e permite correções. Não muda o provedor nem usa um
endpoint antigo para contornar indisponibilidade externa.
