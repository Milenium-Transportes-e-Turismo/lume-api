import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { REQUIRED_PERMISSIONS } from '../../shared/http/decorators/require-permissions.decorator';
import { AgentAdministrationController } from './agent-administration.controller';
import type { AgentAdministrationService } from './agent-administration.service';
import {
  ListAgentExecutionsQueryDto,
  UpdateTenantAgentInstructionsDto,
} from './dto/agent-administration.dto';

const principal = {
  id: '00000000-0000-4000-8000-000000000011',
  companyId: '00000000-0000-4000-8000-000000000010',
} as AuthenticatedPrincipal;

function handler(name: keyof AgentAdministrationController): object {
  return Object.getOwnPropertyDescriptor(
    AgentAdministrationController.prototype,
    name,
  )?.value as object;
}

describe('AgentAdministrationController', () => {
  it('separa consulta de agentes da única escrita permitida ao tenant', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler('list'))).toEqual([
      'ai-agents:view',
    ]);
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, handler('executions')),
    ).toEqual(['ai-agents:view']);
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS,
        handler('updateTenantInstructions'),
      ),
    ).toEqual(['ai-agents:manage']);
  });

  it('deriva o tenant da identidade autenticada na consulta de execuções', async () => {
    const listExecutions = vi.fn().mockResolvedValue({ items: [], total: 0 });
    const controller = new AgentAdministrationController({
      listExecutions,
    } as unknown as AgentAdministrationService);
    const query = new ListAgentExecutionsQueryDto();

    await controller.executions(
      principal,
      '00000000-0000-4000-8000-000000000020',
      query,
    );

    expect(listExecutions).toHaveBeenCalledWith(
      principal,
      '00000000-0000-4000-8000-000000000020',
      query,
    );
  });

  it('encaminha somente conteúdo versionado das instruções do tenant', async () => {
    const updateTenantInstructions = vi.fn().mockResolvedValue({ version: 2 });
    const controller = new AgentAdministrationController({
      updateTenantInstructions,
    } as unknown as AgentAdministrationService);
    const body = Object.assign(new UpdateTenantAgentInstructionsDto(), {
      commandId: '00000000-0000-4000-8000-000000000030',
      expectedVersion: 1,
      content: 'Use a terminologia aprovada pelo tenant.',
    });

    await controller.updateTenantInstructions(
      principal,
      '00000000-0000-4000-8000-000000000020',
      body,
    );

    expect(updateTenantInstructions).toHaveBeenCalledWith(
      principal,
      '00000000-0000-4000-8000-000000000020',
      body,
    );
    expect(body).not.toHaveProperty('provider');
    expect(body).not.toHaveProperty('model');
    expect(body).not.toHaveProperty('credentialRef');
  });
});
