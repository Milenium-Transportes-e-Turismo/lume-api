import { formatTourismQuoteSummary } from './tourism-quote-summary';
import { hasUnexpectedMixedAlphabetWord } from './customer-message-text';
import { Injectable } from '@nestjs/common';

import { RouteLocationSearchProvider } from '../../../application/contracts/route-location-search.provider';
import type { WhatsAppConversationAgentInput } from '../../../application/contracts/whatsapp-conversation-agent';
import type { AiProviderOutput } from '../../../domain/whatsapp/whatsapp-automation-flow';
import { PrismaService } from '../../database/prisma/prisma.service';

import {
  hasLocationState,
  locationIdentity,
  locationSearchText,
  sameLocation,
  locationQuestionField,
  undefinedStreetAddress,
} from './tourism-location-identity';

type PendingKind = 'vehicles' | 'passengers' | 'date' | 'location';
interface Pending {
  kind: PendingKind;
  field: string;
  value: string | number;
  question: string;
  phase?: string;
}
export interface TourismFleetContext {
  maximumPassengers: number;
  source: 'fleet' | 'default';
  capacities: { passengers: number; vehicles: number }[];
}
interface IntakeState {
  pending?: Pending | null;
  multipleVehicles?: boolean;
  plannedPassengerCount?: number;
  locations?: Record<
    string,
    {
      query: string;
      label: string;
      status: string;
      rejected?: string[];
      addressPending?: boolean;
      routingValidationPending?: boolean;
    }
  >;
}
const STATE_KEY = 'lumeTourismIntake';
function collectedLocation(status: string | undefined): boolean {
  return status === 'matched' || status === 'customer-confirmed';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function normalized(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}
function affirmative(value: string): boolean {
  return /^(sim|isso|isso mesmo|isso ai|correto|confirmo|pode ser|pode|exato|exatamente|certo|esta certo|esta correto)[.!,\s]*$/u.test(
    normalized(value),
  );
}
function explicitHuman(value: string): boolean {
  const text = normalized(value);
  return (
    !/\bnao (?:quero|preciso|desejo)\b/u.test(text) &&
    /\b(?:quero|preciso|desejo|prefiro|posso|pode|me)\b.{0,45}\b(?:humano|atendente|pessoa|equipe|transferir|encaminhar)\b/u.test(
      text,
    )
  );
}
function singleVehicle(value: string): boolean {
  return /^(?:nao\b|(?:quero |prefiro |sera |vai ser )?(?:so |somente |apenas )?(?:um|1) (?:onibus|veiculo))/u.test(
    normalized(value),
  );
}
function multipleVehicles(value: string): boolean {
  return /\b(?:mais de um|varios|dois|tres|quatro|cinco|[2-9]\d*) (?:onibus|veiculos)\b/u.test(
    normalized(value),
  );
}
function passengerNumber(
  message: string,
  patch: unknown,
  pending: Pending | null | undefined,
  passengerQuestion: boolean,
): number | undefined {
  // Only numbers explicitly about passengers, or a bare answer to a passenger question.
  const match = normalized(message).match(
    /(?<![\d.,])(-?\d{1,3}(?:\.\d{3})+|-?\d+(?:,\d+)?)(?:\s*)(?:pessoas|passageiros|passageiras)\b/u,
  );
  const bare =
    pending?.kind === 'passengers' ||
    pending?.kind === 'vehicles' ||
    passengerQuestion
      ? message.trim().match(/^\d+$/u)?.[0]
      : undefined;
  if (match || bare)
    return Number(
      (match?.[1] ?? bare ?? '').replaceAll('.', '').replace(',', '.'),
    );
  return typeof patch === 'number' && Number.isFinite(patch)
    ? patch
    : undefined;
}
function civilDate(value: string): string | null {
  const candidate = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(candidate)) return null;
  const parsed = new Date(candidate + 'T12:00:00Z');
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === candidate
    ? candidate
    : null;
}

