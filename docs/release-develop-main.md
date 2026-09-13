# Promoção de develop para main — API

## Escopo e referências

Preparação em 13/09/2026 para promover o conjunto da API de `develop` para
`main`. Base remota consultada: `dcb2a8230e18cb687c0e247a3cc81c0ecea68c0d`;
candidato funcional: `d7207752dcdf0d71bafb5f244acc79a0c838fac5`, acrescido das
correções de configuração deste runbook. A base é ancestral do candidato.
Use as referências remotas atualizadas e registre o SHA final aprovado no PR;
a branch `main` local de staging pode estar desatualizada.

Os remotos existentes permanecem: `origin` é o repositório original e
`milenium` é a cópia da organização. Promover uma branch ou aprovar um PR não
executa deploy: o workflow versionado é de CI. A implantação ocorre somente
na janela e no ambiente autorizados. Staging permanece em `develop`.

## Condições que impedem executar as migrações

- **Dados legados de roteirização:**
  `20260825000000_remove_legacy_contract_routing` remove com `CASCADE` dezenove
  tabelas, incluindo passageiros, contratos, rotas, versões, aprovações e
  execuções. Seu comentário original autoriza a limpeza somente em
  desenvolvimento/staging. A migração restauradora de 30/08 recria estrutura,
  mas não restaura registros. Antes de qualquer deploy, inventarie essas
  tabelas e suas dependências na produção. Se houver dados ou dependências a
  preservar, interrompa a implantação e prepare uma migração de preservação
  revisada e ensaiada; não execute a limpeza, não suponha que o backup a torna
  aceitável e não reescreva silenciosamente uma migração já aplicada.
- **PostGIS:** a migração `20260825000100_routing_core_postgis_tolls` executa
  `CREATE EXTENSION IF NOT EXISTS postgis`. O Compose/CI candidato usa
  `postgis/postgis:17-3.5-alpine`. A imagem `postgres:17-alpine` não fornece essa
  extensão. Verifique `pg_available_extensions`, a imagem e os overrides reais;
  prepare e ensaie a atualização do serviço PostgreSQL 17 para uma imagem com
  PostGIS preservando o volume e o ponto de recuperação. Não crie outro banco
  vazio para contornar a dependência.
- **Reconstrução do WhatsApp:** a migração
  `20260829000100_whatsapp_reconstruction_foundation` recusa telefones de canais
  duplicados, referências inválidas ou entre tenants em `registration_phones`
  e o canal técnico `milenium-production` sem departamento Comercial. Resolva
  essas inconsistências por procedimento auditável antes da execução.
- **Serviços confirmados:** o pacote `20260901000500` a `20260901000800` deve
  ser aplicado sem uso intermediário. A última migração exige atestes
  Financeiro/Operacional não nulos e falha se já houver serviços sem eles.
  Não fabrique atestes para viabilizar o deploy.
- **Identificadores de departamentos:** a migração
  `20260904000100_repair_tenant_department_public_identifiers` exige que todas
  as FKs existentes para departamentos tenham `ON UPDATE CASCADE`. Verifique
  também relações adicionadas fora do Prisma.

Essas verificações são do banco de destino. Uma suíte em banco vazio e a saúde
do staging não comprovam preservação de dados na promoção de produção. Não use
`prisma migrate reset`, `db push`, exclusão de volumes ou `migrate resolve`
para ignorar uma falha. Registre o diagnóstico e prepare a recuperação antes
de retomar uma migração parcialmente aplicada.

## Configuração e artefatos

1. Registre os SHAs, digests de API/Web/PostgreSQL em execução, projeto Compose,
   arquivo de ambiente, overrides, portas, redes e volumes. Não exporte os
   valores dos segredos para logs ou para o PR.
2. Gere imagens imutáveis de API e Web a partir dos SHAs aprovados. O estágio
   `build` da API inclui Prisma CLI para `npm run prisma:deploy`; a imagem
   `production` contém somente o runtime. Não tente migrar pela imagem final.
3. Valide a composição usando `docker compose ... config --quiet` com o projeto
   real e verifique em leitura controlada os mounts e nomes das variáveis.
   Preserve `storage-init`, os volumes de mídias, importações e Knowledge e as
   dependências do serviço `api` em `migrate` e `storage-init`.
