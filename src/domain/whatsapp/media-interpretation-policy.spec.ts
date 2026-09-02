import { describe, expect, it } from 'vitest';

import {
  assertMediaInterpretationDoesNotChangeControl,
  decideMediaInterpretation,
  effectiveMediaInterpretation,
  mediaFailureOutcome,
  type MediaInterpretationState,
} from './media-interpretation-policy';

function media(
  patch: Partial<MediaInterpretationState> = {},
): MediaInterpretationState {
  return {
    mediaType: 'audio',
    interpretationStatus: null,
    interpretationId: null,
    humanCorrection: null,
    ...patch,
  };
}

describe('media interpretation policy', () => {
  it('allows one interpretation and prevents automatic reanalysis', () => {
    expect(
      decideMediaInterpretation({
        state: media(),
        controlMode: 'ai',
        processDuringHumanControl: false,
        requestedManually: false,
      }),
    ).toMatchObject({ action: 'interpret' });
    expect(
      decideMediaInterpretation({
        state: media({
          interpretationStatus: 'failed',
          interpretationId: crypto.randomUUID(),
        }),
        controlMode: 'ai',
        processDuringHumanControl: false,
        requestedManually: false,
      }),
    ).toMatchObject({ action: 'use-existing' });
  });

  it('preserves video without interpreting it', () => {
    expect(
      decideMediaInterpretation({
        state: media({ mediaType: 'video' }),
        controlMode: 'ai',
        processDuringHumanControl: true,
        requestedManually: true,
      }),
    ).toMatchObject({ action: 'preserve-only' });
  });

  it('supports a manual analysis while human control remains unchanged', () => {
    expect(
      decideMediaInterpretation({
        state: media({ mediaType: 'document' }),
        controlMode: 'human',
        processDuringHumanControl: false,
        requestedManually: false,
      }),
    ).toMatchObject({ action: 'skip-during-human-control' });
    expect(
      decideMediaInterpretation({
        state: media({ mediaType: 'document' }),
        controlMode: 'human',
        processDuringHumanControl: false,
        requestedManually: true,
      }),
    ).toMatchObject({ action: 'interpret' });
    expect(() =>
      assertMediaInterpretationDoesNotChangeControl({
        before: 'human',
        after: 'human',
      }),
    ).not.toThrow();
    expect(() =>
      assertMediaInterpretationDoesNotChangeControl({
        before: 'human',
        after: 'ai',
      }),
    ).toThrow('não pode alterar o controle');
  });

  it('makes a human correction authoritative without discarding machine provenance', () => {
    expect(
      effectiveMediaInterpretation({
        machineInterpretation: 'Documento do tipo A.',
        humanCorrection: 'Documento do tipo B.',
      }),
    ).toEqual({ value: 'Documento do tipo B.', source: 'human' });
  });

  it('keeps the message and attendance available after interpretation failure', () => {
    expect(mediaFailureOutcome()).toEqual({
      messageAvailable: true,
      serviceSessionAvailable: true,
      retryAutomatically: false,
    });
  });
});
