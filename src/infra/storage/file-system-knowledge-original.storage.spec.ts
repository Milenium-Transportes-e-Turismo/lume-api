import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it } from 'vitest';

import { FileSystemKnowledgeOriginalStorage } from './file-system-knowledge-original.storage';

const companyId = '00000000-0000-4000-8000-000000000001';
const documentId = '00000000-0000-4000-8000-000000000101';
const versionId = '00000000-0000-4000-8000-000000000201';
const digest = 'a'.repeat(64);
const storageKey = `v1/${companyId}/${documentId}/${versionId}/${digest}`;
const temporaryDirectories: string[] = [];

function at(rootPath: string): FileSystemKnowledgeOriginalStorage {
  return new FileSystemKnowledgeOriginalStorage(
    new ConfigService({ KNOWLEDGE_STORAGE_PATH: rootPath }),
  );
}

async function storage(): Promise<{
  readonly rootPath: string;
  readonly instance: FileSystemKnowledgeOriginalStorage;
}> {
  const rootPath = await mkdtemp(join(tmpdir(), 'lume-knowledge-'));
  temporaryDirectories.push(rootPath);
  return { rootPath, instance: at(rootPath) };
}

describe('FileSystemKnowledgeOriginalStorage', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('preserva o original de modo idempotente entre reinicializações', async () => {
    const { rootPath, instance } = await storage();
    const content = Buffer.from('original imutável', 'utf8');

    await instance.write({ storageKey, content });
    await instance.write({ storageKey, content });

    await expect(at(rootPath).read(storageKey)).resolves.toEqual(content);
  });

  it('recusa path traversal e colisão de conteúdo', async () => {
    const { instance } = await storage();

    await expect(instance.read('../../segredo')).rejects.toThrow(
      'Chave de armazenamento de knowledge inválida',
    );
    await instance.write({ storageKey, content: Buffer.from('primeiro') });
    await expect(
      instance.write({ storageKey, content: Buffer.from('diferente') }),
    ).rejects.toThrow('outro conteúdo');
  });
});