4. Configure a URL pública HTTPS da API para os webhooks de canais e as sete
   credenciais individuais `LUME_AGENT_*` referenciadas pelo catálogo.
   Confirme as versões e referências efetivas de cada agente; a chave legada
   `WHATSAPP_AI_OPENAI_API_KEY` não substitui as credenciais individuais.
   Docker secrets exigem mounts privados adicionais. Preserve as credenciais
   existentes e os identificadores técnicos dos canais Evolution.
5. Preserve os prazos de espera do cliente: por padrão, lembrete em três horas
   e encerramento uma hora após o envio confirmado. O Compose encaminha
   `WHATSAPP_CUSTOMER_REMINDER_DELAY_MS` e
   `WHATSAPP_CUSTOMER_CLOSURE_DELAY_MS`. Pendência humana/comercial é excluída.
6. Mantenha `TRANSPORT_WORKER_ENABLED=false` até validar separadamente a
   integração Avic, seus vínculos, identificador de viagem, fuso e proteção de
   transporte. A promoção do Lume não autoriza a ativação da importação.

## Sequência na janela autorizada

1. Concluir as condições acima e ensaiar a atualização em cópia descartável
   protegida do banco, incluindo comparação de contagens e relações antes/depois.
2. Criar e conferir um ponto recuperável do PostgreSQL e dos volumes de mídia,
   importações e Knowledge. Guardar os arquivos de configuração e digests
   correspondentes com acesso restrito.
3. Suspender mutações e consumidores antigos durante a alteração incompatível
   de schema. Coordenar a entrada de webhooks e reentregas da Evolution;
   `WHATSAPP_ENABLED=false` sozinho não interrompe todas as gravações HTTP.
4. Disponibilizar o PostgreSQL 17 com PostGIS e executar uma única instância de
   `npm run prisma:deploy` do candidato, usando o banco confirmado. Registrar
   `prisma migrate status` e conferir as migrações efetivamente pendentes.
5. Iniciar a API candidata, verificar readiness e o bootstrap idempotente dos
   catálogos/permissões, conferir os runtimes de agentes e executar os smokes
   autenticados de API. Só então publicar a Web compatível.
6. Conferir login/permissões; documentos do titular PF/PJ; CNPJs separados dos
   cadastros; frota e códigos numéricos; resumo legível; novo orçamento sem
   sobrescrever o anterior; transferência real ao Comercial; controle humano
   sem resposta automática; cartões privados de assistência; ausência de
   mensagens históricas reenviadas. Não enviar mensagens reais de teste sem
   autorização e não alterar dados do cliente para produzir evidência.
7. Registrar as imagens efetivas, readiness, filas e resultados funcionais.
   Retomar o tráfego e a automação conforme os marcos de ativação aprovados,
   sem duas versões consumidoras da outbox simultaneamente.

## Recuperação

Antes de iniciar migrações, a reversão é voltar aos digests e configuração
registrados. Depois das mudanças de schema e dados deste pacote, retornar
somente a imagem antiga não é uma recuperação comprovada. Interrompa escritas,
identifique quais migrações e mensagens foram efetivadas e escolha correção
adiante ou restauração coordenada do ponto recuperável, sob autorização.
A restauração deve combinar banco, mídias e versões compatíveis, com
reconciliação de webhooks/outbox e das gravações ocorridas depois do backup.
Não apague histórico, reenvie eventos indiscriminadamente nem faça downgrade do
volume PostgreSQL sem ensaio e verificação de compatibilidade.

## Manifesto de migrações em relação à main remota consultada

São 36 arquivos novos. Essa lista descreve a diferença Git; a quantidade
pendente no banco depende de `_prisma_migrations` e precisa ser conferida na
instalação. Mantenha a ordem gerenciada pelo Prisma:

