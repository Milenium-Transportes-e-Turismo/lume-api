---
status: accepted
supersedes-in-part: ADR-0005
---

# Autoridade do tenant e atendimento são capacidades explícitas

RH e Departamento Pessoal permanecem departamentos distintos, embora possuam o
mesmo teto de capacidades documentais; essa equivalência não define qual deles
é responsável por cada tipo de documento. A capacidade individual
`whatsapp-conversations:attend` é transversal a todos os departamentos internos
catalogados, atuais ou futuros, e nunca se aplica a `client-company`. O
responsável de uma conversa é a referência corrente, não um bloqueio exclusivo:
qualquer usuário autorizado no escopo pode atuar ou substituir essa referência,
sempre com `expectedVersion` e histórico auditável.

Diretoria e Gerência não são sinônimos. Um integrante de `directorate` somente
recebe autoridade ampla sobre o negócio do tenant quando também recebe
individualmente `tenant:manage`. A Gerência continua limitada às capacidades
estreitas atribuídas para cada processo. O Administrador da Instalação Lume
possui autoridade total sobre a instalação e é diferente de ambos. Supervisão
é uma capacidade explícita, e não um cargo, departamento ou perfil rígido.

## Consequências

Pertencer a RH, Departamento Pessoal, Diretoria ou Gerência não ativa sozinho
as capacidades descritas. A condução operacional de uma conversa exige
`whatsapp-conversations:attend` ou uma autoridade ampla explicitamente
reconhecida; pertencer a um departamento nunca basta. Catálogo dinâmico de
departamentos e responsabilidade documental por tipo continuam lacunas mesmo
depois da publicação dos novos códigos de autoridade.

O catálogo administrativo de usuários aplica a mesma proteção das operações
individuais: somente um Administrador da Instalação visualiza outras contas
administradoras ou integrantes da Diretoria que possuam `tenant:manage`.
