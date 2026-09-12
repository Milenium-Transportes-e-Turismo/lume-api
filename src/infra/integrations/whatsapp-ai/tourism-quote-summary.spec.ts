import { describe, expect, it } from 'vitest';
import { formatTourismQuoteSummary } from './tourism-quote-summary';

describe('readable WhatsApp quote summary', () => {
  const quote = {
    contactName: 'Cliente',
    origin: 'Jataí/GO',
    destination: 'Uberlândia/MG',
    departureDate: '2026-09-12',
    returnDate: '2026-09-20',
    passengerCount: 15,
    vehicleType: 'Sem preferência',
    vehicleAtDisposal: true,
    localTransfers: true,
    notes: null,
    structuredData: {
      tripType: 'round_trip',
      notesAnswered: true,
      transferDetails: 'Passaremos em Goiânia, Caldas Novas e Araguari.',
    },
  };
  it('renders dates, locations, answers and itinerary on separate lines without losing details', () => {
    const result = formatTourismQuoteSummary(quote);
    expect(result).toContain('• *Saída:* 12/09/2026 (horário não informado)\n');
    expect(result).toContain(
      '• *Retorno:* 20/09/2026 (horário não informado)\n',
    );
    expect(result).toContain(
      '• *Origem:* Jataí/GO\n• *Destino:* Uberlândia/MG',
    );
    expect(result).toContain(
      '• *Trajeto e deslocamentos informados:* Passaremos em Goiânia, Caldas Novas e Araguari.\n',
    );
    expect(result).toContain(
      '• *Observações:* Nenhuma observação.\n\nOs dados estão corretos para solicitar o orçamento?',
    );
    expect(
      result.split('\n').filter((line) => line.startsWith('• ')),
    ).toHaveLength(12);
  });
  it('omits return for one-way, preserves multiple vehicles and unknown details', () => {
    const result = formatTourismQuoteSummary({
      ...quote,
      structuredData: {
        tripType: 'one_way',
        notesAnswered: true,
        lumeTourismIntake: { multipleVehicles: true },
      },
    });
    expect(result).not.toContain('*Retorno:*');
    expect(result).toContain('• *Mais de um veículo:* Sim');
    expect(result).toContain('• *Detalhes dos deslocamentos:* A definir');
  });
  it('formats provided times in the operational timezone and prefers a corrected instant', () => {
    const result = formatTourismQuoteSummary({
      ...quote,
      departureAt: '2026-09-14T01:30:00Z',
    });
    expect(result).toContain('• *Saída:* 13/09/2026 às 22:30');
  });
  it('does not invent missing values or treat unknown answers as no', () => {
    const result = formatTourismQuoteSummary({});
    expect(result).toContain('• *Veículo à disposição:* A definir');
    expect(result).toContain('• *Passageiros:* Não informado');
    expect(result).toContain('• *Observações:* A definir');
  });
});
