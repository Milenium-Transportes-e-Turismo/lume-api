import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  TollIntelligenceAgent,
  type TollIntelligenceInput,
} from '../../application/contracts/toll-intelligence.agent';
import type {
  TollIntelligenceAssessment,
  TollIntelligenceSource,
} from '../../domain/route-planner/route-planner.types';
import {
  ROUTE_PLANNER_FETCHER,
  type RoutePlannerFetcher,
} from './route-planner.tokens';

interface OpenAiUrlCitation {
  readonly type?: string;
  readonly url?: string;
  readonly title?: string;
}

interface OpenAiContent {
  readonly type?: string;
  readonly text?: string;
  readonly annotations?: readonly OpenAiUrlCitation[];
}

interface OpenAiOutputItem {
  readonly type?: string;
  readonly content?: readonly OpenAiContent[];
}

interface OpenAiResponse {
  readonly status?: string;
  readonly model?: string;
  readonly output?: readonly OpenAiOutputItem[];
}

interface RawAssessment {
  readonly status?: unknown;
  readonly estimatedCount?: unknown;
  readonly estimatedTotalMin?: unknown;
  readonly estimatedTotalLikely?: unknown;
  readonly estimatedTotalMax?: unknown;
  readonly confidence?: unknown;
  readonly sources?: unknown;
  readonly assumptions?: unknown;
  readonly explanation?: unknown;
}

const emptyAssessment = (
  status: 'not-required' | 'disabled' | 'unavailable',
  explanation: string,
  provider: string | null,
  model: string | null,
  researchedAt: string | null = null,
): TollIntelligenceAssessment => ({
  status,
  estimatedCount: null,
  estimatedTotalMin: null,
  estimatedTotalLikely: null,
  estimatedTotalMax: null,
  confidence: null,
  sources: [],
  assumptions: [],
  explanation,
  provider,
  model,
  researchedAt,
});

function sampledCoordinates(
  coordinates: readonly (readonly [number, number])[],
  maximum = 80,
): readonly (readonly [number, number])[] {
  if (coordinates.length <= maximum) return coordinates;
  const result: (readonly [number, number])[] = [];
  for (let index = 0; index < maximum; index += 1) {
    const sourceIndex = Math.round(
      (index * (coordinates.length - 1)) / (maximum - 1),
    );
    const coordinate = coordinates[sourceIndex];
    if (coordinate) result.push(coordinate);
  }
  return result;
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_000) return null;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function citationKey(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function outputText(response: OpenAiResponse): {
  readonly text: string | null;
  readonly citedUrls: ReadonlySet<string>;
} {
  const contents = (response.output ?? []).flatMap((item) =>
    item.type === 'message' ? (item.content ?? []) : [],
  );
  const text = contents.find(
    (content) => content.type === 'output_text' && content.text,
  )?.text;
  const citedUrls = new Set<string>();
  for (const content of contents) {
    for (const annotation of content.annotations ?? []) {
      if (annotation.type !== 'url_citation') continue;
      const url = httpUrl(annotation.url);
      if (url) citedUrls.add(citationKey(url));
    }
  }
  return { text: text ?? null, citedUrls };
}

function parseAssessment(
  text: string,
  citedUrls: ReadonlySet<string>,
  model: string,
): TollIntelligenceAssessment | null {
  let raw: RawAssessment;
  try {
    raw = JSON.parse(text) as RawAssessment;
  } catch {
    return null;
  }
  if (raw.status === 'unavailable') {
    return emptyAssessment(
      'unavailable',
      typeof raw.explanation === 'string'
        ? raw.explanation.slice(0, 1_000)
        : 'Não foram encontradas fontes suficientes para estimar os pedágios.',
      'openai-responses-web-search',
      model,
      new Date().toISOString(),
    );
  }
  const estimatedCount = finiteNumber(raw.estimatedCount);
  const minimum = finiteNumber(raw.estimatedTotalMin);
  const likely = finiteNumber(raw.estimatedTotalLikely);
  const maximum = finiteNumber(raw.estimatedTotalMax);
  const confidence = finiteNumber(raw.confidence);
  if (
    raw.status !== 'estimated' ||
    estimatedCount === null ||
    !Number.isInteger(estimatedCount) ||
    estimatedCount < 0 ||
    minimum === null ||
    likely === null ||
    maximum === null ||
    minimum < 0 ||
    minimum > likely ||
    likely > maximum ||
    confidence === null ||
    confidence < 0 ||
    confidence > 1 ||
    typeof raw.explanation !== 'string'
  ) {
    return null;
  }
  const sources: TollIntelligenceSource[] = Array.isArray(raw.sources)
    ? raw.sources.flatMap((source): TollIntelligenceSource[] => {
        if (!source || typeof source !== 'object') return [];
        const value = source as Record<string, unknown>;
        const url = httpUrl(value.url);
        if (
          !url ||
          !citedUrls.has(citationKey(url)) ||
          typeof value.title !== 'string' ||
          value.title.trim().length === 0
        ) {
          return [];
        }
        return [
          {
            title: value.title.trim().slice(0, 300),
            url,
            effectiveDate:
              typeof value.effectiveDate === 'string' &&
              /^\d{4}-\d{2}-\d{2}$/.test(value.effectiveDate)
                ? value.effectiveDate
                : null,
          },
        ];
      })
    : [];
  if (sources.length === 0) return null;
  const assumptions = Array.isArray(raw.assumptions)
    ? raw.assumptions
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim().slice(0, 500))
        .filter(Boolean)
        .slice(0, 12)
    : [];
  return {
    status: 'estimated',
    estimatedCount,
    estimatedTotalMin: Math.round(minimum * 100) / 100,
    estimatedTotalLikely: Math.round(likely * 100) / 100,
    estimatedTotalMax: Math.round(maximum * 100) / 100,
    confidence,
    sources,
    assumptions,
    explanation: raw.explanation.trim().slice(0, 1_000),
    provider: 'openai-responses-web-search',
    model,
    researchedAt: new Date().toISOString(),
  };
}

