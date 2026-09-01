import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { HmacPreAdmissionTokenService } from './hmac-pre-admission-token.service';

const accessId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const companyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function service() {
  return new HmacPreAdmissionTokenService(
    new ConfigService({
      JWT_ACCESS_SECRET: 'this-is-a-test-secret-with-at-least-32-characters',
    }),
  );
}

describe('HmacPreAdmissionTokenService', () => {
  it('reconstructs the same opaque token for an idempotent command', () => {
    const tokens = service();

    expect(tokens.issue({ accessId, companyId, generation: 1 })).toEqual(
      tokens.issue({ accessId, companyId, generation: 1 }),
    );
  });

  it('rotates the token when the generation changes', () => {
    const tokens = service();

    expect(
      tokens.issue({ accessId, companyId, generation: 2 }).plainText,
    ).not.toBe(tokens.issue({ accessId, companyId, generation: 1 }).plainText);
  });

  it('parses only the complete token and exposes its hash for lookup', () => {
    const tokens = service();
    const issued = tokens.issue({ accessId, companyId, generation: 3 });

    expect(tokens.parse(issued.plainText)).toEqual({
      accessId,
      generation: 3,
      hash: issued.hash,
    });
    expect(tokens.parse(`${issued.plainText}x`)).not.toEqual(
      expect.objectContaining({ hash: issued.hash }),
    );
    expect(tokens.parse('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBeNull();
  });
});
