import { describe, it, expect } from 'vitest';
import { hasUnexpectedMixedAlphabetWord } from './customer-message-text';

describe('mixed-alphabet generated words', () => {
  it.each([
    'Há alguma observação დამატicional sobre a viagem?',
    'Algum detalhe аdicional?', // Cyrillic first character.
    'Confirme o númerო de passageiros.',
    'Quantos passageiros irão viajar დაახლოებით?',
    'Há alguma observação დამატებითი sobre a viagem?',
  ])('detects malformed generated text: %s', (message) => {
    expect(hasUnexpectedMixedAlphabetWord(message, [])).toBe(true);
  });
  it.each([
    'Há alguma observação adicional sobre a viagem? 😊',
    'São João, Jataí e Uberlândia — 150 passageiros 🚌',
    'Observac\u0327a\u0303o sobre a viagem?',
  ])('preserves legitimate Unicode: %s', (message) => {
    expect(hasUnexpectedMixedAlphabetWord(message, [])).toBe(false);
  });
  it('preserves mixed-script names actually supplied by the customer', () => {
    expect(
      hasUnexpectedMixedAlphabetWord('A saída será do Hotel McДональд?', [
        'Vamos sair do Hotel McДональд.',
      ]),
    ).toBe(false);
  });
});

it('preserves non-Latin place names only when present in the customer context', () => {
  expect(
    hasUnexpectedMixedAlphabetWord('Vamos ao restaurante 東京?', [
      'O destino é o restaurante 東京.',
    ]),
  ).toBe(false);
  expect(hasUnexpectedMixedAlphabetWord('Vamos ao restaurante 東京?', [])).toBe(
    true,
  );
});
