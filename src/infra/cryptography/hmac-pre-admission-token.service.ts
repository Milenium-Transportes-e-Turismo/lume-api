import { createHash, createHmac } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  PreAdmissionTokenService,
  type IssuedPreAdmissionToken,
  type ParsedPreAdmissionToken,
} from '../../application/contracts/pre-admission-access.repository';

const TOKEN_PATTERN =
  /^pa_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([1-9]\d*)\.([A-Za-z0-9_-]{43})$/i;

@Injectable()
export class HmacPreAdmissionTokenService extends PreAdmissionTokenService {
  private readonly signingKey: Buffer;

  constructor(config: ConfigService) {
    super();
    this.signingKey = createHmac(
      'sha256',
      config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    )
      .update('lume:pre-admission:v1')
      .digest();
  }

  issue(input: {
    readonly accessId: string;
    readonly companyId: string;
    readonly generation: number;
  }): IssuedPreAdmissionToken {
    const signature = createHmac('sha256', this.signingKey)
      .update(
        `${input.companyId}:${input.accessId}:${String(input.generation)}`,
      )
      .digest('base64url');
    const plainText = `pa_${input.accessId}.${String(input.generation)}.${signature}`;

    return { plainText, hash: this.hash(plainText) };
  }

  parse(token: string): ParsedPreAdmissionToken | null {
    const match = TOKEN_PATTERN.exec(token);
    if (!match) return null;

    const generation = Number(match[2]);
    if (!Number.isSafeInteger(generation)) return null;

    return {
      accessId: match[1].toLowerCase(),
      generation,
      hash: this.hash(token),
    };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
