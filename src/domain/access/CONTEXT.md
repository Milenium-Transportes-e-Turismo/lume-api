# Acesso

Este contexto define capacidades e escopos de uso do Lume, separando a
estrutura organizacional da autorização efetiva.

## Linguagem

**Departamento**:
Parte configurável da estrutura organizacional da empresa operadora.
_Evite_: Permissão, perfil

**Departamento Interno**:
Departamento da empresa operadora elegível a capacidades transversais de
trabalho, sem recebê-las automaticamente.
_Evite_: Empresa cliente, perfil de acesso

**RH e Departamento Pessoal**:
Departamentos internos distintos com o mesmo teto de capacidades documentais,
sem que essa equivalência determine o responsável por cada documento.
_Evite_: Departamento único, nomes equivalentes

**Cargo**:
Posição ocupada por uma pessoa em seu vínculo de trabalho.
_Evite_: Perfil de acesso

**Área de Atuação**:
Escopo no qual uma capacidade pode ser exercida, como Turismo ou Contínuo.
_Evite_: Departamento, permissão

**Perfil de Acesso**:
Conjunto reutilizável de capacidades concedidas a usuários.
_Evite_: Cargo, departamento

**Projeção de Compatibilidade**:
Retrato determinístico do acesso efetivo no modelo anterior, usado para
comparar uma migração sem participar da autorização.
_Evite_: Novo perfil ativo, concessão automática

**Permissão**:
Capacidade específica concedida por um perfil ou excepcionalmente a um
usuário.
_Evite_: Área de atuação

**Gestão do Tenant**:
Autoridade ampla sobre o negócio do tenant, concedida individualmente por
`tenant:manage` a um integrante da Diretoria.
_Evite_: Gerência, administração da instalação

**Restrição Explícita**:
Bloqueio que prevalece sobre qualquer capacidade concedida ao usuário.
_Evite_: Ausência de permissão

**Delegação**:
Concessão temporária de capacidades com início, término, motivo e escopo.
_Evite_: Permissão permanente, senha compartilhada

**Diretoria**:
Departamento de direção cujo integrante pode receber individualmente a Gestão
do Tenant; pertencer à Diretoria, sozinho, não concede autoridade ampla.
_Evite_: Gerência, Administrador da Instalação

**Gerência**:
Departamento cuja autoridade permanece limitada às capacidades estreitas
atribuídas para cada processo.
_Evite_: Diretoria, autoridade ampla por departamento

**Administrador da Instalação Lume**:
Autoridade total sobre a instalação e seu tenant, separada da Diretoria e da
Gerência. Recebe todo o catálogo efetivo atual, inclusive `service:*`, sem
depender de departamentos ou concessões individuais materializadas.
_Evite_: Diretoria, Gerência, supervisor

**Supervisão**:
Capacidade explícita para acompanhar ou intervir em um processo conforme seu
escopo, sem constituir cargo, perfil ou departamento rígido.
_Evite_: Cargo Supervisor, bypass implícito

**Matriz de Aprovação**:
Política que define solicitantes, aprovadores, limites e tratamento de
emergências para uma ação de negócio.
_Evite_: Perfil de acesso

**Comando de Alteração de Usuário**:
Mutação identificada por `commandId` e condicionada à `expectedVersion` do
cadastro. Atualização, recibo idempotente, histórico e auditoria formam uma só
transação.
_Evite_: PATCH sem versão, auditoria posterior
