import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';

import { Injectable } from '@nestjs/common';
import ExcelJS, { type CellValue } from 'exceljs';
import JSZip from 'jszip';
import { PDFParse } from 'pdf-parse';

import {
  KnowledgeDocumentExtractor,
  type ExtractKnowledgeDocumentInput,
  type KnowledgeExtractionResult,
} from '../../application/contracts/knowledge-document.extractor';
import type { KnowledgeChunkDraft } from '../../application/contracts/knowledge.repository';
import {
  unsupportedFileFormat,
  validationError,
} from '../../core/errors/app-error';
import { DataExchangeConverter } from '../data-exchange/data-exchange-converter';
import { preflightXlsxArchive } from '../imports/whatsapp-import-package';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 2 * 1024 * 1024;
const MAX_CHUNKS = 500;
const CHUNK_CHARACTERS = 4_000;
const MAX_WORKSHEETS = 20;
const MAX_ROWS = 20_000;
const MAX_COLUMNS = 200;
const MAX_CELLS = 500_000;
const MAX_PDF_PAGES = 500;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizedFileName(value: string): string {
  const normalized = value.normalize('NFC').trim();
  const hasControlCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (
    !normalized ||
    normalized.length > 255 ||
    basename(normalized) !== normalized ||
    hasControlCharacter
  ) {
    throw validationError('O nome do arquivo de knowledge é inválido.');
  }
  return normalized;
}

function decodeUtf8(content: Buffer): string {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true })
      .decode(content)
      .replace(/^\uFEFF/u, '')
      .replaceAll('\u0000', '')
      .trim();
    if (!decoded)
      throw validationError('O arquivo não possui texto extraível.');
    return decoded;
  } catch (error) {
    if (error instanceof Error && error.name === 'AppError') throw error;
    throw unsupportedFileFormat('O arquivo de texto não contém UTF-8 válido.');
  }
}

function assertExtractedLimit(content: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_EXTRACTED_BYTES) {
    throw unsupportedFileFormat(
      'O texto extraído excede o limite seguro de 2 MiB.',
    );
  }
}

function chunkText(
  content: string,
  provenance: Readonly<Record<string, unknown>>,
): KnowledgeChunkDraft[] {
  const paragraphs = content
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks: KnowledgeChunkDraft[] = [];
  let pending = '';
  const flush = () => {
    const normalized = pending.trim();
    if (!normalized) return;
    if (chunks.length >= MAX_CHUNKS) {
      throw unsupportedFileFormat(
        `O documento excede o limite de ${MAX_CHUNKS} chunks.`,
      );
    }
    chunks.push({
      ordinal: chunks.length + 1,
      pageNumber: null,
      content: normalized,
      contentHash: sha256(normalized),
      tokenCount: Math.ceil(normalized.length / 4),
      provenance,
    });
    pending = '';
  };
  for (const paragraph of paragraphs) {
    for (
      let offset = 0;
      offset < paragraph.length;
      offset += CHUNK_CHARACTERS
    ) {
      const piece = paragraph.slice(offset, offset + CHUNK_CHARACTERS);
      if (pending && pending.length + piece.length + 2 > CHUNK_CHARACTERS) {
        flush();
      }
      pending = pending ? `${pending}\n\n${piece}` : piece;
      if (piece.length === CHUNK_CHARACTERS) flush();
    }
  }
  flush();
  return chunks;
}

function cellText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value instanceof Date) return value.toISOString();
  if ('result' in value) return cellText(value.result);
  if ('richText' in value)
    return value.richText.map((part) => part.text).join('');
  if ('text' in value) return value.text;
  if ('error' in value) return value.error;
  return '';
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<w:tab\b[^>]*\/>/giu, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/>/giu, '\n')
    .replace(/<\/w:p>/giu, '\n\n')
    .replace(/<[^>]+>/gu, '')
    .replace(/&#(\d+);/gu, (_match, number: string) =>
      String.fromCodePoint(Math.min(0x10ffff, Number(number))),
    )
    .replace(/&#x([0-9a-f]+);/giu, (_match, number: string) =>
      String.fromCodePoint(Math.min(0x10ffff, Number.parseInt(number, 16))),
    )
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

