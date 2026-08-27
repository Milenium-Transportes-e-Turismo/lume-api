import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import ExcelJS, { type Cell, type Worksheet } from 'exceljs';
import JSZip from 'jszip';

import { validationError } from '../../core/errors/app-error';
import { normalizeWhatsAppPhone } from '../../shared/utils/normalization';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_SOURCE_ROWS = 30_000;
const MAX_NORMALIZED_XML_BYTES = 160 * 1024 * 1024;
const HEADER_ROW = 4;

const PDF_SHEET = 'Clientes PDF';
const WHATSAPP_SHEET = 'Contatos WhatsApp';
const MATCHES_SHEET = 'Correspondências';

const PDF_HEADERS = [
  'customer_source_id',
  'nome_original',
  'nome_normalizado',
  'cidade',
  'uf',
  'endereco',
  'telefone_original',
  'telefone_normalizado',
  'documento',
  'documento_normalizado',
  'inscricao',
  'observacoes',
  'pagina_origem',
] as const;

const WHATSAPP_HEADERS = [
  'conversation_source_id',
  'chat_id',
  'jid',
  'nome_disponivel',
  'nome_fonte',
  'telefone_original',
  'telefone_normalizado',
  'telefone_fonte',
  'tipo_conversa',
  'servidor_jid',
  'total_mensagens',
  'enviadas',
  'recebidas',
  'primeira_interacao',
  'ultima_interacao',
  'anos_interacao',
  'periodos_atividade_30d',
  'mensagens_90_dias',
  'mensagens_365_dias',
  'menor_message_id',
  'maior_message_id',
] as const;

const MATCH_HEADERS = [
  'status_correspondencia',
  'status_revisao',
  'regra_match',
  'score_evidencia',
  'confianca',
  'evidencias',
  'motivo_ambiguidade',
  'cliente_source_id',
  'chat_source_id',
] as const;

export type RegistrationWorkbookRecordKind =
  'PDF_CUSTOMER' | 'WHATSAPP_CONTACT';

export interface RegistrationWorkbookRecord {
  kind: RegistrationWorkbookRecordKind;
  sourceSheet: string;
  sourceRow: number;
  externalId: string;
  fingerprint: string;
  rawPayload: Readonly<Record<string, string | null>>;
  normalizedPayload: Readonly<Record<string, string | null>>;
  technicalRecord: boolean;
}

export interface RegistrationWorkbookMatch {
  customerExternalId: string;
  whatsappExternalId: string;
  status: string | null;
  reviewStatus: string | null;
  rule: string | null;
  score: number | null;
  confidence: string | null;
  evidence: string | null;
  ambiguityReason: string | null;
}

export interface ParsedRegistrationWorkbook {
  fileSha256: string;
  records: RegistrationWorkbookRecord[];
  matches: RegistrationWorkbookMatch[];
  rowErrors: string[];
  metadata: Readonly<Record<string, unknown>>;
}

const ROW_NUMBER = Symbol('registration-workbook-row-number');

type WorkbookRow = Readonly<Record<string, string | null>> & {
  readonly [ROW_NUMBER]: number;
};

function compact(value: string | null | undefined): string | null {
  return value?.replace(/\s+/g, ' ').trim() || null;
}

function normalizedDocument(value: string | null): string | null {
  return value?.toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
}

