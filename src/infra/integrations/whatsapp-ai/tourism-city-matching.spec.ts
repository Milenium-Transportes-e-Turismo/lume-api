import { describe, it, expect } from 'vitest';
import {
  matchingCities,
  locationSearchText,
} from './tourism-location-identity';
describe('municipality matching', () => {
  const city = (region: string) => ({
    id: region,
    name: 'Bom Jesus',
    layer: 'locality',
    region,
    label: 'raw',
  });
  it('preserves real ambiguity and resolves explicit state', () => {
    const items = [city('Piauí'), city('Rio Grande do Sul')];
    expect(matchingCities(items, 'Bom Jesus')).toHaveLength(2);
    expect(matchingCities(items, 'Bom Jesus RS')).toHaveLength(1);
  });
  it('does not accept a street or approximate city match', () => {
    expect(
      matchingCities([{ ...city('Piauí'), layer: 'street' }], 'Bom Jesus'),
    ).toHaveLength(0);
    expect(matchingCities([city('Piauí')], 'Bom')).toHaveLength(0);
  });
});

it.each(['Porto Velho RO', 'Porto Velho/RO', 'Porto Velho Rondônia'])(
  'normalizes the provider query %s',
  (value) => {
    expect(locationSearchText(value)).toBe('Porto Velho, RO');
  },
);
it('preserves a city whose name is also a state', () => {
  expect(locationSearchText('São Paulo')).toBe('São Paulo');
  expect(locationSearchText('Rio de Janeiro')).toBe('Rio de Janeiro');
});