@Injectable()
export class LocalKnowledgeDocumentExtractor extends KnowledgeDocumentExtractor {
  constructor(private readonly dataExchange: DataExchangeConverter) {
    super();
  }

  async extract(
    input: ExtractKnowledgeDocumentInput,
  ): Promise<KnowledgeExtractionResult> {
    const fileName = normalizedFileName(input.fileName);
    if (input.content.length < 1 || input.content.length > MAX_FILE_BYTES) {
      throw validationError('O original deve possuir entre 1 byte e 10 MiB.');
    }
    const extension = extname(fileName).toLowerCase();
    switch (extension) {
      case '.txt':
        return this.text(input.content, input.mimeType);
      case '.csv':
        return this.csv(input.content, input.mimeType);
      case '.xlsx':
        return this.xlsx(input.content, input.mimeType);
      case '.docx':
        return this.docx(input.content, input.mimeType);
      case '.pdf':
        return this.pdf(input.content, input.mimeType);
      default:
        throw unsupportedFileFormat(
          'Knowledge aceita somente TXT, CSV, XLSX, DOCX e PDF.',
        );
    }
  }

  private text(content: Buffer, mimeType: string): KnowledgeExtractionResult {
    if (!['text/plain', 'application/octet-stream'].includes(mimeType)) {
      throw unsupportedFileFormat('O MIME type não corresponde a um TXT.');
    }
    const extracted = decodeUtf8(content);
    assertExtractedLimit(extracted);
    return {
      status: 'completed',
      format: 'txt',
      content: extracted,
      chunks: chunkText(extracted, { extractor: 'utf8-text-v1' }),
      limitation: null,
      provenance: { extractor: 'utf8-text-v1', extractionStatus: 'completed' },
    };
  }

  private async csv(
    content: Buffer,
    mimeType: string,
  ): Promise<KnowledgeExtractionResult> {
    if (
      !['text/csv', 'application/csv', 'application/octet-stream'].includes(
        mimeType,
      )
    ) {
      throw unsupportedFileFormat('O MIME type não corresponde a um CSV.');
    }
    const extracted = decodeUtf8(content);
    await this.dataExchange.validate('csv', content);
    assertExtractedLimit(extracted);
    return {
      status: 'completed',
      format: 'csv',
      content: extracted,
      chunks: chunkText(extracted, { extractor: 'csv-v1' }),
      limitation: null,
      provenance: { extractor: 'csv-v1', extractionStatus: 'completed' },
    };
  }

