import { describe, expect, it, vi } from 'vitest';

import type { KnowledgeManagementUseCase } from '../../application/use-cases/knowledge/knowledge-management.use-case';
import type { ServicePrincipal } from '../../shared/http/decorators/current-service.decorator';
import { InternalKnowledgeObservationsController } from './internal-knowledge-observations.controller';

const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SERVICE_IDENTITY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EXECUTION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MESSAGE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const COMMAND_ID = '11111111-1111-4111-8111-111111111111';

describe('InternalKnowledgeObservationsController', () => {
  it('derives tenant and service identity from the authenticated principal', async () => {
    const createAgentSuggestion = vi.fn().mockResolvedValue({
      status: 'pending',
    });
    const observeAgentGap = vi.fn().mockResolvedValue({ status: 'open' });
    const controller = new InternalKnowledgeObservationsController({
      createAgentSuggestion,
      observeAgentGap,
    } as unknown as KnowledgeManagementUseCase);
    const service = {
      id: SERVICE_IDENTITY_ID,
      companyId: COMPANY_ID,
    } as ServicePrincipal;
    const provenance = {
      commandId: COMMAND_ID,
      serviceSessionId: SESSION_ID,
      agentExecutionId: EXECUTION_ID,
      evidenceMessageIds: [MESSAGE_ID],
    };

    await controller.suggestion(service, {
      ...provenance,
      title: 'Transporte de animais',
      proposedContent: 'Definir política institucional.',
    });
    await controller.gap(service, {
      ...provenance,
      topic: 'Transporte de animais',
    });

    expect(createAgentSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        serviceIdentityId: SERVICE_IDENTITY_ID,
        serviceSessionId: SESSION_ID,
        agentExecutionId: EXECUTION_ID,
      }),
    );
    expect(observeAgentGap).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        serviceIdentityId: SERVICE_IDENTITY_ID,
        serviceSessionId: SESSION_ID,
        agentExecutionId: EXECUTION_ID,
      }),
    );
    expect('reviewSuggestion' in controller).toBe(false);
    expect('publish' in controller).toBe(false);
  });
});
