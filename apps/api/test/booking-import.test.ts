import { CreateBookingInput } from '@tagalong/shared';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findBookings, pdfText } from '../src/lib/booking-import';
import { findDates, findTimes, findTotal, htmlToText } from '../src/lib/booking-import/text-utils';

// Sample emails written for these tests: realistic layouts, made-up people and codes.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/booking-emails/${name}`, import.meta.url), 'utf8');
const JUNE = new Date('2026-05-20T10:00:00Z');

/** Every candidate must be something the bookings API would accept as it is. */
const expectValid = (candidates: ReturnType<typeof findBookings>) => {
  for (const c of candidates) expect(CreateBookingInput.safeParse(c.booking).success, JSON.stringify(c.booking)).toBe(true);
};

describe('reading bookings from emails', () => {
  it('finds both flights of a return trip in an IndiGo-style email', () => {
    const found = findBookings({ text: fixture('indigo-return.txt'), receivedAt: JUNE, timezone: 'Asia/Kolkata' });
    expect(found).toHaveLength(2);
    const [out, back] = found;
    expect(out).toMatchObject({
      confidence: 'medium',
      booking: {
        type: 'flight',
        provider: 'IndiGo',
        reference: 'K7XQ2M',
        // 08:15 and 09:30 in India.
        startsAt: '2026-06-12T02:45:00.000Z',
        endsAt: '2026-06-12T04:00:00.000Z',
        timezone: 'Asia/Kolkata',
        details: { flightNumber: '6E 2134', from: 'BOM', to: 'GOI', terminal: '1' },
        costMinor: 984000,
        costCurrency: 'INR',
      },
    });
    expect(back!.booking).toMatchObject({
      reference: 'K7XQ2M',
      startsAt: '2026-06-15T13:10:00.000Z',
      details: { flightNumber: '6E 5098', from: 'GOI', to: 'BOM', seats: '14A, 14B' },
      // The total is for the whole trip, so it's only on the first flight.
      costMinor: null,
    });
    expectValid(found);
  });

  it('reads an IRCTC-style train ticket', () => {
    const [train, ...rest] = findBookings({ text: fixture('irctc.txt'), receivedAt: JUNE, timezone: 'Asia/Kolkata' });
    expect(rest).toHaveLength(0);
    expect(train).toMatchObject({
      confidence: 'medium',
      booking: {
        type: 'train',
        provider: 'Indian Railways',
        reference: '4521378960',
        startsAt: '2026-06-14T09:00:00.000Z',
        endsAt: '2026-06-15T00:45:00.000Z',
        details: { trainNumber: '12051', from: 'MADGAON (MAO)', to: 'MUMBAI CSMT (CSMT)', coach: 'C2', seats: '41, 42' },
        costMinor: 231000,
        costCurrency: 'INR',
      },
    });
    expectValid([train!]);
  });

  it('trusts structured data (Booking.com-style JSON-LD) and marks it high', () => {
    const [stay, ...rest] = findBookings({ html: fixture('booking-com.html'), receivedAt: JUNE, timezone: 'Europe/Lisbon' });
    expect(rest).toHaveLength(0);
    expect(stay).toMatchObject({
      confidence: 'high',
      booking: {
        type: 'stay',
        provider: 'Casa do Alfama',
        reference: '4012339881',
        startsAt: '2026-06-12T14:00:00.000Z',
        endsAt: '2026-06-15T10:00:00.000Z',
        details: { address: 'Rua dos Remédios 12, Lisbon, 1100-445', phone: '+351 21 000 1234', room: 'Double room with balcony' },
        costMinor: 48000,
        costCurrency: 'EUR',
      },
    });
    expectValid([stay!]);
  });

  it('prefers the markup over the text, and reads times without an offset at the airport', () => {
    const found = findBookings({ html: fixture('flights-jsonld.html'), receivedAt: JUNE, timezone: 'Asia/Kolkata' });
    expect(found.map((c) => c.booking.details.flightNumber)).toEqual(['TP 1350', 'TP 1363']);
    expect(found.every((c) => c.booking.reference === 'TPQ7KL' && c.confidence === 'high')).toBe(true);
    expect(found[0]!.booking).toMatchObject({
      provider: 'TAP Air Portugal',
      startsAt: '2026-06-12T06:05:00.000Z',
      timezone: 'Europe/London',
      details: { from: 'LHR', to: 'LIS', seats: '22C' },
    });
    // 19:10 in Lisbon and 21:50 in London, both an hour ahead of UTC in June.
    expect(found[1]!.booking).toMatchObject({ startsAt: '2026-06-15T18:10:00.000Z', endsAt: '2026-06-15T20:50:00.000Z', timezone: 'Europe/Lisbon' });
    expectValid(found);
  });

  it('reads microdata too (an event ticket)', () => {
    const [event] = findBookings({ html: fixture('event-microdata.html'), receivedAt: JUNE });
    expect(event).toMatchObject({
      confidence: 'high',
      booking: {
        type: 'ticket',
        provider: 'Fado night at Clube de Fado',
        reference: 'FADO-2291',
        startsAt: '2026-06-13T20:00:00.000Z',
        details: { venue: 'Clube de Fado, Rua São João da Praça 86, Lisbon' },
        costMinor: 7000,
        costCurrency: 'EUR',
      },
    });
    expectValid([event!]);
  });

  it('reads an Airbnb-style stay with dates that have no year', () => {
    const [stay] = findBookings({ text: fixture('airbnb.txt'), receivedAt: JUNE, timezone: 'Europe/Lisbon' });
    expect(stay).toMatchObject({
      booking: {
        type: 'stay',
        provider: 'Sunny loft by the river',
        reference: 'HMABC12345',
        startsAt: '2026-06-12T14:00:00.000Z',
        endsAt: '2026-06-15T10:00:00.000Z',
        details: { address: 'Rua da Bica de Duarte Belo 21, 1200-056 Lisboa, Portugal' },
        costMinor: 48000,
        costCurrency: 'EUR',
      },
    });
  });

  it('reads a restaurant booking', () => {
    const [table] = findBookings({ text: fixture('restaurant.txt'), receivedAt: JUNE, timezone: 'Europe/Lisbon' });
    expect(table).toMatchObject({
      booking: {
        type: 'restaurant',
        provider: 'Taberna da Rua',
        reference: 'TB4821X',
        startsAt: '2026-06-13T19:30:00.000Z',
        details: { partySize: 4, address: 'Rua do Norte 55, 1200-286 Lisboa' },
      },
    });
    expectValid([table!]);
  });

  it('reads a car rental', () => {
    const [car] = findBookings({ text: fixture('car-rental.txt'), receivedAt: JUNE, timezone: 'Asia/Kolkata' });
    expect(car).toMatchObject({
      booking: {
        type: 'car',
        provider: 'Zoomcar',
        reference: 'ZC88421907',
        startsAt: '2026-06-12T04:30:00.000Z',
        endsAt: '2026-06-15T11:30:00.000Z',
        details: { pickup: 'Dabolim Airport, Goa', dropoff: 'Dabolim Airport, Goa' },
        costMinor: 645000,
        costCurrency: 'INR',
      },
    });
    expectValid([car!]);
  });

  it('reads the text of a ticket PDF', async () => {
    const text = await pdfText(readFileSync(new URL('./fixtures/booking-emails/air-india-ticket.pdf', import.meta.url)));
    expect(text).toContain('R4TN8Q');
    const [flight] = findBookings({ text, receivedAt: JUNE, timezone: 'Europe/Lisbon' });
    expect(flight!.booking).toMatchObject({
      type: 'flight',
      provider: 'Air India',
      reference: 'R4TN8Q',
      // At the departure airport's time, whatever the trip's zone.
      startsAt: '2026-06-18T00:30:00.000Z',
      endsAt: '2026-06-18T02:40:00.000Z',
      timezone: 'Asia/Kolkata',
      details: { flightNumber: 'AI 865', from: 'DEL', to: 'BOM', terminal: '3', seats: '23F' },
      costMinor: 621000,
    });
  });

  it('finds nothing in an email that isn’t a booking', async () => {
    expect(findBookings({ text: fixture('newsletter.txt'), receivedAt: JUNE })).toEqual([]);
    expect(findBookings({ text: 'Thanks for your order! It ships tomorrow.' })).toEqual([]);
    expect(findBookings({ html: '<script type="application/ld+json">{not json</script><p>hello</p>' })).toEqual([]);
    // A file that isn't a PDF has no text, rather than an error.
    expect(await pdfText(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('the small readers', () => {
  it('reads dates the ways people write them', () => {
    const text = '2026-06-12, 13 Jun 2026, 14-Jun-26, June 15, 2026, 16/06/2026, 06/17/2026, Thu 18th June';
    expect(findDates(text, 2026).map((d) => d.value)).toEqual([
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
      '2026-06-16',
      '2026-06-17',
      '2026-06-18',
    ]);
  });

  it('reads 12- and 24-hour times, but not money', () => {
    expect(findTimes('08:15, 3:00 PM, 12:30 am, 21.45 hrs, ₹12.50').map((t) => t.value)).toEqual(['08:15', '15:00', '00:30', '21:45']);
  });

  it('reads totals in rupees, euros and dollars', () => {
    expect(findTotal('Total fare: ₹9,840')).toEqual({ minor: 984000, currency: 'INR' });
    expect(findTotal('Grand total INR 4520.00')).toEqual({ minor: 452000, currency: 'INR' });
    expect(findTotal('Total: 120.50 EUR')).toEqual({ minor: 12050, currency: 'EUR' });
    expect(findTotal('Amount paid $89')).toEqual({ minor: 8900, currency: 'USD' });
    expect(findTotal('No money here')).toBeNull();
  });

  it('turns HTML into readable lines', () => {
    expect(htmlToText('<table><tr><td>PNR</td><td>K7XQ2M</td></tr></table><p>Fly&nbsp;safe &amp; well</p>')).toBe('PNR | K7XQ2M\nFly safe & well');
  });
});
