# Transportes: importação Avic e conferência

A API mantém a cópia registrada pelo motorista, a origem e o histórico de conferência.
O Lume não corrige KM na Avic e não oferece edição local dessas leituras. A orientação
permanente é corrigir na origem; a justificativa do Lume não resolve a divergência.

Os cadastros e seus vínculos estão em [transport-catalogs.md](transport-catalogs.md).
`RoutingCompany` identifica clientes e funcionários PF/PJ; `Company` identifica o
tenant e `TransportSupplierProfile` seus CNPJs próprios. `RoutingContract` continua
sendo o contrato canônico. Prestadora, cliente, veículo e funcionário têm vínculos
distintos. A linha externa não é um `RoutingRoute` de planejamento.

## Configuração e ativação

As variáveis são privadas da API:

- TRANSPORT_WORKER_ENABLED=false por padrão. true processa as filas persistidas.
- AVIC_API_BASE_URL: endereço base da API de dados, sem usuário/senha/query.
- AVIC_API_USER_ID e AVIC_API_ACCESS_KEY: usuário e chave da API de dados. Preencha ambos
  para login automático; não são as credenciais da página Swagger.
- AVIC_AUTH_UTC_OFFSET: opcional, vazio quando o JWT contém exp válido. Só necessário para
  Expiration sem fuso quando não existe exp utilizável; confirme o offset com o provedor.
- AVIC_API_HEADERS_JSON: opcional, para headers adicionais ou compatibilidade com o modo
  estático anterior. Deixe vazio no login automático; Authorization junto às credenciais
  é rejeitado na inicialização, inclusive com outra capitalização.

### Login automático

O Swagger Geral conferido em 09/09/2026 documenta Bearer JWT nas consultas e POST
/api/Login. O Lume envia somente UserID, AccessKey e GrantType=password. Recebe
Authenticated=true e AccessToken, e usa Authorization: Bearer nas consultas de leitura.
O campo RefreshToken existe, mas não há procedimento de renovação documentado; não
enviamos grants ou endpoints presumidos. A renovação é uma nova autenticação automática.

A validade usa exp do JWT como metadado de cache, sem usá-lo para autorizar qualquer
requisição no Lume. Expiration com fuso explícito (ou offset confirmado) também limita
o prazo quando pode ser interpretada; vale o menor prazo disponível. Created/Expiration
são apenas strings no Swagger, sem formato/fuso definido. Nunca se assume o horário
da VPS. Token sem validade utilizável impede a consulta, em vez de presumir duração de um dia.

O token é reutilizado até 30 segundos antes do vencimento. O primeiro acesso após
reinício, expiração ou descarte faz login; nenhuma cópia manual de token é necessária.
Chamadas simultâneas do mesmo cliente aguardam um único login. Um 401 permite apenas
uma nova autenticação e repetição da mesma página. Outra recusa encerra a tentativa;
403 não provoca login repetido. Falhas de autenticação têm espera mínima de 30 segundos
na memória, além das retentativas limitadas da fila. Login tem limite de 15 segundos;
cada consulta tem limite de 30 segundos, incluindo a leitura do corpo.

Credenciais vêm do ambiente privado da API. AccessToken fica somente em memória,
separado por tenant e instância do processo; RefreshToken, Message e resposta bruta de
login não são persistidos. Erros não incluem corpo externo, credenciais ou tokens.
O worker mantém até 100 clientes, cada um associado a um tenant, sem transferir tokens
entre tenants. Reinício ou descarte do cache pede novo login. Em múltiplas réplicas,
cada processo tem seu próprio cache; a lease do banco coordena as importações.
A configuração de ambiente identifica uma única conta Avic por instalação da API;
contas diferentes devem ser configuradas em instalações distintas.

### Preenchimento no staging

No arquivo privado /home/taiane/lume/lume-staging/lume-tenant-api/.env.staging, preencha
AVIC_API_BASE_URL, AVIC_API_USER_ID e AVIC_API_ACCESS_KEY. Deixe AVIC_API_HEADERS_JSON e
AVIC_AUTH_UTC_OFFSET vazios para o login JWT habitual. Preserve a chave exatamente
como fornecida; use aspas simples no .env se ela contiver espaços, # ou $.
Mantenha o arquivo restrito ao proprietário (chmod 600), fora do Git e de logs.
A URL demonstrada pelo provedor usa HTTP: credenciais e tokens ficam sem criptografia
no transporte nesse endereço. Para uso seguro, confirme HTTPS ou um túnel privado com
a Avic; esta implementação não comprovou disponibilidade de HTTPS.

