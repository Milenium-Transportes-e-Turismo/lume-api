import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';

import type { DataExchangeConverter } from '../data-exchange/data-exchange-converter';
import { LocalKnowledgeDocumentExtractor } from './knowledge-document.extractor';

function extractor() {
  const validate = vi.fn().mockResolvedValue(undefined);
  return {
    instance: new LocalKnowledgeDocumentExtractor({
      validate,
    } as unknown as DataExchangeConverter),
    validate,
  };
}

function singlePagePdf(text: string): Buffer {
  const safeText = text.replace(/[\\()]/gu, (value) => `\\${value}`);
  const stream = `BT /F1 12 Tf 40 100 Td (${safeText}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let document = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document, 'ascii'));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(document, 'ascii');
  document += `xref\n0 ${objects.length + 1}\n`;
  document += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    document += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  document += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, 'ascii');
}

describe('LocalKnowledgeDocumentExtractor', () => {
  it('extrai TXT em chunks com hash e provenance', async () => {
    const { instance } = extractor();

    const result = await instance.extract({
      fileName: 'manual.txt',
      mimeType: 'text/plain',
      content: Buffer.from('Primeiro parágrafo.\n\nSegundo parágrafo.', 'utf8'),
    });

    expect(result).toMatchObject({
      status: 'completed',
      format: 'txt',
      limitation: null,
      provenance: { extractor: 'utf8-text-v1', extractionStatus: 'completed' },
    });
    expect(result.chunks).toEqual([
      expect.objectContaining({
        ordinal: 1,
        pageNumber: null,
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        provenance: { extractor: 'utf8-text-v1' },
      }),
    ]);
  });

  it('valida CSV pelo conversor existente antes de disponibilizar chunks', async () => {
    const { instance, validate } = extractor();
    const content = Buffer.from('name,value\nalpha,1', 'utf8');

    const result = await instance.extract({
      fileName: 'dados.csv',
      mimeType: 'text/csv',
      content,
    });

    expect(validate).toHaveBeenCalledWith('csv', content);
    expect(result).toMatchObject({ status: 'completed', format: 'csv' });
  });

  it('extrai XLSX e DOCX localmente com limites e provenance explícita', async () => {
    const { instance } = extractor();
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Tarifas').addRow(['Trecho', 'Valor']);
    const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());

    const archive = new JSZip();
    archive.file(
      'word/document.xml',
      '<w:document><w:body><w:p><w:r><w:t>Política interna</w:t></w:r></w:p></w:body></w:document>',
    );
    const docx = await archive.generateAsync({ type: 'nodebuffer' });

    await expect(
      instance.extract({
        fileName: 'dados.xlsx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        content: xlsx,
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      format: 'xlsx',
      content: expect.stringContaining('Tarifas'),
    });
    await expect(
      instance.extract({
        fileName: 'politica.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        content: docx,
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      format: 'docx',
      content: 'Política interna',
    });
  });

  it('extrai PDF válido com página, chunks e provenance', async () => {
    const { instance } = extractor();

    const result = await instance.extract({
      fileName: 'manual.pdf',
      mimeType: 'application/pdf',
      content: singlePagePdf('Politica comercial'),
    });

    expect(result).toMatchObject({
      status: 'completed',
      format: 'pdf',
      content: expect.stringContaining('Politica comercial'),
      limitation: null,
      provenance: {
        extractor: 'pdf-parse-pdfjs-v1',
        extractionStatus: 'completed',
        pageCount: 1,
      },
    });
    expect(result.chunks).toEqual([
      expect.objectContaining({
        ordinal: 1,
        pageNumber: 1,
        content: expect.stringContaining('Politica comercial'),
        provenance: {
          extractor: 'pdf-parse-pdfjs-v1',
          pageNumber: 1,
        },
      }),
    ]);
  });

  it('recusa nomes com path traversal e assinaturas PDF falsas', async () => {
    const { instance } = extractor();

    await expect(
      instance.extract({
        fileName: '../manual.txt',
        mimeType: 'text/plain',
        content: Buffer.from('texto'),
      }),
    ).rejects.toThrow('nome do arquivo');
    await expect(
      instance.extract({
        fileName: 'manual.pdf',
        mimeType: 'application/pdf',
        content: Buffer.from('not-a-pdf'),
      }),
    ).rejects.toThrow('assinatura PDF');
  });
});
