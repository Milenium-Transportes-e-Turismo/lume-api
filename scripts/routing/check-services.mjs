const timeoutMs = Number(process.env.ROUTING_TIMEOUT_MS ?? 15_000);
const baseUrl = (
  process.env.HEIGIT_BASE_URL ?? 'https://api.heigit.org'
).replace(/\/+$/, '');
const apiKey = process.env.HEIGIT_API_KEY;

if (!apiKey) {
  console.error('HeiGIT: HEIGIT_API_KEY ausente.');
  process.exitCode = 1;
} else {
  const checks = [
    {
      name: 'HeiGIT Pelias',
      url: `${baseUrl}/pelias/v1/search?text=Uberlandia&boundary.country=BR&size=1`,
      accept: 'application/json',
      options: {},
    },
    {
      name: 'OpenRouteService',
      url: `${baseUrl}/openrouteservice/v2/directions/driving-car/geojson`,
      accept: 'application/geo+json',
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coordinates: [
            [-48.2772, -18.9186],
            [-48.2672, -18.9186],
          ],
          instructions: false,
        }),
      },
    },
  ];

  let failed = false;
  for (const check of checks) {
    try {
      const response = await fetch(check.url, {
        ...check.options,
        headers: {
          ...check.options.headers,
          Accept: check.accept,
          Authorization: apiKey,
          'User-Agent': 'Lume-Routing-Core/0.2',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      console.log(`${check.name}: OK`);
    } catch (error) {
      console.error(
        `${check.name}: ${error instanceof Error ? error.message : 'falha desconhecida'}`,
      );
      failed = true;
    }
  }

  process.exitCode = failed ? 1 : 0;
}
