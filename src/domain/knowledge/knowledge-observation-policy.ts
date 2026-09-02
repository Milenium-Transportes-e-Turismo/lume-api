import { validationError } from '../../core/errors/app-error';

export const KNOWLEDGE_OBSERVATION_MAX_EVIDENCE_MESSAGES = 5;
export const KNOWLEDGE_SUGGESTION_MAX_BYTES = 16 * 1024;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SECRET =
  /(?:\b(?:bearer|password|passwd|secret|token|api[-_ ]?key)\b|\bsk-[a-z0-9_-]{12,})/iu;
const INTERNET_REFERENCE = /(?:https?:\/\/|\bwww\.)/iu;
const EMAIL = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/iu;
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/u;
const CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/u;
const PHONE = /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}/u;
const CARD = /\b(?:\d[ -]?){13,19}\b/u;

function compact(value: string, label: string, maximum: number): string {
  const normalized = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (!normalized || normalized.length > maximum) {
    throw validationError(`${label} é inválido.`);
  }
  return normalized;
}

function rejectUnsafeObservation(value: string, label: string): void {
  if (
    SECRET.test(value) ||
    INTERNET_REFERENCE.test(value) ||
    EMAIL.test(value) ||
    CPF.test(value) ||
    CNPJ.test(value) ||
    PHONE.test(value) ||
    CARD.test(value)
  ) {
    throw validationError(
      `${label} não pode conter credenciais, fonte de internet ou identificadores pessoais diretos.`,
    );
  }
}

export function normalizeKnowledgeSuggestionObservation(input: {
  readonly title: string;
  readonly proposedContent: string;
}): { readonly title: string; readonly proposedContent: string } {
  const title = compact(input.title, 'O título da sugestão', 240);
  const proposedContent = input.proposedContent.normalize('NFC').trim();
  if (
    !proposedContent ||
    Buffer.byteLength(proposedContent, 'utf8') > KNOWLEDGE_SUGGESTION_MAX_BYTES
  ) {
    throw validationError(
      'O conteúdo sugerido deve possuir entre 1 byte e 16 KiB.',
    );
  }
  rejectUnsafeObservation(title, 'O título da sugestão');
  rejectUnsafeObservation(proposedContent, 'O conteúdo sugerido');
  return { title, proposedContent };
}

export function normalizeKnowledgeGapTopic(value: string): {
  readonly topic: string;
  readonly topicNormalized: string;
} {
  const topic = compact(value, 'O tópico da lacuna', 240);
  rejectUnsafeObservation(topic, 'O tópico da lacuna');
  const topicNormalized = topic
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
  if (!topicNormalized || topicNormalized.length > 240) {
    throw validationError('O tópico normalizado da lacuna é inválido.');
  }
  return { topic, topicNormalized };
}

export function normalizeKnowledgeEvidenceMessageIds(
  values: readonly string[],
): readonly string[] {
  const result = [...new Set(values.map((value) => value.trim()))];
  if (
    result.length < 1 ||
    result.length > KNOWLEDGE_OBSERVATION_MAX_EVIDENCE_MESSAGES ||
    result.some((value) => !UUID.test(value))
  ) {
    throw validationError(
      `Informe de 1 a ${KNOWLEDGE_OBSERVATION_MAX_EVIDENCE_MESSAGES} mensagens de evidência válidas.`,
    );
  }
  return result;
}
