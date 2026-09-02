import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import type { CustomerContextUseCase } from '../../application/use-cases/customer-context/customer-context.use-case';
import type { ServicePrincipal } from '../../shared/http/decorators/current-service.decorator';
import { REQUIRED_PERMISSIONS } from '../../shared/http/decorators/require-permissions.decorator';
import { CustomerContextController } from './customer-context.controller';
import { InternalCustomerContextController } from './internal-customer-context.controller';

const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SERVICE_IDENTITY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SESSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EXECUTION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const COMMAND_ID = '11111111-1111-4111-8111-111111111111';
const SUGGESTION_ID = '22222222-2222-4222-8222-222222222222';

function handler(name: keyof CustomerContextController): object {
  return Object.getOwnPropertyDescriptor(
    CustomerContextController.prototype,
    name,
  )?.value as object;
}

describe('CustomerContextController', () => {
  it('protects reads and writes with the requested service permissions', () => {
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, handler('summary')),
    ).toEqual(['service:view']);
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, handler('details')),
    ).toEqual(['service:view']);
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, handler('listSuggestions')),
    ).toEqual(['service:view']);
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, handler('suggest')),
    ).toEqual(['service:respond']);
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, handler('decide')),
    ).toEqual(['service:respond']);
  });

  it('derives tenant and reviewer exclusively from the authenticated human', async () => {
    const suggestFromHuman = vi.fn().mockResolvedValue({ status: 'pending' });
    const decide = vi.fn().mockResolvedValue({ status: 'approved' });
    const context = {
      suggestFromHuman,
      decide,
    } as unknown as CustomerContextUseCase;
    const controller = new CustomerContextController(context);
    const principal = {
      companyId: COMPANY_ID,
      id: USER_ID,
    } as AuthenticatedPrincipal;

    await controller.suggest(principal, SESSION_ID, {
      commandId: COMMAND_ID,
      profileKey: 'language',
      suggestedValue: 'Prefere atendimento em português.',
    });
    await controller.decide(principal, SUGGESTION_ID, {
      commandId: COMMAND_ID,
      expectedUpdatedAt: '2026-08-29T12:00:00.000Z',
      decision: 'approved',
      reason: 'Confirmado.',
    });

    expect(suggestFromHuman).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        actorUserId: USER_ID,
        serviceSessionId: SESSION_ID,
      }),
    );
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        actorUserId: USER_ID,
        suggestionId: SUGGESTION_ID,
      }),
    );
  });
});

describe('InternalCustomerContextController', () => {
  it('derives the tenant and service provenance and exposes no decision method', async () => {
    const suggestFromAgent = vi.fn().mockResolvedValue({ status: 'pending' });
    const controller = new InternalCustomerContextController({
      suggestFromAgent,
    } as unknown as CustomerContextUseCase);
    const service = {
      id: SERVICE_IDENTITY_ID,
      companyId: COMPANY_ID,
    } as ServicePrincipal;

    await controller.suggest(service, SESSION_ID, {
      commandId: COMMAND_ID,
      agentExecutionId: EXECUTION_ID,
      profileKey: 'service-preference',
      suggestedValue: 'Prefere retirada pela manhã.',
    });

    expect(suggestFromAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        serviceIdentityId: SERVICE_IDENTITY_ID,
        serviceSessionId: SESSION_ID,
        agentExecutionId: EXECUTION_ID,
      }),
    );
    expect('decide' in controller).toBe(false);
  });
});
