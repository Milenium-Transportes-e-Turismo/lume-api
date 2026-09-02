# Mapa de Contextos

## Contextos

- [Identidade](./src/domain/identity/CONTEXT.md): distingue a pessoa, o vínculo
  de trabalho, o usuário e as identidades técnicas.
- [Cadastro Principal](./src/domain/registrations/CONTEXT.md): mantém a
  identidade canônica de pessoas e empresas, seus papéis e contatos.
- [Acesso](./src/domain/access/CONTEXT.md): decide o que cada usuário pode fazer
  e em qual área de atuação.
- [Comunicação](./src/domain/whatsapp/CONTEXT.md): mantém contatos de canal,
  conversas, mensagens e preferências de comunicação.
- [Comercial](./src/domain/commercial/CONTEXT.md): conduz oportunidades,
  orçamentos, negociações, aceites e pré-reservas.
- [Operação de Viagens](./src/domain/trips/CONTEXT.md): mantém viagens,
  programação, execução, ocorrências e desvios.
- [Planejamento de Rotas](./src/domain/routing/CONTEXT.md): mantém planos de
  trajeto, paradas e suas versões aprovadas.
- [Documentos](./src/domain/documents/CONTEXT.md): mantém solicitações,
  arquivos, versões, evidências e pastas documentais.
- [Políticas de Negócio](./src/domain/policies/CONTEXT.md): mantém parâmetros
  configuráveis de tipos conhecidos, sua vigência e aprovação.

## Relacionamentos

- **Identidade → Cadastro Principal**: um usuário humano referencia a pessoa
  correspondente, mas possuir cadastro não concede acesso ao sistema.
- **Cadastro Principal → demais contextos**: os demais contextos referenciam a
  pessoa ou empresa canônica e acrescentam somente seus próprios perfis.
- **Comunicação → Comercial e Operação de Viagens**: uma conversa pode iniciar
  ou acompanhar processos, mas não possui o estado desses processos.
- **Comercial → Operação de Viagens**: uma versão aceita do orçamento contém
  serviços propostos; depois da confirmação, esses serviços originam viagens.
- **Operação de Viagens → Planejamento de Rotas**: uma viagem pode possuir um
  plano de trajeto versionado, sem transformar o plano na própria viagem.
- **Comercial ↔ Operação de Viagens**: pré-reservas consultam a disponibilidade
  operacional e expiram sem transformar o orçamento em viagem confirmada.
- **Documentos → demais contextos**: cada documento possui um titular principal
  real e pode manter relações secundárias com outros contextos.
- **Acesso → demais contextos**: perfil concede capacidades, área de atuação
  limita o escopo e uma restrição explícita sempre bloqueia.
- **Políticas de Negócio → demais contextos**: cada operação preserva a versão
  da política usada quando foi decidida.
