# Lume Routing Core

## Escopo desta primeira fase

O núcleo calcula uma rota técnica entre origem, paradas e destino e devolve
distância, duração, geometria GeoJSON, instruções, pedágios, combustível e custo.
Ele é independente de contrato, orçamento ou rota operacional e não usa QualP,
Google Maps nem IA para cálculos determinísticos.

```text
Web -> Tenant API -> CalculateRouteUseCase
                         |-- GeocodingProvider -> Nominatim
                         |-- RoutingProvider   -> Valhalla
                         |-- TollMatcher       -> PostgreSQL/PostGIS
                         |-- FuelCostService
                         `-- CostEngineService
```

O controller conhece somente o caso de uso. Nominatim e Valhalla ficam atrás de
ports em `src/application/contracts`; a troca de provider não altera domínio ou
HTTP. `RoutingMatrixProvider` e `RouteOptimizationProvider` definem as fronteiras
futuras de Matrix/OR-Tools sem implementar um otimizador falso.

## Dados e tenancy

O cálculo não é persistido nesta fase, mas sempre recebe a identidade autenticada
e devolve `tenant.companyId`. Um futuro `RoutePlan` deverá guardar esse campo.
Veículos continuam sendo informados manualmente porque não há entidade `Vehicle`
no código atual; nenhuma tabela duplicada foi criada.

Rodovias, concessionárias, concessões, pontos e tarifas são dados públicos globais.
`TollPoint.location` é `geography(Point,4326)`: a distância do corredor é expressa
em metros e funciona corretamente fora de uma projeção local. O índice GiST evita
carregar a base inteira. Dados privados futuros permanecem tenant-scoped.

## Pedágios

O matcher `postgis-corridor-heading-v1` executa uma única consulta espacial:

1. seleciona pontos ativos dentro do corredor configurado;
2. posiciona cada ponto ao longo da linha para ordenar o resultado;
3. estima o rumo local e descarta sentidos incompatíveis;
4. seleciona lateralmente a categoria/eixos e a tarifa vigente em `travelDate`.

A aproximação ainda não confirma a rodovia do segmento e pode produzir falso
positivo em trevos, pistas paralelas ou sobrepostas. A evolução prevista é usar
atributos de edge/segmento do Valhalla e map matching. Tarifa ausente retorna
`tariffStatus=missing`, `complete=false`; dataset vazio retorna
`dataStatus=unavailable`. Fixtures só entram quando
`TOLL_ALLOW_DEVELOPMENT_FIXTURES=true`.

## Ida e volta e precisão

`roundTrip=true` dispara dois cálculos Valhalla independentes, com os locais em
ordem inversa na volta, e dois matches de pedágio. Distância, duração e
combustível são marcados como estimados. O resultado inclui engine, versão,
versão do grafo, data do cálculo, data tarifária e um campo reservado para a
versão publicada do dataset de pedágios.

## Cache e próximos componentes

Não havia Redis no projeto e esta fase não adiciona outro datastore. Antes de
cache distribuído, a chave deverá incorporar coordenadas ordenadas, perfil,
opções, versão do grafo e data tarifária. Geocoding poderá usar endereço
normalizado + versão do dataset. A próxima fase pode adicionar Redis único,
Matrix Valhalla, OR-Tools e persistência separada de `RoutePlan` e rota operacional.
