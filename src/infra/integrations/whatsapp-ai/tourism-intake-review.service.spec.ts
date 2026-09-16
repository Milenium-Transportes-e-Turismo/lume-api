import { deriveAiActions } from '../../../domain/whatsapp/whatsapp-automation-flow';
import { describe, expect, it, vi } from 'vitest';
import type { WhatsAppConversationAgentInput } from '../../../application/contracts/whatsapp-conversation-agent';
import type {
  AiProviderOutput,
  QuoteRequestSnapshot,
} from '../../../domain/whatsapp/whatsapp-automation-flow';
import type { PrismaService } from '../../database/prisma/prisma.service';
import type { RouteLocationSearchProvider } from '../../../application/contracts/route-location-search.provider';
import { TourismIntakeReviewService } from './tourism-intake-review.service';

const fleet = {
  maximumPassengers: 46,
  source: 'default' as const,
  capacities: [],
};
const initial: WhatsAppConversationAgentInput = {
  sourceEventId: 'event',
  correlationId: 'event',
  companyId: 'tenant-a',
  conversationId: 'conversation',
  serviceSessionId: 'session',
  aiMode: 'eventual-quote',
  userMessage: '',
  contextThrough: '2026-09-10T20:00:00Z',
  currentConversation: {
    id: 'conversation',
    department: 'commercial',
    conversationState: 'bot-active',
    flowStep: 'quote-data-collection',
    requestStatus: 'collecting-information',
    resumeState: null,
    version: 1,
    currentQuoteRequest: {
      id: 'quote',
      sequence: 1,
      version: 1,
      status: 'collecting-information',
      contactName: 'Abreu',
      structuredData: { tripType: 'one_way' },
    },
  },
};
const draft = (patch: Record<string, unknown> = {}): AiProviderOutput => ({
  message: 'Vou transferir para a equipe.',
  collectionStatus: 'human-handoff',
  customerDecision: 'human-requested',
  summaryPresented: false,
  missingFields: [],
  extractedDataPatch: patch,
});
function setup() {
  const groupBy = vi.fn().mockResolvedValue([]);
  const searchLocations = vi.fn().mockResolvedValue([]);
  const service = new TourismIntakeReviewService(
    { transportFleet: { groupBy } } as unknown as PrismaService,
    { searchLocations } as unknown as RouteLocationSearchProvider,
  );
  return { service, groupBy, searchLocations };
}
function reply(
  previous: AiProviderOutput,
  text: string,
  quote: Partial<QuoteRequestSnapshot> = {},
): WhatsAppConversationAgentInput {
  return {
    ...initial,
    userMessage: text,
    currentConversation: {
      ...initial.currentConversation!,
      currentQuoteRequest: {
        ...initial.currentConversation!.currentQuoteRequest!,
        ...previous.extractedDataPatch,
        ...quote,
      },
    },
  };
}
describe('tourism intake uses business evidence before handoff', () => {
  it('queries active fleet only within the tenant and defaults to 46 only with no capacity', async () => {
    const { service, groupBy } = setup();
    expect(await service.fleetContext('tenant-a')).toEqual(fleet);
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'tenant-a', active: true, passengers: { gt: 0 } },
      }),
    );
    groupBy.mockResolvedValue([
      { passengers: 28, _count: { _all: 2 } },
      { passengers: 60, _count: { _all: 1 } },
    ]);
    expect(await service.fleetContext('tenant-b')).toMatchObject({
      maximumPassengers: 60,
      source: 'fleet',
    });
    groupBy.mockRejectedValue(new Error('database unavailable'));
    await expect(service.fleetContext('tenant-a')).rejects.toThrow(
      'database unavailable',
    );
  });
  it('treats 200 passengers as valid and asks about multiple vehicles before handoff', async () => {
    const { service } = setup();
    const first = await service.review(
      { ...initial, userMessage: '200 passageiros' },
      draft({ passengerCount: 200 }),
      fleet,
    );
    expect(first).toMatchObject({
      collectionStatus: 'collecting',
      customerDecision: 'undecided',
    });
    expect(first.message).toContain('mais de um veículo');
    expect(first.extractedDataPatch.passengerCount).toBe(200);
    const accepted = await service.review(
      reply(first, 'sim'),
      draft(),
      fleet,
      first.message,
    );
    expect(accepted.collectionStatus).toBe('collecting');
    expect(accepted.extractedDataPatch.structuredData).toMatchObject({
      lumeTourismIntake: { multipleVehicles: true, pending: null },
    });
  });
  it('explains capacity only after one vehicle is requested, accepts correction and does not confirm the whole quote', async () => {
    const { service } = setup();
    const first = await service.review(
      { ...initial, userMessage: '200 pessoas' },
      draft({ passengerCount: 200 }),
      fleet,
    );
    const one = await service.review(
      reply(first, 'não'),
      draft(),
      fleet,
      first.message,
    );
    expect(one.message).toContain('46 passageiros por veículo');
    expect(one.collectionStatus).toBe('collecting');
    const corrected = await service.review(
      reply(one, 'errei, são 40 pessoas'),
      draft({ passengerCount: 40 }),
      fleet,
      one.message,
    );
    expect(corrected.extractedDataPatch.passengerCount).toBe(40);
    expect(corrected.customerDecision).toBe('undecided');
    expect(corrected.collectionStatus).toBe('collecting');
  });
  it('uses registered capacity instead of 46 and never clamps a group to fit', async () => {
    const { service } = setup();
    const output = await service.review(
      { ...initial, userMessage: '200 pessoas, quero só um ônibus' },
      draft({ passengerCount: 200 }),
      { ...fleet, source: 'fleet', maximumPassengers: 60 },
    );
    expect(output.message).toContain('60 passageiros');
    expect(output.extractedDataPatch.passengerCount).toBe(200);
  });
  it('requires delivered question and explicit confirmation before forwarding a 5000-person exception', async () => {
    const { service } = setup();
    const first = await service.review(
      { ...initial, userMessage: '5000 pessoas' },
      draft({ passengerCount: 500 }),
      fleet,
    );
    expect(first.extractedDataPatch.passengerCount).toBeUndefined();
    const unsolicited = await service.review(
      reply(first, 'sim'),
      draft(),
      fleet,
      'Outra pergunta?',
    );
    expect(unsolicited.message).toContain('mais de um veículo');
    const multiple = await service.review(
      reply(first, 'sim'),
      draft(),
      fleet,
      first.message,
    );
    expect(multiple.collectionStatus).toBe('collecting');
    expect(multiple.message).toContain('5.000 passageiros');
    const correction = await service.review(
      reply(multiple, 'desculpe, é 50 pessoas'),
      draft({ passengerCount: 50 }),
      fleet,
      multiple.message,
    );
    expect(correction.collectionStatus).toBe('collecting');
    expect(correction.extractedDataPatch.passengerCount).toBe(50);
    const confirmed = await service.review(
      reply(multiple, 'sim'),
      draft(),
      fleet,
      multiple.message,
    );
    expect(confirmed.collectionStatus).toBe('human-handoff');
    expect(confirmed.extractedDataPatch.structuredData).toMatchObject({
      confirmedPassengerException: { passengers: 5000 },
    });
  });
  it.each(['2020-09-09', '2026-02-30', '2026-13-01'])(
    'does not accept suspicious date %s before clarification',
    async (departureAt) => {
      const { service } = setup();
      const result = await service.review(
        initial,
        draft({ departureAt }),
        fleet,
      );
      expect(result.collectionStatus).toBe('collecting');
      expect(result.extractedDataPatch.departureAt).toBeUndefined();
    },
  );
  it('checks return after departure and keeps an optional time optional', async () => {
    const { service } = setup();
    expect(
      (
        await service.review(
          initial,
          draft({ departureAt: '2026-10-12', returnAt: '2026-10-11' }),
          fleet,
        )
      ).message,
    ).toContain('volta ficou antes');
    const out = await service.review(
      initial,
      {
        ...draft({ departureAt: '2026-10-12' }),
        collectionStatus: 'collecting',
        customerDecision: 'undecided',
        message: 'Qual é a origem?',
      },
      fleet,
    );
    expect(out.extractedDataPatch.departureAt).toBe('2026-10-12');
  });
  it('does not turn a destination into a name and resolves a location through the routing provider', async () => {
    const { service, searchLocations } = setup();
    searchLocations.mockResolvedValue([
      {
        id: 'place',
        label: 'Campo de Marte, São Paulo, Brasil',
        lat: -23.5,
        lng: -46.6,
      },
    ]);
    const first = await service.review(
      { ...initial, userMessage: 'é para Campo de Marte' },
      draft({ contactName: 'Marte', destination: 'Campo de Marte' }),
      fleet,
    );
    expect(first.extractedDataPatch.contactName).toBeUndefined();
    expect(searchLocations).toHaveBeenCalledWith('Campo de Marte');
    expect(first.message).toContain('São Paulo');
    expect(first.extractedDataPatch.destination).toBeUndefined();
    const accepted = await service.review(
      reply(first, 'sim'),
      {
        ...draft(),
        collectionStatus: 'collecting',
        customerDecision: 'undecided',
        message: 'Qual é a data?',
      },
      fleet,
      first.message,
    );
    expect(accepted.extractedDataPatch.destination).toBe(
      'Campo de Marte, São Paulo, Brasil',
    );
    expect(searchLocations).toHaveBeenCalledTimes(1);
  });
  it('does not equate empty results or outages with a nonexistent destination', async () => {
    const { service, searchLocations } = setup();
    const missing = await service.review(
      initial,
      draft({ destination: 'Lua' }),
      fleet,
    );
    expect(missing.message).toContain('cidade e o estado');
    expect(missing.message).not.toContain('não existe');
    searchLocations.mockRejectedValue(new Error('timeout'));
    const outage = await service.review(
      initial,
      draft({ origin: 'Uberlândia' }),
      fleet,
    );
    expect(outage.collectionStatus).toBe('collecting');
    expect(outage.message).toBe('Em qual estado fica Uberlândia?');
  });
  it('honors an explicit human request without requiring clarification', async () => {
    const { service } = setup();
    const result = await service.review(
      { ...initial, userMessage: 'Quero falar com um atendente' },
      draft(),
      fleet,
    );
    expect(result.collectionStatus).toBe('human-handoff');
  });
  it('preserves one-way answers and replaces repeated trip-type questions with the next missing item', async () => {
    const { service } = setup();
    const result = await service.review(
      initial,
      {
        ...draft(),
        message: 'Será só ida ou ida e volta?',
        collectionStatus: 'collecting',
        customerDecision: 'undecided',
      },
      fleet,
      undefined,
      ['somente ida', 'ida apenas'],
    );
    expect(result.message).toBe('Qual é a data da viagem?');
    expect(result.extractedDataPatch.structuredData).toMatchObject({
      tripType: 'one_way',
    });
  });
});