@Injectable()
export class OpenAiTollIntelligenceAgent extends TollIntelligenceAgent {
  private readonly logger = new Logger(OpenAiTollIntelligenceAgent.name);
  private readonly enabled: boolean;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(
    config: ConfigService,
    @Inject(ROUTE_PLANNER_FETCHER)
    private readonly fetcher: RoutePlannerFetcher,
  ) {
    super();
    this.enabled = config.getOrThrow<boolean>('TOLL_INTELLIGENCE_ENABLED');
    this.apiKey = config.get<string>('TOLL_INTELLIGENCE_OPENAI_API_KEY') ?? '';
    this.baseUrl = (
      config.get<string>('TOLL_INTELLIGENCE_OPENAI_BASE_URL') ??
      'https://api.openai.com/v1'
    ).replace(/\/+$/, '');
    this.model =
      config.get<string>('TOLL_INTELLIGENCE_OPENAI_MODEL') ?? 'gpt-5.4-mini';
    this.timeoutMs = config.getOrThrow<number>('TOLL_INTELLIGENCE_TIMEOUT_MS');
  }

  async assess(
    input: TollIntelligenceInput,
  ): Promise<TollIntelligenceAssessment> {
    if (input.verified.complete) {
      return emptyAssessment(
        'not-required',
        'A base interna possui dados completos para este trecho e veículo.',
        null,
        null,
      );
    }
    if (!this.enabled) {
      return emptyAssessment(
        'disabled',
        'A pesquisa assistida de pedágios está desabilitada neste ambiente.',
        null,
        null,
      );
    }
    const startedAt = Date.now();
    try {
      const response = await this.fetcher(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          store: false,
          max_output_tokens: 2_500,
          tools: [
            {
              type: 'web_search',
              search_context_size: 'medium',
            },
          ],
          instructions:
            'Você pesquisa pedágios rodoviários no Brasil. Use prioritariamente fontes oficiais de governo, agência reguladora ou concessionária. Nunca trate memória do modelo como fonte. Estime o total do trecho inteiro para o veículo e a data recebidos. Se não houver fontes suficientes para sustentar quantidade e tarifa, responda unavailable. Valores são em BRL. Não proponha gravar ou alterar dados oficiais.',
          input: JSON.stringify({
            direction: input.route.direction,
            origin: input.origin.coordinates,
            destination: input.destination.coordinates,
            travelDate: input.travelDate.toISOString().slice(0, 10),
            vehicle: input.vehicle,
            distanceKm: input.route.distanceKm,
            roadNames: [
              ...new Set(
                input.route.segments
                  .map((segment) => segment.roadName)
                  .filter((name): name is string => Boolean(name)),
              ),
            ].slice(0, 80),
            sampledRouteCoordinates: sampledCoordinates(
              input.route.geometry.coordinates,
            ),
            internalMatch: {
              dataStatus: input.verified.dataStatus,
              complete: input.verified.complete,
              items: input.verified.items,
            },
          }),
          text: {
            format: {
              type: 'json_schema',
              name: 'toll_intelligence_assessment',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  status: {
                    type: 'string',
                    enum: ['estimated', 'unavailable'],
                  },
                  estimatedCount: { type: ['integer', 'null'] },
                  estimatedTotalMin: { type: ['number', 'null'] },
                  estimatedTotalLikely: { type: ['number', 'null'] },
                  estimatedTotalMax: { type: ['number', 'null'] },
                  confidence: { type: ['number', 'null'] },
                  sources: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        title: { type: 'string' },
                        url: { type: 'string' },
                        effectiveDate: { type: ['string', 'null'] },
                      },
                      required: ['title', 'url', 'effectiveDate'],
                    },
                  },
                  assumptions: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  explanation: { type: 'string' },
                },
                required: [
                  'status',
                  'estimatedCount',
                  'estimatedTotalMin',
                  'estimatedTotalLikely',
                  'estimatedTotalMax',
                  'confidence',
                  'sources',
                  'assumptions',
                  'explanation',
                ],
              },
            },
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`OpenAI HTTP ${response.status}`);
      }
      const value = (await response.json()) as OpenAiResponse;
      if (value.status !== 'completed') {
        throw new Error(`OpenAI response status: ${value.status ?? 'unknown'}`);
      }
      const output = outputText(value);
      const assessment = output.text
        ? parseAssessment(
            output.text,
            output.citedUrls,
            value.model ?? this.model,
          )
        : null;
      if (!assessment) {
        throw new Error(
          'Resposta sem estimativa estruturada e fontes citadas.',
        );
      }
      this.logger.log({
        event: 'toll.intelligence.success',
        direction: input.route.direction,
        status: assessment.status,
        sourceCount: assessment.sources.length,
        durationMs: Date.now() - startedAt,
      });
      return assessment;
    } catch (error) {
      this.logger.error({
        event: 'toll.intelligence.error',
        direction: input.route.direction,
        durationMs: Date.now() - startedAt,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      return emptyAssessment(
        'unavailable',
        'O agente não encontrou evidências suficientes para produzir uma estimativa segura.',
        'openai-responses-web-search',
        this.model,
        new Date().toISOString(),
      );
    }
  }
}
