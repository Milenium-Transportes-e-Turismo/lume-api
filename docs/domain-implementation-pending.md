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
obriga `subjectUserId`, `submittedByUserId` e `uploadedByUserId`. A próxima
etapa deve conectar o Titular Principal genérico ao fluxo e ao armazenamento
documental existentes, sem criar `User` temporário e sem persistir bytes em uma
esteira paralela.

**Decisão organizacional concluída**: RH e Departamento Pessoal possuem o mesmo
teto de capacidades documentais e ambos podem administrar a pré-admissão quando
recebem individualmente `documents:manage`. `human-resources` continua
suportado para contas legadas; Departamento Pessoal continua sendo a opção
atribuível no catálogo atual. Esta decisão documental não cria, por si só, um
segundo departamento ou fila de WhatsApp.

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

**Estado**: projeção determinística do acesso legado implementada; novo modelo
de perfis e restrições ainda não ativado no runtime.

Perfis e áreas entram de forma aditiva e inicialmente reproduzem o acesso
efetivo atual. Administradores preservam sua autoridade. Restrições novas só
prevalecem depois de registradas e revisadas, mantendo a proteção do último
administrador ativo e um caminho de reversão.

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
dentro das transações; a Administradora não substitui essas responsabilidades.
Dispensas `not-applicable` permanecem bloqueadas até existir uma capacidade
estreita de Gerência/Diretoria aprovada.

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

**Estado**: proteção autoritativa de devolução ao bot e fluxo explícito de
solicitação/aceite implementados; política de exceção por supervisão permanece
fechada em modo seguro.

Somente o atendente atribuído pode executar `return-to-bot`, com a validação
dentro da transação. Uma transferência nova registra destino e motivo, mas
mantém o atendimento ativo, o departamento e o responsável de origem até o
aceite. A pendência aparece na fila do destino e somente um usuário ativo desse
departamento pode aceitá-la; o aceite troca departamento e responsável na mesma
transação. Até existir uma decisão explícita sobre autoridade de supervisores,
nenhum perfil recebe exceção implícita. O encaminhamento legado é mantido como
alias, mas exige motivo e produz a mesma espera por aceite. A mudança direta de
departamento também exige motivo e não pode contornar uma atribuição humana.
Consultas por identificador, histórico, proposta e mídia respeitam o
departamento atual ou o destino pendente. Ações genéricas também são revalidadas
na transação; assumir ou encerrar não substitui silenciosamente outro atendente.

O contrato está implementado no backend, mas o rollout geral permanece
bloqueado pela matriz atual: `whatsapp-conversations:manage` pertence ao teto do
Comercial, e um usuário somente de Operacional ou Financeiro não consegue
recebê-lo por atribuição individual. Não se deve adicionar Comercial
artificialmente para contornar esse limite. A definição de quais departamentos
recebem essa capacidade, ou de uma capacidade separada para aceitar
transferências, permanece uma decisão de autorização e não foi ampliada por
inferência.

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