it('retains an omitted past-date candidate until the delivered question is answered', async () => {
  const { service } = setup();
  const first = await service.review(
    initial,
    draft({ departureAt: '2020-09-09' }),
    fleet,
  );
  const second = await service.review(
    reply(first, 'sim'),
    draft(),
    fleet,
    first.message,
  );
  expect(second.collectionStatus).toBe('human-handoff');
  expect(second.extractedDataPatch.structuredData).toMatchObject({
    confirmedDateException: { value: '2020-09-09' },
  });
});
it('keeps both location candidates without recording either as verified prematurely', async () => {
  const { service } = setup();
  const out = await service.review(
    initial,
    draft({ origin: 'A', destination: 'B' }),
    fleet,
  );
  expect(out.extractedDataPatch.origin).toBeUndefined();
  expect(out.extractedDataPatch.destination).toBeUndefined();
  expect(out.extractedDataPatch.structuredData).toMatchObject({
    lumeTourismIntake: {
      locations: { destination: { query: 'B', status: 'pending' } },
    },
  });
});
it('reads a bare high count in response to a passenger question even if the model omits it', async () => {
  const { service } = setup();
  const out = await service.review(
    { ...initial, userMessage: '800' },
    draft(),
    fleet,
    'Quantas pessoas vão viajar?',
  );
  expect(out.collectionStatus).toBe('collecting');
  expect(out.message).toContain('mais de um veículo');
});
it.each([-1, 0, 1.5])(
  'does not silently normalize an invalid passenger count %s',
  async (passengerCount) => {
    const { service } = setup();
    const out = await service.review(
      { ...initial, userMessage: passengerCount + ' pessoas' },
      draft({ passengerCount }),
      fleet,
    );
    expect(out.collectionStatus).toBe('collecting');
    expect(out.extractedDataPatch.passengerCount).toBeUndefined();
  },
);

