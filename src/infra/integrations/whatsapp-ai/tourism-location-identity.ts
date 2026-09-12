const states: Record<string, string> = {
  acre: 'AC',
  alagoas: 'AL',
  amapa: 'AP',
  amazonas: 'AM',
  bahia: 'BA',
  ceara: 'CE',
  'distrito federal': 'DF',
  'espirito santo': 'ES',
  goias: 'GO',
  maranhao: 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  para: 'PA',
  paraiba: 'PB',
  parana: 'PR',
  pernambuco: 'PE',
  piaui: 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  rondonia: 'RO',
  roraima: 'RR',
  'santa catarina': 'SC',
  'sao paulo': 'SP',
  sergipe: 'SE',
  tocantins: 'TO',
};

// Normalize only a trailing state, never a city with the same name (São Paulo).
export function locationSearchText(value: string): string {
  const text = value
    .trim()
    .replace(/(?:,\s*|\s+)(?:brasil|brazil)\s*$/iu, '')
    .trim();
  const parts = text.split(',').map((part) => part.trim());
  if (parts.length > 1) {
    const state = parts
      .at(-1)!
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
    parts[parts.length - 1] = states[state] ?? parts.at(-1)!;
  }
  return parts.join(', ');
}
export function locationIdentity(value: string): string {
  return locationSearchText(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[,.-]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
export function sameLocation(
  first: string | undefined | null,
  second: string | undefined | null,
): boolean {
  return (
    !!first && !!second && locationIdentity(first) === locationIdentity(second)
  );
}
export function locationQuestionField(
  message: string,
): 'origin' | 'destination' | undefined {
  if (!message.includes('?')) return undefined;
  const text = message.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const origin = /\b(?:origem|saida|sair|saem|embarque)\b/u.test(text);
  const destination = /\b(?:destino|destinacao|desembarque)\b/u.test(text);
  return origin === destination ? undefined : origin ? 'origin' : 'destination';
}
export function undefinedStreetAddress(message: string): boolean {
  const text = message.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return (
    /\b(?:nao (?:tenho|tem|temos|sei|sabemos|defini|definimos)|ainda nao|sem)\b.{0,45}\b(?:endereco|rua|local exato|ponto exato)\b/u.test(
      text,
    ) ||
    /\b(?:endereco|rua|local exato|ponto exato)\b.{0,30}\b(?:indefinido|nao definid[oa]|a definir|nao sei)\b/u.test(
      text,
    )
  );
}

// This checks completeness only; it is never evidence that a place exists.
export function hasLocationState(value: string): boolean {
  const text = locationSearchText(value);
  const state = text.match(/(?:,|\s|-)\s*([A-Z]{2})$/iu)?.[1]?.toUpperCase();
  return !!state && Object.values(states).includes(state);
}
