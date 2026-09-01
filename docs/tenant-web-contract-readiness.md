# Contratos disponíveis para o Tenant Web

Este quadro evita que uma lacuna parcial seja anunciada como ausência total e
que uma tela trate uma proteção local como regra autoritativa. O estado abaixo
descreve o contrato da Tenant API; mocks e controles visuais do Tenant Web não
substituem estes limites.

| Capacidade                      | Estado da API                        | Contrato utilizável pelo Web                                                                                                     | Limite atual                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Devolver atendimento ao bot     | Disponível e protegido               | `POST /api/v1/whatsapp/conversations/:id/actions/return-to-bot`                                                                  | Somente o atendente atribuído pode executar. A checagem ocorre dentro da transação. Não existe override implícito de supervisão.                                                                                                                                                                             |
| Transferir entre departamentos  | Backend disponível; uso fora do Comercial bloqueado | `POST .../actions/request-transfer` e `POST .../actions/accept-transfer`                                                         | A origem continua responsável até o aceite e a pendência aparece na fila do destino. Hoje, porém, um usuário apenas do Operacional ou Financeiro não pode abrir, aceitar nem responder essa conversa, pois o código exigido (`whatsapp-conversations:manage`) só cabe no Comercial e também inclui poderes administrativos excessivos. Recomendação pendente: criar uma capacidade menor de atendimento departamental. Rejeição/cancelamento explícitos continuam pendentes. |
| Pré-admissão por link seguro    | Parcial, com gestão segura do acesso | `POST /api/v1/pre-admission/accesses`, `POST .../:id/renew`, `POST .../:id/revoke` e `POST /api/v1/pre-admission/public/resolve` | Token, 30 dias, rotação, revogação, escopo, idempotência e auditoria estão disponíveis sem criar `User`. RH e Departamento Pessoal podem gerir o acesso quando recebem individualmente `documents:manage`. O upload continua bloqueado (`uploadAvailable=false`).                                      |
| Área do Cliente                 | Parcial                              | Contas cliente legadas e consultas de contratos, passageiros, rotas e viagens com escopo por empresa                             | Não há ainda um portal unificado nem contrato genérico de representação de uma ou mais empresas para Comercial e Documentos.                                                                                                                                                                                 |
| Aceite Comercial completo       | Parcial, com segregação autoritativa | Financeiro usa `financial-attestation`, Operacional usa `operational-attestation`, Comercial usa `confirmed-services` e as três áreas consultam `confirmed-service-readiness` | Aceite não confirma nem cria viagem automaticamente. Ator e permissão são revalidados na transação e Administradora não substitui as áreas. Ainda faltam itens comerciais versionados, dispensa `not-applicable` autorizada, pré-reserva e cancelamento pós-confirmação. |
| Viagens operacionais            | Disponível para origens contínua e eventual | `/api/v1/trips` cria manualmente a partir de contrato contínuo ou Serviço Confirmado e executa comandos versionados            | A origem eventual é bloqueada e revalidada, usa a data confirmada e não nasce do aceite. Veículo/motorista, custos, quilometragem e efeitos financeiro/documental ainda não estão integrados. |
| Planos de Rota                  | Integrado para contratos contínuos   | `/api/v1/routing/**` mantém rotas versionadas; `POST /trips/:id/route-plan` seleciona a versão aprovada e `GET /trips/:id/route-plans` consulta o histórico | O início congela a seleção que orientou a execução e a resposta sanitiza dados de passageiros. Plano eventual, rota realizada e comparação planejado × realizado permanecem pendentes. |
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
- separar visualmente aceite de orçamento, confirmação explícita de serviço e
  criação manual da viagem eventual;
- integrar a seleção e o histórico do Plano de Rota da Viagem, enviando as duas
  versões esperadas e tratando conflitos `409`;
- atualizar `docs/tenant-api-contract-gaps.md`, que ainda marca o escopo
  multidepartamental, a transferência com aceite e a proteção do responsável
  como ausentes na API.

O gateway atual chama o alias `actions/forward` enviando apenas o departamento.
Como o alias agora exige motivo e produz uma transferência pendente, esse
payload recebe `400 VALIDATION_ERROR` até o Tenant Web ser atualizado. Esta é
uma incompatibilidade conhecida do frontend, e não uma permissão para relaxar a
regra autoritativa na API.