@Injectable()
export class TourismIntakeReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: RouteLocationSearchProvider,
  ) {}

  async fleetContext(companyId: string): Promise<TourismFleetContext> {
    const rows = await this.prisma.transportFleet.groupBy({
      by: ['passengers'],
      where: { companyId, active: true, passengers: { gt: 0 } },
      _count: { _all: true },
      orderBy: { passengers: 'asc' },
    });
    const capacities = rows.flatMap((row) =>
      row.passengers && Number.isSafeInteger(row.passengers)
        ? [{ passengers: row.passengers, vehicles: row._count._all }]
        : [],
    );
    return {
      maximumPassengers: capacities.length
        ? Math.max(...capacities.map((row) => row.passengers))
        : 46,
      source: capacities.length ? 'fleet' : 'default',
      capacities,
    };
  }

  prompt(context: TourismFleetContext, referenceDate: string): string {
    return [
      'VALIDAÇÃO DO PEDIDO DE TURISMO — regras do servidor, antes de encaminhar ou apresentar resumo:',
      'Capacidades consultadas agora na frota ativa deste tenant: ' +
        JSON.stringify(context) +
        '. São lugares por veículo, nunca limite do grupo, nem garantia de disponibilidade. Sem capacidade cadastrada, o padrão autorizado é 46.',
      'Data de referência do atendimento: ' +
        referenceDate +
        '. Confirme datas passadas, impossíveis ou retorno anterior à ida antes de aceitar. Não invente outro ano.',
      'Grupos de qualquer tamanho podem viajar em vários veículos. Quando ultrapassar a maior capacidade por veículo, primeiro pergunte se o cliente considera mais de um veículo. Se disser que quer somente um, explique a capacidade consultada e confirme a quantidade. Não transfira só por causa de um número alto; pode ser erro de digitação. Respeite uma correção imediatamente. Nunca reduza a quantidade para caber em um limite técnico.',
      'Se a quantidade exceder 500, preserve o valor como candidato até confirmá-lo com o cliente; esse é um limite técnico do cadastro, não uma proibição de grupos maiores. Só depois da confirmação encaminhe a exceção comercial.',
      'A validação de origem/destino usa a busca da roteirização. Sugestões são candidatos, não prova de identidade. Peça cidade/UF quando o nome for ambíguo. Ausência de resultado ou indisponibilidade não prova inexistência. Nunca transforme Lua em nome do responsável porque o cliente disse “é para Lua”. Só altere contactName após uma correção explícita do nome.',
      'Na coleta inicial, cidade e estado bastam para origem e destino. Endereço, rua e ponto exato podem ficar a definir. Preserve a cidade já confirmada ao receber o destino; não peça nova confirmação por variação de grafia. Um não recusa a sugestão perguntada, não apaga outra informação confirmada. Se o endereço ainda não estiver definido, siga com a cidade conhecida. Nunca escolha uma rua só porque seu nome lembra a cidade.',
      'Se um local estiver customer-confirmed com routingValidationPending, a cidade foi confirmada pelo cliente e basta para continuar a coleta. Não pergunte novamente nem anuncie validação de mapa, distância ou trajeto. A conferência técnica permanece pendente para a equipe.',
      'Escreva em português brasileiro e revise a grafia antes de responder. Não misture alfabetos dentro de palavras portuguesas. Preserve nomes próprios informados pelo cliente, acentos e emojis.',
      'Não use o nome do cliente em toda mensagem. Evite bordões e eco de cada resposta; faça uma pergunta contextual por vez. Preserve o formato JSON do sistema.',
      'Se existe lumeTourismIntake.pending, resolva essa dúvida antes das outras perguntas; um sim responde à pergunta pendente, não confirma o orçamento inteiro. A API controla lumeTourismIntake; não escreva nessa chave.',
      'Pedido explícito de atendimento humano deve ser respeitado. Tamanho de grupo, lugar duvidoso e data incoerente não são pedidos explícitos de humano.',
    ].join('\n');
  }

  async review(
    input: WhatsAppConversationAgentInput,
    proposed: AiProviderOutput,
    fleet: TourismFleetContext,
    lastSentMessage?: string,
    inboundHistory: readonly string[] = [],
  ): Promise<AiProviderOutput> {
    const quote = input.currentConversation?.currentQuoteRequest;
    const active =
      input.aiMode === 'eventual-quote' ||
      input.aiMode === 'quote-correction-or-confirmation' ||
      (input.currentConversation?.department === 'commercial' &&
        (!quote || quote.status === 'collecting-information') &&
        (quote?.serviceType === 'eventual' ||
          proposed.extractedDataPatch.serviceType === 'eventual'));
    if (!active) return proposed;
    const patch = { ...proposed.extractedDataPatch };
    const stored = record(quote?.structuredData);
    const state = structuredClone(record(stored[STATE_KEY])) as IntakeState;
    const pending = state.pending;
    const structuredData = { ...stored, ...record(patch.structuredData) };
    // Model-generated metadata cannot clear or confirm the server's pending review.
    structuredData[STATE_KEY] = state;
    if (stored.intakeStartedAt)
      structuredData.intakeStartedAt = stored.intakeStartedAt;
    else delete structuredData.intakeStartedAt;
    patch.structuredData = structuredData;
    const answered = !!pending && lastSentMessage === pending.question;
    const yes = answered && affirmative(input.userMessage);
    const explicitCount = passengerNumber(
      input.userMessage,
      patch.passengerCount ??
        record(patch.structuredData).reportedPassengerCount,
      pending,
      /(?:quantas pessoas|quantos passageiros|quantidade.{0,25}(?:pessoas|passageiros))/u.test(
        normalized(lastSentMessage ?? ''),
      ),
    );
    const count =
      explicitCount ??
      (typeof pending?.value === 'number'
        ? pending.value
        : quote?.passengerCount);

    const tripAnswers = [...inboundHistory, input.userMessage].flatMap(
      (message) => {
        const text = normalized(message);
        if (
          /\b(?:so(?:mente)? ida|apenas ida|ida apenas|ida somente|so de ida)\b/u.test(
            text,
          )
        )
          return ['one_way'];
        if (
          /\bida e volta\b/u.test(text) &&
          !/\bnao\s+(?:(?:quero|sera|vai ser|precisa ser|e|faremos)\b[^,.!?]{0,30})?ida e volta\b/u.test(
            text,
          )
        )
          return ['round_trip'];
        return [];
      },
    );
    const tripType =
      tripAnswers.at(-1) ?? stored.tripType ?? structuredData.tripType;
    if (tripType) structuredData.tripType = tripType;
    const nextQuestion = (): string => {
      const merged = { ...quote, ...patch };
      if (!merged.contactName)
        return 'Qual é o nome do responsável pelo orçamento?';
      if (!tripType) return 'A viagem será somente ida ou ida e volta?';
      if (!merged.departureAt && !quote?.departureDate)
        return 'Qual é a data da viagem?';
      if (tripType === 'round_trip' && !merged.returnAt && !quote?.returnDate)
        return 'Qual é a data da volta?';
      if (!merged.origin) return 'De onde vocês vão sair?';
      if (!merged.destination) return 'Qual é o destino da viagem?';
      if (!merged.passengerCount) return 'Quantas pessoas vão viajar?';
      if (!merged.vehicleType)
        return 'Você tem preferência por algum tipo de veículo?';
      if (merged.vehicleAtDisposal == null)
        return 'O veículo precisa ficar à disposição de vocês no destino?';
      if (merged.localTransfers == null)
        return 'Haverá outros deslocamentos no destino?';
      return 'Há alguma observação adicional sobre a viagem?';
    };
    const malformedMessage = hasUnexpectedMixedAlphabetWord(proposed.message, [
      ...inboundHistory,
      input.userMessage,
      ...[
        quote?.contactName,
        quote?.origin,
        quote?.destination,
        quote?.vehicleType,
        quote?.notes,
      ].filter((value): value is string => typeof value === 'string'),
    ]);
    let locationQuestionResolved = false;
    let offlineLocationConfirmed = false;
    const proposedLocationField = locationQuestionField(proposed.message);
    const output = (): AiProviderOutput => ({
      ...proposed,
      extractedDataPatch: patch,
      missingFields: proposed.missingFields.filter(
        (field) =>
          !(
            (field === 'origin' || field === 'destination') &&
            collectedLocation(state.locations?.[field]?.status)
          ),
      ),
      ...((locationQuestionResolved ||
        (proposedLocationField &&
          collectedLocation(
            state.locations?.[proposedLocationField]?.status,
          ))) &&
      !proposed.summaryPresented &&
      locationQuestionField(proposed.message) &&
      (patch[locationQuestionField(proposed.message)!] ??
        quote?.[locationQuestionField(proposed.message)!])
        ? {
            message: nextQuestion(),
            collectionStatus: 'collecting',
            customerDecision: 'undecided',
            summaryPresented: false,
          }
        : {}),
      ...(tripType &&
      !proposed.summaryPresented &&
      proposed.collectionStatus === 'collecting' &&
      proposed.message.includes('?') &&
      /(?:somente ida|so ida|ida e volta|tipo de viagem)/u.test(
        normalized(proposed.message),
      ) &&
      !/\b(?:corrigir|correcao|mudar|alterar)\b/u.test(
        normalized(input.userMessage),
      )
        ? {
            message: nextQuestion(),
            collectionStatus: 'collecting',
            customerDecision: 'undecided',
            summaryPresented: false,
          }
        : {}),
      ...(offlineLocationConfirmed
        ? {
            message: nextQuestion(),
            collectionStatus: 'collecting',
            customerDecision: 'undecided',
            summaryPresented: false,
          }
        : {}),
      ...(malformedMessage && !offlineLocationConfirmed
        ? proposed.collectionStatus === 'human-handoff' ||
          proposed.customerDecision === 'human-requested'
          ? {
              message:
                'Vou encaminhar seu atendimento para nossa equipe dar continuidade.',
            }
          : {
              message: nextQuestion(),
              collectionStatus: 'collecting',
              customerDecision: 'undecided',
              summaryPresented: false,
            }
        : {}),
    });

    const ask = (
      next: Omit<Pending, 'question'>,
      question: string,
    ): AiProviderOutput => {
      // Keep the model's natural phrasing when it asks the required question safely.
      const natural =
        !malformedMessage &&
        proposed.collectionStatus === 'collecting' &&
        proposed.customerDecision === 'undecided' &&
        !proposed.summaryPresented &&
        (proposed.message.match(/\?/gu)?.length ?? 0) === 1 &&
        !/encaminh|transfer|comercial|atendente/u.test(
          normalized(proposed.message),
        );
      if (
        natural &&
        next.kind === 'vehicles' &&
        /(?:mais de um|varios|multiplos) veiculos?/u.test(
          normalized(proposed.message),
        )
      ) {
        question = proposed.message;
      }
      state.pending = { ...next, question };
      return {
        ...output(),
        message: question,
        collectionStatus: 'collecting',
        customerDecision: 'undecided',
        summaryPresented: false,
        missingFields: [...new Set([...output().missingFields, next.field])],
      };
    };
    const forward = (message: string): AiProviderOutput => {
      state.pending = null;
      return {
        ...output(),
        message,
        collectionStatus: 'human-handoff',
        customerDecision: 'human-requested',
        summaryPresented: false,
        targetDepartment: 'commercial',
      };
    };
    if (
      quote?.contactName &&
      patch.contactName !== quote.contactName &&
      !/\b(?:meu nome|me chamo|nome correto|corrig.{0,12}nome)\b/u.test(
        normalized(input.userMessage),
      )
    ) {
      delete patch.contactName;
    }
    if (
      count !== undefined &&
      count !== null &&
      (!Number.isSafeInteger(count) || count < 1 || count > 500)
    ) {
      delete patch.passengerCount;
    } else if (explicitCount !== undefined) {
      patch.passengerCount = explicitCount;
    }
    if (explicitHuman(input.userMessage)) return output();

    const reference = new Date(input.contextThrough ?? Date.now());
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(reference);
    const dateCandidates = {
      departureAt: patch.departureAt,
      returnAt: patch.returnAt,
    };
    for (const field of ['departureAt', 'returnAt'] as const) {
      if (typeof patch[field] === 'string') {
        const day = civilDate(String(patch[field]));
        if (!day || day < today) delete patch[field];
      }
    }
    for (const field of ['departureAt', 'returnAt'] as const) {
      const value =
        dateCandidates[field] ??
        (field === 'departureAt'
          ? (quote?.departureDate ?? quote?.departureAt)
          : (quote?.returnDate ?? quote?.returnAt)) ??
        (pending?.kind === 'date' && pending.field === field
          ? pending.value
          : undefined);
      if (typeof value !== 'string') continue;
      const day = civilDate(value);
      const departureValue =
        patch.departureAt ?? quote?.departureDate ?? quote?.departureAt;
      const departure =
        typeof departureValue === 'string' ? civilDate(departureValue) : null;
      const bad =
        !day ||
        day < today ||
        (field === 'returnAt' && departure && day < departure);
      if (!bad) continue;
      delete patch[field];
      if (yes && pending?.kind === 'date' && pending.value === value && day) {
        structuredData.confirmedDateException = { field, value };
        return forward(
          'Como essa data não corresponde a uma nova viagem futura, vou encaminhar o contexto à equipe para avaliar seu pedido.',
        );
      }
      return ask(
        { kind: 'date', field, value },
        !day
          ? 'Essa data não existe no calendário. Qual é a data correta da viagem?'
          : day < today
            ? 'A data informada, ' +
              day.split('-').reverse().join('/') +
              ', já passou. Você quis dizer essa data mesmo ou outra data para a viagem?'
            : 'A volta ficou antes da ida. Qual é a data correta do retorno?',
      );
    }
    if (pending?.kind === 'date') state.pending = null;

    const noAddress = undefinedStreetAddress(input.userMessage);
    const negative =
      answered && /^nao(?:[.!,\s]|$)/u.test(normalized(input.userMessage));
    const askedField = locationQuestionField(lastSentMessage ?? '');
    const priorLocations = { ...state.locations };
    const locationCandidates = {
      origin: typeof patch.origin === 'string' ? patch.origin : undefined,
      destination:
        typeof patch.destination === 'string' ? patch.destination : undefined,
    };
    for (const field of ['origin', 'destination'] as const) {
      const previous = state.locations?.[field];
      let candidate = locationCandidates[field];
      // Recover a repeated city from older unavailable sessions even if the model
      // does not emit the same patch a second time.
      if (
        !candidate &&
        answered &&
        pending?.kind === 'location' &&
        pending.field === field &&
        pending.phase === 'unavailable' &&
        sameLocation(input.userMessage, String(pending.value).split(',')[0])
      ) {
        candidate = String(pending.value);
        locationCandidates[field] = candidate;
      }
      // A response to the destination must not rewrite an already confirmed origin (or vice versa).
      const explicitField =
        field === 'origin'
          ? /\b(?:origem|saida|sairemos|sair|embarque)\b/u
          : /\b(?:destino|iremos|vamos para|desembarque)\b/u;
      if (
        (noAddress && quote?.[field]) ||
        (previous?.status === 'unverified' &&
          pending?.kind === 'location' &&
          pending.field === field &&
          pending.phase === 'candidate' &&
          sameLocation(previous.query, quote?.[field]) &&
          !sameLocation(previous.label, quote?.[field]) &&
          sameLocation(candidate, previous.label) &&
          !explicitField.test(normalized(input.userMessage))) ||
        (collectedLocation(previous?.status) &&
          askedField &&
          askedField !== field &&
          !explicitField.test(normalized(input.userMessage)))
      ) {
        candidate = undefined;
        locationCandidates[field] = undefined;
      }
      if (
        !candidate &&
        answered &&
        pending?.kind === 'location' &&
        pending.field === field &&
        pending.phase === 'offline-details'
      ) {
        const stateAnswer = locationSearchText('Cidade, ' + input.userMessage);
        if (
          /^Cidade, [A-Z]{2}$/u.test(stateAnswer) &&
          hasLocationState(stateAnswer)
        ) {
          candidate = String(pending.value) + ', ' + stateAnswer.split(', ')[1];
          locationCandidates[field] = candidate;
        } else if (hasLocationState(input.userMessage)) {
          candidate = input.userMessage.trim();
          locationCandidates[field] = candidate;
        }
      }
      delete patch[field];
      if (typeof candidate !== 'string' || !candidate.trim()) continue;
      if (
        !sameLocation(previous?.query, candidate) &&
        !sameLocation(previous?.label, candidate)
      ) {
        state.locations = {
          ...state.locations,
          [field]: {
            query: candidate,
            label: candidate,
            status: 'pending',
            rejected: previous?.rejected,
          },
        };
      }
    }
    for (const field of ['origin', 'destination'] as const) {
      let previous = state.locations?.[field];
      const fieldPending =
        pending?.kind === 'location' && pending.field === field
          ? pending
          : undefined;
      const candidate = locationCandidates[field];
      const value =
        candidate ??
        (fieldPending ? fieldPending.value : undefined) ??
        (previous?.status === 'pending' ? previous.query : undefined) ??
        quote?.[field];
      if (typeof value !== 'string' || !value.trim()) continue;

      // Repair old sessions where the former guard rechecked its own canonical label
      // and left an unrelated suggestion pending, despite a validated city in the quote.
      const staleRecheck =
        previous?.status === 'unverified' &&
        fieldPending?.phase === 'candidate' &&
        sameLocation(previous.query, quote?.[field]) &&
        !sameLocation(previous.label, quote?.[field]) &&
        (!candidate || sameLocation(candidate, quote?.[field]));
      if (staleRecheck) {
        previous = {
          query: quote![field]!,
          label: quote![field]!,
          status: 'matched',
          rejected: [
            ...new Set([...(previous?.rejected ?? []), previous!.label]),
          ],
        };
        state.locations = { ...state.locations, [field]: previous };
        state.pending = null;
        locationQuestionResolved = true;
      }
      if (
        previous &&
        collectedLocation(previous.status) &&
        (sameLocation(previous.query, value) ||
          sameLocation(previous.label, value))
      ) {
        patch[field] = previous.label;
        if (noAddress) previous.addressPending = true;
        if (fieldPending) {
          state.pending = null;
          locationQuestionResolved = true;
        }
        if (
          noAddress ||
          (candidate && locationQuestionField(proposed.message) === field)
        )
          locationQuestionResolved = true;
        continue;
      }

      if (
        yes &&
        fieldPending?.phase === 'offline-confirm' &&
        hasLocationState(String(fieldPending.value)) &&
        (!candidate || sameLocation(candidate, String(fieldPending.value)))
      ) {
        const label = String(fieldPending.value);
        patch[field] = label;
        state.locations = {
          ...state.locations,
          [field]: {
            query: label,
            label,
            status: 'customer-confirmed',
            routingValidationPending: true,
            rejected: previous?.rejected,
          },
        };
        state.pending = null;
        offlineLocationConfirmed = true;
        locationQuestionResolved = true;
        continue;
      }

      if (
        yes &&
        fieldPending &&
        (!candidate ||
          sameLocation(String(fieldPending.value), candidate) ||
          sameLocation(priorLocations[field]?.label, candidate))
      ) {
        if (fieldPending.phase === 'candidate' && previous?.label) {
          patch[field] = previous.label;
          state.locations = {
            ...state.locations,
            [field]: { ...previous, query: previous.label, status: 'matched' },
          };
          state.pending = null;
          locationQuestionResolved = true;
          continue;
        }
        if (fieldPending.phase === 'confirm') {
          structuredData.confirmedLocationException = { field, value };
          return forward(
            'Vou encaminhar esse local, com a sua confirmação, para a equipe conferir o trajeto.',
          );
        }
      }
      if (
        (negative || noAddress) &&
        fieldPending &&
        (!candidate ||
          sameLocation(candidate, String(fieldPending.value)) ||
          sameLocation(candidate, priorLocations[field]?.label))
      ) {
        state.locations = {
          ...state.locations,
          [field]: {
            query: value,
            label: value,
            status: 'needs-city',
            rejected: [
              ...new Set([
                ...(previous?.rejected ?? []),
                ...(previous?.label ? [previous.label] : []),
              ]),
            ],
            addressPending: noAddress,
          },
        };
        return ask(
          { kind: 'location', field, value, phase: 'city-needed' },
          (noAddress
            ? 'O endereço exato pode ficar para depois. '
            : 'Desconsiderei essa sugestão. ') +
            (field === 'origin'
              ? 'Qual é a cidade e o estado de saída?'
              : 'Qual é a cidade e o estado do destino?'),
        );
      }
      const askWithoutRouting = (): AiProviderOutput => {
        const complete = hasLocationState(value);
        state.locations = {
          ...state.locations,
          [field]: {
            query: value,
            label: value,
            status: 'unverified',
            routingValidationPending: true,
            rejected: previous?.rejected,
          },
        };
        return ask(
          {
            kind: 'location',
            field,
            value,
            phase: complete ? 'offline-confirm' : 'offline-details',
          },
          complete
            ? (field === 'origin' ? 'A saída será de ' : 'O destino será ') +
                locationSearchText(value) +
                '?'
            : 'Em qual estado fica ' + value + '?',
        );
      };
      // Upgrade old unavailable prompts and keep handling a known outage locally.
      // A confirmation is about the city, never about the whole quote or route.
      if (
        fieldPending &&
        ['unavailable', 'offline-details', 'offline-confirm'].includes(
          fieldPending.phase ?? '',
        )
      ) {
        return askWithoutRouting();
      }
      if (fieldPending && !candidate && !yes && !staleRecheck) {
        return ask(fieldPending, fieldPending.question);
      }

      let suggestions;
      try {
        suggestions = await this.locations.searchLocations(
          locationSearchText(value).slice(0, 300),
        );
      } catch {
        return askWithoutRouting();
      }
      const uniqueLabels = [
        ...new Map(
          suggestions
            .filter(
              (item) =>
                !previous?.rejected?.some((rejected) =>
                  sameLocation(rejected, item.label),
                ),
            )
            .map((item) => [locationIdentity(item.label), item]),
        ).values(),
      ];
      const exact = uniqueLabels.filter((item) =>
        sameLocation(item.label, value),
      );
      if (exact.length === 1) {
        patch[field] = exact[0].label;
        state.locations = {
          ...state.locations,
          [field]: {
            query: value,
            label: exact[0].label,
            status: 'matched',
            rejected: previous?.rejected,
          },
        };
        if (fieldPending) {
          state.pending = null;
          locationQuestionResolved = true;
        }
        continue;
      }
      // Autocomplete ranking is not evidence of identity. Never pick the first of
      // several places merely because the customer already answered a clarification.
      const label =
        uniqueLabels.length === 1 ? uniqueLabels[0].label : undefined;
      state.locations = {
        ...state.locations,
        [field]: {
          query: value,
          label: label ?? value,
          status: 'unverified',
          rejected: previous?.rejected,
        },
      };
      if (label) {
        return ask(
          { kind: 'location', field, value, phase: 'candidate' },
          'Você se refere a ' +
            label +
            (field === 'origin' ? ' como local de saída?' : ' como destino?'),
        );
      }
      if (uniqueLabels.length > 1) {
        return ask(
          { kind: 'location', field, value, phase: 'details' },
          'Encontrei mais de um local com esse nome. Qual é a cidade e o estado ' +
            (field === 'origin' ? 'da saída?' : 'do destino?'),
        );
      }
      const confirmedDetails =
        fieldPending?.phase === 'details' &&
        !!candidate &&
        !sameLocation(candidate, String(fieldPending.value));
      return ask(
        {
          kind: 'location',
          field,
          value,
          phase: confirmedDetails ? 'confirm' : 'details',
        },
        confirmedDetails
          ? 'Só para confirmar antes de pedir à equipe que confira o trajeto: ' +
              value +
              ' é o local correto, com a cidade e o estado?'
          : 'Qual é a cidade e o estado de ' +
              value +
              '? Se for um sítio, bairro ou ponto de referência, pode me dizer também.',
      );
    }

    if (count !== undefined && count !== null) {
      if (state.plannedPassengerCount !== count) {
        state.multipleVehicles = undefined;
        state.plannedPassengerCount = count;
        if (pending?.kind === 'vehicles' || pending?.kind === 'passengers')
          state.pending = null;
      }
      if (multipleVehicles(input.userMessage)) state.multipleVehicles = true;
      if (
        /\b(?:so|somente|apenas|prefiro|quero) (?:um|1) (?:veiculo|onibus)\b/u.test(
          normalized(input.userMessage),
        )
      )
        state.multipleVehicles = false;
      if (count > fleet.maximumPassengers) {
        if (
          answered &&
          pending?.kind === 'vehicles' &&
          pending.value === count
        ) {
          if (yes) state.multipleVehicles = true;
          else if (singleVehicle(input.userMessage))
            state.multipleVehicles = false;
        }
        if (state.multipleVehicles === undefined) {
          return ask(
            { kind: 'vehicles', field: 'passengerCount', value: count },
            'Para esse grupo, você considera usar mais de um veículo?',
          );
        }
        if (state.multipleVehicles === false) {
          if (
            yes &&
            pending?.kind === 'passengers' &&
            pending.value === count
          ) {
            structuredData.confirmedCapacityException = {
              passengers: count,
              maximumPerVehicle: fleet.maximumPassengers,
              multipleVehicles: false,
            };
            return forward(
              'Essa quantidade ultrapassa a capacidade de um único veículo. Vou encaminhar o contexto à equipe para avaliar alternativas com você.',
            );
          }
          return ask(
            { kind: 'passengers', field: 'passengerCount', value: count },
            'A maior capacidade ' +
              (fleet.source === 'fleet' ? 'cadastrada' : 'de referência') +
              ' é de ' +
              fleet.maximumPassengers +
              ' passageiros por veículo. Seriam mesmo ' +
              count.toLocaleString('pt-BR') +
              ' pessoas ou você quer corrigir a quantidade?',
          );
        }
      }
      if (!Number.isSafeInteger(count) || count < 1 || count > 500) {
        if (
          yes &&
          pending?.kind === 'passengers' &&
          pending.value === count &&
          count > 500
        ) {
          structuredData.confirmedPassengerException = {
            passengers: count,
            multipleVehicles: state.multipleVehicles,
          };
          return forward(
            'Com essa quantidade confirmada, vou encaminhar o pedido à equipe para planejar os veículos necessários.',
          );
        }
        return ask(
          { kind: 'passengers', field: 'passengerCount', value: count },
          count < 1
            ? 'Quantas pessoas vão viajar?'
            : 'Antes de prosseguir: são ' +
                count.toLocaleString('pt-BR') +
                ' passageiros mesmo ou houve algum erro na quantidade?',
        );
      }
      if (pending?.kind === 'vehicles' || pending?.kind === 'passengers') {
        state.pending = null;
        // Answering a capacity question is not confirmation of the entire quote.
        if (
          proposed.collectionStatus === 'ready-for-summary' &&
          proposed.summaryPresented
        ) {
          return { ...output(), customerDecision: 'undecided' };
        }
        return {
          ...output(),
          collectionStatus: 'collecting',
          customerDecision: 'undecided',
          summaryPresented: false,
          message: nextQuestion(),
        };
      }
    }
    if (
      pending &&
      state.pending === null &&
      (proposed.customerDecision === 'confirmed' ||
        proposed.collectionStatus === 'human-handoff' ||
        proposed.customerDecision === 'human-requested')
    ) {
      return {
        ...output(),
        message: nextQuestion(),
        collectionStatus: 'collecting',
        customerDecision: 'undecided',
        summaryPresented: false,
      };
    }
    const reviewed = output();
    if (
      reviewed.summaryPresented &&
      reviewed.collectionStatus === 'ready-for-summary'
    ) {
      return {
        ...reviewed,
        message: formatTourismQuoteSummary({ ...quote, ...patch }),
      };
    }
    return reviewed;
  }
}
