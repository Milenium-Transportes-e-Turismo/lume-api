# Cancelamento legado não é adivinhado

Um registro antigo marcado apenas como `cancelled` recebe a classificação
`cancelamento legado não classificado` e aparece separadamente nos indicadores
até revisão humana. Novos encerramentos registram a etapa específica; inferir
uma classificação sem evidência foi rejeitado porque distorceria Comercial,
Operação e Financeiro.

O rollout é aditivo: primeiro entram coluna, backfill e aplicação compatível;
somente depois que todas as instâncias escreverem a classificação será ativada
a constraint final. Durante a janela, nulos tardios são apresentados como
`legacy-unclassified`, nunca como uma etapa presumida.
