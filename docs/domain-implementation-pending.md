# Estado da evolução de domínio

As decisões PEND-01 a PEND-07 foram aprovadas em 30 de agosto de 2026. Este
arquivo acompanha sua implantação incremental. As regras de produto estão
fechadas; a escolha de segurança descoberta durante a implantação também foi
decidida e está registrada ao final.

## Cadastro temporário

**Estado**: núcleo aditivo implementado; marcos operacionais ainda parciais.

O prazo padrão é de sete dias, sem ultrapassar o marco crítico da operação.
Nome ou razão social, papel, contato, motivo, responsável e vencimento são
comuns. CPF e CNH são bloqueadores da escala do motorista; documento é
bloqueador do fechamento da lista de passageiros; CPF/CNPJ é bloqueador de
contrato, pedido ou pagamento de cliente e fornecedor.

A transição para cadastro regular exige CPF/CNPJ e telefone aplicáveis, sem
apagar os bloqueios operacionais de motorista ou passageiro. Contratos também
consultam o identificador real, inclusive em cadastros antigos sem a marca
temporária. O bloqueio na escala do motorista e no fechamento da lista de
passageiros ainda depende da associação canônica com suas evidências.

## Consolidação de duplicidades

**Estado**: política e preview somente leitura implementados; transferência de
vínculos ainda não ativada.

A consolidação é manual e pode ser revertida por uma nova operação auditada,
sem apagar o evento anterior. A evidência mínima contém motivo, cadastro
principal, vínculos afetados, responsável, data/hora e confirmação explícita;
anexo é opcional. O cadastro duplicado nunca é apagado.

O preview declara `application-not-available`; portanto nem um par sem vínculos
é anunciado como executável antes dos adapters transacionais.

## Migração de usuários para o cadastro principal

**Estado**: associação persistida implementada como primeira etapa; telefone
canônico e reconciliação em massa ainda pendentes.

Somente CPF único e idêntico permite associação automática. E-mail e telefone
geram sugestão para confirmação humana. Usuários sem CPF ou com conflito
recebem uma pessoa provisória marcada para regularização, sem fusão automática.
O vínculo legado `User.routingCompanyId` aparece apenas como escopo de acesso a
ser revisado, e não é reinterpretado como associação de identidade.
Sugestão por telefone aguarda um telefone canônico no modelo de Usuário; nenhum
número de WhatsApp é reutilizado como identidade por inferência.

A leitura de candidatos agora utiliza um adapter canônico compartilhado por
Identidade e Documentos. A associação transacional exige `companyId`,
`commandId` e `expectedVersion`, preserva histórico e auditoria na mesma
transação e nunca transforma `User.routingCompanyId` em identidade. CPF único e
idêntico pode ser aplicado automaticamente; escolha por CPF ou e-mail exige
confirmação humana explícita e motivo. Conflitos não consolidam Cadastros e,
quando não existe Pessoa aplicável, é criada uma Pessoa temporária marcada para
regularização sem conceder acesso e sem inferir papel de Funcionário. Vínculo
de trabalho exige uma operação própria, explícita e auditada. A classificação
documental continua somente leitura até sua mutation específica entrar em
produção.

## Pré-admissão

**Estado**: gestão segura do link implementada; recebimento dos arquivos ainda
bloqueado pelo titular documental legado.

RH ou Departamento Pessoal com `documents:manage` pode criar um Acesso de
Pré-admissão ligado a uma Pessoa, com validade padrão de 30 dias, escopo de
tipos documentais, revogação e renovação por rotação de token. Somente o hash
do token é persistido. As
mutações usam `companyId`, `commandId`, `expectedVersion`, idempotência,
concorrência otimista, histórico e auditoria na mesma transação.

O endpoint público apenas valida o token e apresenta o escopo solicitado. Ele
não recebe arquivos e responde `uploadAvailable=false`, porque o legado ainda
depende de autoria e autorização do upload vinculadas ao usuário. Solicitações
por `subjectRegistrationId` já permitem titular PF/PJ sem conta; isso não libera
a ingestão pública de arquivos por link de pré-admissão. A próxima
etapa deve conectar o Titular Principal genérico ao fluxo e ao armazenamento
documental existentes, sem criar `User` temporário e sem persistir bytes em uma
esteira paralela.

**Decisão organizacional concluída**: RH e Departamento Pessoal possuem o mesmo
teto de capacidades documentais e ambos podem administrar a pré-admissão quando
recebem individualmente `documents:manage`. Os dois são departamentos
atribuíveis e separados no catálogo atual, embora exerçam funções documentais
parecidas. Essa equivalência de permissões não define qual deles responde por
cada tipo de documento nem cria uma trava exclusiva na fila de WhatsApp.

## Titulares documentais

**Estado**: política e preview por envio documental implementados; persistência
da classificação ainda não ativada.

