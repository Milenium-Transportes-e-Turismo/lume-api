# Ingestão e governança de pedágios

## Pipeline

```text
ANTT / órgão estadual / concessionária
  -> download controlado
  -> normalização
  -> validação humana e automática
  -> importação transacional
  -> publicação
```

O contrato `TollDataImporter` reserva `importTollPoints()` e
`importTollTariffs()` para comandos/jobs futuros. A primeira fase entrega o
schema e o matcher, mas deliberadamente não inclui scraping nem dataset de
produção. Cadastro manual autorizado usa `data_kind=MANUAL`; testes e seeds
explícitos usam `DEVELOPMENT_FIXTURE`.

Há uma amostra idempotente e deliberadamente fictícia em
`prisma/fixtures/routing-tolls.development.sql`. Ela não é executada por migration
nem bootstrap. Em um laboratório descartável, aplique-a manualmente e habilite
`TOLL_ALLOW_DEVELOPMENT_FIXTURES=true`; o padrão continua `false` em todos os
ambientes.

Todo registro importado conserva `source`, `source_reference`,
`source_updated_at` e `imported_at`. Uma tarifa nova cria outro período; nunca
sobrescreva histórico. Antes de publicar um lote valide:

- coordenadas e SRID 4326;
- rodovia, UF, km, tipo físico/free flow e sentido;
- concessão e concessionária;
- categoria e faixa de eixos;
- preço não negativo e vigência sem sobreposição indevida;
- fonte oficial e data de referência;
- amostras espaciais em rotas conhecidas nos dois sentidos.

Correções manuais precisam de usuário, justificativa e auditoria em uma evolução
do importador. Produção deve manter `TOLL_ALLOW_DEVELOPMENT_FIXTURES=false`.

## Pesquisa assistida de lacunas

O agente de inteligência não substitui o pipeline oficial. Ele recebe a rota
calculada, uma amostra limitada da geometria, rodovias reconhecidas, veículo,
data e o resultado do PostGIS. Se a base interna estiver completa, nenhuma
chamada de IA é realizada. Quando houver lacuna e o recurso estiver habilitado,
o agente pesquisa fontes atuais e pode devolver uma faixa estimada.

Uma resposta estimada precisa conter quantidade, mínimo, valor provável,
máximo, confiança, premissas e pelo menos uma URL citada. Ela nunca é importada
automaticamente. Para transformar uma descoberta em tarifa oficial ainda é
necessário normalizar, revisar, importar transacionalmente e publicar pelo
pipeline acima.

## Limitações atuais

O corredor padrão é 60 m e pode ser ajustado por ambiente. Proximidade + rumo é
uma primeira estratégia, não uma prova de passagem. Free Flow está modelado,
mas descontos, cobrança por trecho, TAG, evasão e regras comerciais específicas
ainda não estão implementados.
