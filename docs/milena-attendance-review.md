# Avaliação do atendimento e revisão do prompt

Amostra: atendimento de 10/09/2026 no staging, consultado em modo somente leitura.

Das 13 respostas da IA nessa sequência, 11 usaram o nome da cliente, todas as 13 continham o mesmo emoji e 6 começaram com “Perfeito”. A cada dado recebido, várias mensagens repetiram o dado e voltaram a confirmar o contexto antes da pergunta seguinte.

O prompt ativo no agente Atendimento Lume correspondia ao texto fornecido pelo usuário. As instruções de variar confirmações, demonstrar entendimento antes de cada pergunta e incluir uma despedida obrigatória estimulavam uma estrutura repetitiva. Faltavam regras explícitas para dispensar bordões, usar o nome com parcimônia e aceitar informações opcionais ainda não definidas.

A revisão em milena-tenant-prompt.md é um texto para o campo de instruções do tenant. Ela não substitui o contrato de saída estruturada nem as regras de autorização da plataforma. É uma referência para configuração: editar o arquivo não publica instruções no agente. A versão ativa precisa ser consultada por tenant.

## Comportamento que o prompt não resolve sozinho

“Precisa de mais alguma coisa?” foi enviada pelo sistema, não pelo agente, três vezes nessa sequência. Uma ocorreu após a saudação inicial; outra após a confirmação do orçamento; e uma terceira após a cliente responder “não”. A correção dessa repetição exige revisar o disparo automático e o estado de encerramento do atendimento.

O aviso de encerramento com código para retomar também foi gerado pelo sistema. Alterar apenas a personalidade da Milena não altera esses textos.

## Critérios para conferir a revisão

- A próxima pergunta aproveita o dado recebido e não repete a frase da cliente.
- O nome não aparece em todas as mensagens e emojis não acompanham a coleta inteira.
- “Não tenho o horário” não bloqueia o orçamento nem provoca repetição da pergunta.
- Não há promessa de desconto, reserva ou transferência sem resultado do sistema.
- “Não preciso de mais nada” produz uma única despedida.
- A automação de acompanhamento é avaliada separadamente, para não atribuir ao prompt mensagens que ele não gerou.

Não foi enviada nenhuma mensagem ao contato durante esta avaliação.

Referência de revisão: [documentação oficial de prompt engineering da OpenAI](https://developers.openai.com/api/docs/guides/prompt-engineering). A proposta usa instruções específicas, exemplos compatíveis com as regras e critérios de avaliação. A melhoria no atendimento real ainda depende da avaliação da nova versão; não foi feita ativação nem teste com mensagens ao cliente.

## Evolução posterior da implementação

A amostra acima é um registro histórico de 10/09/2026, não uma descrição permanente
do runtime. As correções posteriores incluem tratamento de pendência do cliente,
transferência efetiva, assistência silenciosa e validação da coleta. Consulte
[atendimento humano](whatsapp-human-assistance.md) e
[coleta e resumo](tourism-intake-validation.md) para o comportamento atual e seus
limites. Não atribua mensagens fixas do lifecycle ao prompt de personalidade.