Somente tipo e contexto inequívocos classificam automaticamente o titular.
Os demais documentos permanecem como `legado não classificado`, preservados e
disponíveis para revisão manual.

O preview reconhece `User.personRegistrationId` já persistido como associação
confirmada somente quando a relação resolve para uma Pessoa do mesmo tenant; o
CPF usado como evidência vem dessa Pessoa canônica. CPF confirmado no documento
continua sendo lido apenas dos dados revisados, nunca de OCR bruto, e uma mera
recomendação de associação não é transformada em vínculo confirmado. Uma
associação persistida cuja Pessoa ainda não possui CPF canônico permanece sem
classificação automática de titular.

## Novo modelo de autorização

**Estado**: projeção determinística do acesso legado implementada e autoridade
alvo definida; perfis, restrições e departamentos dinâmicos ainda não estão
ativados integralmente no runtime.

Perfis e áreas entram de forma aditiva e inicialmente reproduzem o acesso
efetivo atual. O Administrador da Instalação preserva autoridade total. A
Diretoria somente recebe autoridade ampla de negócio com `directorate` e a
atribuição individual `tenant:manage`; a Gerência continua limitada às
capacidades estreitas de cada processo. Supervisão é capacidade, não perfil ou
cargo fixo. Restrições novas só prevalecem depois de registradas e revisadas,
mantendo a proteção do último administrador ativo e um caminho de reversão.

O catálogo de departamentos ainda é fechado no código e no enum do banco. A
regra aprovada abrange departamentos internos atuais e futuros, mas a criação
dinâmica em runtime permanece uma lacuna e não deve ser anunciada pela API.

## Operação de viagens

**Estado**: origens contínua e eventual implementadas, com seleção versionada
do Plano de Rota recorrente para viagens de contrato contínuo.

Cada serviço confirmado pode originar uma ou mais viagens criadas manualmente
pelo Operacional, sempre com referência ao serviço ou contrato de origem.
Rascunhos são editáveis; mudança relevante depois da programação gera versão e
auditoria; depois do início, mudanças são ocorrências ou desvios. Contratos
contínuos não criam viagens automaticamente nesta fase.

Antes da confirmação eventual, o Financeiro registra o ateste com
`financial:approve`, o Operacional registra o seu com `operations:manage` e o
Comercial finaliza com `commercial:manage`. Os três atores são revalidados
dentro das transações. A autorização para exceções foi definida: Gerência usa
`service-confirmations:approve`, Diretoria usa `tenant:manage` atribuída
individualmente e o Administrador da Instalação possui autoridade total. O
contrato `not-applicable` está implementado com motivo, evidência, `commandId`,
versão esperada, idempotência, auditoria e revalidação do ator dentro da
transação. A Gerência não recebe, por essa capacidade estreita, o direito de
executar os atestes ordinários ou confirmar o Serviço.

A criação exige a versão esperada do contrato ou do Serviço Confirmado, e cada
comando da viagem exige `commandId` e `expectedVersion`. Aceite e confirmação
permanecem eventos distintos; nenhuma aprovação de orçamento cria viagem
automaticamente. O histórico expõe o resultado persistido, com versões da
programação, ocorrências e evidências.

Na origem eventual, a API bloqueia a linha do Serviço Confirmado, verifica que
o orçamento de origem continua aprovado na mesma versão e exige a data de saída
confirmada. Ator ativo e permissão também são recarregados antes da escrita.

Uma viagem contínua pode selecionar uma versão aprovada da Rota. A seleção é
histórica, substituições exigem motivo e o comando `start` congela a versão que
orientou a execução. O snapshot público é sanitizado. A estrutura legada de
Rota ainda exige contrato; por isso, Plano de Rota eventual, rota efetivamente
executada, quilometragem, custos e efeitos financeiros/documentais continuam
fora desta fatia.

As permissões canônicas de viagem já são aceitas pelos endpoints. Os códigos
legados de rotas permanecem como ponte de compatibilidade enquanto o cadastro de
acesso é migrado, sem transformar Plano de Rota na fonte da operação.

## Atendimento e transferências

**Estado**: fluxo explícito de solicitação/aceite e política de atendimento
transversal implementados na API. A Web atual já usa os comandos nativos de
`/api/v1/service/sessions`, o snapshot de capacidades e sugestões privadas.
A solicitação/aceite descrita abaixo permanece como contrato de compatibilidade;
não substitui o comando nativo de transferência de sessão. Consulte
[contratos atuais](tenant-web-contract-readiness.md).

Uma transferência registra destino e motivo, mas mantém o atendimento ativo e
o departamento de origem até o aceite. A pendência aparece na fila do destino e
um usuário autorizado desse departamento pode aceitá-la. A capacidade
individual `whatsapp-conversations:attend` é transversal a todos os
departamentos internos catalogados e é proibida para `client-company`.

