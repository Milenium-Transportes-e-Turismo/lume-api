import { describe, expect, it } from 'vitest';
import {
  sameLocation,
  locationSearchText,
  undefinedStreetAddress,
} from './tourism-location-identity';
describe('location identity', () => {
  it.each([
    ['Uberlândia, Minas Gerais', 'Uberlandia, MG, Brasil'],
    ['Jataí, Goiás', 'Jatai, GO, Brazil'],
    ['São Paulo, São Paulo', 'Sao Paulo, SP, Brasil'],
    ['Rio de Janeiro, Rio de Janeiro', 'Rio de Janeiro, RJ, Brasil'],
  ])('normalizes %s and %s without confusing a street with a city', (a, b) => {
    expect(sameLocation(a, b)).toBe(true);
    expect(sameLocation('Rua ' + a, b)).toBe(false);
  });
  it('does not abbreviate a city named after a state', () => {
    expect(locationSearchText('São Paulo')).toBe('São Paulo');
    expect(locationSearchText('Uberlândia, Minas Gerais, Brasil')).toBe(
      'Uberlândia, MG',
    );
  });
  it.each([
    'Não tenho endereço definido ainda.',
    'Ainda não sei a rua.',
    'O endereço está a definir.',
  ])('understands optional address: %s', (message) =>
    expect(undefinedStreetAddress(message)).toBe(true),
  );
  it.each([
    'Não é Uberlândia',
    'A origem é Uberaba',
    'Sim',
    'Não tenho destino definido',
  ])('does not confuse city changes with optional street: %s', (message) =>
    expect(undefinedStreetAddress(message)).toBe(false),
  );
});
