import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { TollIntelligenceInput } from '../../application/contracts/toll-intelligence.agent';
import { OpenAiTollIntelligenceAgent } from './openai-toll-intelligence.agent';

const input: TollIntelligenceInput = {
  route: {
    direction: 'outbound',
    distanceKm: 540,
    durationMinutes: 420,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-48.2772, -18.9186],
        [-43.9345, -19.9167],
      ],
    },
    encodedPolylines: [],
    segments: [
      {
        sequence: 1,
        instruction: 'Siga pela BR-050.',
        distanceKm: 540,
        durationMinutes: 420,
        roadName: 'BR-050',
      },
    ],
    engine: 'openrouteservice',
    engineVersion: 'test',
    mapDataVersion: null,
  },
  origin: {
    coordinates: { lat: -18.9186, lng: -48.2772 },
    label: 'Uberlândia - MG',
    address: 'Uberlândia - MG',
    source: 'coordinates',
  },
  destination: {
    coordinates: { lat: -19.9167, lng: -43.9345 },
    label: 'Belo Horizonte - MG',
    address: 'Belo Horizonte - MG',
    source: 'coordinates',
  },
  vehicle: {
    type: 'bus',
    axles: 3,
    fuelType: 'diesel',
    consumptionKmPerLiter: 3.1,
  },
  travelDate: new Date('2026-08-18T12:00:00.000Z'),
  verified: {
    count: 0,
    total: 0,
    complete: false,
    dataStatus: 'unavailable',
    dataVersion: null,
    items: [],
    matcherStrategy: 'test',
  },
};

function config(enabled: boolean) {
  return new ConfigService({
    TOLL_INTELLIGENCE_ENABLED: enabled,
    TOLL_INTELLIGENCE_OPENAI_API_KEY: enabled ? 'dedicated-key' : '',
    TOLL_INTELLIGENCE_OPENAI_BASE_URL: 'https://api.openai.test/v1',
    TOLL_INTELLIGENCE_OPENAI_MODEL: 'test-model',
    TOLL_INTELLIGENCE_TIMEOUT_MS: 1_000,
  });
}

describe('OpenAiTollIntelligenceAgent', () => {
  it('não chama IA quando a base interna está completa', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const agent = new OpenAiTollIntelligenceAgent(config(true), fetcher);

    await expect(
      agent.assess({
        ...input,
        verified: { ...input.verified, complete: true },
      }),
    ).resolves.toMatchObject({ status: 'not-required' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('não chama o provedor quando o recurso está desabilitado', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const agent = new OpenAiTollIntelligenceAgent(config(false), fetcher);

    await expect(agent.assess(input)).resolves.toMatchObject({
      status: 'disabled',
      provider: null,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('aceita somente estimativa estruturada sustentada por citação web', async () => {
    const sourceUrl = 'https://concessionaria.example.test/tarifas';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          model: 'test-model-2026-08-01',
          output: [
            { type: 'web_search_call', status: 'completed' },
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    status: 'estimated',
                    estimatedCount: 5,
                    estimatedTotalMin: 120,
                    estimatedTotalLikely: 130,
                    estimatedTotalMax: 145,
                    confidence: 0.78,
                    sources: [
                      {
                        title: 'Tarifas oficiais',
                        url: sourceUrl,
                        effectiveDate: '2026-08-01',
                      },
                    ],
                    assumptions: ['Ônibus de três eixos.'],
                    explanation: 'Estimativa baseada na tarifa publicada.',
                  }),
                  annotations: [
                    {
                      type: 'url_citation',
                      url: sourceUrl,
                      title: 'Tarifas oficiais',
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const agent = new OpenAiTollIntelligenceAgent(config(true), fetcher);

    await expect(agent.assess(input)).resolves.toMatchObject({
      status: 'estimated',
      estimatedCount: 5,
      estimatedTotalLikely: 130,
      confidence: 0.78,
      provider: 'openai-responses-web-search',
      model: 'test-model-2026-08-01',
    });
    const body = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Corpo ausente.');
    expect(JSON.parse(body)).toMatchObject({
      store: false,
      tools: [{ type: 'web_search' }],
      text: { format: { type: 'json_schema', strict: true } },
    });
  });

  it('descarta estimativa sem fonte efetivamente citada', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          model: 'test-model',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    status: 'estimated',
                    estimatedCount: 1,
                    estimatedTotalMin: 10,
                    estimatedTotalLikely: 10,
                    estimatedTotalMax: 10,
                    confidence: 0.9,
                    sources: [
                      {
                        title: 'Fonte não citada',
                        url: 'https://example.test/tarifa',
                        effectiveDate: null,
                      },
                    ],
                    assumptions: [],
                    explanation: 'Sem citação.',
                  }),
                  annotations: [],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const agent = new OpenAiTollIntelligenceAgent(config(true), fetcher);

    await expect(agent.assess(input)).resolves.toMatchObject({
      status: 'unavailable',
      estimatedTotalLikely: null,
    });
  });
});