it('recognizes a city and UF without asking them again when routing returns duplicate city labels', async () => {
  const { service, searchLocations } = setup();
  searchLocations.mockResolvedValue([
    { id: '1', label: 'Uberlândia, MG, Brasil', lat: -18.9, lng: -48.2 },
    { id: '2', label: 'Uberlândia, MG, Brasil', lat: -18.8, lng: -48.3 },
    {
      id: '3',
      label: 'Prefeitura, Uberlândia, MG, Brasil',
      lat: -18.9,
      lng: -48.1,
    },
  ]);
  const result = await service.review(
    initial,
    {
      ...draft({ origin: 'Uberlândia, MG' }),
      collectionStatus: 'collecting',
      customerDecision: 'undecided',
      message: 'Qual é o destino?',
    },
    fleet,
  );
  expect(result.extractedDataPatch.origin).toBe('Uberlândia, MG, Brasil');
  expect(result.message).toBe('Qual é o destino?');
});

it('accepts an explicit change from one-way to round-trip despite earlier one-way answers', async () => {
  const { service } = setup();
  const result = await service.review(
    { ...initial, userMessage: 'Não, agora é ida e volta' },
    {
      ...draft({ structuredData: { tripType: 'round_trip' } }),
      collectionStatus: 'collecting',
      customerDecision: 'undecided',
      message: 'Qual é a data da volta?',
    },
    fleet,
    undefined,
    ['somente ida'],
  );
  expect(result.extractedDataPatch.structuredData).toMatchObject({
    tripType: 'round_trip',
  });
});

