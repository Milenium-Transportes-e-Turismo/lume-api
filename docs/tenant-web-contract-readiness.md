# Contratos disponíveis para o Tenant Web

Este quadro evita que uma lacuna parcial seja anunciada como ausência total e
que uma tela trate uma proteção local como regra autoritativa. O estado abaixo
descreve o contrato da Tenant API; mocks e controles visuais do Tenant Web não
substituem estes limites.

| Capacidade                      | Estado da API                               | Contrato utilizável pelo Web                                                                                                                                                     | Limite atual                                                                                                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Devolver atendimento ao bot     | Disponível com atendimento transversal      | `POST /api/v1/whatsapp/conversations/:id/actions/return-to-bot`                                                                                                                  | Um usuário interno com `whatsapp-conversations:attend` pode atuar mesmo sem ser o responsável corrente. A API exige `expectedVersion`, revalida o ator na transação e preserva o histórico; `client-company` não pode receber essa capacidade.                                |
| Transferir entre departamentos  | Backend disponível com aceite versionado    | `POST .../actions/request-transfer` e `POST .../actions/accept-transfer`                                                                                                         | A origem permanece responsável até o aceite. Usuários internos autorizados usam `whatsapp-conversations:attend`; a capacidade ampla legada `manage` não é necessária para atender. O responsável é corrente, não mutex. Rejeição/cancelamento explícitos continuam pendentes. |
| Pré-admissão por link seguro    | Parcial, com gestão segura do acesso        | `POST /api/v1/pre-admission/accesses`, `POST .../:id/renew`, `POST .../:id/revoke` e `POST /api/v1/pre-admission/public/resolve`                                                 | Token, 30 dias, rotação, revogação, escopo, idempotência e auditoria estão disponíveis sem criar `User`. RH e Departamento Pessoal podem gerir o acesso com `documents:manage`. O upload continua bloqueado e a responsabilidade por tipo documental ainda não foi modelada.  |
| Área do Cliente                 | Parcial                                     | Contas cliente legadas e consultas de contratos, passageiros, rotas e viagens com escopo por empresa                                                                             | Não há ainda um portal unificado nem contrato genérico de representação de uma ou mais empresas para Comercial e Documentos.                                                                                                                                                  |
| Aceite Comercial completo       | Parcial, com segregação autoritativa        | Financeiro usa `financial-attestation`, Operacional usa `operational-attestation`, Comercial usa `confirmed-services` e exceções usam `requirements/:requirement/not-applicable` | Aceite não confirma nem cria viagem. Diretoria com `tenant:manage` e Administrador também executam atos ordinários; Gerência com `service-confirmations:approve` decide somente a exceção. Ainda faltam itens versionados, pré-reserva e cancelamento pós-confirmação.        |
| Autoridade do tenant            | Disponível em catálogo fixo                 | `directorate` com `tenant:manage` individual projeta autoridade ampla de negócio; `isAdministrator` representa autoridade total da instalação                                    | Gerência continua limitada a capacidades estreitas. Criação dinâmica de departamentos em runtime ainda não está disponível.                                                                                                                                                   |
| Viagens operacionais            | Disponível para origens contínua e eventual | `/api/v1/trips` cria manualmente a partir de contrato contínuo ou Serviço Confirmado e executa comandos versionados                                                              | A origem eventual é bloqueada e revalidada, usa a data confirmada e não nasce do aceite. Veículo/motorista, custos, quilometragem e efeitos financeiro/documental ainda não estão integrados.                                                                                 |
| Plano de Rota da viagem         | Disponível para contratos contínuos         | `POST /api/v1/trips/:tripId/route-plan` seleciona uma versão aprovada e `GET /api/v1/trips/:tripId/route-plans` lista o histórico sanitizado                                     | A seleção é versionada e congelada no início da viagem contínua. O Plano de Rota para serviços eventuais ainda não está disponível.                                                                                                                                           |
| Titulares documentais genéricos | Parcial: PF/PJ disponível                   | Solicitações por `subjectRegistrationId`; `subjectUserId` preservado como compatibilidade                                                                                        | Titularidade genérica de veículo, contrato, orçamento e viagem, relações secundárias e revisão de classificação ainda exigem evolução. `legacy-subject-preview` não persiste sua recomendação.                                                                                |

## Sessões e assistência no WhatsApp

Os comandos nativos `/api/v1/service/sessions` usam capacidades `service:*` e ações
disponíveis no snapshot. As linhas de `actions/*` acima documentam a fachada legada,
não uma exigência de que a Web atual use exclusivamente esses endpoints.

## Regra para integração

O Tenant Web pode implementar agora somente as linhas com contrato disponível,
respeitando `commandId`, `expectedVersion`, `companyId` derivado da sessão e os
códigos de permissão publicados pela API. Linhas parciais devem expor apenas a
fatia descrita, sem prometer o fluxo futuro. Linhas indisponíveis permanecem
bloqueadas até a publicação de contrato e teste de integração correspondentes.

## Integração atual do Tenant Web

A revisão de 12/09/2026 considera os diretórios oficiais de staging em `develop`.
O painel já consome o snapshot da sessão e seus `availableActions`. Assumir,
transferir, devolver à fila/IA, alterar prioridade e encerrar usam comandos
versionados de `/api/v1/service/sessions`. O par legado `request-transfer` /
`accept-transfer` permanece disponível como compatibilidade, com semântica própria.
Não confunda essa transferência pendente com o comando nativo da sessão.

Sugestões da assistência são privadas e a decisão exige versões de conversa e
sessão. A Web não anuncia envio, transferência ou sucesso antes da confirmação da
API. Veja [atendimento humano](whatsapp-human-assistance.md).

O frontend continua tratando `409` como conflito, preserva os dados para recarga
e não concede permissões por estado visual. Departamentos são um catálogo fechado.
A cobertura Comercial, documental e de Viagens deve respeitar os limites da tabela;
contrato disponível no código não prova implantação em todos os ambientes.