O responsável é a referência corrente da conversa, não um mutex. Qualquer
usuário autorizado no escopo pode atuar ou substituir essa referência; toda
mutação continua exigindo `expectedVersion`, revalidação dentro da transação
e histórico com ator e responsável anterior. Supervisão segue a mesma regra de
capacidade explícita, sem perfil rígido ou override implícito por nome de cargo.

`whatsapp-conversations:manage` permanece como capacidade ampla legada para
administração do canal e operações de proposta Comercial; não deve ser
concedido apenas para liberar atendimento. O Tenant Web deve usar `attend` em
leitura, resposta, substituição, transferência, encerramento e retorno ao bot,
enviando a versão esperada e tratando conflitos sem simular sucesso local.

## Classificação dos cancelamentos existentes

**Estado**: classificação explícita implementada no domínio e na API comercial;
constraint final adiada para uma etapa segura de rollout.

Nesta primeira fatia, `acceptance-cancelled` é uma declaração humana auditada
válida somente depois da aprovação e antes de existir Serviço Confirmado. A API
consulta esse marco na mesma transação e recusa a reclassificação quando a
confirmação já ocorreu. Nesse caso, o histórico de aceite e confirmação fica
preservado e deve ser usado o futuro fluxo próprio de cancelamento do serviço e
de seus efeitos. A ausência desse fluxo permanece fechada: não se apaga a etapa
alcançada nem se transforma o caso em simples cancelamento de aceite.

Registros existentes sem evidência recebem `cancelamento legado não
classificado` e aparecem separadamente nos indicadores até revisão manual.
Novos encerramentos registram sua etapa específica. Nenhum histórico é apagado
e o sistema não tenta inferir uma classificação.

A primeira migration adiciona a coluna e faz o backfill, mas tolera por um
período instâncias antigas ainda em execução. Depois do rollout integral, uma
migration posterior deverá refazer o backfill e ativar a constraint final.

## Decisões de segurança concluídas

**SEC-01 — Gerência e Cadastro temporário (opção B aprovada)**: o teto de
Gerência inclui `clients:create` e `clients:update`, permitindo que essas
capacidades sejam atribuídas individualmente para operar tanto Cadastros
temporários quanto normais.

**SEC-02 — Leitura de Cadastros pela Gerência (opção A aprovada)**:
`clients:view` também entra no teto de Gerência, permitindo listar, consultar e
carregar o catálogo das telas de Cadastros. As três capacidades continuam sendo
atribuídas individualmente em `permissionCodes`; pertencer à Gerência não as
ativa sozinho. As decisões não concedem `clients:manage`, acesso ao histórico,
permissões comerciais ou autoridade administrativa, e os guards, o tenant e as
regras de domínio continuam aplicáveis.

**ADR-0013 — Autoridade e atendimento**: RH e Departamento Pessoal permanecem
separados com o mesmo teto documental; `whatsapp-conversations:attend` é
individual e transversal somente a departamentos internos; `directorate` com
`tenant:manage` individual representa autoridade ampla de negócio; Gerência
usa capacidades estreitas; e o Administrador da Instalação permanece uma
autoridade total distinta. Responsável de conversa é referência corrente e
supervisão é capacidade, sempre com versão esperada e auditoria.

## Endurecimentos concorrenciais

O `PATCH /users/:id` exige `commandId` e `expectedVersion`, trava e revalida o
responsável e o alvo, incrementa a versão do cadastro e grava o recibo
idempotente, o histórico e a auditoria dentro da mesma transação. O mesmo
comando com o mesmo conteúdo não repete a mutação; conteúdo divergente ou versão
antiga retorna conflito. O Tenant Web deve consumir `version` da resposta e não
inferir concorrência apenas a partir de `updatedAt`.

Quando a alteração de perfil recalcula documentos do funcionário, a
sincronização usa o mesmo `commandId` e registra seu recibo no histórico da
atualização. Um retry conclui uma falha posterior ao PATCH sem criar outra
solicitação, incrementar novamente sua versão ou duplicar a auditoria.

Uploads de mídia do painel usam uma única chave imutável por tenant, conversa e
identidade idempotente da mensagem; conteúdo divergente não cria uma segunda
chave. Falhas ambíguas continuam preservando o blob para não apagar uma mídia
que possa ter sido confirmada. Antes de produção com alto volume, falta o job
de reconciliação/quota para remover somente blobs comprovadamente órfãos de
comandos distintos, sem depender de limpeza síncrona insegura.

## Titular cadastral e classificação genérica

Solicitações documentais já aceitam `subjectRegistrationId` para PF/PJ e preservam
`subjectUserId` como compatibilidade. A associação pessoal autorizada também é
considerada em Meus documentos. Isso é distinto da classificação genérica por
envio descrita acima: titularidade de veículo, contrato, orçamento e viagem,
relações secundárias e ingestão pública de pré-admissão ainda exigem evolução.
