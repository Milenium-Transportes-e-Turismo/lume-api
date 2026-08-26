# Lume Routing Core

## Escopo desta primeira fase

O núcleo calcula uma rota técnica entre origem, paradas e destino e devolve
distância, duração, geometria GeoJSON, instruções, pedágios, combustível e custo.
Ele é independente de contrato, orçamento ou rota operacional e não usa QualP
nem Google Maps. Rota, match espacial, combustível e custo verificado continuam
determinísticos; IA aparece apenas como pesquisa opcional de lacunas tarifárias.

```text
Web -> Tenant API -> CalculateRouteUseCase
                         |-- GeocodingProvider     -> HeiGIT Pelias
                         |-- RoutingProvider       -> OpenRouteService
                         |-- TollMatcher           -> PostgreSQL/PostGIS
                         |-- TollIntelligenceAgent -> pesquisa web opcional
                         |-- FuelCostService
                         `-- CostEngineService
```

O controller conhece somente o caso de uso. OpenRouteService e Pelias ficam
atrás de ports em `src/application/contracts`; a troca de provider não altera
domínio ou HTTP. Os adaptadores Valhalla/Nominatim continuam no repositório para
uma futura infraestrutura dedicada, mas `RoutePlannerModule` não os importa nem
registra. `RoutingMatrixProvider` e `RouteOptimizationProvider` definem as
fronteiras futuras de Matrix/OR-Tools sem implementar um otimizador falso.

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
atributos de edge/segmento e map matching. Tarifa ausente retorna
`tariffStatus=missing`, `complete=false`; dataset vazio retorna
`dataStatus=unavailable`. Fixtures só entram quando
`TOLL_ALLOW_DEVELOPMENT_FIXTURES=true`.

## Fronteira do agente de inteligência

O `TollIntelligenceAgent` é chamado depois do matcher e somente pesquisa quando
o resultado interno está incompleto. A implementação usa Responses API com
pesquisa web, saída JSON estruturada e `store=false`. Uma estimativa só é aceita
quando possui ao menos uma URL realmente citada na resposta. Falha, timeout,
JSON inválido ou ausência de citação tornam o resultado `unavailable`, sem fazer
o cálculo da rota falhar.

O agente não grava no PostGIS, não altera vigências, não promove uma estimativa
a dado oficial e não participa de `tolls.total` ou `cost.tolls`. O contrato HTTP
expõe `tolls.intelligence.usedInVerifiedTotal=false` para tornar essa separação
inequívoca. A chave do agente é independente das demais chaves de IA da API.

## Ida e volta e precisão

`roundTrip=true` dispara dois cálculos ORS independentes, com os locais em
ordem inversa na volta, e dois matches de pedágio. Distância, duração e
combustível são marcados como estimados. O resultado inclui engine, versão,
versão do grafo, data do cálculo, data tarifária e um campo reservado para a
versão publicada do dataset de pedágios.

## Cache e próximos componentes

Não havia Redis no projeto e esta fase não adiciona outro datastore. Antes de
cache distribuído, a chave deverá incorporar coordenadas ordenadas, perfil,
opções, versão do grafo e data tarifária. Geocoding poderá usar endereço
normalizado + versão do dataset. A próxima fase pode adicionar Redis único,
Matrix ORS, OR-Tools e persistência separada de `RoutePlan` e rota operacional.
