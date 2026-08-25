# Operação dos serviços geográficos

## Dependências

- PostgreSQL com PostGIS no banco operacional do tenant;
- Valhalla self-hosted, acessível somente pela API;
- Nominatim self-hosted em implantação e banco próprios;
- extrato `.osm.pbf` compatível entre Valhalla e Nominatim.

O compose principal usa `postgis/postgis:17-3.5-alpine`. Nominatim mantém banco
próprio porque seu esquema, importação, atualização e consumo de recursos são
operacionalmente diferentes do banco do Lume. Valhalla e Nominatim não devem ser
publicados na internet; exponha-os apenas na rede privada da VPS/Compose.

## Preparação

1. Escolha um extrato regional do OpenStreetMap para desenvolvimento.
2. Baixe o `.osm.pbf` fora do repositório; nunca faça commit do arquivo.
3. Importe o extrato no Nominatim conforme a documentação da versão implantada.
4. Gere os tiles/grafo Valhalla com o mesmo extrato e registre a versão em
   `VALHALLA_MAP_DATA_VERSION`.
5. Execute as migrations Prisma no banco PostGIS.
6. Configure as URLs privadas e confirme a saúde dos serviços.

```powershell
$env:VALHALLA_URL = 'http://127.0.0.1:8002'
$env:NOMINATIM_URL = 'http://127.0.0.1:8080'
node scripts/routing/check-services.mjs
npm.cmd run prisma:deploy
```

Para ampliar de uma região ao Brasil inteiro, estime armazenamento, RAM e janela
de reconstrução antes da troca. Faça import/rebuild em volume novo, valide
`/status` e somente depois altere o serviço ativo. O retorno deve manter o volume
anterior até a validação.

## Atualização e atribuição

Defina uma cadência explícita para baixar novo extrato, atualizar Nominatim,
reconstruir Valhalla e alterar `VALHALLA_MAP_DATA_VERSION`. O mapa visual futuro
deve mostrar atribuição OpenStreetMap. Dados OSM são ODbL; Valhalla, Nominatim,
MapLibre e futuro OR-Tools mantêm suas próprias licenças, que devem acompanhar a
distribuição utilizada.

Tiles públicos padrão do OpenStreetMap não são infraestrutura de produção. Use
servidor próprio, OpenMapTiles/PMTiles ou provedor compatível com MapLibre e com
termos adequados ao tráfego esperado.

## Saúde e incidentes

Os logs estruturados não contêm endereços: `routing.request`,
`routing.success/error`, `geocoding.request/error` e `toll.match/not_found`.
Timeout é controlado por `ROUTING_TIMEOUT_MS`. Indisponibilidade de geocoding,
roteamento ou pedágio é traduzida para um código público específico; não exponha
corpos de resposta dos providers ao cliente.
