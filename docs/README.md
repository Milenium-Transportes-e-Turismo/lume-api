# Documentação da Tenant API

Índice revisado em 12/09/2026 para o código da branch `develop`. Comece pelo
[README do repositório](../README.md), pelos contratos de integração e pelos guias
de operação do domínio. A API é a fonte autoritativa dos dados e das regras.

Guias operacionais descrevem o comportamento atual; ADRs preservam decisões e
checklists/relatos datados preservam evidências do momento da avaliação. Números
de testes, estado de um serviço ou configuração de um tenant em um relato antigo
não comprovam o estado atual. Confirme revisão, migrações e imagem do ambiente.

## Decisões de arquitetura

- [Cadastro principal canônico para pessoas e empresas](adr/0001-cadastro-principal-canonico.md).
- [Comunicação não possui processos de negócio](adr/0002-comunicacao-nao-possui-processos-de-negocio.md).
- [Políticas configuráveis são tipadas e versionadas](adr/0003-politicas-configuraveis-versionadas.md).
- [Viagem, plano de rota e execução são distintos](adr/0004-viagem-plano-e-execucao-sao-distintos.md).
- [Autorização combina capacidade, escopo e restrição](adr/0005-autorizacao-combina-capacidade-escopo-e-restricao.md).
- [Evidência manual antes de integração externa](adr/0006-evidencia-manual-antes-de-integracao.md).
- [Cancelamento preserva a etapa do processo](adr/0007-cancelamento-preserva-a-etapa-do-processo.md).
- [Fluxos Eventual e Contínuo são distintos](adr/0008-fluxos-eventual-e-continuo-sao-distintos.md).
- [A evolução de identidade é conservadora](adr/0009-evolucao-de-identidade-e-conservadora.md).
- [Autorização migra em modo de compatibilidade](adr/0010-autorizacao-migra-em-modo-de-compatibilidade.md).
- [Cancelamento legado não é adivinhado](adr/0011-cancelamento-legado-nao-e-adivinhado.md).
- [Gerência pode operar Cadastros gerais](adr/0012-gerencia-pode-operar-cadastros-gerais.md).
- [Autoridade do tenant e atendimento são capacidades explícitas](adr/0013-autoridade-do-tenant-e-atendimento-sao-capacidades-explicitas.md).

## WhatsApp e agentes

- [Documentação de domínio](agents/domain.md).
- [Rastreador de issues: GitHub](agents/issue-tracker.md).
- [Etiquetas de triagem](agents/triage-labels.md).
- [CustomerContext e memória aprovada](customer-context.md).
- [milena-tenant-prompt](milena-tenant-prompt.md).
- [Validação da coleta de turismo](tourism-intake-validation.md).
- [WhatsApp consolidado na Tenant API](whatsapp-api.md).
- [Importação de atendimentos WhatsApp existentes](whatsapp-conversation-import.md).
- [Atendimento humano, sugestões internas e espera pelo cliente](whatsapp-human-assistance.md).
- [Horário de atendimento humano no WhatsApp](whatsapp-human-service-hours.md).
- [WhatsApp multimodal](whatsapp-multimodal.md).
- [WhatsApp na Tenant API](whatsapp-mvp.md).
- [Coordenação de prioridade entre atendimentos](whatsapp-service-priority-coordination.md).

## Arquitetura, contratos e demais domínios

- [Arquitetura do Lume Tenant API](architecture.md).
- [Serviços comerciais confirmados](commercial-confirmed-services.md).
- [Exportação de contatos aprovados](contact-export.md).
- [Intercâmbio de arquivos](data-exchange.md).
- [Gestão documental](document-management.md).
- [Estado da evolução de domínio](domain-implementation-pending.md).
- [Knowledge Base](knowledge-base.md).
- [Encerramento e portabilidade](offboarding.md).
- [Identificação e Cadastro pela conversa](registration-conversations.md).
- [Contratos disponíveis para o Tenant Web](tenant-web-contract-readiness.md).

## Transportes e roteirização

- [Perguntas para o gestor da Avic](avic-manager-questions.md).
- [API do Lume Routing Core](routing/api.md).
- [Lume Routing Core](routing/architecture.md).
- [Operação dos serviços geográficos](routing/operations.md).
- [Ativação do Routing Core no lume-staging](routing/staging.md).
- [Ingestão e governança de pedágios](routing/tolls.md).
- [Empresas, frota e contratos de transporte](transport-catalogs.md).
- [Transportes: importação Avic e conferência](transport-imports.md).

## Histórico e checklists

- [Checklist de teste real local — Lume Tenant API + Web](checklist-teste-real-local.md).
- [Avaliação do atendimento e revisão do prompt](milena-attendance-review.md).
- [Reformulação do atendimento e plataforma de agentes — checklist de execução](reformulacao-atendimento-agentes-checklist.md).
- [Fundação de dados da reconstrução de atendimento](whatsapp-reconstruction-schema-foundation.md).

## Ambientes e operação

- [Ambientes e branches](deployment-environments.md).
- [Contrato do lume-edge-agent](edge-contract.md).
- [Operação em produção](production.md).

O arquivo `milena-tenant-prompt.md` é um modelo de instruções para configuração;
editá-lo não altera automaticamente o prompt ativo de nenhum tenant.
