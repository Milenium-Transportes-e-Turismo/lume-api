# Validação da coleta de turismo

O agente de atendimento consulta as capacidades agrupadas de TransportFleet, sempre com companyId e active=true. A maior capacidade válida é usada por veículo; na ausência de dados o padrão é 46. Capacidade cadastrada não representa disponibilidade na data. A consulta é feita a cada interação de coleta, portanto alterações na frota passam a orientar os próximos atendimentos.

Origem e destino novos passam pelo RouteLocationSearchProvider da roteirização. Sugestões, dúvidas e confirmações ficam no structuredData.lumeTourismIntake da QuoteRequest. Ausência de resultado não prova inexistência; erro do serviço pede esclarecimento, sem aceitar silenciosamente nem encerrar a conversa. A consulta envia somente o local, sem telefone ou histórico. Não há cálculo de rota, pedágio ou promessa de viabilidade nesta etapa.

O servidor impede encaminhamento automático por quantidade não confirmada, preserva candidatos fora da faixa técnica de 1 a 500 e pergunta sobre vários veículos antes de tratar um grupo como exceção. A confirmação só vale quando responde à pergunta pendente efetivamente enviada, na mesma sessão. Correções substituem o candidato; dados inválidos não são gravados nos campos canônicos. Pedidos explícitos de humano são respeitados.

Somente ida é persistido em tripType e perguntas repetidas sobre ida/volta são substituídas pelo próximo dado ausente. Mudanças explícitas continuam permitidas. O nome não é substituído por um destino.

Pedidos explícitos de novo orçamento usam a transição canônica new-quote-request, com comando idempotente, versão esperada e trilha de auditoria. O registro anterior mantém status, versão, resumo e propostas. O novo tem outra sequência e coleta vazia; intakeStartedAt delimita o histórico do novo pedido. A automação não assume conversas em atendimento humano. Conflitos durante envio de proposta continuam protegidos.

A validação usa testes unitários de regras, testes do adaptador e integração em PostgreSQL descartável. Conversas reais são consultadas apenas como evidência; nenhum teste envia mensagens a clientes.

## Correção da regressão de locais (10/09/2026)

A identidade aceita a consulta original e o rótulo canônico retornado pela roteirização. Um local já validado não é consultado novamente quando o cliente informa outro campo. UF e nome de estado são equivalentes; o sufixo Brasil não altera a identidade. A recusa de uma sugestão a descarta, sem apagar uma cidade validada. O endereço exato pode ficar a definir; apenas cidade e estado são necessários nesta etapa.

Sessões anteriores com uma sugestão indevida pendente sobre o próprio local canônico se recuperam no próximo processamento normal, mantendo o local já gravado. Não há alteração direta do histórico nem envio de mensagens por scripts. Resultados ambíguos nunca são resolvidos escolhendo a primeira rua da lista. Testes reproduzem a sequência com estado acumulado entre mensagens, além de recusas, correções e endereço indefinido.

## Qualidade do texto enviado

Palavras geradas que misturam letras latinas e outro alfabeto são conferidas antes da saída da coleta de turismo. Nomes já fornecidos pelo cliente são preservados, assim como acentos e emojis. Quando a frase contém essa corrupção, a API usa a próxima pergunta da coleta com base nos dados já validados. Um resumo malformado não é marcado como apresentado ou confirmado. Encaminhamentos explícitos preservam o destino e usam uma mensagem válida. O registro original da execução continua disponível para auditoria.

## Regressão do atendimento de 12/09/2026

A proteção da resposta em português cobre também palavras inteiras em alfabetos não fornecidos pelo cliente. Mantém nomes presentes no contexto, acentos e emojis. A regra contra repetição de ida/volta só atua em coleta, nunca sobre um resumo apresentado. Isso impede que uma confirmação do resumo seja confundida com uma pergunta repetida de modalidade e substituída por observações.

Resumos de turismo são formatados pela API a partir do orçamento corrente e do patch revisado, com uma informação por linha, rótulos em negrito do WhatsApp e confirmação separada. Datas civis são preservadas; horários informados usam America/Sao_Paulo. Tipo de viagem, vários veículos, respostas negativas e detalhes de trajeto permanecem explícitos. Não usa os dados de uma solicitação anterior nem transforma apresentação em confirmação. Testes reproduzem a resposta negativa à pergunta de observações, apresentação imediata do resumo e confirmação seguinte.

## Identidade de municípios (16/09/2026)

A busca preserva tipo, nome e estado estruturados do provedor. Na coleta de cidade, resultados do tipo locality com nome exato têm precedência sobre ruas e estabelecimentos. A UF é normalizada pelo nome completo do estado (inclusive quando o provedor abrevia Rondônia como R.). Municípios diferentes continuam exigindo esclarecimento. Após esclarecimento completo ainda inconclusivo, pede-se confirmação da cidade uma vez e mantém-se a validação técnica pendente, sem repetir a mesma pergunta nem afirmar que o mapa foi validado.

A consulta normaliza cidade e UF antes de chamar o provedor: Porto Velho RO, Porto Velho/RO e Porto Velho Rondônia viram Porto Velho, RO. Nomes de cidades que também são estados, como São Paulo, permanecem intactos.
