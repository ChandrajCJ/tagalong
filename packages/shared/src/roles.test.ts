import { describe, expect, it } from 'vitest';
import { hasRole } from './roles';
import { CreateTripInput } from './schemas/trips';

describe('hasRole', () => {
  it('ranks owner above editor above viewer', () => {
    expect(hasRole('owner', 'editor')).toBe(true);
    expect(hasRole('editor', 'editor')).toBe(true);
    expect(hasRole('viewer', 'editor')).toBe(false);
  });
});

describe('CreateTripInput', () => {
  it('fills in defaults', () => {
    const trip = CreateTripInput.parse({ name: 'Porto', destination: 'Porto, Portugal' });
    expect(trip.baseCurrency).toBe('EUR');
    expect(trip.coverColor).toBe('#D8A47F');
  });
});
