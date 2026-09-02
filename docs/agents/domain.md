# Documentação de domínio

Como as skills de engenharia devem consumir a documentação de domínio deste repositório ao explorar o código.

## Leia antes de explorar

- **`CONTEXT.md`** na raiz do repositório; ou
- **`CONTEXT-MAP.md`**, caso exista, apontando para um `CONTEXT.md` por contexto. Leia os contextos relevantes ao trabalho.
- **`docs/adr/`**: leia os ADRs relacionados à área que será alterada. Em repositórios multi-context, verifique também `src/<context>/docs/adr/`.

Se algum desses arquivos não existir, prossiga silenciosamente. Não sinalize sua ausência nem proponha sua criação antecipada. A skill `/domain-modeling` os cria gradualmente quando termos ou decisões forem realmente definidos.

## Estrutura dos arquivos

Este repositório usa o layout multi-contexto:

```text
/
├── CONTEXT-MAP.md
├── docs/adr/
│   ├── 0001-exemplo-de-decisao.md
│   └── 0002-outra-decisao.md
└── src/domain/<contexto>/CONTEXT.md
```

Em um eventual repositório multi-context, a presença de `CONTEXT-MAP.md` indica o seguinte layout:

```text
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← decisões de todo o sistema
└── src/
    ├── contexto-a/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← decisões específicas do contexto
    └── contexto-b/
        ├── CONTEXT.md
        └── docs/adr/
```

## Use o vocabulário do glossário

Quando uma saída nomear um conceito de domínio — em títulos de issues, propostas de refatoração, hipóteses ou nomes de testes — use o termo definido em `CONTEXT.md`. Não adote sinônimos que o glossário rejeite explicitamente.

Se o conceito necessário não estiver no glossário, reavalie se o termo pertence ao projeto ou registre a lacuna para `/domain-modeling`.

## Sinalize conflitos com ADRs

Se uma proposta contradisser um ADR existente, indique o conflito explicitamente em vez de substituir silenciosamente a decisão:

> Contradiz o ADR-0007, mas vale reabrir a decisão porque…
