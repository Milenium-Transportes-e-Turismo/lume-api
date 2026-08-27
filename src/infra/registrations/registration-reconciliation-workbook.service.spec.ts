import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { RegistrationReconciliationWorkbookService } from './registration-reconciliation-workbook.service';

const pdfHeaders = [
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
];
const whatsappHeaders = [
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
];
const matchHeaders = [
  'status_correspondencia',
  'status_revisao',
  'regra_match',
  'score_evidencia',
  'confianca',
  'evidencias',
  'motivo_ambiguidade',
  'cliente_source_id',
  'chat_source_id',
];

function addSheet(workbook: ExcelJS.Workbook, name: string, headers: string[]) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRows([[name], ['Descrição'], [], headers]);
  return sheet;
}

async function workbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const pdf = addSheet(workbook, 'Clientes PDF', pdfHeaders);
  pdf.addRow([
    'pdf-p001-r01',
    'Empresa Exemplo Ltda',
    'EMPRESA EXEMPLO LTDA',
    'Uberlândia',
    'MG',
    'Rua A, 10',
    '(34) 99999-0000',
    '34999990000',
    '11.222.333/0001-81',
    '11222333000181',
    null,
    null,
    1,
  ]);
  pdf.addRow([null, 'Linha sem identificador']);

  const whatsapp = addSheet(workbook, 'Contatos WhatsApp', whatsappHeaders);
  whatsapp.addRow([
    'wa-chat-1',
    1,
    '5534999990000@s.whatsapp.net',
    'Empresa Exemplo',
    'push_name',
    '5534999990000',
    '34999990000',
    'jid_direto',
    'individual',
    's.whatsapp.net',
    10,
    4,
    6,
    '2025-01-01',
    '2026-01-01',
    '2025,2026',
    1,
    0,
    10,
    1,
    10,
  ]);
  whatsapp.addRow([
    'wa-chat-2',
    2,
    '5534999990000-123@g.us',
    'Grupo interno',
    'subject',
    null,
    null,
    'indisponivel',
    'grupo',
    'g.us',
    20,
  ]);
  whatsapp.addRow([
    'wa-chat-3',
    3,
    'status@broadcast',
    'Status',
    'system',
    null,
    null,
    'indisponivel',
    'status',
    'broadcast',
    5,
  ]);
  whatsapp.addRow([
    'wa-chat-4',
    4,
    'bot@example',
    'Atendimento automático',
    'system',
    null,
    null,
    'indisponivel',
    'bot',
    'system',
    12,
  ]);

  const matches = addSheet(workbook, 'Correspondências', matchHeaders);
  matches.addRow([
    'correspondencia forte',
    'pronto',
    'TELEFONE_EXATO',
    100,
    'alta',
    'Mesmo telefone normalizado',
    null,
    'pdf-p001-r01',
    'wa-chat-1',
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function prefixedWorkbookBuffer() {
  const zip = await JSZip.loadAsync(await workbookBuffer());
  const entries = Object.values(zip.files).filter(
    (entry) =>
      !entry.dir &&
      /^xl\/(?:workbook|styles|sharedStrings|worksheets\/[^/]+|tables\/[^/]+)\.xml$/i.test(
        entry.name,
      ),
  );
  for (const entry of entries) {
    const xml = await entry.async('string');
    if (
      !xml.includes(
        'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
      )
    ) {
      continue;
    }
    zip.file(
      entry.name,
      xml
        .replace(
          'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
          'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
        )
        .replace(/<(\/?)([A-Za-z][\w.-]*)(?=[\s/>])/g, '<$1x:$2'),
    );
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('RegistrationReconciliationWorkbookService', () => {
  it('keeps an individual conversation and classifies group, status and bot as technical', async () => {
    const service = new RegistrationReconciliationWorkbookService();
    const content = await workbookBuffer();
    const parsed = await service.parse(content, 'resultado.xlsx');

    expect(parsed.records.map((record) => record.externalId)).toEqual([
      'pdf-p001-r01',
      '5534999990000@s.whatsapp.net',
      '5534999990000-123@g.us',
      'status@broadcast',
      'bot@example',
    ]);
    expect(parsed.matches).toHaveLength(1);
    expect(parsed.rowErrors).toHaveLength(1);
    expect(
      parsed.records.filter((record) => record.technicalRecord),
    ).toHaveLength(3);
    expect(
      parsed.records
        .filter((record) => record.kind === 'WHATSAPP_CONTACT')
        .map((record) => ({
          type: record.normalizedPayload.conversationType,
          technical: record.technicalRecord,
        })),
    ).toEqual([
      { type: 'individual', technical: false },
      { type: 'grupo', technical: true },
      { type: 'status', technical: true },
      { type: 'bot', technical: true },
    ]);
    expect(parsed.matches[0]).toMatchObject({
      customerExternalId: 'pdf-p001-r01',
      whatsappExternalId: 'wa-chat-1',
      rule: 'TELEFONE_EXATO',
      score: 100,
    });
  });

  it('uses deterministic source fingerprints and file hashes', async () => {
    const service = new RegistrationReconciliationWorkbookService();
    const content = await workbookBuffer();
    const first = await service.parse(content, 'resultado.xlsx');
    const second = await service.parse(content, 'resultado.xlsx');

    expect(second.fileSha256).toBe(first.fileSha256);
    expect(second.records.map((record) => record.fingerprint)).toEqual(
      first.records.map((record) => record.fingerprint),
    );
  });

  it('accepts SpreadsheetML files that use an explicit x namespace prefix', async () => {
    const service = new RegistrationReconciliationWorkbookService();
    const parsed = await service.parse(
      await prefixedWorkbookBuffer(),
      'resultado-prefixado.xlsx',
    );

    expect(parsed.metadata).toMatchObject({
      pdfRows: 2,
      whatsappRows: 4,
      matchRows: 1,
      technicalWhatsappRows: 3,
    });
  });
});
