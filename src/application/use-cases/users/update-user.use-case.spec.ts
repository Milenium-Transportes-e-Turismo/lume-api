import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  FakeOfflineLicenseVerifier,
  FakePasswordHasher,
  InMemoryStore,
  InMemoryTenantBootstrapRepository,
  InMemoryUsersRepository,
} from '../../../../test/fakes/in-memory';
import { companyFixture } from '../../../../test/fixtures/company';
import { User } from '../../../domain/entities/user';
import { BootstrapTenantUseCase } from '../tenant/bootstrap-tenant.use-case';
import { CreateUserUseCase } from './create-user.use-case';
import { UpdateUserStatusUseCase } from './update-user-status.use-case';
import {
  type UpdateUserInput,
  UpdateUserUseCase,
} from './update-user.use-case';

describe('UpdateUserUseCase', () => {
  let store: InMemoryStore;
  let users: InMemoryUsersRepository;
  let useCase: UpdateUserUseCase;
  let updateUser: (
    input: Omit<UpdateUserInput, 'commandId' | 'expectedVersion'>,
  ) => ReturnType<UpdateUserUseCase['execute']>;
  let create: CreateUserUseCase;

  beforeEach(async () => {
    store = new InMemoryStore();
    users = new InMemoryUsersRepository(store);
    const passwordHasher = new FakePasswordHasher();
    await new BootstrapTenantUseCase(
      new InMemoryTenantBootstrapRepository(store),
      passwordHasher,
      new FakeOfflineLicenseVerifier(),
    ).execute(companyFixture);
    useCase = new UpdateUserUseCase(users);
    updateUser = (input) => {
      const target = store.users.find(
        (user) =>
          user.companyId === input.companyId && user.id === input.userId,
      );
      if (!target) throw new Error('Missing update target in test.');
      return useCase.execute({
        ...input,
        actorUserId:
          input.actorUserId ?? input.currentUserId ?? store.users[0].id,
        commandId: randomUUID(),
        expectedVersion: target.props.version,
      });
    };
    create = new CreateUserUseCase(users, passwordHasher);
  });

  it('updates departments and individual permissions atomically', async () => {
    const created = await create.execute({
      companyId: store.companies[0].id,
      name: 'Bruno Lima',
      username: 'bruno.lima',
      email: 'bruno@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['operations'],
      permissionCodes: ['operations:view'],
    });

    const updated = await updateUser({
      companyId: store.companies[0].id,
      userId: created.id,
      name: 'Bruno Atualizado',
      departments: ['monitoring'],
      permissionCodes: ['monitoring:view', 'monitoring:manage'],
    });

    expect(updated.name).toBe('Bruno Atualizado');
    expect(updated.departments).toEqual(['monitoring']);
    expect(updated.permissionCodes).toEqual([
      'monitoring:manage',
      'monitoring:view',
    ]);
  });

  it('assigns Cadastro view, creation and editing permissions to existing Management users', async () => {
    const created = await create.execute({
      companyId: store.companies[0].id,
      name: 'Gerente Existente',
      username: 'gerente.existente',
      email: 'gerente.existente@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['management'],
      permissionCodes: [],
    });

    const updated = await updateUser({
      companyId: store.companies[0].id,
      userId: created.id,
      permissionCodes: ['clients:view', 'clients:create', 'clients:update'],
    });

    expect(updated.permissionCodes).toEqual([
      'clients:create',
      'clients:update',
      'clients:view',
    ]);
    expect(updated.permissions).toEqual(
      expect.arrayContaining([
        'clients:view',
        'clients:create',
        'clients:update',
      ]),
    );
  });

  it('keeps a document-only candidate editable and promotes it to collaborator', async () => {
    const candidate = await create.execute({
      companyId: store.companies[0].id,
      name: 'Jean Candidato',
      username: 'jean.candidato',
      email: 'jean@empresa.test',
      password: 'OutraSenha@2026',
      documentAccessMode: 'document-portal',
      departments: [],
      permissionCodes: [],
    });

    await expect(
      updateUser({
        companyId: store.companies[0].id,
        userId: candidate.id,
        name: 'Jean Atualizado',
      }),
    ).resolves.toMatchObject({
      name: 'Jean Atualizado',
      documentAccessMode: 'document-portal',
    });

    await expect(
      updateUser({
        companyId: store.companies[0].id,
        userId: candidate.id,
        documentAccessMode: 'standard',
        departments: ['commercial'],
        permissionCodes: ['commercial:view'],
      }),
    ).resolves.toMatchObject({
      documentAccessMode: 'standard',
      departments: ['commercial'],
      permissionCodes: ['commercial:view'],
    });
  });

  it('rejects keeping an incompatible permission while changing department', async () => {
    const created = await create.execute({
      companyId: store.companies[0].id,
      name: 'Bruno Lima',
      username: 'bruno.lima',
      email: 'bruno@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['operations'],
      permissionCodes: ['operations:manage'],
    });

    await expect(
      updateUser({
        companyId: store.companies[0].id,
        userId: created.id,
        departments: ['commercial'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('suspends, revokes sessions and records a future deadline', async () => {
    const created = await create.execute({
      companyId: store.companies[0].id,
      name: 'Bruno Lima',
      username: 'bruno.lima',
      email: 'bruno@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['operations'],
      permissionCodes: ['operations:view'],
    });
    const until = new Date(Date.now() + 86_400_000);
    const statusUseCase = new UpdateUserStatusUseCase(users);

    const suspended = await statusUseCase.execute({
      companyId: store.companies[0].id,
      actorUserId: store.users[0].id,
      currentUserId: store.users[0].id,
      userId: created.id,
      status: 'suspended',
      suspendedUntil: until,
      suspensionReason: 'Afastamento temporário',
    });

    expect(suspended).toMatchObject({
      status: 'suspended',
      isActive: false,
      suspensionReason: 'Afastamento temporário',
    });
    expect(suspended.suspendedUntil).toBe(until.toISOString());
  });

  it('prevents suspending the current user', async () => {
    const administrator = store.users[0];
    await expect(
      new UpdateUserStatusUseCase(users).execute({
        companyId: administrator.companyId,
        actorUserId: administrator.id,
        currentUserId: administrator.id,
        userId: administrator.id,
        status: 'inactive',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('prevents the current administrator from demoting itself', async () => {
    const administrator = store.users[0];

    await expect(
      updateUser({
        companyId: administrator.companyId,
        actorUserId: administrator.id,
        currentUserId: administrator.id,
        userId: administrator.id,
        isAdministrator: false,
        departments: ['management'],
        permissionCodes: ['users:view'],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('blocks a management user from mutating administrator identity or status', async () => {
    const administrator = store.users[0];
    const manager = await create.execute({
      companyId: administrator.companyId,
      name: 'Gerente',
      username: 'gerente',
      email: 'gerente@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['management'],
      permissionCodes: [],
    });

    await expect(
      updateUser({
        companyId: administrator.companyId,
        actorUserId: manager.id,
        currentUserId: manager.id,
        userId: administrator.id,
        email: 'captura@empresa.test',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      new UpdateUserStatusUseCase(users).execute({
        companyId: administrator.companyId,
        actorUserId: manager.id,
        currentUserId: manager.id,
        userId: administrator.id,
        status: 'active',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows TI to edit another ordinary user but blocks self and administrator targets', async () => {
    const administrator = store.users[0];
    const informationTechnology = await create.execute({
      companyId: administrator.companyId,
      name: 'Analista de TI',
      username: 'analista.ti',
      email: 'ti@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['information-technology'],
      permissionCodes: [],
    });
    const common = await create.execute({
      companyId: administrator.companyId,
      name: 'Usuário comum',
      username: 'usuario.comum',
      email: 'comum@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['commercial'],
      permissionCodes: ['commercial:view'],
    });

    await expect(
      updateUser({
        companyId: administrator.companyId,
        actorUserId: informationTechnology.id,
        currentUserId: informationTechnology.id,
        userId: common.id,
        departments: ['operations'],
        permissionCodes: ['operations:view'],
      }),
    ).resolves.toMatchObject({ departments: ['operations'] });

    await expect(
      updateUser({
        companyId: administrator.companyId,
        actorUserId: informationTechnology.id,
        currentUserId: informationTechnology.id,
        userId: informationTechnology.id,
        name: 'Autoedição indevida',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      updateUser({
        companyId: administrator.companyId,
        actorUserId: informationTechnology.id,
        currentUserId: informationTechnology.id,
        userId: administrator.id,
        name: 'Administrador capturado',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows TI to suspend and reactivate another ordinary user but blocks self and administrators', async () => {
    const administrator = store.users[0];
    const informationTechnology = await create.execute({
      companyId: administrator.companyId,
      name: 'Analista de TI',
      username: 'analista.ti.status',
      email: 'ti.status@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['information-technology'],
      permissionCodes: [],
    });
    const common = await create.execute({
      companyId: administrator.companyId,
      name: 'Usuário comum',
      username: 'usuario.status',
      email: 'usuario.status@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['commercial'],
      permissionCodes: ['commercial:view'],
    });
    const statusUseCase = new UpdateUserStatusUseCase(users);

    await expect(
      statusUseCase.execute({
        companyId: administrator.companyId,
        actorUserId: informationTechnology.id,
        currentUserId: informationTechnology.id,
        userId: common.id,
        status: 'suspended',
        suspendedUntil: new Date(Date.now() + 86_400_000),
        suspensionReason: 'Bloqueio solicitado',
      }),
    ).resolves.toMatchObject({ status: 'suspended', isActive: false });

    await expect(
      statusUseCase.execute({
        companyId: administrator.companyId,
        actorUserId: informationTechnology.id,
        currentUserId: informationTechnology.id,
        userId: common.id,
        status: 'active',
      }),
    ).resolves.toMatchObject({ status: 'active', isActive: true });

    await expect(
      statusUseCase.execute({
        companyId: administrator.companyId,
        actorUserId: informationTechnology.id,
        currentUserId: informationTechnology.id,
        userId: informationTechnology.id,
        status: 'active',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      statusUseCase.execute({
        companyId: administrator.companyId,
        actorUserId: informationTechnology.id,
        currentUserId: informationTechnology.id,
        userId: administrator.id,
        status: 'active',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('prevents TI from granting license permissions while editing another user', async () => {
    const administrator = store.users[0];
    const informationTechnology = await create.execute({
      companyId: administrator.companyId,
      name: 'Analista de TI',
      username: 'analista.ti',
      email: 'ti@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['information-technology'],
      permissionCodes: [],
    });
    const common = await create.execute({
      companyId: administrator.companyId,
      name: 'Usuário comum',
      username: 'usuario.comum',
      email: 'comum@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['management'],
      permissionCodes: [],
    });

    await expect(
      updateUser({
        companyId: administrator.companyId,
        actorUserId: informationTechnology.id,
        currentUserId: informationTechnology.id,
        userId: common.id,
        permissionCodes: ['license:view'],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows only an administrator to grant or remove tenant-wide Directorate authority', async () => {
    const administrator = store.users[0];
    const informationTechnology = await create.execute({
      companyId: administrator.companyId,
      name: 'TI de acessos',
      username: 'ti.acessos',
      email: 'ti.acessos@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['information-technology'],
      permissionCodes: [],
    });
    const director = await create.execute({
      companyId: administrator.companyId,
      actorUserId: administrator.id,
      name: 'Diretora',
      username: 'diretora',
      email: 'diretora@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['directorate'],
      permissionCodes: ['tenant:manage'],
    });

    await expect(
      updateUser({
        companyId: administrator.companyId,
        actorUserId: informationTechnology.id,
        currentUserId: informationTechnology.id,
        userId: director.id,
        permissionCodes: [],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      updateUser({
        companyId: administrator.companyId,
        actorUserId: administrator.id,
        currentUserId: administrator.id,
        userId: director.id,
        permissionCodes: [],
      }),
    ).resolves.toMatchObject({ permissionCodes: [] });
  });

  it('clears business authority when an administrator moves a Director to the document portal', async () => {
    const administrator = store.users[0];
    const director = await create.execute({
      companyId: administrator.companyId,
      actorUserId: administrator.id,
      name: 'Diretora documental',
      username: 'diretora.documental',
      email: 'diretora.documental@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['directorate'],
      permissionCodes: ['tenant:manage'],
    });

    const updated = await updateUser({
      companyId: administrator.companyId,
      actorUserId: administrator.id,
      userId: director.id,
      documentAccessMode: 'document-portal',
    });

    expect(updated).toMatchObject({
      documentAccessMode: 'document-portal',
      departments: [],
      permissionCodes: [],
    });
    expect(updated.permissions).not.toContain('operations:manage');
    const persisted = store.users.find((user) => user.id === director.id);
    expect(persisted?.props.departments).toEqual([]);
    expect(persisted?.props.permissionCodes).toEqual([]);
    expect(store.userUpdateHistory.at(-1)?.changedFields).toEqual([
      'documentAccessMode',
      'departments',
      'permissionCodes',
    ]);
    expect(store.tenantAuditLogs.at(-1)?.metadata).toMatchObject({
      changedFields: ['documentAccessMode', 'departments', 'permissionCodes'],
      requestedFields: ['documentAccessMode'],
    });
  });

  it('rejects explicit business grants on a document-portal account', async () => {
    const administrator = store.users[0];
    const candidate = await create.execute({
      companyId: administrator.companyId,
      actorUserId: administrator.id,
      name: 'Candidata documental',
      username: 'candidata.documental',
      email: 'candidata.documental@empresa.test',
      password: 'OutraSenha@2026',
      documentAccessMode: 'document-portal',
      departments: [],
      permissionCodes: [],
    });

    await expect(
      updateUser({
        companyId: administrator.companyId,
        actorUserId: administrator.id,
        userId: candidate.id,
        departments: ['directorate'],
        permissionCodes: ['tenant:manage'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('does not reactivate legacy Directorate grants when leaving the document portal', async () => {
    const administrator = store.users[0];
    const informationTechnology = await create.execute({
      companyId: administrator.companyId,
      actorUserId: administrator.id,
      name: 'TI sem autoridade global',
      username: 'ti.sem.autoridade.global',
      email: 'ti.sem.autoridade.global@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['information-technology'],
      permissionCodes: ['users:update'],
    });
    const director = await create.execute({
      companyId: administrator.companyId,
      actorUserId: administrator.id,
      name: 'Diretora legada no portal',
      username: 'diretora.legada.portal',
      email: 'diretora.legada.portal@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['directorate'],
      permissionCodes: ['tenant:manage'],
    });
    const directorIndex = store.users.findIndex(
      (user) => user.id === director.id,
    );
    store.users[directorIndex] = User.restore({
      ...store.users[directorIndex].props,
      documentAccessMode: 'document-portal',
    });

    await expect(
      updateUser({
        companyId: administrator.companyId,
        actorUserId: informationTechnology.id,
        currentUserId: informationTechnology.id,
        userId: director.id,
        documentAccessMode: 'standard',
        departments: ['directorate'],
        permissionCodes: ['tenant:manage'],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('keeps one active direct administrator', async () => {
    const administrator = store.users[0];
    const inactiveAdministrator = User.restore({
      ...User.create({
        companyId: administrator.companyId,
        name: 'Administrador inativo',
        username: 'admin.inativo',
        usernameNormalized: 'admin.inativo',
        email: 'admin.inativo@empresa.test',
        emailNormalized: 'admin.inativo@empresa.test',
        cpfNormalized: null,
        passwordHash: 'hashed:SenhaInicial@2026',
        isAdministrator: true,
        departments: [],
      }).props,
      status: 'inactive',
      isActive: false,
    });
    store.users.push(inactiveAdministrator);

    await expect(
      updateUser({
        companyId: administrator.companyId,
        actorUserId: inactiveAdministrator.id,
        currentUserId: inactiveAdministrator.id,
        userId: administrator.id,
        isAdministrator: false,
        departments: ['management'],
        permissionCodes: [],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      new UpdateUserStatusUseCase(users).execute({
        companyId: administrator.companyId,
        actorUserId: inactiveAdministrator.id,
        currentUserId: inactiveAdministrator.id,
        userId: administrator.id,
        status: 'inactive',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('filters the paginated list by search, department, permission and status', async () => {
    await create.execute({
      companyId: store.companies[0].id,
      name: 'Maria Comercial',
      username: 'maria.comercial',
      email: 'maria@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['commercial'],
      permissionCodes: ['commercial:view'],
    });

    const result = await users.list(store.companies[0].id, {
      page: 1,
      pageSize: 20,
      search: 'maria',
      department: 'commercial',
      permission: 'commercial:view',
      status: 'active',
    });

    expect(result.total).toBe(1);
    expect(result.items[0].user.props.username).toBe('maria.comercial');
  });

  it('filters by effective permissions, including implicit permissions', async () => {
    await create.execute({
      companyId: store.companies[0].id,
      name: 'Maria Comercial',
      username: 'maria.comercial',
      email: 'maria@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['commercial'],
      permissionCodes: [],
    });

    const result = await users.list(store.companies[0].id, {
      page: 1,
      pageSize: 20,
      search: 'maria',
      permission: 'profile:view',
    });

    expect(result.total).toBe(1);
  });

  it('filters Directorate tenant authority as effective business access without inventing departments for administrators', async () => {
    const administrator = store.users[0];
    const director = await create.execute({
      companyId: administrator.companyId,
      actorUserId: administrator.id,
      name: 'Diretora de Operações',
      username: 'diretora.operacoes',
      email: 'diretora.operacoes@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['directorate'],
      permissionCodes: ['tenant:manage'],
    });

    const byPermission = await users.list(administrator.companyId, {
      page: 1,
      pageSize: 20,
      permission: 'operations:manage',
    });
    expect(byPermission.items.map((item) => item.user.id)).toContain(
      director.id,
    );

    const byDepartment = await users.list(administrator.companyId, {
      page: 1,
      pageSize: 20,
      department: 'directorate',
    });
    expect(byDepartment.items.map((item) => item.user.id)).toEqual([
      director.id,
    ]);
    expect(byDepartment.items.map((item) => item.user.id)).not.toContain(
      administrator.id,
    );
  });

  it('allows only an administrator to edit or suspend a tenant-wide Director', async () => {
    const administrator = store.users[0];
    const director = await create.execute({
      companyId: administrator.companyId,
      actorUserId: administrator.id,
      name: 'Diretora Protegida',
      username: 'diretora.protegida',
      email: 'diretora.protegida@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['directorate'],
      permissionCodes: ['tenant:manage'],
    });
    const informationTechnology = await create.execute({
      companyId: administrator.companyId,
      actorUserId: administrator.id,
      name: 'Analista TI',
      username: 'analista.ti.protecao',
      email: 'analista.ti.protecao@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['information-technology'],
      permissionCodes: ['users:update', 'users:manage'],
    });

    await expect(
      updateUser({
        companyId: administrator.companyId,
        actorUserId: informationTechnology.id,
        userId: director.id,
        email: 'diretoria.tomada@empresa.test',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      new UpdateUserStatusUseCase(users).execute({
        companyId: administrator.companyId,
        actorUserId: informationTechnology.id,
        currentUserId: informationTechnology.id,
        userId: director.id,
        status: 'inactive',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      updateUser({
        companyId: administrator.companyId,
        actorUserId: administrator.id,
        userId: director.id,
        email: 'diretora.atualizada@empresa.test',
      }),
    ).resolves.toMatchObject({ email: 'diretora.atualizada@empresa.test' });
  });

  it('does not filter in a direct permission stored outside the department ceiling', async () => {
    const created = await create.execute({
      companyId: store.companies[0].id,
      name: 'Maria Comercial',
      username: 'maria.comercial',
      email: 'maria@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['commercial'],
      permissionCodes: [],
    });
    const index = store.users.findIndex((user) => user.id === created.id);
    store.users[index] = User.restore({
      ...store.users[index].props,
      permissionCodes: ['users:manage'],
    });

    const result = await users.list(store.companies[0].id, {
      page: 1,
      pageSize: 20,
      search: 'maria',
      permission: 'users:manage',
    });

    expect(result.total).toBe(0);
  });

  it('requires an identified active actor for user updates', async () => {
    const created = await create.execute({
      companyId: store.companies[0].id,
      name: 'Alvo com ator obrigatório',
      username: 'alvo.ator.obrigatorio',
      email: 'alvo.ator@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['operations'],
      permissionCodes: ['operations:view'],
    });

    await expect(
      useCase.execute({
        companyId: store.companies[0].id,
        userId: created.id,
        commandId: randomUUID(),
        expectedVersion: created.version,
        name: 'Alteração sem responsável',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('increments the user version and replays the same command without a second write or audit', async () => {
    const created = await create.execute({
      companyId: store.companies[0].id,
      name: 'Versão Controlada',
      username: 'versao.controlada',
      email: 'versao@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['operations'],
      permissionCodes: ['operations:view'],
    });
    const commandId = randomUUID();
    const input = {
      companyId: store.companies[0].id,
      actorUserId: store.users[0].id,
      userId: created.id,
      commandId,
      expectedVersion: created.version,
      name: 'Versão Atualizada',
    };

    const first = await useCase.execute(input);
    const replay = await useCase.execute(input);

    expect(first).toMatchObject({ version: 2, idempotent: false });
    expect(replay).toMatchObject({ version: 2, idempotent: true });
    expect(store.userUpdateHistory).toHaveLength(1);
    expect(store.tenantAuditLogs).toHaveLength(1);
  });

  it('rejects a stale version and a reused commandId with different data', async () => {
    const created = await create.execute({
      companyId: store.companies[0].id,
      name: 'Concorrência Segura',
      username: 'concorrencia.segura',
      email: 'concorrencia@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['operations'],
      permissionCodes: ['operations:view'],
    });
    const commandId = randomUUID();
    await useCase.execute({
      companyId: store.companies[0].id,
      actorUserId: store.users[0].id,
      userId: created.id,
      commandId,
      expectedVersion: created.version,
      name: 'Primeiro Resultado',
    });

    await expect(
      useCase.execute({
        companyId: store.companies[0].id,
        actorUserId: store.users[0].id,
        userId: created.id,
        commandId,
        expectedVersion: created.version,
        name: 'Payload Divergente',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      useCase.execute({
        companyId: store.companies[0].id,
        actorUserId: store.users[0].id,
        userId: created.id,
        commandId: randomUUID(),
        expectedVersion: created.version,
        email: 'stale@empresa.test',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(store.userUpdateHistory).toHaveLength(1);
    expect(store.tenantAuditLogs).toHaveLength(1);
  });

  it('treats an omitted job title and an explicit empty job title as different commands', async () => {
    const created = await create.execute({
      companyId: store.companies[0].id,
      name: 'Cargo Idempotente',
      username: 'cargo.idempotente',
      email: 'cargo.idempotente@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['operations'],
      permissionCodes: ['operations:view'],
    });
    const command = {
      companyId: store.companies[0].id,
      actorUserId: store.users[0].id,
      userId: created.id,
      commandId: randomUUID(),
      expectedVersion: created.version,
      name: 'Cargo Idempotente Atualizado',
    };

    await useCase.execute(command);

    await expect(
      useCase.execute({ ...command, jobTitle: '   ' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(store.userUpdateHistory).toHaveLength(1);
    expect(store.tenantAuditLogs).toHaveLength(1);
  });

  it('does not overwrite an intermediate change when an old command is replayed later', async () => {
    const created = await create.execute({
      companyId: store.companies[0].id,
      name: 'Replay Tardio',
      username: 'replay.tardio',
      email: 'replay@empresa.test',
      password: 'OutraSenha@2026',
      departments: ['operations'],
      permissionCodes: ['operations:view'],
    });
    const firstCommand = {
      companyId: store.companies[0].id,
      actorUserId: store.users[0].id,
      userId: created.id,
      commandId: randomUUID(),
      expectedVersion: created.version,
      name: 'Nome Confirmado',
    };
    const first = await useCase.execute(firstCommand);
    await useCase.execute({
      companyId: store.companies[0].id,
      actorUserId: store.users[0].id,
      userId: created.id,
      commandId: randomUUID(),
      expectedVersion: first.version,
      email: 'intermediaria@empresa.test',
    });

    const replay = await useCase.execute(firstCommand);

    expect(replay).toMatchObject({
      name: 'Nome Confirmado',
      email: 'intermediaria@empresa.test',
      version: 3,
      idempotent: true,
    });
    expect(store.userUpdateHistory).toHaveLength(2);
    expect(store.tenantAuditLogs).toHaveLength(2);
  });
});
