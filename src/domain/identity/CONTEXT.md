# Identidade

Este contexto separa identidade humana, vínculo com a empresa e acesso ao
sistema. Ele existe para que desligar um acesso nunca apague a pessoa nem seu
histórico.

## Linguagem

**Usuário**:
Identidade que pode autenticar e receber permissões no Lume.
_Evite_: Funcionário, pessoa, cadastro

**Vínculo de Trabalho**:
Relação profissional entre uma pessoa e a empresa operadora, com início,
situação e eventual término.
_Evite_: Usuário, conta

**Candidato**:
Pessoa participante de um processo seletivo antes da criação de um vínculo de
trabalho.
_Evite_: Usuário pendente, candidato de importação

**Acesso de Pré-admissão**:
Acesso temporário por link seguro, limitado à finalidade informada e sem criar
um usuário por padrão.
_Evite_: Login completo, conta de candidato

**Escopo Documental de Pré-admissão**:
Conjunto de evidências admissionais que uma pessoa pode apresentar pelo seu
acesso de pré-admissão, sem acesso a outros dados ou processos do Lume.
_Evite_: Portal completo, dossiê público

**Identidade Técnica**:
Identidade própria de uma integração, separada das credenciais de qualquer
pessoa.
_Evite_: Usuário compartilhado, login de integração humano

**Desligamento**:
Término do vínculo de trabalho que bloqueia imediatamente o acesso e preserva
o histórico da pessoa.
_Evite_: Exclusão do usuário, remoção do histórico
