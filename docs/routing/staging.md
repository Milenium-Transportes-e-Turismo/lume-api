# Ativação do Routing Core no lume-staging

Este roteiro pressupõe que a branch de trabalho já foi validada e integrada à
branch `develop`. Nunca implante diretamente uma branch de trabalho na VPS.

## 1. Criar as chaves sem expô-las

1. Crie uma chave no painel HeiGIT para OpenRouteService/Pelias.
2. Crie um projeto/chave de IA exclusivo para inteligência de pedágios, com
   limite de gasto próprio.
3. Grave os valores somente no `.env.staging` da VPS. Não cole as chaves em
   chat, issue, commit ou histórico do shell.

Comece com o agente desligado:

```dotenv
HEIGIT_BASE_URL=https://api.heigit.org
HEIGIT_API_KEY=<segredo-heigit>
ROUTING_TIMEOUT_MS=15000
ORS_VERSION=
ORS_MAP_DATA_VERSION=
TOLL_MATCH_CORRIDOR_METERS=60
TOLL_ALLOW_DEVELOPMENT_FIXTURES=false
TOLL_INTELLIGENCE_ENABLED=false
TOLL_INTELLIGENCE_OPENAI_API_KEY=<segredo-exclusivo-do-agente>
TOLL_INTELLIGENCE_OPENAI_BASE_URL=https://api.openai.com/v1
TOLL_INTELLIGENCE_OPENAI_MODEL=gpt-5.4-mini
TOLL_INTELLIGENCE_TIMEOUT_MS=90000
```

Remova do ambiente de staging as variáveis antigas `VALHALLA_URL`,
`NOMINATIM_URL`, `VALHALLA_VERSION` e `VALHALLA_MAP_DATA_VERSION`. Elas não são
mais lidas pela aplicação. Não crie containers Valhalla/Nominatim nessa VPS.

## 2. Conferir o Compose antes de alterar containers

No diretório usado pelo deploy de staging:

```bash
docker compose -p lume-staging \
  --env-file .env.staging \
  -f compose.prod.yml \
  -f compose.vps.yml \
  config >/tmp/lume-staging-compose.rendered.yml

grep -E 'HEIGIT_BASE_URL|TOLL_INTELLIGENCE_ENABLED' \
  /tmp/lume-staging-compose.rendered.yml
```

Não pesquise `API_KEY` no arquivo renderizado porque isso exibiria segredos no
terminal. Apague o arquivo temporário depois da conferência:

```bash
rm -f -- /tmp/lume-staging-compose.rendered.yml
```

## 3. Atualizar e validar

Execute o script normal de staging depois do merge. Em seguida:

```bash
docker exec lume-staging-api npm run routing:check-services

docker inspect lume-staging-api \
  --format '{{range .Config.Env}}{{println .}}{{end}}' |
grep -E '^(HEIGIT_BASE_URL|ROUTING_TIMEOUT_MS|TOLL_INTELLIGENCE_ENABLED|TOLL_INTELLIGENCE_OPENAI_MODEL)='
```

Não inclua `HEIGIT_API_KEY` ou `TOLL_INTELLIGENCE_OPENAI_API_KEY` no `grep`.

## 4. Testar em duas fases

Com `TOLL_INTELLIGENCE_ENABLED=false`, teste endereço, coordenadas, paradas,
ida/volta, ônibus de dois/três eixos e rotas sem pedágio. Confirme que a resposta
usa `engine=openrouteservice`, origem `pelias` para endereços e
`tolls.intelligence.status=disabled` quando a base estiver incompleta.

Depois altere `TOLL_INTELLIGENCE_ENABLED=true` e recrie somente os serviços que
dependem da imagem/ambiente da API pelo fluxo normal de deploy. Repita rotas
conhecidas e confira:

- estimativa possui fontes, premissas, faixa e confiança;
- `tolls.intelligence.usedInVerifiedTotal=false`;
- `tolls.total` e `cost.tolls` continuam contendo apenas dados PostGIS;
- ausência de evidência retorna `unavailable`, sem falhar a rota.

Durante os testes, mantenha o terminal de diagnóstico descrito em
[operations.md](operations.md). Ao terminar, confira quotas e custos nos painéis
HeiGIT/OpenAI e preserve o log sem segredos junto das evidências do staging.
