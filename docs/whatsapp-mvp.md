# WhatsApp na Tenant API

O WhatsApp é um módulo interno da Tenant API. PostgreSQL é a fonte de verdade
para conversas, mensagens, anexos, orçamentos, histórico e atendimento. A
Evolution transporta mensagens; agentes com modelos OpenAI ajudam na coleta comercial,
mas não definem estados de domínio nem recebem acesso direto ao painel.

Consulte [whatsapp-api.md](./whatsapp-api.md) para configuração, garantias de
processamento, mídia autenticada, operação e checklist de publicação.

## Contratos principais

- `POST /api/v1/webhooks/evolution`: valida assinatura, normaliza e deduplica o
  evento antes de persistir mensagem e outbox.
- `/api/v1/whatsapp/conversations`: lista, detalha e executa comandos humanos
  autenticados e versionados.
- `GET .../messages/:messageId/content`: entrega mídia somente após validar
  empresa, permissão, conversa e mensagem.
- `/api/v1/whatsapp/quote-proposals`: mantém filas, documentos PDF e histórico
  de propostas.

## Processamento

A outbox é ordenada por conversa. A automação própria reivindica lotes usando
lease no banco, confirma o aceite antes da execução e conclui cada evento de
forma idempotente. Falhas transitórias usam backoff; tentativas esgotadas ficam
isoladas para análise. Um evento nunca é encaminhado para dois consumidores.

## Estados de atendimento

- `bot-active`: automação ativa, sem atendente atribuído;
- `sent-to-human`: aguardando um usuário assumir;
- `human-active`: exige atendente ativo e responsável correspondente;
- `waiting-for-customer`: aguarda resposta do cliente mantendo o contexto.

“Devolver ao bot” preserva o contexto comercial. “Encerrar atendimento” encerra
a sessão atual e remove a atribuição, sem retornar a um menu obrigatório. A conversa
canônica e todo o histórico são preservados para o próximo contato.

O responsável é a referência corrente, não uma trava exclusiva. Qualquer
usuário interno com `whatsapp-conversations:attend` pode atuar, substituir a
referência ou devolver a conversa ao bot; `client-company` é excluído. Na fachada legada, a
transferência entre departamentos é solicitada com destino e motivo. Até o
aceite, o atendimento permanece ativo no departamento de origem, enquanto a
pendência aparece para o destino. O aceite autorizado altera departamento e
Responsável Atual na mesma transação. Todos os comandos exigem versão esperada
e preservam ator, responsável anterior e resultado no histórico.

## Orçamentos e anexos

O envio de proposta em PDF assume o remetente como atendente, cria mensagem
pendente, tentativa e outbox na mesma transação. A Evolution recebe o conteúdo
somente pelo gateway da API. Confirmações de envio atualizam documento, proposta,
conversa e filas consultadas pelo Tenant Web.

Mídias recebidas permanecem referenciadas pelo identificador da mensagem. Quando
um usuário autorizado abre uma prévia, a API recupera o conteúdo pela Evolution,
valida MIME, tamanho e tipo e o transmite com cache desabilitado. PDFs enviados
pela aplicação são lidos diretamente do banco.

O fluxo de fila humana, sugestões privadas e espera por resposta está em
[Atendimento assistido](whatsapp-human-assistance.md).

O painel atual também consome sessões nativas e capacidades `service:*`. A
transferência nativa de sessão e a solicitação/aceite legada são contratos distintos.
Consulte [o contrato atual](whatsapp-api.md) e
[assistência e espera do cliente](whatsapp-human-assistance.md).