- `20260825000000_remove_legacy_contract_routing`.
- `20260825000100_archive_inactive_whatsapp_conversations`.
- `20260825000100_routing_core_postgis_tolls`.
- `20260826000100_registration_and_reconciliation`.
- `20260829000050_prepare_whatsapp_transition_backfill`.
- `20260829000100_whatsapp_reconstruction_foundation`.
- `20260829000150_restore_whatsapp_transition_append_only`.
- `20260829000200_seed_platform_agent_catalog`.
- `20260829000300_customer_profile_suggestions`.
- `20260829000400_human_service_hours`.
- `20260829000500_media_interpretation_relational_provenance`.
- `20260830000000_restore_operational_routing_foundation`.
- `20260830000100_temporary_registration`.
- `20260830000200_commercial_closure_classification`.
- `20260830000300_operational_trips`.
- `20260901000100_user_person_association`.
- `20260901000200_secure_pre_admission_access`.
- `20260901000300_pending_conversation_transfer`.
- `20260901000400_registration_command_idempotency`.
- `20260901000500_confirmed_commercial_services`.
- `20260901000600_operational_trip_route_plan_selection`.
- `20260901000700_confirmed_service_trip_source`.
- `20260901000800_commercial_service_requirement_attestations`.
- `20260901001100_commercial_service_requirement_outcomes`.
- `20260901001200_expand_tenant_access_departments`.
- `20260901001300_seed_tenant_access_departments`.
- `20260901001400_user_update_commands`.
- `20260904000100_repair_tenant_department_public_identifiers`.
- `20260906000100_driver_registration_tag`.
- `20260906000200_registration_service_instructions`.
- `20260906000300_registration_document_ownership`.
- `20260907211000_channel_agents_enabled`.
- `20260909000100_transport_catalogs_avic`.
- `20260910000100_tenant_legal_entities`.
- `20260910000200_numeric_catalog_codes`.
- `20260911000100_whatsapp_customer_wait_window`.

## Evidências disponíveis e validação final

No candidato funcional de 12/09/2026 passaram Prisma validate/generate,
formatação, lint, build e 1.538 testes unitários em 189 arquivos. A execução
HTTP WhatsApp passou 79 de 80 casos em conjunto; um timeout de 30 segundos
passou sem mudança em repetição isolada (12,865 segundos). Isso não equivale
a uma execução completa E2E sem falhas nem ao ensaio de dados de produção.

Os logs estão no diretório operacional privado
`/home/taiane/lume/lume-staging/diagnostics/attendance-regression-20260912`.
Confronte os arquivos testados com o SHA candidato e exija o resultado de CI
no SHA final, incluindo PostgreSQL/PostGIS, migrações, testes E2E e build da
imagem. As alterações de Compose desta preparação são verificadas por
renderização com valores sintéticos, sem iniciar serviços ou acessar bancos.

## Conferência somente leitura do destino em 13/09/2026

A verificação com `default_transaction_read_only=on` encontrou 36 migrações
pendentes e as dezenove tabelas atingidas pela limpeza sem registros naquele
momento. Essa observação não autoriza a limpeza nem cobre dependências externas;
repita-a na janela com escritas suspensas e confronte o ensaio de recuperação.
O PostgreSQL de produção usa `postgres:17-alpine`, sem PostGIS instalado ou
instalável pelo catálogo de extensões dessa imagem. A adequação de PostGIS ainda
é uma condição pendente de implantação. Nenhum dado, serviço ou ambiente foi
alterado durante essa conferência.

## Resultado da cobertura em 13/09/2026

A CI do candidato funcional falha em `npm run test:cov`, antes de build e E2E,
embora os 1.538 testes unitários passem. A repetição na VPS confirmou 76,92% de
linhas, 79,70% de funções e 75,15% de instruções, abaixo dos 80% exigidos;
branches alcançaram 65,69%, acima do mínimo de 65%. Os limites são preservados.
A versão não está liberada para merge/deploy enquanto a CI não passar no SHA
final. Aumentar a cobertura dos caminhos de negócio não exercitados é pendência
explícita, especialmente importação/resumo de Transportes, Viagens e Cadastro.

A validação da configuração desta preparação renderizou o Compose com valores
sintéticos: sete credenciais independentes de agentes, URL pública e prazos
customizados chegam ao serviço API; a dependência de migração foi preservada.
Nenhum serviço foi iniciado por essa verificação. Logs e resultados privados:
`diagnostics/release-main-20260913`, fora do Git.
