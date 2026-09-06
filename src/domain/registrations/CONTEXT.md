# Cadastro Principal

Este contexto mantém a identidade canônica de pessoas e empresas utilizada
pelos demais contextos, sem pertencer a um departamento específico.

## Linguagem

**Cadastro Principal**:
Registro canônico de uma pessoa ou empresa no tenant.
_Evite_: Cliente, RoutingCompany, conta

**Pessoa**:
Cadastro principal de uma pessoa física.
_Evite_: Usuário, funcionário, motorista

**Empresa**:
Cadastro principal de uma pessoa jurídica.
_Evite_: Cliente, fornecedor, conta

**Papel**:
Forma como uma pessoa ou empresa participa do negócio, como cliente,
fornecedor, funcionário, prestador de serviço ou passageiro; papéis podem coexistir.
_Evite_: Tipo exclusivo, perfil de acesso

**Contato**:
Telefone ou endereço eletrônico pertencente ao cadastro principal, inclusive
quando compartilhado por mais de uma pessoa.
_Evite_: Contato de WhatsApp, usuário

**Cadastro Temporário**:
Cadastro principal incompleto criado para uma necessidade emergencial, com
motivo, responsável e prazo de regularização.
_Evite_: Cadastro descartável

**Duplicidade**:
Cadastro identificado como representação repetida de outra pessoa ou empresa,
preservado para manter o histórico.
_Evite_: Cadastro excluído

**Consolidação**:
Ação manual que escolhe o cadastro principal, corrige seus vínculos e preserva
o registro duplicado no histórico.
_Evite_: Fusão automática, exclusão de duplicidade

**Perfil Contextual**:
Registro que acrescenta dados próprios de um contexto a um cadastro principal,
como acesso, passageiro ou contato de canal.
_Evite_: Segunda identidade

**Marcador Motorista**:
Característica operacional da pessoa, compatível com seus papéis explícitos. O papel legado permanece no histórico; novos cadastros usam o marcador.

## Perfil, endereço e documentos

O endereço cadastral reutiliza RoutingFixedPoint, com código ADR por pessoa e histórico
no agregado. RoutingCompany.documentProfile é a fonte canônica do perfil documental PF.
Campos legados em User são preservados; o backfill exige vínculo explícito e perfis
sem divergência. DocumentRequest.subjectRegistrationId identifica o titular sem exigir
conta. subjectUserId permanece nos fluxos legados e não recebe IDs de Cadastro.
A aprovação da conciliação cria o grafo oficial e promove o candidato na mesma transação.
serviceInstructions exige identidade confirmada e entra como contexto subordinado.
Não modifica ferramentas, escopo nem instruções da plataforma.
