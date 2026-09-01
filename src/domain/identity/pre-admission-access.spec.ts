import { describe, expect, it } from 'vitest';

import { AppError } from '../../core/errors/app-error';
import {
  assertCanManagePreAdmission,
  preAdmissionExpiresAt,
  preAdmissionStatus,
} from './pre-admission-access';

describe('Acesso de Pré-admissão', () => {
  it('allows RH and Personnel Department with the specific document permission', () => {
    for (const department of ['human-resources', 'personnel-department']) {
      expect(() =>
        assertCanManagePreAdmission({
          departments: [department],
          permissions: ['documents:manage'],
        }),
      ).not.toThrow();
    }
  });

  it('rejects document readers and unrelated departments', () => {
    for (const authority of [
      {
        departments: ['human-resources'],
        permissions: ['documents:view'],
      },
      {
        departments: ['operations'],
        permissions: ['documents:manage'],
      },
    ]) {
      expect(() => assertCanManagePreAdmission(authority)).toThrowError(
        expect.objectContaining<Partial<AppError>>({ code: 'FORBIDDEN' }),
      );
    }
  });

  it('uses the approved default validity of 30 days', () => {
    expect(preAdmissionExpiresAt(new Date('2026-09-01T12:00:00.000Z'))).toEqual(
      new Date('2026-10-01T12:00:00.000Z'),
    );
  });

  it('does not treat revoked or expired access as active', () => {
    const now = new Date('2026-09-01T12:00:00.000Z');

    expect(
      preAdmissionStatus({
        revokedAt: new Date('2026-08-31T12:00:00.000Z'),
        expiresAt: new Date('2026-10-01T12:00:00.000Z'),
        now,
      }),
    ).toBe('revoked');
    expect(
      preAdmissionStatus({
        revokedAt: null,
        expiresAt: new Date('2026-09-01T11:59:59.999Z'),
        now,
      }),
    ).toBe('expired');
    expect(
      preAdmissionStatus({
        revokedAt: null,
        expiresAt: new Date('2026-09-01T12:00:00.001Z'),
        now,
      }),
    ).toBe('active');
  });
});