const collecting = (
  message: string,
  patch: Record<string, unknown> = {},
): AiProviderOutput => ({
  ...draft(patch),
  message,
  collectionStatus: 'collecting',
  customerDecision: 'undecided',
});
const city = {
  id: 'city',
  label: 'Uberlândia, MG, Brasil',
  lat: -18.9,
  lng: -48.2,
};
const wrongStreet = {
  id: 'street',
  label: 'Rua Uberlândia, Canaã do Brasil, MG, Brasil',
  lat: -19,
  lng: -44,
};
function locationSession() {
  let quote = {
    ...initial.currentConversation!.currentQuoteRequest!,
    departureDate: '2026-10-12',
  };
  let lastMessage = '';
  return {
    input(text: string): WhatsAppConversationAgentInput {
      return {
        ...initial,
        userMessage: text,
        currentConversation: {
          ...initial.currentConversation!,
          currentQuoteRequest: quote,
        },
      };
    },
    save(out: AiProviderOutput) {
      quote = { ...quote, ...out.extractedDataPatch };
      lastMessage = out.message;
    },
    get quote() {
      return quote;
    },
    get lastMessage() {
      return lastMessage;
    },
  };
}
describe('location regression across persisted conversation turns', () => {
  it('replays origin confirmation then Jatai without rechecking origin or replacing the destination question', async () => {
    const { service, searchLocations } = setup();
    searchLocations
      .mockResolvedValueOnce([city])
      .mockResolvedValue([wrongStreet]);
    const session = locationSession();
    for (const [text, message] of [
      [
        'era brincadeira, não existe. Lua.',
        'Qual é o local real de origem da viagem?',
      ],
      ['Lua', 'Informe a cidade e o estado de origem.'],
      ['Uberlandia', 'A origem é Uberlândia, Minas Gerais?'],
    ]) {
      const out = await service.review(
        session.input(text),
        collecting(message),
        fleet,
        session.lastMessage,
      );
      session.save(out);
    }
    const confirmed = await service.review(
      session.input('sim'),
      collecting('Qual é o destino da viagem?', { origin: 'Uberlândia, MG' }),
      fleet,
      session.lastMessage,
    );
    session.save(confirmed);
    expect(session.quote.origin).toBe(city.label);
    const destination = await service.review(
      session.input('Jatai'),
      collecting('O destino é Jataí, Goiás?'),
      fleet,
      session.lastMessage,
    );
    session.save(destination);
    expect(destination.message).toBe('O destino é Jataí, Goiás?');
    expect(session.quote.origin).toBe(city.label);
    expect(searchLocations).toHaveBeenCalledTimes(1);
    searchLocations.mockResolvedValue([
      { id: 'jataí', label: 'Jataí, GO, Brasil', lat: -17.9, lng: -51.7 },
    ]);
    const accepted = await service.review(
      session.input('sim'),
      collecting('Quantas pessoas vão viajar?', { destination: 'Jataí, GO' }),
      fleet,
      session.lastMessage,
    );
    session.save(accepted);
    expect(session.quote.origin).toBe(city.label);
    expect(session.quote.destination).toBe('Jataí, GO, Brasil');
    expect(accepted.message).toBe('Quantas pessoas vão viajar?');
    expect(searchLocations.mock.calls.map((call) => call[0])).toEqual([
      'Uberlândia, MG',
      'Jataí, GO',
    ]);
  });

  it.each(['Não', 'Não tenho endereço definido ainda.', 'sim'])(
    'recovers an existing poisoned origin suggestion on %s without accepting the wrong street',
    async (answer) => {
      const { service, searchLocations } = setup();
      const question =
        'Você se refere a ' + wrongStreet.label + ' como local de saída?';
      const input = reply(
        collecting(question, {
          origin: city.label,
          structuredData: {
            tripType: 'one_way',
            lumeTourismIntake: {
              pending: {
                kind: 'location',
                field: 'origin',
                phase: 'candidate',
                value: city.label,
                question,
              },
              locations: {
                origin: {
                  query: city.label,
                  label: wrongStreet.label,
                  status: 'unverified',
                },
              },
            },
          },
        }),
        answer,
        { departureDate: '2026-10-12' },
      );
      const out = await service.review(
        input,
        collecting(
          'Você se refere a ' + wrongStreet.label + ' como local de saída?',
          answer === 'sim' ? { origin: wrongStreet.label } : {},
        ),
        fleet,
        question,
      );
      expect(out.extractedDataPatch.origin).toBe(city.label);
      expect(out.message).toBe('Qual é o destino da viagem?');
      expect(out.extractedDataPatch.structuredData).toMatchObject({
        lumeTourismIntake: {
          pending: null,
          locations: { origin: { status: 'matched', label: city.label } },
        },
      });
      expect(searchLocations).not.toHaveBeenCalled();
    },
  );

  it('does not repeat a rejected suggestion or treat missing street address as a new rejection of the city', async () => {
    const { service, searchLocations } = setup();
    searchLocations.mockResolvedValue([wrongStreet]);
    const first = await service.review(
      initial,
      collecting('Qual é o destino?', { origin: 'Uberlandia' }),
      fleet,
    );
    const rejected = await service.review(
      reply(first, 'Não'),
      collecting(first.message),
      fleet,
      first.message,
    );
    expect(rejected.message).not.toBe(first.message);
    expect(rejected.message).toContain('Desconsiderei');
    expect(rejected.extractedDataPatch.origin).toBeUndefined();
    const noStreet = await service.review(
      reply(rejected, 'Não tenho endereço definido ainda.'),
      collecting(first.message),
      fleet,
      rejected.message,
    );
    expect(noStreet.message).toContain('endereço exato pode ficar para depois');
    expect(noStreet.message).not.toContain(wrongStreet.label);
    expect(searchLocations).toHaveBeenCalledTimes(1);
    searchLocations.mockResolvedValue([wrongStreet, city]);
    const corrected = await service.review(
      reply(noStreet, 'Uberlândia, Minas Gerais'),
      collecting('Qual é o destino?', { origin: 'Uberlândia, Minas Gerais' }),
      fleet,
      noStreet.message,
    );
    expect(corrected.extractedDataPatch.origin).toBe(city.label);
    expect(corrected.message).toBe('Qual é o destino?');
  });

  it('keeps a confirmed city when its address is unknown, and continues to the missing destination', async () => {
    const { service, searchLocations } = setup();
    searchLocations.mockResolvedValue([city]);
    const session = locationSession();
    session.save(
      await service.review(
        session.input('Uberlandia, MG'),
        collecting('Qual é o destino?', { origin: 'Uberlandia, MG' }),
        fleet,
      ),
    );
    const out = await service.review(
      session.input('Não tenho endereço definido ainda.'),
      collecting('Qual é o endereço de saída?', { origin: 'Não definido' }),
      fleet,
      session.lastMessage,
    );
    session.save(out);
    expect(out.message).toBe('Qual é o destino da viagem?');
    expect(session.quote.origin).toBe(city.label);
    expect(out.extractedDataPatch.structuredData).toMatchObject({
      lumeTourismIntake: { locations: { origin: { addressPending: true } } },
    });
    expect(searchLocations).toHaveBeenCalledTimes(1);
  });

  it('preserves identity for state spelling and canonical country suffix across repeated patches', async () => {
    const { service, searchLocations } = setup();
    searchLocations.mockResolvedValue([city]);
    const session = locationSession();
    for (const origin of [
      'Uberlandia, MG',
      city.label,
      'Uberlândia, Minas Gerais',
    ]) {
      const out = await service.review(
        session.input('40 passageiros'),
        collecting('Você prefere qual veículo?', { origin }),
        fleet,
        session.lastMessage,
      );
      session.save(out);
      expect(session.quote.origin).toBe(city.label);
    }
    expect(searchLocations).toHaveBeenCalledTimes(1);
  });

  it('does not let an answer about destination overwrite the confirmed origin', async () => {
    const { service, searchLocations } = setup();
    searchLocations.mockResolvedValue([city]);
    const session = locationSession();
    session.save(
      await service.review(
        session.input('Uberlandia, MG'),
        collecting('Qual é o destino?', { origin: 'Uberlandia, MG' }),
        fleet,
      ),
    );
    const out = await service.review(
      session.input('Jataí'),
      collecting('O destino é Jataí, Goiás?', { origin: 'Jataí, GO' }),
      fleet,
      session.lastMessage,
    );
    expect(out.extractedDataPatch.origin).toBe(city.label);
    expect(out.message).toBe('O destino é Jataí, Goiás?');
    expect(searchLocations).toHaveBeenCalledTimes(1);
  });

  it('allows an explicit origin change and keeps the old city until the new candidate is confirmed', async () => {
    const { service, searchLocations } = setup();
    searchLocations
      .mockResolvedValueOnce([city])
      .mockResolvedValue([
        { id: '2', label: 'Uberaba, MG, Brasil', lat: -19.7, lng: -47.9 },
      ]);
    const session = locationSession();
    session.save(
      await service.review(
        session.input('Uberlandia, MG'),
        collecting('Qual é o destino?', { origin: 'Uberlandia, MG' }),
        fleet,
      ),
    );
    const change = await service.review(
      session.input('Corrigindo a origem, sairemos de Uberaba'),
      collecting('Qual é o destino?', { origin: 'Uberaba' }),
      fleet,
      session.lastMessage,
    );
    session.save(change);
    expect(change.message).toContain('Uberaba');
    expect(session.quote.origin).toBe(city.label);
    const yes = await service.review(
      session.input('sim'),
      collecting('Qual é o destino?', { origin: 'Uberaba, MG, Brasil' }),
      fleet,
      session.lastMessage,
    );
    expect(yes.extractedDataPatch.origin).toBe('Uberaba, MG, Brasil');
    expect(searchLocations).toHaveBeenCalledTimes(2);
  });

  it('does not pick the first ambiguous street after a clarification', async () => {
    const { service, searchLocations } = setup();
    searchLocations.mockResolvedValue([
      wrongStreet,
      { ...wrongStreet, id: 'other', label: 'Rua Uberlândia, SP, Brasil' },
    ]);
    const first = await service.review(
      initial,
      collecting('', { origin: 'Uberlandia' }),
      fleet,
    );
    const second = await service.review(
      reply(first, 'Minas Gerais'),
      collecting('', { origin: 'Uberlândia, Minas Gerais' }),
      fleet,
      first.message,
    );
    expect(second.message).not.toContain('Rua ');
    expect(second.extractedDataPatch.origin).toBeUndefined();
    expect(second.message).toBe('A saída será de Uberlandia, MG?');
    const confirmed = await service.review(
      reply(second, 'sim'),
      draft(),
      fleet,
      second.message,
    );
    expect(confirmed.extractedDataPatch.origin).toBe('Uberlandia, MG');
    expect(confirmed.message).not.toContain('mais de um local');
  });

  it('accepts a corrected candidate in the same message as a rejection', async () => {
    const { service, searchLocations } = setup();
    searchLocations
      .mockResolvedValueOnce([wrongStreet])
      .mockResolvedValue([city]);
    const first = await service.review(
      initial,
      collecting('', { origin: 'Uberlandia' }),
      fleet,
    );
    const out = await service.review(
      reply(first, 'Não, é Uberlândia, MG'),
      collecting('Qual é o destino?', { origin: 'Uberlândia, MG' }),
      fleet,
      first.message,
    );
    expect(out.extractedDataPatch.origin).toBe(city.label);
    expect(out.message).toBe('Qual é o destino?');
  });
});

