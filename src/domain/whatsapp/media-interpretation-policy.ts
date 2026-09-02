import { validationError } from '../../core/errors/app-error';
import type { ServiceControlMode } from './service-session';

export const INTERPRETABLE_MEDIA_TYPES = [
  'audio',
  'image',
  'document',
  'spreadsheet',
  'location',
  'contact',
] as const;
export const PRESERVED_ONLY_MEDIA_TYPES = ['video'] as const;
export type InterpretableMediaType = (typeof INTERPRETABLE_MEDIA_TYPES)[number];
export type PreservedOnlyMediaType =
  (typeof PRESERVED_ONLY_MEDIA_TYPES)[number];
export type PlatformMediaType =
  InterpretableMediaType | PreservedOnlyMediaType | 'other';

export interface MediaInterpretationState {
  readonly mediaType: PlatformMediaType;
  readonly interpretationStatus:
    'pending' | 'succeeded' | 'failed' | 'unsupported' | null;
  readonly interpretationId: string | null;
  readonly humanCorrection: string | null;
}

export type MediaInterpretationDecision =
  | { readonly action: 'interpret'; readonly reason: string }
  | { readonly action: 'preserve-only'; readonly reason: string }
  | { readonly action: 'use-existing'; readonly reason: string }
  | { readonly action: 'skip-during-human-control'; readonly reason: string };

export function decideMediaInterpretation(input: {
  readonly state: MediaInterpretationState;
  readonly controlMode: ServiceControlMode;
  readonly processDuringHumanControl: boolean;
  readonly requestedManually: boolean;
}): MediaInterpretationDecision {
  if (input.state.mediaType === 'video' || input.state.mediaType === 'other') {
    return {
      action: 'preserve-only',
      reason:
        'A mídia é preservada, mas não possui interpretação habilitada nesta etapa.',
    };
  }
  if (
    input.state.interpretationId !== null ||
    input.state.interpretationStatus !== null
  ) {
    return {
      action: 'use-existing',
      reason:
        'A mídia já possui uma tentativa única de interpretação registrada.',
    };
  }
  if (
    input.controlMode === 'human' &&
    !input.processDuringHumanControl &&
    !input.requestedManually
  ) {
    return {
      action: 'skip-during-human-control',
      reason:
        'O processamento automático durante atendimento humano está desabilitado.',
    };
  }
  return {
    action: 'interpret',
    reason: input.requestedManually
      ? 'Análise solicitada manualmente por usuário autorizado.'
      : 'Mídia elegível para interpretação automática.',
  };
}

export function effectiveMediaInterpretation(input: {
  readonly machineInterpretation: string | null;
  readonly humanCorrection: string | null;
}): {
  readonly value: string | null;
  readonly source: 'human' | 'machine' | 'none';
} {
  const human = input.humanCorrection?.trim();
  if (human) return { value: human, source: 'human' };
  const machine = input.machineInterpretation?.trim();
  if (machine) return { value: machine, source: 'machine' };
  return { value: null, source: 'none' };
}

export function assertMediaInterpretationDoesNotChangeControl(input: {
  readonly before: ServiceControlMode;
  readonly after: ServiceControlMode;
}): void {
  if (input.before !== input.after) {
    throw validationError(
      'Interpretar mídia não pode alterar o controle do atendimento.',
    );
  }
}

export function mediaFailureOutcome(): {
  readonly messageAvailable: true;
  readonly serviceSessionAvailable: true;
  readonly retryAutomatically: false;
} {
  return {
    messageAvailable: true,
    serviceSessionAvailable: true,
    retryAutomatically: false,
  };
}