  private async xlsx(
    content: Buffer,
    mimeType: string,
  ): Promise<KnowledgeExtractionResult> {
    if (
      ![
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/octet-stream',
      ].includes(mimeType)
    ) {
      throw unsupportedFileFormat('O MIME type não corresponde a um XLSX.');
    }
    preflightXlsxArchive(content);
    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer;
    await workbook.xlsx.load(arrayBuffer);
    if (
      workbook.worksheets.length < 1 ||
      workbook.worksheets.length > MAX_WORKSHEETS
    ) {
      throw unsupportedFileFormat(
        'A quantidade de abas do XLSX não é suportada.',
      );
    }
    const sections: string[] = [];
    let cells = 0;
    for (const sheet of workbook.worksheets) {
      if (sheet.rowCount > MAX_ROWS || sheet.columnCount > MAX_COLUMNS) {
        throw unsupportedFileFormat(
          'A planilha excede os limites de linhas ou colunas.',
        );
      }
      const rows: string[] = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const values: string[] = [];
        for (let column = 1; column <= row.cellCount; column += 1) {
          cells += 1;
          if (cells > MAX_CELLS) {
            throw unsupportedFileFormat(
              'A planilha excede o limite de células.',
            );
          }
          values.push(cellText(row.getCell(column).value).slice(0, 32_000));
        }
        rows.push(values.join('\t'));
      });
      sections.push(`# Aba: ${sheet.name}\n${rows.join('\n')}`);
    }
    const extracted = sections.join('\n\n').trim();
    if (!extracted)
      throw unsupportedFileFormat('O XLSX não possui texto extraível.');
    assertExtractedLimit(extracted);
    return {
      status: 'completed',
      format: 'xlsx',
      content: extracted,
      chunks: chunkText(extracted, { extractor: 'xlsx-exceljs-v1' }),
      limitation: null,
      provenance: {
        extractor: 'xlsx-exceljs-v1',
        extractionStatus: 'completed',
        worksheets: workbook.worksheets.map((sheet) => sheet.name),
      },
    };
  }

  private async docx(
    content: Buffer,
    mimeType: string,
  ): Promise<KnowledgeExtractionResult> {
    if (
      ![
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/octet-stream',
      ].includes(mimeType)
    ) {
      throw unsupportedFileFormat('O MIME type não corresponde a um DOCX.');
    }
    preflightXlsxArchive(content);
    const archive = await JSZip.loadAsync(content, { checkCRC32: true });
    const document = archive.file('word/document.xml');
    if (!document)
      throw unsupportedFileFormat('O DOCX não contém word/document.xml.');
    const extracted = decodeXmlText(await document.async('string'));
    if (!extracted)
      throw unsupportedFileFormat('O DOCX não possui texto extraível.');
    assertExtractedLimit(extracted);
    return {
      status: 'completed',
      format: 'docx',
      content: extracted,
      chunks: chunkText(extracted, { extractor: 'docx-wordml-v1' }),
      limitation: null,
      provenance: {
        extractor: 'docx-wordml-v1',
        extractionStatus: 'completed',
      },
    };
  }

  private async pdf(
    content: Buffer,
    mimeType: string,
  ): Promise<KnowledgeExtractionResult> {
    if (
      mimeType !== 'application/pdf' ||
      !content.subarray(0, 5).equals(Buffer.from('%PDF-'))
    ) {
      throw unsupportedFileFormat(
        'O arquivo não possui assinatura PDF válida.',
      );
    }

    // Copy the bytes because pdf.js may transfer ownership of a typed array to
    // its worker. Network-backed resources, JavaScript evaluation and visual
    // rendering are deliberately disabled: Knowledge only needs bounded text.
    const parser = new PDFParse({
      data: new Uint8Array(content),
      isEvalSupported: false,
      useWorkerFetch: false,
      stopAtErrors: true,
      useSystemFonts: false,
      disableFontFace: true,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      disableStream: true,
      disableAutoFetch: true,
      maxImageSize: 1,
      verbosity: 0,
    });
    try {
      const info = await parser.getInfo();
      if (info.total < 1 || info.total > MAX_PDF_PAGES) {
        throw unsupportedFileFormat(
          `O PDF deve possuir entre 1 e ${MAX_PDF_PAGES} páginas.`,
        );
      }
      const result = await parser.getText({
        first: 1,
        last: info.total,
        parseHyperlinks: false,
        pageJoiner: '',
      });
      const pages = result.pages
        .map((page) => ({ num: page.num, text: page.text.trim() }))
        .filter((page) => page.text.length > 0);
      const extracted = pages
        .map((page) => page.text)
        .join('\n\n')
        .trim();
      if (!extracted) {
        throw unsupportedFileFormat('O PDF não possui texto extraível.');
      }
      assertExtractedLimit(extracted);

      const chunks: KnowledgeChunkDraft[] = [];
      for (const page of pages) {
        const pageChunks = chunkText(page.text, {
          extractor: 'pdf-parse-pdfjs-v1',
          pageNumber: page.num,
        });
        for (const pageChunk of pageChunks) {
          if (chunks.length >= MAX_CHUNKS) {
            throw unsupportedFileFormat(
              `O documento excede o limite de ${MAX_CHUNKS} chunks.`,
            );
          }
          chunks.push({
            ...pageChunk,
            ordinal: chunks.length + 1,
            pageNumber: page.num,
          });
        }
      }

      return {
        status: 'completed',
        format: 'pdf',
        content: extracted,
        chunks,
        limitation: null,
        provenance: {
          extractor: 'pdf-parse-pdfjs-v1',
          extractionStatus: 'completed',
          pageCount: info.total,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AppError') throw error;
      throw unsupportedFileFormat(
        'Não foi possível extrair texto deste PDF com segurança.',
      );
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }
}