it('removes stale missing origin and avoids asking a validated city again even when the model omits the patch', async () => {
  const { service, searchLocations } = setup();
  searchLocations.mockResolvedValue([city]);
  const session = locationSession();
  session.save(
    await service.review(
      session.input('Uberlandia, MG'),
      collecting('Qual é o destino?', { origin: 'Uberlandia, MG' }),
      fleet,
    ),
  );
  const out = await service.review(
    session.input('Ainda não sei'),
    {
      ...collecting('A origem é Uberlândia, Minas Gerais?'),
      missingFields: ['origin', 'destination'],
    },
    fleet,
    session.lastMessage,
  );
  expect(out.message).toBe('Qual é o destino da viagem?');
  expect(out.missingFields).toEqual(['destination']);
  expect(searchLocations).toHaveBeenCalledTimes(1);
});

it('ignores malformed model location patches without discarding a confirmed city', async () => {
  const { service, searchLocations } = setup();
  searchLocations.mockResolvedValue([city]);
  const session = locationSession();
  session.save(
    await service.review(
      session.input('Uberlandia, MG'),
      collecting('Qual é o destino?', { origin: 'Uberlandia, MG' }),
      fleet,
    ),
  );
  const out = await service.review(
    session.input('Jataí'),
    collecting('O destino é Jataí, Goiás?', { origin: { name: 'Jataí' } }),
    fleet,
    session.lastMessage,
  );
  expect(out.extractedDataPatch.origin).toBe(city.label);
  expect(out.message).toBe('O destino é Jataí, Goiás?');
  expect(searchLocations).toHaveBeenCalledTimes(1);
});

