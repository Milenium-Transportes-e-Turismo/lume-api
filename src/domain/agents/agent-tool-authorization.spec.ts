import { describe, expect, it } from 'vitest';

import { AppError } from '../../core/errors/app-error';
import {
  authorizeAgentToolInvocation,
  fingerprintAgentToolArguments,
  isInternetToolTarget,
  type AgentToolAuthorizationContext,
  type AgentToolAuthorizationPolicy,
} from './agent-tool-authorization';

const policy: AgentToolAuthorizationPolicy = {
  toolId: 'registration.update',
  requiredCapability: 'safe-write',
  requiredPermission: 'registrations:update',
  executionTarget: 'internal-service',
  allowedDepartmentIds: ['commercial'],
};

function context(
  overrides: Partial<AgentToolAuthorizationContext> = {},
): AgentToolAuthorizationContext {
  return {
    companyId: 'company-a',
    serviceSessionCompanyId: 'company-a',
    serviceSessionId: 'session-1',
    currentDepartmentId: 'commercial',
    assignedToolIds: ['registration.update'],
    grantedCapabilities: ['read', 'safe-write'],
    serverGrantedPermissions: ['registrations:update'],
    arguments: { registrationId: 'registration-1', name: 'Maria' },
    now: new Date('2026-08-29T12:00:00.000Z'),
    ...overrides,
  };
}

describe('authorizeAgentToolInvocation', () => {
  it('authorizes only from server policy and produces a stable audit fingerprint', () => {
    const first = authorizeAgentToolInvocation(policy, context());
    const second = authorizeAgentToolInvocation(
      policy,
      context({
        arguments: { name: 'Maria', registrationId: 'registration-1' },
      }),
    );

    expect(first).toEqual({
      toolId: 'registration.update',
      argumentsFingerprint: second.argumentsFingerprint,
      authorizationSource: 'server-policy',
      confirmedByUserId: null,
    });
  });

  it.each([
    ['cross-tenant', { serviceSessionCompanyId: 'company-b' }],
    ['unassigned tool', { assignedToolIds: [] }],
    ['missing capability', { grantedCapabilities: ['read'] }],
    ['missing permission', { serverGrantedPermissions: [] }],
    ['wrong department', { currentDepartmentId: 'financial' }],
  ] satisfies ReadonlyArray<
    readonly [string, Partial<AgentToolAuthorizationContext>]
  >)('denies %s without revealing protected data', (_name, overrides) => {
    expect(() =>
      authorizeAgentToolInvocation(policy, context(overrides)),
    ).toThrow(AppError);
    try {
      authorizeAgentToolInvocation(policy, context(overrides));
    } catch (error) {
      expect(String(error)).not.toContain('registration-1');
      expect(error).toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('requires an exact, unexpired contextual confirmation for sensitive writes', () => {
    const sensitivePolicy: AgentToolAuthorizationPolicy = {
      ...policy,
      requiredCapability: 'sensitive-write',
    };
    const sensitiveContext = context({
      grantedCapabilities: ['sensitive-write'],
    });
    const fingerprint = fingerprintAgentToolArguments(
      sensitiveContext.arguments,
    );

    expect(() =>
      authorizeAgentToolInvocation(sensitivePolicy, sensitiveContext),
    ).toThrow('confirmação humana específica');
    expect(() =>
      authorizeAgentToolInvocation(
        sensitivePolicy,
        context({
          grantedCapabilities: ['sensitive-write'],
          confirmation: {
            companyId: 'company-a',
            serviceSessionId: 'session-1',
            toolId: 'registration.update',
            argumentsFingerprint: fingerprintAgentToolArguments({
              registrationId: 'another-registration',
            }),
            confirmedByUserId: 'user-1',
            confirmedAt: new Date('2026-08-29T11:59:00.000Z'),
            expiresAt: new Date('2026-08-29T12:05:00.000Z'),
          },
        }),
      ),
    ).toThrow('confirmação humana específica');

    expect(
      authorizeAgentToolInvocation(
        sensitivePolicy,
        context({
          grantedCapabilities: ['sensitive-write'],
          confirmation: {
            companyId: 'company-a',
            serviceSessionId: 'session-1',
            toolId: 'registration.update',
            argumentsFingerprint: fingerprint,
            confirmedByUserId: 'user-1',
            confirmedAt: new Date('2026-08-29T11:59:00.000Z'),
            expiresAt: new Date('2026-08-29T12:05:00.000Z'),
          },
        }),
      ),
    ).toMatchObject({ confirmedByUserId: 'user-1' });
  });

  it('rejects an expired confirmation', () => {
    const sensitivePolicy: AgentToolAuthorizationPolicy = {
      ...policy,
      requiredCapability: 'sensitive-write',
    };
    const sensitiveContext = context({
      grantedCapabilities: ['sensitive-write'],
    });
    expect(() =>
      authorizeAgentToolInvocation(
        sensitivePolicy,
        context({
          grantedCapabilities: ['sensitive-write'],
          confirmation: {
            companyId: 'company-a',
            serviceSessionId: 'session-1',
            toolId: policy.toolId,
            argumentsFingerprint: fingerprintAgentToolArguments(
              sensitiveContext.arguments,
            ),
            confirmedByUserId: 'user-1',
            confirmedAt: new Date('2026-08-29T11:55:00.000Z'),
            expiresAt: new Date('2026-08-29T12:00:00.000Z'),
          },
        }),
      ),
    ).toThrow('confirmação humana específica');
  });
});

describe('agent tool targets', () => {
  it('allows only internal execution targets and treats internet/MCP as unavailable', () => {
    expect(isInternetToolTarget('internal-service')).toBe(false);
    expect(isInternetToolTarget('transactional-database')).toBe(false);
    expect(isInternetToolTarget('web-search')).toBe(true);
    expect(isInternetToolTarget('mcp')).toBe(true);
  });
});
