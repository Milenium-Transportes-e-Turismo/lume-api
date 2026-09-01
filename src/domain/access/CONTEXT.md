# Acesso

Este contexto define capacidades e escopos de uso do Lume, separando a
estrutura organizacional da autorização efetiva.

## Linguagem

**Departamento**:
Parte configurável da estrutura organizacional da empresa operadora.
_Evite_: Permissão, perfil

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

**Restrição Explícita**:
Bloqueio que prevalece sobre qualquer capacidade concedida ao usuário.
_Evite_: Ausência de permissão

**Delegação**:
Concessão temporária de capacidades com início, término, motivo e escopo.
_Evite_: Permissão permanente, senha compartilhada

**Administradora da Plataforma**:
Autoridade que configura e governa a estrutura técnica do Lume sem assumir
automaticamente decisões de negócio.
_Evite_: Diretoria, Gerência

**Matriz de Aprovação**:
Política que define solicitantes, aprovadores, limites e tratamento de
emergências para uma ação de negócio.
_Evite_: Perfil de acesso