describe('customer-facing text quality', () => {
  const completeQuote: Partial<QuoteRequestSnapshot> = {
    departureDate: '2026-09-19',
    passengerCount: 150,
    vehicleType: 'Sem preferência',
    vehicleAtDisposal: false,
    localTransfers: false,
    structuredData: {
      tripType: 'one_way',
      lumeTourismIntake: { multipleVehicles: true, plannedPassengerCount: 150 },
    },
  };
  it('replays the malformed additional question without changing the collected answers', async () => {
    const { service } = setup();
    const out = await service.review(
      reply(collecting('Haverá outros deslocamentos no destino?'), 'não', {
        ...completeQuote,
        origin: city.label,
        destination: 'Jataí, GO, Brasil',
        structuredData: {
          ...completeQuote.structuredData,
          lumeTourismIntake: {
            multipleVehicles: true,
            plannedPassengerCount: 150,
            locations: {
              origin: {
                query: city.label,
                label: city.label,
                status: 'matched',
              },
              destination: {
                query: 'Jataí, GO',
                label: 'Jataí, GO, Brasil',
                status: 'matched',
              },
            },
          },
        },
      }),
      {
        ...collecting('Há alguma observação დამატicional sobre a viagem?', {
          localTransfers: false,
          structuredData: { transferDetailsAnswered: true },
        }),
        missingFields: ['notes'],
      },
      fleet,
      'Haverá outros deslocamentos no destino?',
    );
    expect(out.message).toBe('Há alguma observação adicional sobre a viagem?');
    expect(out.extractedDataPatch.localTransfers).toBe(false);
    expect(out.extractedDataPatch.structuredData).toMatchObject({
      transferDetailsAnswered: true,
    });
    expect(out.collectionStatus).toBe('collecting');
    expect(out.customerDecision).toBe('undecided');
  });
  it('does not mark a malformed summary as presented or confirmed', async () => {
    const { service } = setup();
    const out = await service.review(
      initial,
      {
        ...collecting('Resumo: observações დამატicionais. Confirma?'),
        collectionStatus: 'ready-for-summary',
        summaryPresented: true,
        customerDecision: 'confirmed',
      },
      fleet,
    );
    expect(out.summaryPresented).toBe(false);
    expect(out.customerDecision).toBe('undecided');
    expect(out.message).not.toContain('დამატ');
  });
  it('preserves an explicit human handoff while repairing malformed text', async () => {
    const { service } = setup();
    const out = await service.review(
      { ...initial, userMessage: 'Quero falar com um atendente' },
      {
        ...draft(),
        message: 'Vou encaminhar ao atendente დამატicional.',
        targetDepartment: 'commercial',
      },
      fleet,
    );
    expect(out.collectionStatus).toBe('human-handoff');
    expect(out.targetDepartment).toBe('commercial');
    expect(out.message).toBe(
      'Vou encaminhar seu atendimento para nossa equipe dar continuidade.',
    );
  });
});

it('does not reuse a malformed model question when asking about multiple vehicles', async () => {
  const { service } = setup();
  const out = await service.review(
    { ...initial, userMessage: '150' },
    collecting('Podemos usar mais de um veículo დამატicional?', {
      passengerCount: 150,
    }),
    fleet,
  );
  expect(out.message).not.toContain('დამატ');
  expect(out.message).toMatch(/mais de um ve[ií]culo/u);
});

