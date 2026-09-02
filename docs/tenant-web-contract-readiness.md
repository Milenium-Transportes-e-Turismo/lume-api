# Contratos disponíveis para o Tenant Web

Este quadro evita que uma lacuna parcial seja anunciada como ausência total e
que uma tela trate uma proteção local como regra autoritativa. O estado abaixo
descreve o contrato da Tenant API; mocks e controles visuais do Tenant Web não
substituem estes limites.

| Capacidade                      | Estado da API                               | Contrato utilizável pelo Web                                                                                                                                                     | Limite atual                                                                                                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Devolver atendimento ao bot     | Disponível com atendimento transversal      | `POST /api/v1/whatsapp/conversations/:id/actions/return-to-bot`                                                                                                                  | Um usuário interno com `whatsapp-conversations:attend` pode atuar mesmo sem ser o responsável corrente. A API exige `expectedVersion`, revalida o ator na transação e preserva o histórico; `client-company` não pode receber essa capacidade.                                          |
| Transferir entre departamentos  | Backend disponível com aceite versionado    | `POST .../actions/request-transfer` e `POST .../actions/accept-transfer`                                                                                                         | A origem permanece responsável até o aceite. Usuários internos autorizados usam `whatsapp-conversations:attend`; a capacidade ampla legada `manage` não é necessária para atender. O responsável é corrente, não mutex. Rejeição/cancelamento explícitos continuam pendentes.        |
| Pré-admissão por link seguro    | Parcial, com gestão segura do acesso        | `POST /api/v1/pre-admission/accesses`, `POST .../:id/renew`, `POST .../:id/revoke` e `POST /api/v1/pre-admission/public/resolve`                                                 | Token, 30 dias, rotação, revogação, escopo, idempotência e auditoria estão disponíveis sem criar `User`. RH e Departamento Pessoal podem gerir o acesso com `documents:manage`. O upload continua bloqueado e a responsabilidade por tipo documental ainda não foi modelada.            |
| Área do Cliente                 | Parcial                                     | Contas cliente legadas e consultas de contratos, passageiros, rotas e viagens com escopo por empresa                                                                             | Não há ainda um portal unificado nem contrato genérico de representação de uma ou mais empresas para Comercial e Documentos.                                                                                                                                                            |
| Aceite Comercial completo       | Parcial, com segregação autoritativa        | Financeiro usa `financial-attestation`, Operacional usa `operational-attestation`, Comercial usa `confirmed-services` e exceções usam `requirements/:requirement/not-applicable` | Aceite não confirma nem cria viagem. Diretoria com `tenant:manage` e Administrador também executam atos ordinários; Gerência com `service-confirmations:approve` decide somente a exceção. Ainda faltam itens versionados, pré-reserva e cancelamento pós-confirmação.               |
| Autoridade do tenant            | Disponível em catálogo fixo                 | `directorate` com `tenant:manage` individual projeta autoridade ampla de negócio; `isAdministrator` representa autoridade total da instalação                                    | Gerência continua limitada a capacidades estreitas. Criação dinâmica de departamentos em runtime ainda não está disponível.                                                                                                                                                             |
| Viagens operacionais            | Disponível para origens contínua e eventual | `/api/v1/trips` cria manualmente a partir de contrato contínuo ou Serviço Confirmado e executa comandos versionados                                                              | A origem eventual é bloqueada e revalidada, usa a data confirmada e não nasce do aceite. Veículo/motorista, custos, quilometragem e efeitos financeiro/documental ainda não estão integrados.                                                                                           |
| Plano de Rota da viagem         | Disponível para contratos contínuos         | `POST /api/v1/trips/:tripId/route-plan` seleciona uma versão aprovada e `GET /api/v1/trips/:tripId/route-plans` lista o histórico sanitizado                                      | A seleção é versionada e congelada no início da viagem contínua. O Plano de Rota para serviços eventuais ainda não está disponível.                                                                                                                                                    |
| Titulares documentais genéricos | Não disponível para escrita                 | Apenas `legacy-subject-preview` oferece recomendação sem persistir                                                                                                               | O legado ainda usa titular `User`; faltam titular principal genérico, relações secundárias, evidência e revisão auditada.                                                                                                                                                               |

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
- tratar `assignedTo` como responsável corrente, não como mutex, permitindo
  substituição somente quando a API autorizar `whatsapp-conversations:attend`;
- enviar `expectedVersion` em toda atuação concorrente e tratar `409` sem
  repetir silenciosamente resposta, transferência ou substituição;
- enviar `commandId` e a `version` recebida pela API em
  `PATCH /api/v1/users/:id`, preservando o mesmo comando somente em retry do
  mesmo payload e respeitando `idempotent` na resposta;
- separar visualmente aceite de orçamento, confirmação explícita de serviço e
  criação manual da viagem eventual;
- consumir a seleção e o histórico de Plano de Rota somente para viagens de
  contrato contínuo, sem oferecer essa ação para a origem eventual;
- atualizar `docs/tenant-api-contract-gaps.md`, que ainda marca o escopo
  multidepartamental, a transferência com aceite e a proteção do responsável
  como ausentes na API.

O Web não deve oferecer criação livre de departamentos: o runtime ainda publica
um catálogo fechado. Também não deve inferir que RH ou Departamento Pessoal é
responsável por todo documento; essa definição por tipo continua sem contrato.

O gateway atual chama o alias `actions/forward` enviando apenas o departamento.
Como o alias agora exige motivo e produz uma transferência pendente, esse
payload recebe `400 VALIDATION_ERROR` até o Tenant Web ser atualizado. Esta é
uma incompatibilidade conhecida do frontend, e não uma permissão para relaxar a
regra autoritativa na API.
