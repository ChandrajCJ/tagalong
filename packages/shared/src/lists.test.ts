import { describe, expect, it } from 'vitest';
import { everyoneProgress, isDoneFor, listsSummary, openTodosByItem, suggestPacking, type PackingContext } from './lists';
import type { ListItem } from './schemas/lists';

const ME = '00000000-0000-7000-8000-000000000001';
const SAM = '00000000-0000-7000-8000-000000000002';
const PRIYA = '00000000-0000-7000-8000-000000000003';
const GONE = '00000000-0000-7000-8000-000000000009';

let n = 0;
const line = (over: Partial<ListItem>): ListItem => ({
  id: `00000000-0000-7000-8000-1000000000${String(n++).padStart(2, '0')}`,
  listId: 'packing',
  tripId: 't',
  text: 'Thing',
  scope: 'shared',
  assigneeId: null,
  dueDate: null,
  itemId: null,
  doneBy: null,
  doneAt: null,
  checkedBy: [],
  position: 'a0',
  createdBy: ME,
  version: 1,
  updatedAt: '2026-10-01T00:00:00Z',
  ...over,
});

const day = (over: Partial<PackingContext['weather'][number]> = {}) => ({
  minC: 15,
  maxC: 24,
  code: 1,
  rainChance: 10,
  rainMm: null,
  ...over,
});
const texts = (ctx: PackingContext, existing?: string[]) => suggestPacking(ctx, existing).map((s) => s.text);

describe('ticks', () => {
  it('counts a shared line once for the group, and an everyone line per person', () => {
    expect(isDoneFor(line({ doneAt: '2026-10-01T00:00:00Z', doneBy: SAM }), ME)).toBe(true);
    expect(isDoneFor(line({ scope: 'everyone', checkedBy: [SAM] }), ME)).toBe(false);
    expect(isDoneFor(line({ scope: 'everyone', checkedBy: [SAM, ME] }), ME)).toBe(true);
  });

  it('says how many have packed, and who hasn’t', () => {
    const p = everyoneProgress(line({ scope: 'everyone', checkedBy: [ME, SAM] }), [ME, SAM, PRIYA]);
    expect(p).toEqual({ checked: 2, total: 3, waitingFor: [PRIYA] });
  });

  it('ignores ticks from someone who left the trip', () => {
    const p = everyoneProgress(line({ scope: 'everyone', checkedBy: [GONE, ME] }), [ME, SAM]);
    expect(p).toEqual({ checked: 1, total: 2, waitingFor: [SAM] });
  });

  it('sums up packing and open to-dos from where you stand', () => {
    const lists = [
      { id: 'packing', kind: 'packing' as const },
      { id: 'todo', kind: 'todo' as const },
    ];
    const items = [
      line({ scope: 'everyone', checkedBy: [ME] }),
      line({ scope: 'everyone', checkedBy: [SAM] }),
      line({ doneAt: '2026-10-01T00:00:00Z' }),
      line({ listId: 'todo', itemId: 'sintra' }),
      line({ listId: 'todo', itemId: 'sintra' }),
      line({ listId: 'todo', itemId: 'belem', doneAt: '2026-10-01T00:00:00Z' }),
    ];
    expect(listsSummary(lists, items, ME)).toEqual({ packed: 2, packingTotal: 3, todosLeft: 2, todosTotal: 3 });
    expect([...openTodosByItem(lists, items, ME)]).toEqual([['sintra', 2]]);
  });
});

describe('suggestPacking', () => {
  it('always offers the basics, with passports per person and a first-aid kit for the group', () => {
    const s = suggestPacking({ weather: [], places: [] });
    expect(s.find((x) => x.text === 'Passport or ID')?.scope).toBe('everyone');
    expect(s.find((x) => x.text === 'First-aid kit')?.scope).toBe('shared');
    expect(s.map((x) => x.text)).not.toContain('Umbrella');
  });

  it('adds an umbrella when rain is likely, by chance, amount or weather code', () => {
    expect(texts({ weather: [day(), day({ rainChance: 60 })], places: [] })).toContain('Umbrella');
    expect(texts({ weather: [day({ rainChance: null, rainMm: 5 })], places: [] })).toContain('Umbrella');
    expect(texts({ weather: [day({ code: 63, rainChance: null })], places: [] })).toContain('Umbrella');
    expect(texts({ weather: [day({ rainChance: 30 })], places: [] })).not.toContain('Umbrella');
  });

  it('adds warm layers under 10 °C, and gloves below freezing', () => {
    const cool = suggestPacking({ weather: [day({ minC: 6.4 })], places: [] });
    expect(cool.find((s) => s.text === 'Warm layers')?.reason).toBe('Down to 6 °C');
    expect(cool.map((s) => s.text)).not.toContain('Gloves and a warm hat');
    expect(texts({ weather: [day({ minC: -3 })], places: [] })).toContain('Gloves and a warm hat');
    expect(texts({ weather: [day({ minC: 10 })], places: [] })).not.toContain('Warm layers');
  });

  it('adds sun things on hot days', () => {
    expect(texts({ weather: [day({ maxC: 33 })], places: [] })).toEqual(expect.arrayContaining(['Sunscreen', 'Sunglasses']));
  });

  it('adds swimwear near beaches, walking shoes for hikes, and covered clothes for temples', () => {
    expect(texts({ weather: [], places: ['Beach', 'Museum'] })).toContain('Swimwear');
    expect(texts({ weather: [], places: ['Hike to Dudhsagar falls'] })).toContain('Walking shoes');
    expect(texts({ weather: [], places: ['Shri Mangueshi Temple'] })).toContain('Clothes that cover shoulders and knees');
    expect(texts({ weather: [], places: ['Beachside café'] })).not.toContain('Swimwear');
  });

  it('leaves out what’s already on the list, ignoring case', () => {
    const s = texts({ weather: [day({ rainChance: 80 })], places: [] }, ['umbrella ', 'PASSPORT OR ID']);
    expect(s).not.toContain('Umbrella');
    expect(s).not.toContain('Passport or ID');
    expect(s).toContain('Rain jacket');
  });
});
