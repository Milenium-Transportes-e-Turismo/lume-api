import { describe, expect, it } from 'vitest';

import {
  normalizeKnowledgeEvidenceMessageIds,
  normalizeKnowledgeGapTopic,
  normalizeKnowledgeSuggestionObservation,
} from './knowledge-observation-policy';

const MESSAGE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('knowledge observation policy', () => {
  it('normalizes recurring topics deterministically', () => {
    expect(normalizeKnowledgeGapTopic('  Transporte de ÁNIMAIS! ')).toEqual({
      topic: 'Transporte de ÁNIMAIS!',
      topicNormalized: 'transporte de animais',
    });
  });

  it.each([
    'Consulte https://externo.example/politica',
    'API key sk-proj-never-store-this-secret',
    'Cliente pessoa@example.com',
    'CPF 529.982.247-25',
  ])('rejects internet, credentials and direct PII: %s', (value) => {
    expect(() =>
      normalizeKnowledgeSuggestionObservation({
        title: 'Possível política',
        proposedContent: value,
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });

  it('requires one to five unique persisted-message references', () => {
    expect(
      normalizeKnowledgeEvidenceMessageIds([MESSAGE_ID, MESSAGE_ID]),
    ).toEqual([MESSAGE_ID]);
    expect(() => normalizeKnowledgeEvidenceMessageIds([])).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });
});
