import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function repositoryFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8').replaceAll(
    '\r\n',
    '\n',
  );
}

describe('production container contract', () => {
  it('keeps the native optional dependency required by pdf-parse', () => {
    const dockerfile = repositoryFile('Dockerfile');

    expect(dockerfile).not.toMatch(/\bnpm ci\b[^\n]*--omit=optional\b/u);
  });

  it('injects, prepares and persists the configured Knowledge storage', () => {
    const compose = repositoryFile('compose.prod.yml');
    const configuredPath =
      '\\$\\{KNOWLEDGE_STORAGE_PATH:-/app/var/knowledge\\}';

    expect(
      compose.match(
        new RegExp(`KNOWLEDGE_STORAGE_PATH: ['"]?${configuredPath}`, 'gu'),
      ) ?? [],
    ).toHaveLength(2);
    expect(compose.match(/source: lume_tenant_knowledge/gu) ?? []).toHaveLength(
      2,
    );
    expect(
      compose.match(new RegExp(`target: ['"]?${configuredPath}`, 'gu')) ?? [],
    ).toHaveLength(2);
    expect(compose).toMatch(/^ {2}lume_tenant_knowledge:\s*$/mu);
  });
});
