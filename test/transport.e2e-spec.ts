import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { RegistrationsService } from '../src/application/use-cases/registrations/registrations.service';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPrincipal } from '../src/application/presenters/user.presenter';
import { PrismaService } from '../src/infra/database/prisma/prisma.service';
import { TransportImportService } from '../src/application/use-cases/transport/transport-import.service';
import { TransportWorkerService } from '../src/application/use-cases/transport/transport-worker.service';
import { TransportSummaryService } from '../src/application/use-cases/transport/transport-summary.service';
import { TransportCatalogRepository } from '../src/modules/transport/transport-catalog.repository';
import { TransportCatalogUseCase } from '../src/modules/transport/transport-catalog.use-case';
import { settingsSchema } from '../src/modules/transport-import/transport-import.schemas';
import type { AvicClient } from '../src/infra/avic/avic-client';

const url = process.env.TEST_DATABASE_URL;
const isolated = url && new URL(url).pathname.endsWith('_test');
const asObject = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
describe.skipIf(!isolated)(
  'Transport persistence on disposable PostgreSQL',
  () => {
    let db: PrismaService,
      imports: TransportImportService,
      worker: TransportWorkerService,
      summary: TransportSummaryService,
      catalog: TransportCatalogUseCase;
    let current: AuthenticatedPrincipal,
      other: AuthenticatedPrincipal,
      company: string,
      contract: string,
      route: string,
      recordId: string,
      issueId: string;
    const settings = settingsSchema.parse({
      externalIdField: 'RegistroViagemId',
      sourceUtcOffset: '-03:00',
      sequenceComplete: true,
    });
    const command = () => ({ commandId: randomUUID(), expectedVersion: 0 });
    beforeAll(async () => {
      const config = new ConfigService({
        DATABASE_URL: url,
        AVIC_API_BASE_URL: 'http://avic.invalid',
        TRANSPORT_WORKER_ENABLED: false,
      });
      db = new PrismaService(config);
      await db.$connect();
      imports = new TransportImportService(db, config);
      worker = new TransportWorkerService(db, config);
      summary = new TransportSummaryService(db, imports);
      catalog = new TransportCatalogUseCase(new TransportCatalogRepository(db));
      async function principal(): Promise<AuthenticatedPrincipal> {
        const companyId = randomUUID();
        const id = randomUUID();
        const suffix = id.slice(0, 8);
        await db.company.create({
          data: {
            id: companyId,
            legalName: 'Tenant de teste ' + suffix,
            taxId: id.replaceAll('-', '').slice(0, 14),
          },
        });
        await db.user.create({
          data: {
            id,
            companyId,
            name: 'Pessoa de teste',
            username: suffix,
            usernameNormalized: suffix,
            email: suffix + '@example.test',
            emailNormalized: suffix + '@example.test',
            passwordHash: 'not-a-login',
            isAdministrator: true,
          },
        });
        return {
          id,
          companyId,
          isAdministrator: true,
          isActive: true,
          departments: ['management'],
          permissions: [],
          permissionCodes: [],
        } as unknown as AuthenticatedPrincipal;
      }
      current = await principal();
      other = await principal();
    }, 120000);
    afterAll(async () => {
      vi.restoreAllMocks();
      await db?.$disconnect();
    });
    it('creates independent tenant company, scoped references, temporal contracts and confirmed route', async () => {
      const input = {
        ...command(),
        cnpj: '11222333000181',
        legalName: 'Prestadora sintética',
        tradeName: 'Frota de teste',
      };
      const created = asObject(await catalog.save(current, 'companies', input));
      company = String(created.registrationId ?? created.id);
      expect(await catalog.save(current, 'companies', input)).toEqual(created);
      expect(
        await db.routingCompany.count({
          where: { companyId: current.companyId, cnpj: input.cnpj },
        }),
      ).toBe(0);
      expect(
        await db.transportSupplierProfile.findUnique({
          where: { registrationId: company },
        }),
      ).toMatchObject({
        cnpj: input.cnpj,
        legalName: input.legalName,
        legacyRegistrationId: null,
      });
      const customer = await db.routingCompany.create({
        data: {
          companyId: current.companyId,
          taxId: '52998224725',
          clientType: 'PF',
          legalName: 'Cliente PF sintético',
          cpf: '52998224725',
        },
      });
      await expect(
        catalog.save(other, 'fleet', {
          ...command(),
          fleetCode: '99',
          supplierRegistrationId: company,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      const fleet = asObject(
        await catalog.save(current, 'fleet', {
          ...command(),
          fleetCode: 'T001',
          supplierRegistrationId: company,
          provider: 'avic',
          externalVehicleId: '6',
          validFrom: '2026-01-01',
        }),
      );
      expect(fleet.fleetCode).toBe('T001');
      const createdContract = asObject(
        await catalog.save(current, 'contracts', {
          ...command(),
          clientRegistrationId: customer.id,
          supplierRegistrationId: company,
          code: 'TEST',
          name: 'Contrato PF',
          modality: 'continuous',
          validFrom: '2026-01-01',
          status: 'active',
        }),
      );
      contract = String(createdContract.contractId ?? createdContract.id);
      await catalog.addPeriod(current, 'contracts', contract, {
        commandId: randomUUID(),
        expectedVersion: 1,
        validFrom: '2026-01-01',
        period: 'daily',
        allowanceKm: '200',
        includeGarage: true,
      });
      const createdRoute = asObject(
        await catalog.save(current, 'routes', {
          ...command(),
          provider: 'avic',
          externalId: '231',
          name: 'Linha de teste',
        }),
      );
      route = String(createdRoute.id);
      await catalog.addPeriod(current, 'routes', route, {
        commandId: randomUUID(),
        expectedVersion: 1,
        contractId: contract,
        validFrom: '2026-01-01',
      });
      await expect(
        catalog.addPeriod(current, 'routes', route, {
          commandId: randomUUID(),
          expectedVersion: 2,
          contractId: contract,
          validFrom: '2026-07-01',
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const nonManager = {
        ...current,
        isAdministrator: false,
        departments: ['operations'],
        permissions: ['clients:manage'],
      } as AuthenticatedPrincipal;
      expect(() =>
        catalog.deactivate(nonManager, company, {
          commandId: randomUUID(),
          expectedVersion: 1,
        }),
      ).toThrow();
    });
    const source = (id: string, start: number, end: number, hour: string) => ({
      RegistroViagemId: id,
      Id: 'different-' + id,
      IdLiteDb: '54444008062582780',
      VeiculoId: '6',
      VeiculoFrota: 'T001',
      IdLinhaRota: '231',
      LinhaNome: 'Linha de teste',
      KMSaidaGaragem: String(start),
      KMRetornoGaragem: String(end),
      KMTotal: String(end - start),
      HoraSaidaGaragem: '2026-07-31T' + hour + ':00:00',
      HoraChegadaGaragem: '2026-07-31T' + hour + ':30:00',
      MotoristaLiderId: '8770',
      MotoristaLiderNome: 'Motorista sintético',
      CodigoCadastro: '7745',
      ClienteNome: 'Cliente de teste',
    });
    async function importRows(
      rows: Record<string, unknown>[],
      vehicleId = '6',
      range = { from: '2026-07-30', to: '2026-08-01' },
    ) {
      const input = {
        commandId: randomUUID(),
        ...range,
        vehicleIds: [vehicleId],
      };
      const created = asObject(await imports.createImport(current, input));
      expect(await imports.createImport(current, input)).toEqual(created);
      const pages = vi
        .fn()
        .mockResolvedValueOnce({ records: rows, nextSkip: 25 })
        .mockResolvedValueOnce({ records: [], nextSkip: null });
      vi.spyOn(worker, 'client').mockReturnValue({
        readPage: pages,
      } as unknown as AvicClient);
      let job = (await db.transportImport.findUnique({
        where: { id: String(created.id) },
      }))!;
      await worker.importPage(job, settings);
      job = (await db.transportImport.findUnique({ where: { id: job.id } }))!;
      expect(job.skip).toBe(25);
      await worker.importPage(job, settings);
      await worker.analyzePage(current.companyId, settings);
      return job.id;
    }
    it('imports idempotently, keeps huge identifiers and detects the same divergence without task spam', async () => {
      await imports.configure(current, {
        commandId: randomUUID(),
        expectedVersion: 0,
        enabled: true,
        settings,
      });
      const rows = [source('a', 100, 90, '04'), source('b', 90, 120, '07')];
      await importRows(rows);
      const record = await db.transportRecord.findUnique({
        where: {
          companyId_provider_externalId: {
            companyId: current.companyId,
            provider: 'avic',
            externalId: 'a',
          },
        },
      });
      recordId = record!.id;
      expect(asObject(record!.raw).IdLiteDb).toBe('54444008062582780');
      expect(record!.driverName).toBe('Motorista sintético');
      const issue = await db.transportIssue.findFirst({
        where: {
          companyId: current.companyId,
          recordId,
          code: 'NEGATIVE_DISTANCE',
        },
      });
      issueId = issue!.id;
      const justification = {
        commandId: randomUUID(),
        expectedVersion: issue!.version,
        text: 'Conferência solicitada na origem.',
      };
      const result = await imports.justify(current, issueId, justification);
      expect(await imports.justify(current, issueId, justification)).toEqual(
        result,
      );
      await importRows(rows);
      expect(
        await db.transportRecord.count({
          where: { companyId: current.companyId },
        }),
      ).toBe(2);
      expect(
        await db.transportRecordHistory.count({
          where: { companyId: current.companyId, recordId },
        }),
      ).toBe(1);
      expect(
        await db.transportIssue.count({
          where: {
            companyId: current.companyId,
            recordId,
            code: 'NEGATIVE_DISTANCE',
          },
        }),
      ).toBe(1);
      expect(
        await db.transportIssueHistory.count({
          where: { issueId, kind: 'JUSTIFIED' },
        }),
      ).toBe(1);
      expect(
        (await db.transportIssue.findUnique({ where: { id: issueId } }))!
          .status,
      ).toBe('OPEN');
      await expect(
        imports.issue(other.companyId, issueId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
    it('origin unavailable neither resolves nor asserts that cached data is still wrong', async () => {
      await worker.unavailable(current.companyId, issueId);
      await imports.analysis(current, {
        commandId: randomUUID(),
        vehicleId: '6',
        from: '2026-07-30',
        to: '2026-08-01',
      });
      await worker.analyzePage(current.companyId, settings);
      expect(
        await db.transportIssue.findUnique({ where: { id: issueId } }),
      ).toMatchObject({ status: 'OPEN', verificationState: 'UNAVAILABLE' });
    });
    it('correction at origin keeps before/after and justification, then resolves automatically', async () => {
      await importRows([
        source('a', 100, 110, '04'),
        source('b', 110, 140, '07'),
      ]);
      expect(
        await db.transportIssue.findUnique({ where: { id: issueId } }),
      ).toMatchObject({ status: 'RESOLVED', verificationState: 'VERIFIED' });
      const history = await db.transportRecordHistory.findMany({
        where: { recordId },
        orderBy: { version: 'asc' },
      });
      expect(history).toHaveLength(2);
      expect(asObject(history[1].before).endKm).toBe('90');
      expect(asObject(history[1].after).endKm).toBe('110');
      expect(
        await db.transportIssueHistory.count({
          where: { issueId, kind: 'JUSTIFIED' },
        }),
      ).toBe(1);
    });
    it('associates a second route and vehicle to the same contract without deriving supplier links from source customer labels', async () => {
      await catalog.save(current, 'fleet', {
        ...command(),
        fleetCode: 'T002',
        supplierRegistrationId: company,
        provider: 'avic',
        externalVehicleId: '7',
        validFrom: '2026-01-01',
      });
      const secondRoute = asObject(
        await catalog.save(current, 'routes', {
          ...command(),
          provider: 'avic',
          externalId: '232',
          name: 'Segunda linha sintética',
        }),
      );
      await catalog.addPeriod(current, 'routes', String(secondRoute.id), {
        commandId: randomUUID(),
        expectedVersion: 1,
        contractId: contract,
        validFrom: '2026-01-01',
      });
      await importRows(
        [
          {
            ...source('route2-record', 300, 360, '12'),
            VeiculoId: '7',
            VeiculoFrota: 'T002',
            IdLinhaRota: '232',
            LinhaNome: 'Segunda linha sintética',
            MotoristaLiderId: '9007199254740993123',
            MotoristaLiderNome: 'Outro motorista sintético',
            CodigoCadastro: '9007199254740993124',
            ClienteNome: 'Rótulo externo sem vínculo local',
          },
        ],
        '7',
      );
      const imported = await db.transportRecord.findUnique({
        where: {
          companyId_provider_externalId: {
            companyId: current.companyId,
            provider: 'avic',
            externalId: 'route2-record',
          },
        },
      });
      expect(imported).toMatchObject({
        vehicleExternalId: '7',
        routeExternalId: '232',
        driverExternalId: '9007199254740993123',
        driverName: 'Outro motorista sintético',
        customerExternalId: '9007199254740993124',
        customerName: 'Rótulo externo sem vínculo local',
      });
      expect(imported!.startedAt!.toISOString()).toBe(
        '2026-07-31T15:00:00.000Z',
      );
      const unchangedContract = await db.transportContractProfile.findUnique({
        where: { contractId: contract },
      });
      expect(unchangedContract!.supplierRegistrationId).toBe(company);
      expect(
        await db.routingCompany.count({
          where: {
            companyId: current.companyId,
            legalName: 'Rótulo externo sem vínculo local',
          },
        }),
      ).toBe(0);
    });
    it('sums all routes/vehicles daily; no inferred revenue or proportional monthly target', async () => {
      const result = await summary.summary(current.companyId, {
        contractId: contract,
        from: '2026-07-31',
        to: '2026-07-31',
      });
      expect(result.periods[0]).toMatchObject({
        periodicity: 'DAILY',
        registeredKm: '100',
        contractedKm: '200',
        differenceKm: '-100',
        recordCount: 3,
      });
      expect(result.source).toBe('DRIVER_REPORTED');
      const condition = await db.transportContractCondition.findFirst({
        where: { companyId: current.companyId, contractId: contract },
      });
      await db.transportContractCondition.update({
        where: { id: condition!.id },
        data: { period: 'monthly', allowanceKm: '1000' },
      });
      const open = await summary.summary(current.companyId, {
        contractId: contract,
        from: '2026-07-01',
        to: '2026-07-31',
      });
      expect(open.periods[0]).toMatchObject({
        periodicity: 'MONTHLY',
        registeredKm: '100',
        contractedKm: '1000',
        differenceKm: null,
        state: 'UNCONFIGURED',
      });
      await summary.setState(current, {
        commandId: randomUUID(),
        expectedVersion: 0,
        contractId: contract,
        period: '2026-07',
        state: 'CLOSED',
      });
      const closed = await summary.summary(current.companyId, {
        contractId: contract,
        from: '2026-07-01',
        to: '2026-07-31',
      });
      expect(closed.periods[0].differenceKm).toBe('-900');
      await db.transportContractCondition.update({
        where: { id: condition!.id },
        data: { includeGarage: false },
      });
      const noGarage = await summary.summary(current.companyId, {
        contractId: contract,
        from: '2026-07-01',
        to: '2026-07-31',
      });
      expect(noGarage.periods[0]).toMatchObject({
        registeredKm: null,
        differenceKm: null,
        dataStatus: 'INSUFFICIENT_MEASUREMENTS',
      });
    });
    it('treats an absent allowance differently from an explicit zero allowance', async () => {
      const condition = await db.transportContractCondition.findFirst({
        where: { companyId: current.companyId, contractId: contract },
      });
      await db.transportContractCondition.update({
        where: { id: condition!.id },
        data: { includeGarage: true, allowanceKm: null },
      });
      const withoutAllowance = await summary.summary(current.companyId, {
        contractId: contract,
        from: '2026-07-01',
        to: '2026-07-31',
      });
      expect(withoutAllowance.periods[0]).toMatchObject({
        contractedKm: null,
        registeredKm: '100',
        differenceKm: null,
        dataStatus: 'SUFFICIENT',
        state: 'CLOSED',
      });
      await db.transportContractCondition.update({
        where: { id: condition!.id },
        data: { allowanceKm: '0' },
      });
      const zero = await summary.summary(current.companyId, {
        contractId: contract,
        from: '2026-07-01',
        to: '2026-07-31',
      });
      expect(zero.periods[0]).toMatchObject({
        contractedKm: '0',
        registeredKm: '100',
        differenceKm: '100',
        dataStatus: 'SUFFICIENT',
      });
      await db.transportContractCondition.update({
        where: { id: condition!.id },
        data: { allowanceKm: '1000' },
      });
    });
    it('requires an explicit transition allowance instead of prorating monthly changes', async () => {
      const old = await db.transportContractCondition.findFirst({
        where: { companyId: current.companyId, contractId: contract },
      });
      await db.transportContractCondition.update({
        where: { id: old!.id },
        data: { validUntil: new Date('2026-07-31') },
      });
      await db.transportContractCondition.create({
        data: {
          companyId: current.companyId,
          contractId: contract,
          validFrom: new Date('2026-08-01'),
          validUntil: new Date('2026-08-15'),
          period: 'monthly',
          allowanceKm: '1000',
          includeGarage: true,
        },
      });
      const transition = await db.transportContractCondition.create({
        data: {
          companyId: current.companyId,
          contractId: contract,
          validFrom: new Date('2026-08-16'),
          period: 'monthly',
          allowanceKm: '2000',
          includeGarage: true,
        },
      });
      const august = {
        ...source('august-record', 140, 150, '04'),
        HoraSaidaGaragem: '2026-08-20T04:00:00',
        HoraChegadaGaragem: '2026-08-20T04:30:00',
      };
      await importRows([august], '6', { from: '2026-08-01', to: '2026-08-31' });
      await summary.setState(current, {
        commandId: randomUUID(),
        expectedVersion: 0,
        contractId: contract,
        period: '2026-08',
        state: 'CLOSED',
      });
      const unset = await summary.summary(current.companyId, {
        contractId: contract,
        from: '2026-08-01',
        to: '2026-08-31',
      });
      expect(unset.periods).toHaveLength(1);
      expect(unset.periods[0]).toMatchObject({
        period: '2026-08',
        periodicity: 'MONTHLY',
        state: 'CLOSED',
        contractedKm: null,
        registeredKm: '10',
        differenceKm: null,
        dataStatus: 'TRANSITION_CONDITION_REQUIRED',
      });
      await db.transportContractCondition.update({
        where: { id: transition.id },
        data: { transitionMonth: '2026-08', transitionAllowanceKm: '1500' },
      });
      const explicit = await summary.summary(current.companyId, {
        contractId: contract,
        from: '2026-08-01',
        to: '2026-08-31',
      });
      expect(explicit.periods[0]).toMatchObject({
        contractedKm: '1500',
        registeredKm: '10',
        differenceKm: '-1490',
        dataStatus: 'SUFFICIENT',
      });
      const partial = await summary.summary(current.companyId, {
        contractId: contract,
        from: '2026-08-16',
        to: '2026-08-31',
      });
      expect(partial.periods[0]).toMatchObject({
        contractedKm: '1500',
        differenceKm: null,
        dataStatus: 'PARTIAL_PERIOD',
      });
      const historical = await summary.summary(current.companyId, {
        contractId: contract,
        from: '2026-07-01',
        to: '2026-07-31',
      });
      expect(historical.periods[0]).toMatchObject({
        contractedKm: '1000',
        registeredKm: '100',
        differenceKm: '-900',
      });
    });
    it('quarantines missing identity without discarding the rest or asserting complete coverage', async () => {
      const id = await importRows([
        { VeiculoId: '6' },
        source('c', 140, 150, '10'),
      ]);
      expect(
        await db.transportImport.findUnique({ where: { id } }),
      ).toMatchObject({ status: 'COMPLETED', rejected: 1 });
      expect(
        await db.transportImportRejection.count({ where: { importId: id } }),
      ).toBe(1);
      expect(
        await db.transportRecord.count({
          where: { companyId: current.companyId },
        }),
      ).toBe(5);
      const pending = await db.transportIssue.findFirst({
        where: {
          companyId: current.companyId,
          code: 'INCOMPLETE_SEQUENCE',
          status: 'OPEN',
        },
      });
      expect(pending?.verificationState).toBe('PENDING');
      const incompleteSummary = await summary.summary(current.companyId, {
        contractId: contract,
        from: '2026-07-01',
        to: '2026-07-31',
      });
      expect(incompleteSummary.periods[0]).toMatchObject({
        registeredKm: '110',
        contractedKm: '1000',
        differenceKm: null,
        dataStatus: 'IMPORT_PENDING',
      });
    });
    it('restores complete coverage after a clean reimport while preserving rejected-row evidence', async () => {
      const rejected = await db.transportImport.findFirst({
        where: { companyId: current.companyId, rejected: { gt: 0 } },
      });
      expect(rejected).not.toBeNull();
      const cleanId = await importRows([
        source('a', 100, 110, '04'),
        source('b', 110, 140, '07'),
        source('c', 140, 150, '10'),
        source('identity-now-present', 150, 160, '11'),
      ]);
      expect(
        await db.transportImport.findUnique({ where: { id: rejected!.id } }),
      ).toMatchObject({
        rejected: 1,
        supersededByImportId: cleanId,
      });
      expect(
        await db.transportImportRejection.count({
          where: { importId: rejected!.id },
        }),
      ).toBe(1);
      expect(
        await db.transportIssue.count({
          where: {
            companyId: current.companyId,
            vehicleExternalId: '6',
            code: 'INCOMPLETE_SEQUENCE',
            status: 'OPEN',
          },
        }),
      ).toBe(0);
      const restored = await summary.summary(current.companyId, {
        contractId: contract,
        from: '2026-07-01',
        to: '2026-07-31',
      });
      expect(restored.periods[0]).toMatchObject({
        registeredKm: '120',
        contractedKm: '1000',
        differenceKm: '-880',
        dataStatus: 'SUFFICIENT',
      });
    });
    it('filters source late-night trips by the tenant operational date instead of their UTC calendar date', async () => {
      await catalog.save(current, 'fleet', {
        ...command(),
        fleetCode: 'T003',
        supplierRegistrationId: company,
        provider: 'avic',
        externalVehicleId: '8',
        validFrom: '2026-01-01',
      });
      await importRows(
        [
          {
            ...source('late-july30', 100, 110, '23'),
            VeiculoId: '8',
            VeiculoFrota: 'T003',
            HoraSaidaGaragem: '2026-07-30T23:00:00',
            HoraChegadaGaragem: '2026-07-30T23:30:00',
          },
          {
            ...source('late-july31', 110, 120, '23'),
            VeiculoId: '8',
            VeiculoFrota: 'T003',
          },
        ],
        '8',
      );
      const july31 = await imports.records(current.companyId, {
        vehicleId: '8',
        from: '2026-07-31',
        to: '2026-07-31',
      });
      expect(july31.items.map((item) => item.externalId)).toEqual([
        'late-july31',
      ]);
      expect(july31.items[0].startedAt!.toISOString()).toBe(
        '2026-08-01T02:00:00.000Z',
      );
      const july30 = await imports.records(current.companyId, {
        vehicleId: '8',
        from: '2026-07-30',
        to: '2026-07-30',
      });
      expect(july30.items.map((item) => item.externalId)).toEqual([
        'late-july30',
      ]);
    });
    it('lets a verified source correction resolve an issue even if a justification was entered before analysis', async () => {
      await importRows([source('a', 100, 90, '04')]);
      expect(
        await db.transportIssue.findUnique({ where: { id: issueId } }),
      ).toMatchObject({ status: 'OPEN' });
      await worker.unavailable(current.companyId, issueId);
      const created = asObject(
        await imports.createImport(current, {
          commandId: randomUUID(),
          from: '2026-07-30',
          to: '2026-08-01',
          vehicleIds: ['6'],
        }),
      );
      const pages = vi
        .fn()
        .mockResolvedValueOnce({
          records: [source('a', 100, 110, '04')],
          nextSkip: 25,
        })
        .mockResolvedValueOnce({ records: [], nextSkip: null });
      vi.spyOn(worker, 'client').mockReturnValue({
        readPage: pages,
      } as unknown as AvicClient);
      let job = (await db.transportImport.findUnique({
        where: { id: String(created.id) },
      }))!;
      await worker.importPage(job, settings);
      job = (await db.transportImport.findUnique({ where: { id: job.id } }))!;
      await worker.importPage(job, settings);
      const pending = (await db.transportIssue.findUnique({
        where: { id: issueId },
      }))!;
      expect(pending.verificationState).toBe('UNAVAILABLE');
      await imports.justify(current, issueId, {
        commandId: randomUUID(),
        expectedVersion: pending.version,
        text: 'Informação registrada após sincronização, antes da análise.',
      });
      await worker.analyzePage(current.companyId, settings);
      expect(
        await db.transportIssue.findUnique({ where: { id: issueId } }),
      ).toMatchObject({
        status: 'RESOLVED',
        verificationState: 'VERIFIED',
      });
      expect(
        await db.transportIssueHistory.count({
          where: { issueId, kind: 'JUSTIFIED' },
        }),
      ).toBe(2);
    });

    it('keeps profile lists, counts and existing contract candidates scoped before pagination', async () => {
      const people = await Promise.all(
        [0, 1].map((index) =>
          db.routingCompany.create({
            data: {
              companyId: current.companyId,
              taxId: '0000000000' + index,
              clientType: 'PF',
              legalName: 'Perfil cliente ' + index,
            },
          }),
        ),
      );
      for (const person of people) {
        for (const month of ['01', '02']) {
          await catalog.save(current, 'affiliations', {
            ...command(),
            registrationId: person.id,
            supplierRegistrationId: company,
            role: 'client',
            validFrom: '2025-' + month + '-01',
            validUntil: '2025-' + month + '-20',
          });
          await catalog.save(current, 'contracts', {
            ...command(),
            clientRegistrationId: person.id,
            supplierRegistrationId: company,
            code: 'PROFILE-' + person.id + '-' + month,
            name: 'Perfil contrato ' + month,
            modality: 'continuous',
            validFrom: '2025-' + month + '-01',
            status: 'active',
          });
        }
      }
      for (const resource of ['affiliations', 'contracts'] as const) {
        const field =
          resource === 'affiliations'
            ? 'registrationId'
            : 'clientRegistrationId';
        const seen = [];
        for (const page of ['1', '2']) {
          const result = (await catalog.list(current, resource, {
            registrationId: people[0].id,
            search: 'Perfil',
            page,
            pageSize: '1',
          })) as { items: Record<string, unknown>[]; total: number };
          expect(result.total).toBe(2);
          expect(result.items).toHaveLength(1);
          expect(result.items[0][field]).toBe(people[0].id);
          seen.push(result.items[0].id);
        }
        expect(new Set(seen).size).toBe(2);
        expect(
          await catalog.list(other, resource, { registrationId: people[0].id }),
        ).toMatchObject({ items: [], total: 0 });
        expect(
          await catalog.list(current, resource, {
            registrationId: randomUUID(),
          }),
        ).toMatchObject({ items: [], total: 0 });
      }
      // Remove only profiles in this disposable fixture to exercise legacy contract selection.
      const attached = await db.transportContractProfile.findMany({
        where: {
          companyId: current.companyId,
          contract: { routingCompanyId: { in: people.map((p) => p.id) } },
        },
      });
      await db.transportContractProfile.deleteMany({
        where: {
          companyId: current.companyId,
          contractId: { in: attached.map((p) => p.contractId) },
        },
      });
      const candidates = await catalog.contractCandidates(current, {
        registrationId: people[0].id,
        search: 'Perfil',
        pageSize: '1',
        page: '2',
      });
      expect(candidates.total).toBe(2);
      expect(candidates.items).toHaveLength(1);
      expect(candidates.items[0].clientRegistrationId).toBe(people[0].id);
      expect(
        await catalog.contractCandidates(other, {
          registrationId: people[0].id,
        }),
      ).toMatchObject({ items: [], total: 0 });
    });

    it('keeps tenant CNPJs independent and excludes migrated legacy identities from Cadastro', async () => {
      const legacy = await db.routingCompany.create({
        data: {
          companyId: current.companyId,
          taxId: '99900000000001',
          cnpj: '99900000000001',
          legalName: 'Identidade histórica do tenant',
          tradeName: 'Nome legado',
          clientType: 'PJ',
        },
      });
      const entity = await db.transportSupplierProfile.create({
        data: {
          registrationId: legacy.id,
          legacyRegistrationId: legacy.id,
          companyId: current.companyId,
          cnpj: legacy.cnpj!,
          legalName: legacy.legalName,
          tradeName: legacy.tradeName,
          version: 7,
        },
      });
      const registrations = new RegistrationsService(db);
      const list = await registrations.list(current, {
        page: 1,
        pageSize: 25,
        search: 'Identidade histórica do tenant',
      });
      expect(list).toMatchObject({ items: [], total: 0 });
      await expect(registrations.get(current, legacy.id)).rejects.toMatchObject(
        { code: 'NOT_FOUND' },
      );
      const changed = asObject(
        await catalog.save(
          current,
          'companies',
          {
            commandId: randomUUID(),
            expectedVersion: 7,
            tradeName: 'Nome próprio da empresa',
          },
          entity.registrationId,
        ),
      );
      expect(changed).toMatchObject({
        tradeName: 'Nome próprio da empresa',
        version: 8,
      });
      expect(
        await db.routingCompany.findUnique({ where: { id: legacy.id } }),
      ).toMatchObject({ tradeName: 'Nome legado', version: legacy.version });
      expect(
        await catalog.list(current, 'companies', { search: 'Nome próprio' }),
      ).toMatchObject({ total: 1 });
      await expect(
        catalog.save(current, 'affiliations', {
          ...command(),
          registrationId: legacy.id,
          supplierRegistrationId: company,
          role: 'client',
          validFrom: '2026-01-01',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(
        await catalog.history(current, 'companies', entity.registrationId, {}),
      ).toMatchObject({ total: 1 });
    });
    it('generates distinct numeric codes concurrently, replays commands and keeps seed identity after rename', async () => {
      const payload = { ...command(), kind: 'category', name: 'Leito' };
      const first = asObject(await catalog.save(current, 'catalogs', payload));
      expect(first.code).toMatch(/^[0-9]+$/);
      expect(await catalog.save(current, 'catalogs', payload)).toEqual(first);
      const created = await Promise.all(
        Array.from({ length: 4 }, async (_, index) => {
          const concurrentInput = {
            ...command(),
            kind: 'category',
            name: 'Categoria ' + index,
          };
          // Serializable writes may return a bounded conflict. Retry the same
          // idempotent command, as the client does, without allocating a new ID.
          for (let attempt = 0; ; attempt++) {
            try {
              return await catalog.save(current, 'catalogs', concurrentInput);
            } catch (error) {
              if (
                attempt >= 2 ||
                (error as { code?: string }).code !== 'CONFLICT'
              )
                throw error;
            }
          }
        }),
      );
      const codes = created.map((row) => String(asObject(row).code));
      expect(new Set(codes).size).toBe(4);
      expect(codes.every((code) => /^[0-9]+$/.test(code))).toBe(true);
      await catalog.initialize(current, command());
      const seed = await db.transportCatalogItem.findFirstOrThrow({
        where: {
          companyId: current.companyId,
          seedKey: 'conventional',
          kind: 'category',
        },
      });
      await catalog.save(
        current,
        'catalogs',
        {
          commandId: randomUUID(),
          expectedVersion: seed.version,
          name: 'Convencional revisado',
        },
        seed.id,
      );
      const count = await db.transportCatalogItem.count({
        where: { companyId: current.companyId },
      });
      await catalog.initialize(current, command());
      expect(
        await db.transportCatalogItem.count({
          where: { companyId: current.companyId },
        }),
      ).toBe(count);
      expect(
        await db.transportCatalogItem.findUnique({ where: { id: seed.id } }),
      ).toMatchObject({
        code: seed.code,
        name: 'Convencional revisado',
      });
    });
    it('exports synthetic API projections for Web contract validation', async () => {
      await catalog.initialize(current, {
        commandId: randomUUID(),
        expectedVersion: 0,
      });
      const firstImport = await db.transportImport.findFirst({
        where: { companyId: current.companyId },
        orderBy: { createdAt: 'desc' },
      });
      const snapshots = {
        companiesList: await catalog.list(current, 'companies', {}),
        companyDetail: await catalog.get(current, 'companies', company),
        fleetList: await catalog.list(current, 'fleet', {}),
        contractsList: await catalog.list(current, 'contracts', {}),
        contractDetail: await catalog.get(current, 'contracts', contract),
        routesList: await catalog.list(current, 'routes', {}),
        routeDetail: await catalog.get(current, 'routes', route),
        affiliationsList: await catalog.list(current, 'affiliations', {}),
        catalogsList: await catalog.list(current, 'catalogs', {}),
        importsList: await imports.listImports(current.companyId, {}),
        importDetail: await imports.importDetail(
          current.companyId,
          firstImport!.id,
        ),
        recordsList: await imports.records(current.companyId, {}),
        recordDetail: await imports.record(current.companyId, recordId),
        issuesList: await imports.issues(current.companyId, {}),
        issueDetail: await imports.issue(current.companyId, issueId),
        integration: await imports.integration(current.companyId),
        summary: await summary.summary(current.companyId, {
          contractId: contract,
          from: '2026-07-01',
          to: '2026-07-31',
        }),
        analysesList: await imports.listAnalysis(current.companyId, {}),
      };
      const output = resolve('artifacts', 'transport-web-contracts.json');
      await mkdir(resolve('artifacts'), { recursive: true });
      await writeFile(
        output,
        JSON.stringify(snapshots, null, 2) + '\n',
        'utf8',
      );
      expect(snapshots.recordDetail).toMatchObject({ externalId: 'a' });
    });
  },
);
