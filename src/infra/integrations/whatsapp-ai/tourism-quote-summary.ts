function text(value: unknown, fallback = 'Não informado'): string {
  return typeof value === 'string' && value.trim()
    ? value.replace(/\s+/gu, ' ').trim()
    : fallback;
}

function dateLabel(
  instant: unknown,
  civilDate: unknown,
  timeProvided: unknown,
): string {
  const value = typeof instant === 'string' && instant ? instant : civilDate;
  if (typeof value !== 'string' || !value) return 'Não informada';
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)} (horário não informado)`;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Não informada';
  const day = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  }).format(date);
  if (timeProvided === false) return `${day} (horário não informado)`;
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return `${day} às ${time}`;
}

/** Presentation only: all values come from this quote and its reviewed patch. */
export function formatTourismQuoteSummary(
  quote: Readonly<Record<string, unknown>>,
): string {
  const data =
    quote.structuredData && typeof quote.structuredData === 'object'
      ? (quote.structuredData as Record<string, unknown>)
      : {};
  const intake =
    data.lumeTourismIntake && typeof data.lumeTourismIntake === 'object'
      ? (data.lumeTourismIntake as Record<string, unknown>)
      : {};
  const yesNo = (value: unknown) =>
    value === true ? 'Sim' : value === false ? 'Não' : 'A definir';
  const lines = [
    '*Resumo do pedido*',
    '',
    `• *Responsável:* ${text(quote.contactName)}`,
    `• *Viagem:* ${data.tripType === 'one_way' ? 'Somente ida' : data.tripType === 'round_trip' ? 'Ida e volta' : 'Não informada'}`,
    `• *Saída:* ${dateLabel(quote.departureAt, quote.departureDate, data.departureTimeProvided)}`,
  ];
  if (data.tripType !== 'one_way')
    lines.push(
      `• *Retorno:* ${dateLabel(quote.returnAt, quote.returnDate, data.returnTimeProvided)}`,
    );
  lines.push(
    `• *Origem:* ${text(quote.origin)}`,
    `• *Destino:* ${text(quote.destination)}`,
    `• *Passageiros:* ${typeof quote.passengerCount === 'number' ? quote.passengerCount : 'Não informado'}`,
    `• *Tipo de veículo:* ${text(quote.vehicleType, 'A definir')}`,
  );
  if (typeof intake.multipleVehicles === 'boolean')
    lines.push(`• *Mais de um veículo:* ${yesNo(intake.multipleVehicles)}`);
  lines.push(
    `• *Veículo à disposição:* ${yesNo(quote.vehicleAtDisposal)}`,
    `• *Deslocamentos adicionais:* ${yesNo(quote.localTransfers)}`,
  );
  if (typeof data.transferDetails === 'string' && data.transferDetails.trim()) {
    lines.push(
      `• *Trajeto e deslocamentos informados:* ${text(data.transferDetails)}`,
    );
  } else if (quote.localTransfers === true) {
    lines.push('• *Detalhes dos deslocamentos:* A definir');
  }
  lines.push(
    `• *Observações:* ${text(quote.notes, data.notesAnswered === true ? 'Nenhuma observação.' : 'A definir')}`,
    '',
    'Os dados estão corretos para solicitar o orçamento?',
  );
  return lines.join('\n');
}
