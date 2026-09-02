import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  KnowledgeOriginalStorage,
  type PersistKnowledgeOriginalInput,
} from '../../application/contracts/knowledge-original.storage';

const UUID_SEGMENT =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const STORAGE_KEY_PATTERN = new RegExp(
  `^v1/${UUID_SEGMENT}/${UUID_SEGMENT}/${UUID_SEGMENT}/[0-9a-f]{64}$`,
  'iu',
);

function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : null;
}

@Injectable()
export class FileSystemKnowledgeOriginalStorage extends KnowledgeOriginalStorage {
  private readonly rootPath: string;

  constructor(config: ConfigService) {
    super();
    this.rootPath = resolve(
      config.get<string>('KNOWLEDGE_STORAGE_PATH') ?? './var/knowledge',
    );
  }

  async write(input: PersistKnowledgeOriginalInput): Promise<void> {
    const destination = this.resolveStorageKey(input.storageKey);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const temporary = `${destination}.tmp-${randomUUID()}`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(input.content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(temporary, destination);
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
        const existing = await readFile(destination);
        if (!existing.equals(input.content)) {
          throw new Error('A chave do original já contém outro conteúdo.');
        }
      }
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (errorCode(error) !== 'ENOENT') throw error;
      });
    }
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolveStorageKey(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await unlink(this.resolveStorageKey(storageKey)).catch((error: unknown) => {
      if (errorCode(error) !== 'ENOENT') throw error;
    });
  }

  private resolveStorageKey(storageKey: string): string {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) {
      throw new Error('Chave de armazenamento de knowledge inválida.');
    }
    const absolutePath = resolve(this.rootPath, ...storageKey.split('/'));
    if (!absolutePath.startsWith(`${this.rootPath}${sep}`)) {
      throw new Error('Chave de knowledge fora do diretório permitido.');
    }
    return absolutePath;
  }
}
