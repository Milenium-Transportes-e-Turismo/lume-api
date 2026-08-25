# API do Lume Routing Core

## Calcular rota

`POST /api/v1/routing/calculations`

Exige JWT do tenant e permissão `route-planner:calculate`. O frontend fala apenas
com esta API; Valhalla, Nominatim e PostGIS não são expostos.

```json
{
  "origin": { "address": "Uberlândia - MG" },
  "destination": { "address": "Belo Horizonte - MG" },
  "waypoints": [],
  "roundTrip": false,
  "vehicle": {
    "type": "bus",
    "axles": 3,
    "fuelType": "diesel",
    "consumptionKmPerLiter": 3.1
  },
  "fuelPricePerLiter": 6.2,
  "travelDate": "2026-08-18"
}
```

Origem, destino e cada parada aceitam alternativamente `lat` e `lng`; quando
ambos são válidos o Nominatim não é chamado. A ordem de até dez paradas é
preservada. Tipos de veículo: `car`, `van`, `minibus`, `bus`, `truck`; eixos: 2–9.

A resposta inclui:

- locais resolvidos e sua origem (`coordinates` ou `nominatim`);
- `route.outbound`, `route.return` e totais estimados;
- geometria GeoJSON `LineString`, polylines e instruções;
- pedágios ordenados com fonte, vigência e `tariffStatus`;
- litros e combustível estimados;
- custo agregado e indicador de completude;
- tenant, identificador, horário e versões do cálculo.

Erros previsíveis usam códigos como `GEOCODING_NOT_FOUND`, `INVALID_COORDINATES`,
`INVALID_VEHICLE_CONFIGURATION`, `INVALID_FUEL_CONSUMPTION`, `ROUTE_NOT_FOUND`,
`ROUTING_UNAVAILABLE` e `TOLL_DATA_UNAVAILABLE`.

## Teste manual

Depois de autenticar e obter o token:

```bash
curl -X POST http://localhost:3000/api/v1/routing/calculations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @route-request.json
```

Sem dataset oficial de pedágios, a rota e o combustível ainda são calculados,
mas `tolls.dataStatus` será `unavailable`, `cost.complete` será `false` e nenhum
valor será inventado.
