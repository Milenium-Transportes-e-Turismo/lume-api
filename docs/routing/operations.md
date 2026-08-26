# Operação dos serviços geográficos

## Dependências ativas

- PostgreSQL com PostGIS no banco operacional do tenant;
- OpenRouteService hospedado pela HeiGIT para rota, distância e duração;
- Pelias hospedado pela HeiGIT para geocodificação;
- Responses API com pesquisa web, somente quando a inteligência de pedágios
  estiver explicitamente habilitada.

OpenRouteService e Pelias usam a mesma `HEIGIT_API_KEY`, armazenada apenas no
backend. O agente de pedágios usa outra chave em
`TOLL_INTELLIGENCE_OPENAI_API_KEY`; ela não pode reutilizar chaves do WhatsApp,
da revisão documental ou de qualquer frontend.

Valhalla e Nominatim não participam da aplicação ativa. Seus adaptadores ficam
no código como opção futura para uma infraestrutura dedicada, sem providers no
container Nest, variáveis obrigatórias, serviços Compose ou fallback automático.

## Configuração mínima

```dotenv
HEIGIT_BASE_URL=https://api.heigit.org
HEIGIT_API_KEY=<segredo-heigit>
ROUTING_TIMEOUT_MS=15000
ORS_VERSION=
ORS_MAP_DATA_VERSION=
TOLL_MATCH_CORRIDOR_METERS=60
TOLL_ALLOW_DEVELOPMENT_FIXTURES=false

TOLL_INTELLIGENCE_ENABLED=false
TOLL_INTELLIGENCE_OPENAI_API_KEY=
TOLL_INTELLIGENCE_OPENAI_BASE_URL=https://api.openai.com/v1
TOLL_INTELLIGENCE_OPENAI_MODEL=gpt-5.4-mini
TOLL_INTELLIGENCE_TIMEOUT_MS=90000
```

Valide a chave HeiGIT antes de reconstruir a API:

```bash
set -a
. ./.env.staging
set +a
npm run routing:check-services
```

O check faz uma busca Pelias e uma rota curta, consumindo uma pequena parcela da
quota. Ele nunca imprime a chave. Uma resposta HTTP 401/403 normalmente indica
credencial ou permissão; 406 indica que um cliente desatualizado não negociou o
formato GeoJSON; 429 indica quota/limite; timeout indica conectividade ou tempo
insuficiente.

## Ativação segura do agente

Primeiro valide rotas com `TOLL_INTELLIGENCE_ENABLED=false`. Depois instale a
chave exclusiva no arquivo de ambiente da VPS e altere somente:

```dotenv
TOLL_INTELLIGENCE_ENABLED=true
TOLL_INTELLIGENCE_OPENAI_API_KEY=<segredo-exclusivo>
```

Não passe segredos por argumento de linha de comando e não os envie ao chat,
Swagger, navegador ou logs. A aplicação usa Responses API, pesquisa web, saída
JSON estruturada e `store=false`. O agente só roda quando o PostGIS devolve dados
incompletos; timeout ou resposta sem fontes citadas não derruba a rota e produz
`status=unavailable`.

## Observabilidade e incidentes

Eventos relevantes:

- `routing.provider.success/error` para OpenRouteService;
- `geocoding.request/error` para Pelias;
- `toll.match/not_found/error` para PostGIS;
- `toll.intelligence.success/error` para o agente.

Os logs não contêm endereço completo, geometria, chave ou corpo retornado pelo
agente. Durante teste funcional, acompanhe:

```bash
docker logs --follow --tail 300 --timestamps lume-staging-api 2>&1 |
  tee -a ~/lume/lume-staging/diagnostics/routing-testing.log
```

Monitore quotas e custos nos painéis dos provedores. Se houver consumo inesperado,
defina `TOLL_INTELLIGENCE_ENABLED=false`, recrie somente a API e investigue antes
de reativar. Rotação de chave não exige migration de banco.

## Atualização e atribuição

A interface de mapa deve exibir a atribuição OpenStreetMap exigida pelo uso dos
dados OSM. Registre manualmente `ORS_VERSION` e `ORS_MAP_DATA_VERSION` quando uma
versão operacional for conhecida; campos vazios permanecem `null` na resposta.
Mudança de provider, perfil ou versão deve ser validada com rotas conhecidas nos
dois sentidos antes de chegar à produção.
