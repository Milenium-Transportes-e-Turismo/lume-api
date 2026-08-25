const timeoutMs = Number(process.env.ROUTING_TIMEOUT_MS ?? 15_000);
const services = [
  ['Valhalla', process.env.VALHALLA_URL, '/status'],
  ['Nominatim', process.env.NOMINATIM_URL, '/status?format=json'],
];

let failed = false;
for (const [name, rawUrl, path] of services) {
  if (!rawUrl) {
    console.error(`${name}: variável de ambiente ausente.`);
    failed = true;
    continue;
  }
  try {
    const response = await fetch(`${rawUrl.replace(/\/+$/, '')}${path}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Lume-Routing-Core/0.1',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    console.log(`${name}: OK`);
  } catch (error) {
    console.error(
      `${name}: ${error instanceof Error ? error.message : 'falha desconhecida'}`,
    );
    failed = true;
  }
}

process.exitCode = failed ? 1 : 0;