function normalizedPhone(value: string | null): string | null {
  if (!value) return null;
  try {
    return normalizeWhatsAppPhone(value);
  } catch {
    return null;
  }
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function cellText(cell: Cell): string | null {
  if (cell.value && typeof cell.value === 'object' && 'formula' in cell.value) {
    throw validationError(
      `A planilha contém fórmula na célula ${cell.address}. Substitua por um valor antes de importar.`,
    );
  }
  return compact(cell.text);
}

function readRows(
  worksheet: Worksheet,
  requiredHeaders: readonly string[],
): WorkbookRow[] {
  const columns = new Map<string, number>();
  worksheet.getRow(HEADER_ROW).eachCell((cell, columnNumber) => {
    const header = cellText(cell)?.toLocaleLowerCase('pt-BR');
    if (header) columns.set(header, columnNumber);
  });
  const missing = requiredHeaders.filter((header) => !columns.has(header));
  if (missing.length > 0) {
    throw validationError(
      `A aba ${worksheet.name} não possui as colunas obrigatórias: ${missing.join(', ')}.`,
    );
  }
  if (worksheet.rowCount - HEADER_ROW > MAX_SOURCE_ROWS) {
    throw validationError(
      `A aba ${worksheet.name} excede o limite de ${MAX_SOURCE_ROWS} linhas.`,
    );
  }

  const rows: WorkbookRow[] = [];
  for (
    let rowNumber = HEADER_ROW + 1;
    rowNumber <= worksheet.rowCount;
    rowNumber += 1
  ) {
    const row = worksheet.getRow(rowNumber);
    const payload = Object.fromEntries(
      [...columns.entries()].map(([header, column]) => [
        header,
        cellText(row.getCell(column)),
      ]),
    );
    if (!Object.values(payload).some(Boolean)) continue;
    rows.push({ ...payload, [ROW_NUMBER]: rowNumber });
  }
  return rows;
}

function requireSheet(workbook: ExcelJS.Workbook, name: string): Worksheet {
  const worksheet = workbook.getWorksheet(name);
  if (!worksheet) {
    throw validationError(`A planilha deve possuir a aba ${name}.`);
  }
  return worksheet;
}

function workbookArrayBuffer(content: Buffer): ArrayBuffer {
  return content.buffer.slice(
    content.byteOffset,
    content.byteOffset + content.byteLength,
  ) as ArrayBuffer;
}

async function normalizeSpreadsheetMlNamespaces(
  content: Buffer,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(content);
  const spreadsheetXml = Object.values(zip.files).filter(
    (entry) =>
      !entry.dir &&
      /^xl\/(?:workbook|styles|sharedStrings|worksheets\/[^/]+|tables\/[^/]+)\.xml$/i.test(
        entry.name,
      ),
  );
  let normalizedBytes = 0;
  for (const entry of spreadsheetXml) {
    const xml = await entry.async('string');
    normalizedBytes += Buffer.byteLength(xml);
    if (normalizedBytes > MAX_NORMALIZED_XML_BYTES) {
      throw validationError(
        'A planilha excede o limite seguro de conteúdo descompactado.',
      );
    }
    if (!xml.includes('<x:')) continue;
    const withoutPresentationTables = entry.name.startsWith('xl/worksheets/')
      ? xml.replace(/<(?:x:)?tableParts\b[\s\S]*?<\/(?:x:)?tableParts>/g, '')
      : xml;
    zip.file(
      entry.name,
      withoutPresentationTables
        .replace(
          /xmlns:x="http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main"/g,
          'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
        )
        .replace(/<(\/?)x:/g, '<$1'),
    );
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

async function loadWorkbook(content: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(workbookArrayBuffer(content));
    return workbook;
  } catch {
    const normalized = await normalizeSpreadsheetMlNamespaces(content);
    const compatibleWorkbook = new ExcelJS.Workbook();
    await compatibleWorkbook.xlsx.load(workbookArrayBuffer(normalized));
    return compatibleWorkbook;
  }
}

function pdfRecord(row: WorkbookRow): RegistrationWorkbookRecord {
  const externalId = compact(row.customer_source_id);
  if (!externalId) {
    throw validationError(
      `A aba ${PDF_SHEET} possui uma linha sem customer_source_id (${row[ROW_NUMBER]}).`,
    );
  }
  const phone = normalizedPhone(
    row.telefone_normalizado ?? row.telefone_original,
  );
  const document = normalizedDocument(
    row.documento_normalizado ?? row.documento,
  );
  return {
    kind: 'PDF_CUSTOMER',
    sourceSheet: PDF_SHEET,
    sourceRow: row[ROW_NUMBER],
    externalId,
    fingerprint: hash(`pdf-customer|${externalId}`),
    rawPayload: withoutRowNumber(row),
    normalizedPayload: {
      name: compact(row.nome_normalizado ?? row.nome_original),
      phone,
      document,
      city: row.cidade === '<<SEM CIDADE>>' ? null : compact(row.cidade),
      state: compact(row.uf)?.toUpperCase() ?? null,
      address: compact(row.endereco),
      municipalRegistration: compact(row.inscricao),
      sourcePage: compact(row.pagina_origem),
    },
    technicalRecord: false,
  };
}

function whatsappRecord(row: WorkbookRow): RegistrationWorkbookRecord {
  const sourceId = compact(row.conversation_source_id);
  const jid = compact(row.jid)?.toLocaleLowerCase('pt-BR') ?? null;
  const phone = normalizedPhone(
    row.telefone_normalizado ?? row.telefone_original ?? jid,
  );
  const externalId = jid ?? phone ?? sourceId;
  if (!externalId) {
    throw validationError(
      `A aba ${WHATSAPP_SHEET} possui uma linha sem identificador estável (${row[ROW_NUMBER]}).`,
    );
  }
  const conversationType =
    compact(row.tipo_conversa)?.toLocaleLowerCase('pt-BR') ?? 'indefinido';
  const technicalRecord = !['individual', 'individual_lid'].includes(
    conversationType,
  );
  return {
    kind: 'WHATSAPP_CONTACT',
    sourceSheet: WHATSAPP_SHEET,
    sourceRow: row[ROW_NUMBER],
    externalId,
    fingerprint: hash(`whatsapp-conversation|${externalId}`),
    rawPayload: withoutRowNumber(row),
    normalizedPayload: {
      sourceId,
      jid,
      name: compact(row.nome_disponivel),
      phone,
      conversationType,
      firstInteraction: compact(row.primeira_interacao),
      lastInteraction: compact(row.ultima_interacao),
      totalMessages: compact(row.total_mensagens),
    },
    technicalRecord,
  };
}

function withoutRowNumber(
  row: WorkbookRow,
): Readonly<Record<string, string | null>> {
  return { ...row };
}

function matchRecord(row: WorkbookRow): RegistrationWorkbookMatch | null {
  const customerExternalId = compact(row.cliente_source_id);
  const whatsappExternalId = compact(row.chat_source_id);
  if (!customerExternalId || !whatsappExternalId) return null;
  const scoreValue = Number(row.score_evidencia);
  return {
    customerExternalId,
    whatsappExternalId,
    status: compact(row.status_correspondencia),
    reviewStatus: compact(row.status_revisao),
    rule: compact(row.regra_match),
    score: Number.isFinite(scoreValue) ? scoreValue : null,
    confidence: compact(row.confianca),
    evidence: compact(row.evidencias),
    ambiguityReason: compact(row.motivo_ambiguidade),
  };
}

@Injectable()
export class RegistrationReconciliationWorkbookService {
  async parse(
    content: Buffer,
    fileName: string,
  ): Promise<ParsedRegistrationWorkbook> {
    if (content.length < 1 || content.length > MAX_FILE_BYTES) {
      throw validationError('Envie uma planilha XLSX válida de até 25 MB.');
    }
    if (!fileName.toLocaleLowerCase('pt-BR').endsWith('.xlsx')) {
      throw validationError('A conciliação aceita somente planilhas XLSX.');
    }

    let workbook: ExcelJS.Workbook;
    try {
      workbook = await loadWorkbook(content);
    } catch {
      throw validationError('Não foi possível ler a planilha de conciliação.');
    }

    const pdfRows = readRows(requireSheet(workbook, PDF_SHEET), PDF_HEADERS);
    const whatsappRows = readRows(
      requireSheet(workbook, WHATSAPP_SHEET),
      WHATSAPP_HEADERS,
    );
    const matchRows = readRows(
      requireSheet(workbook, MATCHES_SHEET),
      MATCH_HEADERS,
    );
    const records: RegistrationWorkbookRecord[] = [];
    const rowErrors: string[] = [];
    for (const row of pdfRows) {
      try {
        records.push(pdfRecord(row));
      } catch (error) {
        rowErrors.push(
          error instanceof Error
            ? error.message
            : `Linha ${row[ROW_NUMBER]} inválida em ${PDF_SHEET}.`,
        );
      }
    }
    for (const row of whatsappRows) {
      try {
        records.push(whatsappRecord(row));
      } catch (error) {
        rowErrors.push(
          error instanceof Error
            ? error.message
            : `Linha ${row[ROW_NUMBER]} inválida em ${WHATSAPP_SHEET}.`,
        );
      }
    }
    const matches = matchRows.flatMap((row) => {
      const match = matchRecord(row);
      return match ? [match] : [];
    });

    return {
      fileSha256: hash(content),
      records,
      matches,
      rowErrors,
      metadata: {
        format: 'lume-whatsapp-analysis-v1',
        workbookSheets: workbook.worksheets.map((worksheet) => ({
          name: worksheet.name,
          rows: worksheet.rowCount,
          columns: worksheet.actualColumnCount,
          role: [PDF_SHEET, WHATSAPP_SHEET].includes(worksheet.name)
            ? 'source'
            : worksheet.name === MATCHES_SHEET
              ? 'derived-match'
              : 'reference-only',
        })),
        sourceSheets: [PDF_SHEET, WHATSAPP_SHEET],
        derivedSheetsRead: [MATCHES_SHEET],
        pdfRows: pdfRows.length,
        whatsappRows: whatsappRows.length,
        matchRows: matches.length,
        rowErrors: rowErrors.length,
        technicalWhatsappRows: records.filter(
          (record) =>
            record.kind === 'WHATSAPP_CONTACT' && record.technicalRecord,
        ).length,
      },
    };
  }
}
