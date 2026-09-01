# Contratos disponíveis para o Tenant Web

Este quadro evita que uma lacuna parcial seja anunciada como ausência total e
que uma tela trate uma proteção local como regra autoritativa. O estado abaixo
descreve o contrato da Tenant API; mocks e controles visuais do Tenant Web não
substituem estes limites.

| Capacidade                      | Estado da API                        | Contrato utilizável pelo Web                                                                                                     | Limite atual                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Devolver atendimento ao bot     | Disponível e protegido               | `POST /api/v1/whatsapp/conversations/:id/actions/return-to-bot`                                                                  | Somente o atendente atribuído pode executar. A checagem ocorre dentro da transação. Não existe override implícito de supervisão.                                                                                                                                                                             |
| Transferir entre departamentos  | Backend disponível; rollout bloqueado | `POST .../actions/request-transfer` e `POST .../actions/accept-transfer`                                                         | A origem continua responsável até o aceite e a pendência aparece na fila do destino. Leituras e ações por ID respeitam o escopo departamental. O aceite exige departamento de destino e `whatsapp-conversations:manage`, mas o teto atual só oferece essa capacidade ao Comercial. Operacional e Financeiro puros não podem recebê-la hoje; falta decidir a matriz ou uma capacidade própria de aceite. Rejeição/cancelamento explícitos continuam pendentes. |
| Pré-admissão por link seguro    | Parcial, com gestão segura do acesso | `POST /api/v1/pre-admission/accesses`, `POST .../:id/renew`, `POST .../:id/revoke` e `POST /api/v1/pre-admission/public/resolve` | Token, 30 dias, rotação, revogação, escopo, idempotência e auditoria estão disponíveis sem criar `User`. O upload continua bloqueado (`uploadAvailable=false`). Antes do uso em novos tenants, falta decidir o mapeamento entre RH legado e Departamento Pessoal atribuível.                                      |
| Área do Cliente                 | Parcial                              | Contas cliente legadas e consultas de contratos, passageiros, rotas e viagens com escopo por empresa                             | Não há ainda um portal unificado nem contrato genérico de representação de uma ou mais empresas para Comercial e Documentos.                                                                                                                                                                                 |
| Aceite Comercial completo       | Parcial                              | Propostas legadas permitem decisão aprovada/recusada e preservam documentos/histórico já existentes                              | Ainda faltam versões comerciais imutáveis, itens de serviço, aceite como evento próprio, sinal/pagamento aplicável, pré-reserva e confirmação definitiva do serviço.                                                                                                                                         |
| Viagens operacionais            | Disponível em primeira fatia         | `/api/v1/trips` cria manualmente viagens de contratos contínuos e executa comandos versionados                                   | Serviços eventuais, veículo/motorista, custos, quilometragem e efeitos financeiro/documental ainda não estão integrados.                                                                                                                                                                                     |
| Planos de Rota                  | Disponível separadamente             | `/api/v1/routing/**` mantém contratos, rotas, pontos e passageiros                                                               | Plano de rota ainda não está associado a `Trip`; rota executada e comparação planejado × realizado permanecem pendentes.                                                                                                                                                                                     |
| Titulares documentais genéricos | Não disponível para escrita          | Apenas `legacy-subject-preview` oferece recomendação sem persistir                                                               | O legado ainda usa titular `User`; faltam titular principal genérico, relações secundárias, evidência e revisão auditada.                                                                                                                                                                                    |

## Regra para integração

O Tenant Web pode implementar agora somente as linhas com contrato disponível,
respeitando `commandId`, `expectedVersion`, `companyId` derivado da sessão e os
códigos de permissão publicados pela API. Linhas parciais devem expor apenas a
fatia descrita, sem prometer o fluxo futuro. Linhas indisponíveis permanecem
bloqueadas até a publicação de contrato e teste de integração correspondentes.

## Handoff para o worktree atual do Tenant Web

Uma inspeção somente leitura do `lume-tenant-web` em 1º de setembro de 2026
confirmou que a reformulação ainda não está integrada ponta a ponta. Antes de
validar o Web contra esta API, o repositório frontend precisa:

- substituir o encaminhamento imediato pelo par `request-transfer` e
  `accept-transfer`, incluindo `reason`, `commandId` e `expectedVersion`;
- projetar `pendingTransfer` no contrato e na interface, mantendo a origem
  responsável até o aceite;
- remover a expectativa local de que `take-over` possa substituir outro
  atendente sem uma capacidade autoritativa de supervisão;
- atualizar `docs/tenant-api-contract-gaps.md`, que ainda marca o escopo
  multidepartamental, a transferência com aceite e a proteção do responsável
  como ausentes na API.

O gateway atual chama o alias `actions/forward` enviando apenas o departamento.
Como o alias agora exige motivo e produz uma transferência pendente, esse
payload recebe `400 VALIDATION_ERROR` até o Tenant Web ser atualizado. Esta é
uma incompatibilidade conhecida do frontend, e não uma permissão para relaxar a
regra autoritativa na API.
