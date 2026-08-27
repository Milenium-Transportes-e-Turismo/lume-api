import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  conflict,
  forbidden,
  notFound,
  validationError,
} from '../../../core/errors/app-error';
import {
  normalizeRegistrationPromotionPayload,
  type RegistrationPromotionPayload,
} from '../../../domain/registrations/registration';
import {
  isValidCnpj,
  isValidCpf,
} from '../../../shared/utils/brazilian-documents';
import {
  Prisma,
  RegistrationCandidateStatus,
  RegistrationDecisionAction,
  RegistrationImportBatchStatus,
  RoutingClientType,
} from '../../../infra/database/prisma/generated/client';
import { PrismaService } from '../../../infra/database/prisma/prisma.service';
import { rethrowKnownPrismaConflict } from '../../../infra/database/prisma/prisma-errors';
import {
  RegistrationReconciliationWorkbookService,
  type ParsedRegistrationWorkbook,
  type RegistrationWorkbookRecord,
} from '../../../infra/registrations/registration-reconciliation-workbook.service';
import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';
import { RegistrationsService } from './registrations.service';

const candidateInclude = {
  batch: {
    select: {
      id: true,
      fileName: true,
      source: true,
      createdAt: true,
    },
  },
  sources: {
    include: { externalRecord: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  },
  decisions: {
    include: { actor: { select: { name: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  },
  promotedRegistration: {
    select: {
      id: true,
      clientType: true,
      individualName: true,
      legalName: true,
      tradeName: true,
    },
  },
} satisfies Prisma.RegistrationCandidateInclude;

type CandidateRow = Prisma.RegistrationCandidateGetPayload<{
  include: typeof candidateInclude;
}>;

export interface RegistrationCandidateListQuery {
  page: number;
  pageSize: number;
  search?: string;
  statuses?: RegistrationCandidateStatus[];
  type?: RoutingClientType;
  suggestedRoleCode?: string;
  hasDocument?: boolean;
  hasDocumentIssue?: boolean;
  hasWhatsApp?: boolean;
  hasConversation?: boolean;
  highConfidence?: boolean;
  incomplete?: boolean;
  reviewedBy?: string;
  batchId?: string;
  sort?: 'priority' | 'name' | 'updated';
}

export interface RegistrationReviewInput {
  commandId: string;
  expectedVersion: number;
  action:
    'start-review' | 'save-review' | 'mark-unidentified' | 'ignore' | 'approve';
  confirmedPayload?: RegistrationPromotionPayload | null;
  note?: string | null;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function jsonObject(
  value: Prisma.JsonValue,
): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function payloadString(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function documentQuality(document: string | null) {
  if (!document) {
    return { valid: null, type: null, issues: ['Documento não informado.'] };
  }
  if (document.length === 11) {
    const valid = isValidCpf(document);
    return {
      valid,
      type: 'PF' as const,
      issues: valid ? [] : ['CPF inválido na fonte.'],
    };
  }
  if (document.length === 14) {
    const valid = isValidCnpj(document);
    return {
      valid,
      type: 'PJ' as const,
      issues: valid ? [] : ['CNPJ inválido na fonte.'],
    };
  }
  return {
    valid: false,
    type: null,
    issues: ['Documento com quantidade de caracteres inválida.'],
  };
}

function nameQuality(name: string | null) {
  if (!name) return { valid: false, issues: ['Nome não informado.'] };
  if ((name.match(/\p{L}/gu)?.length ?? 0) < 2) {
    return { valid: false, issues: ['Nome inválido na fonte.'] };
  }
  return { valid: true, issues: [] as string[] };
}

function candidateStatus(value: RegistrationCandidateStatus) {
  return value.toLocaleLowerCase('pt-BR').replaceAll('_', '-');
}

function decisionAction(value: RegistrationDecisionAction) {
  return value.toLocaleLowerCase('pt-BR').replaceAll('_', '-');
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function presentCandidate(row: CandidateRow) {
  return {
    id: row.id,
    batch: {
      ...row.batch,
      createdAt: row.batch.createdAt.toISOString(),
    },
    status: candidateStatus(row.status),
    suggestedType: row.suggestedType?.toLowerCase() ?? null,
    confirmedType: row.confirmedType?.toLowerCase() ?? null,
    displayName: row.displayName,
    normalizedName: row.normalizedName,
    documentOriginal: row.documentOriginal,
    documentNormalized: row.documentNormalized,
    documentValid: row.documentValid,
    phoneOriginal: row.phoneOriginal,
    phoneNormalized: row.phoneNormalized,
    city: row.city,
    state: row.state,
    confidence: row.confidence,
    priority: row.priority,
    suggestedRoles: row.suggestedRoles,
    evidence: row.evidence,
    qualityIssues: row.qualityIssues,
    minimumDataComplete: row.minimumDataComplete,
    confirmedPayload: row.confirmedPayload,
    whatsappConversationId: row.whatsappConversationId,
    reviewerUserId: row.reviewerUserId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    promotedRegistration: row.promotedRegistration
      ? {
          id: row.promotedRegistration.id,
          type: row.promotedRegistration.clientType.toLowerCase(),
          displayName:
            row.promotedRegistration.clientType === 'PF'
              ? row.promotedRegistration.individualName ||
                row.promotedRegistration.legalName
              : row.promotedRegistration.tradeName ||
                row.promotedRegistration.legalName,
        }
      : null,
    promotedAt: row.promotedAt?.toISOString() ?? null,
    version: row.version,
    sources: row.sources.map(({ externalRecord, ...source }) => ({
      ...source,
      createdAt: source.createdAt.toISOString(),
      externalRecord: {
        id: externalRecord.id,
        kind: externalRecord.kind
          .toLocaleLowerCase('pt-BR')
          .replaceAll('_', '-'),
        sourceSheet: externalRecord.sourceSheet,
        sourceRow: externalRecord.sourceRow,
        externalId: externalRecord.externalId,
        rawPayload: externalRecord.rawPayload,
        normalizedPayload: externalRecord.normalizedPayload,
        technicalRecord: externalRecord.technicalRecord,
      },
    })),
    decisions: row.decisions.map(({ actor, ...decision }) => ({
      ...decision,
      action: decisionAction(decision.action),
      actorName: actor.name,
      createdAt: decision.createdAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function presentBatch(row: {
  id: string;
  fileName: string;
  fileSha256: string;
  source: string;
  status: RegistrationImportBatchStatus;
  metadata: Prisma.JsonValue;
  counts: Prisma.JsonValue;
  totalRows: number;
  importedRows: number;
  duplicateRows: number;
  ignoredRows: number;
  errorRows: number;
  errorMessage: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...row,
    status: row.status.toLocaleLowerCase('pt-BR').replaceAll('_', '-'),
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parsedRecordBySourceId(
  parsed: ParsedRegistrationWorkbook,
  kind: RegistrationWorkbookRecord['kind'],
) {
  return new Map(
    parsed.records
      .filter((record) => record.kind === kind)
      .map((record) => {
        const sourceId =
          kind === 'PDF_CUSTOMER'
            ? record.externalId
            : payloadString(record.normalizedPayload, 'sourceId');
        return sourceId ? [sourceId, record] : null;
      })
      .filter(
        (entry): entry is [string, RegistrationWorkbookRecord] => !!entry,
      ),
  );
}

@Injectable()
export class RegistrationReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workbook: RegistrationReconciliationWorkbookService,
    private readonly registrations: RegistrationsService,
  ) {}

  private assertInternal(current: AuthenticatedPrincipal) {
    if (current.routingCompanyId) {
      throw forbidden(
        'A Conciliação de Cadastros é restrita aos usuários internos.',
      );
    }
  }

  async import(
    current: AuthenticatedPrincipal,
    input: { fileName: string; content: Buffer },
  ) {
    this.assertInternal(current);
    const parsed = await this.workbook.parse(input.content, input.fileName);
    const existing = await this.prisma.registrationImportBatch.findUnique({
      where: {
        companyId_fileSha256: {
          companyId: current.companyId,
          fileSha256: parsed.fileSha256,
        },
      },
    });
    if (existing) return { ...presentBatch(existing), duplicateFile: true };

    const batch = await this.prisma.registrationImportBatch.create({
      data: {
        companyId: current.companyId,
        actorUserId: current.id,
        fileName: input.fileName.slice(0, 255),
        fileSha256: parsed.fileSha256,
        metadata: json(parsed.metadata),
        totalRows: parsed.records.length + parsed.rowErrors.length,
        errorRows: parsed.rowErrors.length,
      },
    });

    try {
      const completed = await this.prisma.$transaction(
        async (transaction) =>
          this.persistImport(transaction, current, batch.id, parsed),
        { maxWait: 15_000, timeout: 180_000 },
      );
      return { ...presentBatch(completed), duplicateFile: false };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 1000)
          : 'Falha inesperada ao importar a planilha.';
      await this.prisma.registrationImportBatch.update({
        where: {
          id_companyId: { id: batch.id, companyId: current.companyId },
        },
        data: {
          status: 'FAILED',
          errorMessage: message,
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }

  private async persistImport(
    transaction: Prisma.TransactionClient,
    current: AuthenticatedPrincipal,
    batchId: string,
    parsed: ParsedRegistrationWorkbook,
  ) {
    let importedRecords = 0;
    for (const part of chunks(parsed.records, 500)) {
      const result = await transaction.registrationExternalRecord.createMany({
        data: part.map((record) => ({
          companyId: current.companyId,
          batchId,
          kind: record.kind,
          sourceSheet: record.sourceSheet,
          sourceRow: record.sourceRow,
          externalId: record.externalId,
          fingerprint: record.fingerprint,
          rawPayload: json(record.rawPayload),
          normalizedPayload: json(record.normalizedPayload),
          technicalRecord: record.technicalRecord,
        })),
        skipDuplicates: true,
      });
      importedRecords += result.count;
    }

    const databaseRecords = [];
    for (const fingerprints of chunks(
      parsed.records.map((record) => record.fingerprint),
      2_000,
    )) {
      databaseRecords.push(
        ...(await transaction.registrationExternalRecord.findMany({
          where: {
            companyId: current.companyId,
            fingerprint: { in: fingerprints },
          },
        })),
      );
    }
    const databaseRecordByFingerprint = new Map(
      databaseRecords.map((record) => [record.fingerprint, record]),
    );
    const sourceRows = [];
    for (const recordIds of chunks(
      databaseRecords.map((record) => record.id),
      2_000,
    )) {
      sourceRows.push(
        ...(await transaction.registrationCandidateSource.findMany({
          where: {
            companyId: current.companyId,
            externalRecordId: { in: recordIds },
          },
        })),
      );
    }
    const candidateIdByRecordId = new Map(
      sourceRows.map((source) => [source.externalRecordId, source.candidateId]),
    );

    const pdfBySourceId = parsedRecordBySourceId(parsed, 'PDF_CUSTOMER');
    const whatsappBySourceId = parsedRecordBySourceId(
      parsed,
      'WHATSAPP_CONTACT',
    );
    const matchesByCustomer = new Map<string, typeof parsed.matches>();
    const matchedWhatsappIds = new Set<string>();
    for (const match of parsed.matches) {
      const values = matchesByCustomer.get(match.customerExternalId) ?? [];
      values.push(match);
      matchesByCustomer.set(match.customerExternalId, values);
      matchedWhatsappIds.add(match.whatsappExternalId);
    }

    const conversationByPhone = await this.findConversationsByPhone(
      transaction,
      current.companyId,
      parsed.records
        .map((record) => payloadString(record.normalizedPayload, 'phone'))
        .filter((phone): phone is string => !!phone),
    );

    const candidates: Prisma.RegistrationCandidateCreateManyInput[] = [];
    const newPrimaryRecordIdByCandidateId = new Map<string, string>();
    const newPdfCandidateIds = new Set<string>();
    for (const [customerSourceId, record] of pdfBySourceId) {
      const databaseRecord = databaseRecordByFingerprint.get(
        record.fingerprint,
      );
      if (!databaseRecord || candidateIdByRecordId.has(databaseRecord.id))
        continue;
      const normalized = record.normalizedPayload;
      const name = payloadString(normalized, 'name');
      const phone = payloadString(normalized, 'phone');
      const document = payloadString(normalized, 'document');
      const quality = documentQuality(document);
      const nameAssessment = nameQuality(name);
      const minimumDataComplete =
        quality.type === 'PF'
          ? nameAssessment.valid && Boolean(phone) && quality.valid === true
          : quality.type === 'PJ'
            ? nameAssessment.valid && quality.valid === true
            : false;
      const completenessIssues =
        quality.type === 'PF' && !phone
          ? ['Pessoa Física precisa de pelo menos um telefone.']
          : [];
      const matches = matchesByCustomer.get(customerSourceId) ?? [];
      const ambiguous = matches.some(
        (match) =>
          match.reviewStatus?.toLocaleLowerCase('pt-BR').includes('obrigat') ||
          match.status?.toLocaleLowerCase('pt-BR').includes('ambigu'),
      );
      const confidence =
        matches.length > 0
          ? Math.max(
              0,
              Math.min(100, ...matches.map((match) => match.score ?? 0)),
            )
          : 0;
      const id = randomUUID();
      candidates.push({
        id,
        companyId: current.companyId,
        batchId,
        status:
          !nameAssessment.valid && !phone && !document
            ? 'INSUFFICIENT_DATA'
            : ambiguous
              ? 'AMBIGUOUS'
              : 'READY_FOR_DECISION',
        suggestedType: quality.type,
        displayName: name,
        normalizedName: name,
        documentOriginal: payloadString(record.rawPayload, 'documento'),
        documentNormalized: document,
        documentValid: quality.valid,
        phoneOriginal: payloadString(record.rawPayload, 'telefone_original'),
        phoneNormalized: phone,
        city: payloadString(normalized, 'city'),
        state: payloadString(normalized, 'state'),
        confidence,
        priority: ambiguous
          ? 60
          : matches.length > 0 && minimumDataComplete && confidence >= 80
            ? 100
            : matches.length > 0
              ? 85
              : document && !quality.valid
                ? 70
                : 50,
        suggestedRoles: json([
          {
            code: 'client',
            label: 'Cliente',
            reason: 'O registro foi extraído da base histórica de clientes.',
          },
        ]),
        suggestedRoleCodes: ['client'],
        evidence: json([
          {
            source: 'Clientes PDF',
            sourceId: customerSourceId,
            message: 'Identidade presente na base histórica de clientes.',
          },
          ...matches.map((match) => ({
            source: 'Correspondências',
            rule: match.rule,
            score: match.score,
            message: match.evidence,
            ambiguityReason: match.ambiguityReason,
          })),
        ]),
        qualityIssues: json([
          ...quality.issues,
          ...nameAssessment.issues,
          ...completenessIssues,
        ]),
        minimumDataComplete,
        whatsappConversationId: phone ? conversationByPhone.get(phone) : null,
      });
      candidateIdByRecordId.set(databaseRecord.id, id);
      newPrimaryRecordIdByCandidateId.set(id, databaseRecord.id);
      newPdfCandidateIds.add(id);
    }

    for (const [whatsappSourceId, record] of whatsappBySourceId) {
      if (record.technicalRecord || matchedWhatsappIds.has(whatsappSourceId)) {
        continue;
      }
      const databaseRecord = databaseRecordByFingerprint.get(
        record.fingerprint,
      );
      if (!databaseRecord || candidateIdByRecordId.has(databaseRecord.id))
        continue;
      const normalized = record.normalizedPayload;
      const name = payloadString(normalized, 'name');
      const phone = payloadString(normalized, 'phone');
      const nameAssessment = nameQuality(name);
      const id = randomUUID();
      candidates.push({
        id,
        companyId: current.companyId,
        batchId,
        status:
          nameAssessment.valid && phone
            ? 'READY_FOR_DECISION'
            : 'INSUFFICIENT_DATA',
        displayName: name,
        normalizedName: name,
        phoneOriginal: payloadString(record.rawPayload, 'telefone_original'),
        phoneNormalized: phone,
        confidence: 0,
        priority: name ? 30 : 10,
        suggestedRoles: json([]),
        suggestedRoleCodes: [],
        evidence: json([
          {
            source: 'Contatos WhatsApp',
            sourceId: whatsappSourceId,
            message:
              'Conversa individual sem correspondência confirmada no Cadastro.',
          },
        ]),
        qualityIssues: json([
          ...nameAssessment.issues,
          'A conversa não comprova identidade, tipo de pessoa ou Papel.',
        ]),
        minimumDataComplete: false,
        whatsappConversationId: phone ? conversationByPhone.get(phone) : null,
      });
      candidateIdByRecordId.set(databaseRecord.id, id);
      newPrimaryRecordIdByCandidateId.set(id, databaseRecord.id);
    }

    for (const part of chunks(candidates, 400)) {
      await transaction.registrationCandidate.createMany({ data: part });
    }

    const candidateSources: Prisma.RegistrationCandidateSourceCreateManyInput[] =
      [...newPrimaryRecordIdByCandidateId].map(
        ([candidateId, externalRecordId]) => ({
          companyId: current.companyId,
          candidateId,
          externalRecordId,
          isPrimary: true,
          evidence: 'Fonte primária do candidato.',
        }),
      );
    for (const match of parsed.matches) {
      const pdf = pdfBySourceId.get(match.customerExternalId);
      const whatsapp = whatsappBySourceId.get(match.whatsappExternalId);
      if (!pdf || !whatsapp || whatsapp.technicalRecord) continue;
      const pdfRecord = databaseRecordByFingerprint.get(pdf.fingerprint);
      const whatsappRecord = databaseRecordByFingerprint.get(
        whatsapp.fingerprint,
      );
      if (!pdfRecord || !whatsappRecord) continue;
      const candidateId = candidateIdByRecordId.get(pdfRecord.id);
      if (!candidateId) continue;
      candidateSources.push({
        companyId: current.companyId,
        candidateId,
        externalRecordId: whatsappRecord.id,
        matchRule: match.rule,
        score: match.score,
        evidence: match.evidence ?? match.ambiguityReason,
        isPrimary: false,
      });
    }
    for (const part of chunks(candidateSources, 700)) {
      await transaction.registrationCandidateSource.createMany({
        data: part,
        skipDuplicates: true,
      });
    }

    const technicalRecords = parsed.records.filter(
      (record) => record.kind === 'WHATSAPP_CONTACT' && record.technicalRecord,
    ).length;
    const duplicateRows = parsed.records.length - importedRecords;
    const counts = {
      candidatesCreated: candidates.length,
      pdfCandidates: newPdfCandidateIds.size,
      whatsappOnlyCandidates: candidates.length - newPdfCandidateIds.size,
      sourceLinks: candidateSources.length,
      technicalRecords,
      rowErrors: parsed.rowErrors,
    };
    return transaction.registrationImportBatch.update({
      where: {
        id_companyId: { id: batchId, companyId: current.companyId },
      },
      data: {
        status:
          parsed.rowErrors.length > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
        counts: json(counts),
        importedRows: importedRecords,
        duplicateRows,
        ignoredRows: technicalRecords,
        errorRows: parsed.rowErrors.length,
        completedAt: new Date(),
      },
    });
  }

  private async findConversationsByPhone(
    transaction: Prisma.TransactionClient,
    companyId: string,
    phones: string[],
  ) {
    const result = new Map<string, string>();
    const uniquePhones = [...new Set(phones)];
    for (const part of chunks(uniquePhones, 2_000)) {
      const conversations = await transaction.whatsAppConversation.findMany({
        where: {
          companyId,
          contact: { phoneNormalized: { in: part } },
        },
        select: {
          id: true,
          updatedAt: true,
          contact: { select: { phoneNormalized: true } },
        },
        orderBy: { updatedAt: 'desc' },
      });
      for (const conversation of conversations) {
        if (!result.has(conversation.contact.phoneNormalized)) {
          result.set(conversation.contact.phoneNormalized, conversation.id);
        }
      }
    }
    return result;
  }

  async listBatches(current: AuthenticatedPrincipal) {
    this.assertInternal(current);
    const rows = await this.prisma.registrationImportBatch.findMany({
      where: { companyId: current.companyId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    return rows.map(presentBatch);
  }

  async listCandidates(
    current: AuthenticatedPrincipal,
    query: RegistrationCandidateListQuery,
  ) {
    this.assertInternal(current);
    const search = query.search?.trim();
    const reviewedBy = query.reviewedBy?.trim();
    const digits = search?.replace(/\D/g, '') || undefined;
    const compoundFilters: Prisma.RegistrationCandidateWhereInput[] = [
      ...(query.type
        ? [
            {
              OR: [
                { confirmedType: query.type },
                { confirmedType: null, suggestedType: query.type },
              ],
            },
          ]
        : []),
      ...(query.incomplete === true ? [{ minimumDataComplete: false }] : []),
      ...(search
        ? [
            {
              OR: [
                {
                  displayName: {
                    contains: search,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  normalizedName: {
                    contains: search,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  documentNormalized: digits ? { contains: digits } : undefined,
                },
                { phoneNormalized: digits ? { contains: digits } : undefined },
                { city: { contains: search, mode: 'insensitive' as const } },
                { state: { equals: search.toUpperCase() } },
                {
                  sources: {
                    some: {
                      externalRecord: {
                        externalId: {
                          contains: search,
                          mode: 'insensitive' as const,
                        },
                      },
                    },
                  },
                },
              ].filter(Boolean) as Prisma.RegistrationCandidateWhereInput[],
            },
          ]
        : []),
      ...(reviewedBy
        ? [
            {
              OR: [
                ...(looksLikeUuid(reviewedBy)
                  ? [{ reviewerUserId: reviewedBy }]
                  : []),
                {
                  reviewer: {
                    is: {
                      name: {
                        contains: reviewedBy,
                        mode: 'insensitive' as const,
                      },
                    },
                  },
                },
              ],
            },
          ]
        : []),
    ];
    const where: Prisma.RegistrationCandidateWhereInput = {
      companyId: current.companyId,
      ...(query.statuses?.length ? { status: { in: query.statuses } } : {}),
      ...(query.suggestedRoleCode
        ? { suggestedRoleCodes: { has: query.suggestedRoleCode } }
        : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
      ...(query.hasDocument === true
        ? { documentNormalized: { not: null } }
        : query.hasDocument === false
          ? { documentNormalized: null }
          : {}),
      ...(query.hasDocumentIssue === true ? { documentValid: false } : {}),
      ...(query.hasWhatsApp === true
        ? { phoneNormalized: { not: null } }
        : query.hasWhatsApp === false
          ? { phoneNormalized: null }
          : {}),
      ...(query.hasConversation === true
        ? { whatsappConversationId: { not: null } }
        : query.hasConversation === false
          ? { whatsappConversationId: null }
          : {}),
      ...(query.highConfidence === true ? { confidence: { gte: 80 } } : {}),
      ...(compoundFilters.length ? { AND: compoundFilters } : {}),
    };
    const orderBy: Prisma.RegistrationCandidateOrderByWithRelationInput[] =
      query.sort === 'name'
        ? [{ displayName: 'asc' }, { id: 'asc' }]
        : query.sort === 'updated'
          ? [{ updatedAt: 'desc' }, { id: 'asc' }]
          : [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }];
    const [rows, total, grouped] = await this.prisma.$transaction([
      this.prisma.registrationCandidate.findMany({
        where,
        include: candidateInclude,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.registrationCandidate.count({ where }),
      this.prisma.registrationCandidate.groupBy({
        by: ['status'],
        where: { companyId: current.companyId },
        _count: true,
        orderBy: { status: 'asc' },
      }),
    ]);
    return {
      items: rows.map(presentCandidate),
      total,
      counts: Object.fromEntries(
        grouped.map((entry) => [candidateStatus(entry.status), entry._count]),
      ),
    };
  }

  async getCandidate(current: AuthenticatedPrincipal, candidateId: string) {
    this.assertInternal(current);
    const row = await this.prisma.registrationCandidate.findUnique({
      where: {
        id_companyId: { id: candidateId, companyId: current.companyId },
      },
      include: candidateInclude,
    });
    if (!row) throw notFound('Candidato');
    return presentCandidate(row);
  }

  async review(
    current: AuthenticatedPrincipal,
    candidateId: string,
    input: RegistrationReviewInput,
  ) {
    this.assertInternal(current);
    const statusByAction: Record<
      RegistrationReviewInput['action'],
      RegistrationCandidateStatus
    > = {
      'start-review': 'IN_REVIEW',
      'save-review': 'IN_REVIEW',
      'mark-unidentified': 'UNIDENTIFIED',
      ignore: 'IGNORED',
      approve: 'APPROVED',
    };
    const actionByInput: Record<
      RegistrationReviewInput['action'],
      RegistrationDecisionAction
    > = {
      'start-review': 'START_REVIEW',
      'save-review': 'SAVE_REVIEW',
      'mark-unidentified': 'MARK_UNIDENTIFIED',
      ignore: 'IGNORE',
      approve: 'APPROVE',
    };
    let confirmedPayload:
      Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput =
      input.confirmedPayload ? json(input.confirmedPayload) : Prisma.JsonNull;
    let confirmedType: RoutingClientType | null = null;
    if (input.action === 'approve') {
      if (!input.confirmedPayload) {
        throw validationError('Revise e confirme os dados antes de aprovar.');
      }
      const normalized = normalizeRegistrationPromotionPayload(
        input.confirmedPayload,
      );
      const primary = normalized.registrations.find(
        (registration) => registration.localId === normalized.primaryLocalId,
      )!;
      confirmedPayload = json(input.confirmedPayload);
      confirmedType =
        primary.registration.type.toUpperCase() as RoutingClientType;
    }
    try {
      const row = await this.prisma.$transaction(async (transaction) => {
        const repeated =
          await transaction.registrationReviewDecision.findUnique({
            where: {
              companyId_commandId: {
                companyId: current.companyId,
                commandId: input.commandId,
              },
            },
          });
        if (repeated) {
          return transaction.registrationCandidate.findUniqueOrThrow({
            where: {
              id_companyId: {
                id: repeated.candidateId,
                companyId: current.companyId,
              },
            },
            include: candidateInclude,
          });
        }
        const before = await transaction.registrationCandidate.findUnique({
          where: {
            id_companyId: { id: candidateId, companyId: current.companyId },
          },
        });
        if (!before) throw notFound('Candidato');
        if (before.status === 'PROMOTED') {
          throw conflict('O candidato já foi promovido para o Cadastro.');
        }
        const updated = await transaction.registrationCandidate.updateMany({
          where: {
            id: candidateId,
            companyId: current.companyId,
            version: input.expectedVersion,
          },
          data: {
            status: statusByAction[input.action],
            ...(input.confirmedPayload !== undefined
              ? { confirmedPayload }
              : {}),
            ...(confirmedType ? { confirmedType } : {}),
            ...(input.action === 'approve'
              ? { minimumDataComplete: true }
              : {}),
            reviewerUserId: current.id,
            reviewedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          throw conflict(
            'O candidato foi alterado por outro usuário. Recarregue os dados.',
          );
        }
        const after = await transaction.registrationCandidate.findUniqueOrThrow(
          {
            where: {
              id_companyId: { id: candidateId, companyId: current.companyId },
            },
          },
        );
        await transaction.registrationReviewDecision.create({
          data: {
            companyId: current.companyId,
            candidateId,
            actorUserId: current.id,
            commandId: input.commandId,
            action: actionByInput[input.action],
            beforeSnapshot: json(before),
            afterSnapshot: json(after),
            note: input.note?.trim().slice(0, 1000) || null,
          },
        });
        return transaction.registrationCandidate.findUniqueOrThrow({
          where: {
            id_companyId: { id: candidateId, companyId: current.companyId },
          },
          include: candidateInclude,
        });
      });
      return presentCandidate(row);
    } catch (error) {
      rethrowKnownPrismaConflict(error);
    }
  }

  async promote(
    current: AuthenticatedPrincipal,
    candidateId: string,
    input: { commandId: string; expectedVersion: number },
  ) {
    this.assertInternal(current);
    try {
      const row = await this.prisma.$transaction(async (transaction) => {
        const repeated =
          await transaction.registrationReviewDecision.findUnique({
            where: {
              companyId_commandId: {
                companyId: current.companyId,
                commandId: input.commandId,
              },
            },
          });
        if (repeated) {
          return transaction.registrationCandidate.findUniqueOrThrow({
            where: {
              id_companyId: {
                id: repeated.candidateId,
                companyId: current.companyId,
              },
            },
            include: candidateInclude,
          });
        }
        const candidate = await transaction.registrationCandidate.findUnique({
          where: {
            id_companyId: { id: candidateId, companyId: current.companyId },
          },
        });
        if (!candidate) throw notFound('Candidato');
        if (candidate.status === 'PROMOTED') {
          return transaction.registrationCandidate.findUniqueOrThrow({
            where: {
              id_companyId: { id: candidateId, companyId: current.companyId },
            },
            include: candidateInclude,
          });
        }
        if (candidate.status !== 'APPROVED' || !candidate.confirmedPayload) {
          throw conflict(
            'Aprove o candidato individualmente antes de promovê-lo.',
          );
        }
        const confirmed = jsonObject(
          candidate.confirmedPayload,
        ) as unknown as RegistrationPromotionPayload;
        const created = await this.registrations.createPromotionGraph(
          transaction,
          current,
          confirmed,
          { commandId: input.commandId, candidateId },
        );
        const promoted = await transaction.registrationCandidate.updateMany({
          where: {
            id: candidateId,
            companyId: current.companyId,
            version: input.expectedVersion,
            status: 'APPROVED',
            promotedRegistrationId: null,
          },
          data: {
            status: 'PROMOTED',
            promotedRegistrationId: created.primaryRegistrationId,
            promotedAt: new Date(),
            reviewerUserId: current.id,
            reviewedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (promoted.count !== 1) {
          throw conflict('O candidato foi alterado por outro usuário.');
        }
        await Promise.all([
          transaction.registrationReviewDecision.create({
            data: {
              companyId: current.companyId,
              candidateId,
              actorUserId: current.id,
              commandId: input.commandId,
              action: 'PROMOTE',
              beforeSnapshot: json(candidate),
              afterSnapshot: {
                candidateId,
                promotedRegistrationId: created.primaryRegistrationId,
                promotedRegistrationIds: created.registrationIds,
                relationshipIds: created.relationshipIds,
                status: 'promoted',
              },
            },
          }),
        ]);
        return transaction.registrationCandidate.findUniqueOrThrow({
          where: {
            id_companyId: { id: candidateId, companyId: current.companyId },
          },
          include: candidateInclude,
        });
      });
      return presentCandidate(row);
    } catch (error) {
      rethrowKnownPrismaConflict(error);
    }
  }
}