compose.prod.yml passa essas variáveis apenas ao serviço API; compose.staging.yml herda
esse mapeamento. Alterar .env exige recriar o container em uma implantação autorizada.
TRANSPORT_WORKER_ENABLED=true habilita o processamento após configurar e habilitar a
integração no painel. Não ative antes das migrações e dos vínculos necessários.
Valide separadamente autenticação, autorização de leitura, execução da importação
e persistência dos registros no ambiente autorizado. Um login bem-sucedido não
comprova importação, e testes sintéticos não comprovam a rotina diária em serviço.

Fonte consultada: [Swagger Geral](http://avicsistemas.avicddns.com.br:8669/swagger/index.html?urls.primaryName=Geral).

No painel **Avic System** (`/integrations/avic`), configure e versione: campo de identidade externa, offset dos
horários sem fuso da origem, horário diário, fuso operacional IANA, dias de sobreposição,
limites opcionais de KM e confirmação de cobertura. RegistroViagemId e Id são distintos;
a seleção da identidade é explícita e não muda depois da primeira importação sem uma
migração específica. IDs são texto, incluindo inteiros acima de Number.MAX_SAFE_INTEGER.
A integração inicia desativada. Sem credenciais não existe prova de conexão real.

A ativação requer confirmar com o provedor:

1. Credenciais válidas da API de dados e acesso de leitura às viagens de todas as modalidades.
2. Identificador estável da viagem e semântica de VeiculoId/IdLinhaRota.
3. Envelope da resposta (o adapter atual valida um array), horários, fuso e limite final
   dos filtros viagemini/viagemfim.
4. Cobertura das viagens em andamento, concluídas e atravessando o período consultado.

GET /api/FrotaContrato/pesquisa/{skip} usa páginas de 25, inclusive depois de página curta,
até página vazia. Não usa aprovadas, situacao=1, filtro de cliente ou tipo de serviço.
A janela efetiva acrescenta lookbackDays nos dois lados para incluir contexto de viagens
que atravessam a seleção. Isso reduz lacunas, mas não comprova completude de deslocamentos
ou viagens maiores que a janela. sequenceComplete permanece false até confirmação operacional.
Não são usadas operações registroviagem/iniciar/concluir para correções.

## Processamento e retomada

A criação de uma importação apenas persiste a fila. Importação e análise são processos
distintos; dados inconsistentes não impedem a entrada das demais linhas. Cada página,
checkpoint, cópias alteradas e seus históricos são gravados atomicamente. O worker roda
a cada 15 segundos, possui lease por tenant, exclusão transacional e validação de versão
do checkpoint. Falhas usam espera crescente, até cinco tentativas; depois o operador pode
retomar o mesmo cursor. O limite defensivo é 50.000 páginas por veículo/consulta; divida
consultas históricas maiores. O primeiro carregamento histórico é solicitado por período
e veículos, sem uma regra financeira de fechamento implícita.

A rotina diária percorre todas as frotas ativas com associação Avic explicitamente
configurada, em lotes de até 500 veículos. Também reconsulta pendências antigas em lotes
limitados, com intervalo de nova verificação, independente da janela diária recente.
Não há automação do aplicativo Codex nem alteração de cron da VPS.

Linhas sem identificador utilizável ficam em quarentena durável, sem identidade inventada.
A listagem mostra motivo e posição; o original permanece privado no banco. A cobertura
fica incompleta enquanto a quarentena não for substituída por uma varredura posterior
completa, sem rejeições, cobrindo todos os veículos e o intervalo do lote anterior.
O lote anterior, suas rejeições e os registros originais são conservados e a substituição
fica identificada em supersededByImportId. Um lote com falha também pode ter sua cobertura
substituída por uma consulta completa posterior.

Cada alteração importada conserva snapshot antes/depois, revisão e verificação. O autor
de uma edição externa não é inferido. Motorista/cliente exibidos são os informados pela
origem; seus nomes/IDs não atribuem automaticamente CNPJ nem identidade canônica no Lume.
Rotas novas são descobertas para revisão. Só o ID externo explicitamente confirmado e uma
associação vigente podem atribuir contrato; nome semelhante não confirma equivalência.
A titularidade da frota e o contrato são projetados pela data operacional, preservando
vigências anteriores. Alterações de nome/frota não reclassificam modalidade da viagem.

## Odômetros e pendências

A análise percorre páginas de 200 registros, por veículo e instante, incluindo vizinhos
e sobreposições. Nunca carrega o histórico inteiro no navegador. Leituras são comparadas
em precisão decimal; limites suspeitos são opcionais, sem um valor arbitrário padrão.
Os controles incluem final menor que inicial, continuidade, distâncias/saltos configurados,
leituras incompletas, horários ausentes, empate e sobreposição.

Zero intermediário e zero de garagem sem o respectivo evento são desconhecidos. Zero
com evento explícito pode ser uma leitura real e requer conferência. Datas impossíveis,
valores fora da precisão armazenável e números já imprecisos permanecem no original;
não se tornam leituras normalizadas inventadas.

Uma pendência tem identidade estável por tenant/provedor/registro/regra. Uma nova análise
atualiza a mesma pendência, conserva justificativas e não gera notificações repetidas.
A justificativa usa commandId/expectedVersion e identifica o usuário Lume. Valores corrigidos
na origem reavaliam o registro e seus vizinhos. Reanálise em execução é reiniciada quando
sua cobertura recebe nova atualização; isso evita saltar registros já percorridos.

Somente uma regra efetivamente avaliada com evidência disponível pode resolver a pendência.
Ausência na resposta, timeout ou indisponibilidade ficam como verificação indisponível.
O instante da falha é separado do instante de edição/justificativa, de modo que justificar
não invalida uma consulta posterior bem-sucedida. Continuidade não é confirmada quando
há importação pendente, quarentena vigente, sequência incompleta ou ambiguidade.
Não há atribuição automática de culpa, execução física comprovada ou telemetria.

## Comparação de KM contratado

O resumo agrega no servidor os registros de todas as rotas e veículos associados ao
contrato pela data, no fuso operacional. Os filtros da lista usam os mesmos limites civis.
Franquia ausente é null; franquia zero é 0. Os valores têm fonte DRIVER_REPORTED.
O resultado oferece contratado, registrado, diferença quando calculável e motivo de
insuficiência. Não representa faturamento, penalidade, receita, custo ou lucro.

Condição diária compara o dia. Condição mensal acumula o mês e só produz diferença após
marcação explícita CLOSED e consulta do mês inteiro. OPEN/CLOSED são marcadores versionados
de comparação, com auditoria, sem workflow financeiro ou congelamento de dados externos.
Reabertura é explícita e auditada. Correções externas continuam preservadas e visíveis.

Não existe rateio mensal para meta diária. Vigência parcial/troca de condição no mês exige
franquia específica de transição quando houver comparação mensal; não se somam franquias
mensais nem se presume proporcionalidade. Sem franquia, o acumulado continua disponível.

includeGarage=false exige medições suficientes para separar trechos. O exemplo Avic não
comprova essa separação, portanto serviceKm permanece null e o resumo informa dados
insuficientes. Não subtrai campos intermediários zero para fabricar KM sem garagem.

A confirmação de cobertura é conservadora: registros sem rota/contrato no período
impedem afirmar que todos os registros relevantes ao contrato foram classificados.
O acumulado conhecido continua disponível; a diferença pode ficar pendente. Nenhuma
rota não mapeada bloqueia as verificações intrínsecas de odômetro.

## API e permissões

Todos os endpoints usam autenticação, tenant da sessão e guards centrais.
Leitura de importação/conferência: trips:view ou trips:manage; mutações: trips:manage.
Cadastros usam as permissões específicas documentadas em transport-catalogs.md.

- GET/PATCH /transport/integration
- GET/POST /transport/imports; GET /transport/imports/:id
- POST /transport/imports/:id/resume
- GET /transport/imports/:id/rejections
- GET/POST /transport/analysis
- GET /transport/records; GET /transport/records/:id
- GET /transport/issues; GET /transport/issues/:id
- POST /transport/issues/:id/justifications
- GET /transport/summary?contractId=...&from=YYYY-MM-DD&to=YYYY-MM-DD
- POST /transport/summary/period-state

Listas de conferência usam cursor/limit (25 padrão, 100 máximo). Detalhes trazem as
100 revisões/eventos mais recentes; o histórico integral permanece no PostgreSQL.
Nenhum endpoint disponibiliza edição de leituras nem expõe headers privados.

## Validação remota

A migração é aditiva e inclui compatibilidade explícita para contratos ainda sem plano
de rota: capacidade/contagem zero só são permitidas com route_type=unspecified.
A validação de persistência usa PostgreSQL/PostGIS descartável na VPS. A aplicação
em um banco de serviço exige implantação autorizada e conferência de `migrate status`.
Use TEST_DATABASE_URL de um banco descartável cujo nome termine em _test para o teste
de persistência de Transportes. A suíte E2E legada executa migrate reset, portanto nunca
aponte esse comando para staging compartilhado ou produção.

Testes de domínio/adapter usam fixtures sintéticos. Os E2E de persistência exercitam
isolamento, vigências, idempotência, histórico, indisponibilidade, correção, agregação,
franquias e transição mensal. A Web valida os contratos via Zod e chama somente a API
do tenant. Evidência de testes não equivale a ativação real da integração Avic.

## Consulta por perfil cadastral

As listas GET /transport/affiliations, /transport/contracts e
/transport/contracts/candidates aceitam registrationId opcional validado como
UUID. O repositório combina o cadastro com companyId do principal autenticado,
antes de aplicar busca, total e paginação. Contratos usam routingCompanyId
canônico; nenhum registro é copiado ao reorganizar a navegação.

## CNPJs próprios do tenant — separação de Cadastro

As empresas que compõem o tenant são entidades independentes, com CNPJ, razão
social, nome fantasia, situação e versão próprios. Criar uma empresa pela API
não cria, reutiliza nem altera um cadastro de cliente/funcionário.
O endpoint de empresas mantém sua compatibilidade; o identificador
registrationId legado passa a identificar a empresa própria, sem exigir
RoutingCompany. A empresa está vinculada diretamente ao tenant autenticado.

A migração 20260910000100_tenant_legal_entities copia os dados das empresas já
existentes para a entidade própria, preserva os IDs e referências de frota,
vínculos e contratos e mantém a identidade antiga apenas como referência de
histórico. Essas identidades legadas são excluídas das listas/detalhes de
Cadastro, busca de identidade e exportação de contatos. Nenhum histórico é
apagado. Novas empresas não possuem uma identidade duplicada no Cadastro.
Novas alterações são auditadas na entidade da empresa.

A interface apresenta CNPJs do tenant em **Empresa > Dados**. Essas empresas
não são classificadas automaticamente como clientes,
funcionários ou pessoas com acesso. O vínculo a uma empresa nunca concede
permissões por correspondência de nome, documento ou e-mail.

## Diagnóstico de registros vazios

`GET /transport/records` consulta registros já persistidos. Abrir a página ou mudar
os filtros não dispara uma importação. Confira, nesta ordem:

1. O período e o ID externo do veículo usados no filtro.
2. O estado da configuração do tenant e o valor efetivo de
   `TRANSPORT_WORKER_ENABLED` no processo da API. Integração habilitada no painel
   não significa worker ativo nem execução concluída.
3. Para a rotina diária, frota ativa com `provider=avic` e `externalVehicleId`
   confirmado. O formulário simplificado não descobre esse vínculo sozinho.
4. O job em `/transport/imports`, suas falhas/rejeições e a existência de dados na
   origem. Um job enfileirado não é prova de registros importados.

`externalIdField` é o **nome do campo da viagem** retornado pela Avic, por exemplo
`RegistroViagemId` ou `Id`, conforme confirmação do provedor. Não preencha com um
valor como `2031` nem com o número da frota. O contrato atual aceita uma string;
a presença do campo na configuração não comprova sua semântica na resposta real.

`sourceUtcOffset` recebe um deslocamento confirmado, como `-03:00`, nunca o texto
`+HH:MM`. Campo vazio significa confirmação pendente. A franquia de distância é
uma condição do contrato. `maxGapKm` indica diferença entre odômetros de viagens
consecutivas; não é franquia nem prova de responsabilidade. `maxTripKm` permanece
no contrato legado da API, mas a Web não o solicita e envia `null` ao salvar.