describe('location outage does not restart or block collection', () => {
  it.each(['origin', 'destination'] as const)(
    'confirms %s once and continues without calling the failed provider again',
    async (field) => {
      const { service, searchLocations } = setup();
      searchLocations.mockRejectedValue(new Error('connection refused'));
      const first = await service.review(
        initial,
        collecting('Qual é a cidade?', { [field]: 'Jataí, GO, Brasil' }),
        fleet,
      );
      expect(first.message).toContain('Jataí, GO');
      expect(first.message).not.toContain('consegui');
      expect(first.extractedDataPatch[field]).toBeUndefined();
      const confirmed = await service.review(
        reply(first, 'sim', { departureDate: '2026-10-12' }),
        draft(),
        fleet,
        first.message,
      );
      expect(confirmed.extractedDataPatch[field]).toBe('Jataí, GO, Brasil');
      expect(confirmed.collectionStatus).toBe('collecting');
      expect(confirmed.customerDecision).toBe('undecided');
      expect(confirmed.summaryPresented).toBe(false);
      expect(confirmed.extractedDataPatch.structuredData).toMatchObject({
        lumeTourismIntake: {
          pending: null,
          locations: {
            [field]: {
              status: 'customer-confirmed',
              routingValidationPending: true,
            },
          },
        },
      });
      const next = await service.review(
        reply(confirmed, '40 pessoas', { departureDate: '2026-10-12' }),
        collecting('Qual veículo prefere?', { passengerCount: 40 }),
        fleet,
        confirmed.message,
      );
      expect(next.extractedDataPatch[field]).toBe('Jataí, GO, Brasil');
      expect(searchLocations).toHaveBeenCalledTimes(1);
    },
  );
  it('recovers the existing unavailable question even when a repeated city has no model patch', async () => {
    const { service, searchLocations } = setup();
    const oldQuestion =
      'Não consegui conferir o local agora. Qual é a cidade e o estado da saída?';
    const previous = collecting(oldQuestion, {
      structuredData: {
        tripType: 'one_way',
        lumeTourismIntake: {
          pending: {
            kind: 'location',
            field: 'origin',
            value: 'Jataí, GO, Brasil',
            phase: 'unavailable',
            question: oldQuestion,
          },
          locations: {
            origin: {
              query: 'Jataí, GO, Brasil',
              label: 'Jataí, GO, Brasil',
              status: 'pending',
            },
          },
        },
      },
    });
    const out = await service.review(
      reply(previous, 'Jatai'),
      collecting(oldQuestion),
      fleet,
      oldQuestion,
    );
    expect(out.message).toBe('A saída será de Jataí, GO?');
    expect(out.extractedDataPatch.origin).toBeUndefined();
    expect(searchLocations).not.toHaveBeenCalled();
  });
  it('collects a missing state and requires confirmation rather than claiming map validation', async () => {
    const { service, searchLocations } = setup();
    searchLocations.mockRejectedValue(new Error('offline'));
    const first = await service.review(
      initial,
      collecting('', { origin: 'Jataí' }),
      fleet,
    );
    expect(first.message).toBe('Em qual estado fica Jataí?');
    const state = await service.review(
      reply(first, 'Goiás'),
      collecting(first.message),
      fleet,
      first.message,
    );
    expect(state.message).toBe('A saída será de Jataí, GO?');
    expect(state.extractedDataPatch.origin).toBeUndefined();
    const yes = await service.review(
      reply(state, 'sim'),
      collecting(state.message),
      fleet,
      state.message,
    );
    expect(yes.extractedDataPatch.origin).toBe('Jataí, GO');
    expect(searchLocations).toHaveBeenCalledTimes(1);
  });
  it('never accepts a no or a reply to an unrelated question as city confirmation', async () => {
    const { service, searchLocations } = setup();
    searchLocations.mockRejectedValue(new Error('offline'));
    const first = await service.review(
      initial,
      collecting('', { origin: 'Jataí, GO' }),
      fleet,
    );
    const no = await service.review(
      reply(first, 'não'),
      collecting('Qual é o destino?'),
      fleet,
      first.message,
    );
    expect(no.extractedDataPatch.origin).toBeUndefined();
    const unrelated = await service.review(
      reply(first, 'sim'),
      collecting('Qual é o destino?'),
      fleet,
      'Você quer mais de um veículo?',
    );
    expect(unrelated.extractedDataPatch.origin).toBeUndefined();
    expect(unrelated.message).toBe(first.message);
  });
  it('does not reuse the old city after a correction during the outage', async () => {
    const { service, searchLocations } = setup();
    searchLocations.mockRejectedValue(new Error('offline'));
    const first = await service.review(
      initial,
      collecting('', { origin: 'Jataí, GO' }),
      fleet,
    );
    const corrected = await service.review(
      reply(first, 'Não, Uberaba MG'),
      collecting('', { origin: 'Uberaba, MG' }),
      fleet,
      first.message,
    );
    expect(corrected.message).toBe('A saída será de Uberaba, MG?');
    expect(corrected.extractedDataPatch.origin).toBeUndefined();
    const yes = await service.review(
      reply(corrected, 'sim'),
      collecting('Qual é o destino?'),
      fleet,
      corrected.message,
    );
    expect(yes.extractedDataPatch.origin).toBe('Uberaba, MG');
  });
});

it.each(['exato', 'certo', 'isso aí'])(
  'continues an offline city confirmation on the natural response %s',
  async (answer) => {
    const { service, searchLocations } = setup();
    searchLocations.mockRejectedValue(new Error('offline'));
    const first = await service.review(
      initial,
      collecting('', { origin: 'Jataí, GO' }),
      fleet,
    );
    const next = await service.review(
      reply(first, answer),
      collecting(first.message),
      fleet,
      first.message,
    );
    expect(next.extractedDataPatch.origin).toBe('Jataí, GO');
    expect(next.customerDecision).toBe('undecided');
    expect(next.message).not.toBe(first.message);
  },
);
it('does not announce handoff from malformed model text when a city has just been confirmed offline', async () => {
  const { service, searchLocations } = setup();
  searchLocations.mockRejectedValue(new Error('offline'));
  const first = await service.review(
    initial,
    collecting('', { origin: 'Jataí, GO' }),
    fleet,
  );
  const next = await service.review(
    reply(first, 'sim'),
    { ...draft(), message: 'Vou encaminhar დამატicional.' },
    fleet,
    first.message,
  );
  expect(next.message).not.toMatch(/encaminhar|დამატ/u);
  expect(next.collectionStatus).toBe('collecting');
  expect(next.extractedDataPatch.origin).toBe('Jataí, GO');
});

