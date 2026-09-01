# Rastreador de issues: GitHub

As issues e especificações deste repositório ficam no GitHub Issues. Use a CLI `gh` para todas as operações.

## Convenções

- **Criar uma issue**: `gh issue create --title "..." --body "..."`. Para textos com várias linhas, use `--body-file`.
- **Ler uma issue**: `gh issue view <number> --comments`, incluindo comentários e etiquetas.
- **Listar issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`, com os filtros adequados de `--label` e `--state`.
- **Comentar em uma issue**: `gh issue comment <number> --body "..."`
- **Aplicar ou remover etiquetas**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Fechar uma issue**: `gh issue close <number> --comment "..."`

Determine o repositório por meio de `git remote -v`; a CLI `gh` faz isso automaticamente quando executada dentro deste clone.

## Pull requests como superfície de triagem

**PRs as a request surface: no.** _(Altere para `yes` se este repositório passar a tratar PRs externos como solicitações; `/triage` lê esta configuração.)_

Quando configurado como `yes`, os PRs usam as mesmas etiquetas e estados das issues:

- **Ler um PR**: `gh pr view <number> --comments` e `gh pr diff <number>`.
- **Listar PRs externos para triagem**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`; mantenha apenas `authorAssociation` igual a `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR` ou `NONE`.
- **Comentar, etiquetar ou fechar**: use `gh pr comment`, `gh pr edit --add-label`/`--remove-label` e `gh pr close`.

GitHub compartilha a numeração entre issues e PRs. Para resolver uma referência como `#42`, tente `gh pr view 42` e, se não for um PR, use `gh issue view 42`.

## Quando uma skill disser “publish to the issue tracker”

Crie uma issue no GitHub.

## Quando uma skill disser “fetch the relevant ticket”

Execute `gh issue view <number> --comments`.

## Operações de wayfinding

Usadas por `/wayfinder`. O **mapa** é uma única issue, e suas issues filhas são os tickets.

- **Mapa**: issue com a etiqueta `wayfinder:map`, contendo Notes, Decisions-so-far e Fog. Crie com `gh issue create --label wayfinder:map`.
- **Ticket filho**: issue vinculada ao mapa como sub-issue do GitHub. Quando sub-issues não estiverem disponíveis, adicione o ticket à lista de tarefas do mapa e inclua `Part of #<map>` no início do corpo. Use uma etiqueta `wayfinder:<type>` (`research`, `prototype`, `grilling` ou `task`). Depois de assumido, atribua o ticket ao desenvolvedor responsável.
- **Bloqueio**: use dependências nativas do GitHub. Adicione a relação com `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, onde `<blocker-db-id>` é o `id` numérico retornado por `gh api repos/<owner>/<repo>/issues/<n> --jq .id`. Quando dependências não estiverem disponíveis, use `Blocked by: #<n>, #<n>` no início do ticket.
- **Consulta da fronteira**: liste os filhos abertos do mapa, descarte os que possuem bloqueador aberto ou responsável atribuído e selecione o primeiro na ordem do mapa.
- **Assumir**: execute `gh issue edit <n> --add-assignee @me`; esta é a primeira escrita da sessão.
- **Resolver**: comente a resposta, feche o ticket e acrescente ao Decisions-so-far do mapa um ponteiro para o contexto produzido.
