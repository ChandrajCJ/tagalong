import { describe, expect, it } from 'vitest';
import { countdownMessage, countdownStage } from './countdown';
import { escapeText, foldLine, icsCalendar, zoneTransitions } from './ics';

const unfold = (ics: string) => ics.replace(/\r\n /g, '');

describe('the calendar writer', () => {
  const event = {
    uid: 'item-1@tagalong',
    sequence: 3,
    stamp: '2026-10-20T10:00:00Z',
    summary: 'Lunch',
    start: { date: '2026-10-23', time: '13:00', tz: 'Europe/Lisbon' },
    end: { date: '2026-10-23', time: '14:30', tz: 'Europe/Lisbon' },
  };

  it('writes a timed stop on its place’s clock, with a stable UID and the version as SEQUENCE', () => {
    const ics = icsCalendar({ name: 'Tagalong', events: [event] });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('\r\nUID:item-1@tagalong\r\nSEQUENCE:3\r\nDTSTAMP:20261020T100000Z\r\n');
    expect(ics).toContain('DTSTART;TZID=Europe/Lisbon:20261023T130000');
    expect(ics).toContain('DTEND;TZID=Europe/Lisbon:20261023T143000');
    expect(ics.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
  });

  it('describes the zone’s summer and winter time in a VTIMEZONE', () => {
    const ics = icsCalendar({ name: 'Tagalong', events: [event] });
    const zone = ics.slice(ics.indexOf('BEGIN:VTIMEZONE'), ics.indexOf('END:VTIMEZONE'));
    expect(zone).toContain('TZID:Europe/Lisbon');
    // Clocks go forward on 29 March 2026 at 01:00 and back on 25 October at 02:00.
    expect(zone).toContain('BEGIN:DAYLIGHT\r\nDTSTART:20260329T010000\r\nTZOFFSETFROM:+0000\r\nTZOFFSETTO:+0100');
    expect(zone).toContain('BEGIN:STANDARD\r\nDTSTART:20261025T020000\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0000');
  });

  it('gives a zone without daylight saving one observance', () => {
    expect(zoneTransitions('Asia/Kolkata', 2026, 2026).changes).toEqual([]);
    const ics = icsCalendar({ name: 'Goa', events: [{ ...event, start: { date: '2026-12-20', time: '09:00', tz: 'Asia/Kolkata' }, end: null }] });
    expect(ics).toContain('TZOFFSETFROM:+0530\r\nTZOFFSETTO:+0530');
    expect(ics).not.toContain('DTEND');
  });

  it('writes all-day items with an end the day after, and exact instants in UTC', () => {
    const ics = icsCalendar({
      name: 'Tagalong',
      events: [
        { ...event, uid: 'trip-1@tagalong', start: { date: '2026-10-22' }, end: { date: '2026-10-29' } },
        { ...event, uid: 'booking-1@tagalong', start: { instant: '2026-10-22T08:15:00+05:30' }, end: { instant: '2026-10-22T09:30:00+05:30' } },
      ],
    });
    expect(ics).toContain('DTSTART;VALUE=DATE:20261022\r\nDTEND;VALUE=DATE:20261030');
    expect(ics).toContain('DTSTART:20261022T024500Z\r\nDTEND:20261022T040000Z');
  });

  it('escapes text and folds long lines without splitting a character', () => {
    expect(escapeText('Fish, chips; and\\more\nlater')).toBe('Fish\\, chips\\; and\\\\more\\nlater');
    const long = `DESCRIPTION:${'é'.repeat(60)}`;
    const folded = foldLine(long);
    const encoder = new TextEncoder();
    for (const line of folded.split('\r\n')) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.split('\r\n').slice(1).every((l) => l.startsWith(' '))).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(long);
    const ics = icsCalendar({ name: 'Tagalong', events: [{ ...event, location: 'Time Out Market, Av. 24 de Julho 49, Lisbon', description: 'Book a table; ask for the terrace' }] });
    expect(unfold(ics)).toContain('LOCATION:Time Out Market\\, Av. 24 de Julho 49\\, Lisbon');
    expect(unfold(ics)).toContain('DESCRIPTION:Book a table\\; ask for the terrace');
  });
});

describe('countdown pushes', () => {
  it('picks the stage by days left and the person’s own hour', () => {
    expect(countdownStage('2026-10-27', { date: '2026-10-20', time: '08:59' })).toBeNull();
    expect(countdownStage('2026-10-27', { date: '2026-10-20', time: '09:00' })).toBe('week');
    expect(countdownStage('2026-10-23', { date: '2026-10-20', time: '21:30' })).toBe('three');
    expect(countdownStage('2026-10-21', { date: '2026-10-20', time: '18:00' })).toBeNull();
    expect(countdownStage('2026-10-21', { date: '2026-10-20', time: '19:05' })).toBe('eve');
    expect(countdownStage('2026-10-20', { date: '2026-10-20', time: '08:00' })).toBe('day');
    expect(countdownStage('2026-10-25', { date: '2026-10-20', time: '12:00' })).toBeNull();
  });

  const readiness = { packed: 4, packingTotal: 18, todosOpen: 2 };

  it('says a week out only when something is open', () => {
    expect(countdownMessage('week', { tripName: 'Goa', readiness })).toEqual({
      body: 'A week to Goa! 2 to-dos still open · 14 items to pack.',
      opens: 'lists',
    });
    expect(countdownMessage('week', { tripName: 'Goa', readiness: { packed: 3, packingTotal: 3, todosOpen: 1 } })!.body).toBe(
      'A week to Goa! 1 to-do still open.',
    );
    expect(countdownMessage('week', { tripName: 'Goa', readiness: { packed: 3, packingTotal: 3, todosOpen: 0 } })).toBeNull();
  });

  it('counts down with the packing, the weather and the first thing on the day', () => {
    expect(countdownMessage('three', { tripName: 'Goa', readiness })!.body).toBe('3 days to go · 14 items to pack.');
    expect(
      countdownMessage('eve', { tripName: 'Goa', readiness: { ...readiness, packed: 14 }, weather: { maxC: 31, minC: 24, rainChance: 70 } }),
    ).toEqual({ body: 'Tomorrow: Goa · weather 31°/24°, rain likely · 4 items to pack', opens: 'lists' });
    expect(countdownMessage('eve', { tripName: 'Goa', readiness: { ...readiness, packed: 18 } })).toEqual({ body: 'Tomorrow: Goa', opens: 'trip' });
    expect(countdownMessage('day', { tripName: 'Goa', readiness, firstUp: { title: 'Flight 6E 2134', time: '10:40' } })).toEqual({
      body: 'Today’s the day! First up: Flight 6E 2134 at 10:40.',
      opens: 'trip',
    });
  });
});