describe('September 12 attendance regression', () => {
  const completedQuote: Partial<QuoteRequestSnapshot> = {
    contactName: 'Cliente',
    departureDate: '2026-09-12',
    returnDate: '2026-09-20',
    origin: 'Jataí, GO, Brasil',
    destination: 'Uberlândia, MG, Brasil',
    passengerCount: 15,
    vehicleType: 'Sem preferência',
    vehicleAtDisposal: true,
    localTransfers: true,
    structuredData: {
      tripType: 'round_trip',
      notesAnswered: false,
      transferDetailsAnswered: true,
      transferDetails: 'Passaremos em Goiânia, Caldas Novas e Araguari.',
      lumeTourismIntake: {
        locations: {
          origin: {
            query: 'Jataí, GO, Brasil',
            label: 'Jataí, GO, Brasil',
            status: 'customer-confirmed',
            routingValidationPending: true,
          },
          destination: {
            query: 'Uberlândia, MG, Brasil',
            label: 'Uberlândia, MG, Brasil',
            status: 'matched',
          },
        },
      },
    },
  };
  it.each([
    'Resumo: ida e volta de Jataí/GO para Uberlândia/MG. Confirma os dados?',
    'Resumo da viagem:\n• Ida e volta: Jataí/GO para Uberlândia/MG\n• Observações: Nenhuma.\nOs dados estão corretos?',
    'Resumo: somente ida de Jataí/GO para Uberlândia/MG. Confirma?',
  ])(
    'presents the summary on the first no instead of repeating notes: %s',
    async (message) => {
      const { service } = setup();
      const result = await service.review(
        reply(
          collecting('Há alguma observação adicional sobre a viagem?'),
          'Nao',
          completedQuote,
        ),
        {
          ...collecting(message, {
            notes: null,
            structuredData: { notesAnswered: true },
          }),
          collectionStatus: 'ready-for-summary',
          summaryPresented: true,
          missingFields: [],
        },
        fleet,
        'Há alguma observação adicional sobre a viagem?',
      );
      expect(result.message).toContain('*Resumo do pedido*');
      expect(result.message).toContain('\n• *Passageiros:* 15\n');
      expect(result.message).toContain(
        '\n\nOs dados estão corretos para solicitar o orçamento?',
      );
      expect(result.message).not.toContain('Há alguma observação');
      expect(result.summaryPresented).toBe(true);
      expect(
        deriveAiActions(result, 'eventual-quote').transitionAfterSend,
      ).toBe('present-quote-summary');
      expect(result.customerDecision).toBe('undecided');
      expect(result.extractedDataPatch.structuredData).toMatchObject({
        notesAnswered: true,
        transferDetailsAnswered: true,
      });
      const confirmation = await service.review(
        reply(result, 'Sim', {
          ...completedQuote,
          structuredData: result.extractedDataPatch.structuredData,
        }),
        {
          ...collecting('Seu pedido está na fila do Comercial.'),
          collectionStatus: 'completed',
          customerDecision: 'confirmed',
        },
        fleet,
        result.message,
      );
      expect(confirmation.customerDecision).toBe('confirmed');
      expect(
        deriveAiActions(confirmation, 'eventual-quote').transitionAfterSend,
      ).toBe('confirm-quote');
    },
  );
  it('blocks a standalone generated Georgian word and advances to the correct passenger question', async () => {
    const { service } = setup();
    const result = await service.review(
      reply(collecting('Uberlândia, MG?'), 'Sim', {
        ...completedQuote,
        passengerCount: null,
      }),
      collecting('Quantos passageiros irão viajar დაახლოებით?'),
      fleet,
      'Uberlândia, MG?',
    );
    expect(result.message).toBe('Quantas pessoas vão viajar?');
    expect(result.summaryPresented).toBe(false);
    expect(result.customerDecision).toBe('undecided');
  });
});

describe('structured municipality identity', () => {
  it.each([
    ['Uberlândia', 'Minas Gerais', 'MG'],
    ['Porto Velho', 'Rondônia', 'R.'],
  ])(
    'accepts %s without confusing venues with cities',
    async (name, region, regionCode) => {
      const { service, searchLocations } = setup();
      searchLocations.mockResolvedValue([
        {
          id: 'city',
          label: name + ', ' + regionCode + ', Brasil',
          name,
          region,
          regionCode,
          layer: 'locality',
          lat: -10,
          lng: -50,
        },
        {
          id: 'shop',
          label: name + ' Shopping, Brasil',
          name: name + ' Shopping',
          layer: 'venue',
          lat: -10,
          lng: -50,
        },
      ]);
      const value = name === 'Porto Velho' ? name + ' RO' : name;
      const result = await service.review(
        { ...initial, userMessage: value },
        draft({ origin: value }),
        fleet,
      );
      expect(result.extractedDataPatch.origin).toBe(
        name + ', ' + (region === 'Rondônia' ? 'RO' : 'MG') + ', Brasil',
      );
      expect(result.message).not.toContain('mais de um local');
    },
  );
});

it('recovers RO from a state-only model patch and preserves the destination city', async () => {
  const { service, searchLocations } = setup();
  searchLocations.mockResolvedValue([
    { id: 'a', label: 'venue one', lat: 0, lng: 0 },
    { id: 'b', label: 'venue two', lat: 0, lng: 0 },
  ]);
  const first = await service.review(
    initial,
    collecting('', { destination: 'Porto Velho RO' }),
    fleet,
  );
  searchLocations.mockResolvedValue([
    {
      id: 'city',
      name: 'Porto Velho',
      region: 'Rondônia',
      regionCode: 'R.',
      layer: 'locality',
      label: 'Porto Velho, R., Brasil',
      lat: 0,
      lng: 0,
    },
  ]);
  const second = await service.review(
    reply(first, 'RO'),
    collecting('', { destination: 'RO' }),
    fleet,
    first.message,
  );
  expect(second.extractedDataPatch.destination).toBe('Porto Velho, RO, Brasil');
});
