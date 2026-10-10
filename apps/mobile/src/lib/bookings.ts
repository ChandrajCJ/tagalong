import type Feather from '@expo/vector-icons/Feather';
import { safeZone, type Booking, type BookingType } from '@tagalong/shared';

type IconName = React.ComponentProps<typeof Feather>['name'];

/** "Thu 12 Jun, 08:15", in the booking's own zone. */
export const formatInZone = (iso: string, tz: string, withDate = true) =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: safeZone(tz),
    ...(withDate ? { weekday: 'short', day: 'numeric', month: 'short' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

/** "in 3 hours", "tomorrow", "in 5 days". */
export const relativeFrom = (iso: string, now = new Date()) => {
  const minutes = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
};

export const BOOKING_META: Record<
  BookingType,
  { label: string; icon: IconName; starts: string; ends: string | null }
> = {
  flight: { label: 'Flight', icon: 'send', starts: 'Departs', ends: 'Arrives' },
  stay: { label: 'Stay', icon: 'home', starts: 'Check-in', ends: 'Check-out' },
  train: { label: 'Train', icon: 'navigation', starts: 'Departs', ends: 'Arrives' },
  ticket: { label: 'Tickets', icon: 'tag', starts: 'Starts', ends: 'Ends' },
  car: { label: 'Car', icon: 'truck', starts: 'Pick-up', ends: 'Drop-off' },
  restaurant: { label: 'Table', icon: 'coffee', starts: 'Table at', ends: null },
};

export interface DetailField {
  key: string;
  label: string;
  placeholder: string;
  numeric?: boolean;
  /** Tucked under "More details": nice to have, not worth asking everyone for. */
  more?: boolean;
}

/** What "who it's with" means for each kind of booking. */
export const PROVIDER_FIELD: Record<BookingType, { label: string; placeholder: string }> = {
  flight: { label: 'Airline', placeholder: 'IndiGo' },
  stay: { label: 'Hotel or place', placeholder: 'Casa do Alfama' },
  train: { label: 'Train company', placeholder: 'Indian Railways' },
  ticket: { label: 'Event', placeholder: 'Fado night' },
  car: { label: 'Rental company', placeholder: 'Zoomcar' },
  restaurant: { label: 'Restaurant', placeholder: 'Time Out Market' },
};

/** Where a booking happens, for directions: a stay's or table's address, a car's pick-up. */
export const addressOf = (b: Booking): string | null => {
  const raw = b.details.address ?? b.details.pickup ?? b.details.venue;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
};

/** The extra fields each type asks for. Mirrors BOOKING_DETAILS in @tagalong/shared. */
export const DETAIL_FIELDS: Record<BookingType, DetailField[]> = {
  flight: [
    { key: 'flightNumber', label: 'Flight number', placeholder: '6E 2134' },
    { key: 'from', label: 'From', placeholder: 'LHR', more: true },
    { key: 'to', label: 'To', placeholder: 'LIS', more: true },
    { key: 'terminal', label: 'Terminal', placeholder: '2', more: true },
    { key: 'gate', label: 'Gate', placeholder: 'B12', more: true },
    { key: 'seats', label: 'Seats', placeholder: '14A, 14B', more: true },
  ],
  stay: [
    { key: 'address', label: 'Address', placeholder: 'Rua dos Remédios 12' },
    { key: 'room', label: 'Room', placeholder: 'Double with balcony', more: true },
    { key: 'phone', label: 'Phone', placeholder: '+351 21 000 0000', more: true },
  ],
  train: [
    { key: 'trainNumber', label: 'Train number', placeholder: '12951' },
    { key: 'from', label: 'From', placeholder: 'Lisboa Oriente', more: true },
    { key: 'to', label: 'To', placeholder: 'Porto Campanhã', more: true },
    { key: 'coach', label: 'Coach', placeholder: '4', more: true },
    { key: 'seats', label: 'Seats', placeholder: '61, 62', more: true },
  ],
  ticket: [
    { key: 'venue', label: 'Venue', placeholder: 'Gulbenkian Museum' },
    { key: 'seats', label: 'Seats', placeholder: 'Row F, 10–12', more: true },
    { key: 'entrance', label: 'Entrance', placeholder: 'Main gate', more: true },
  ],
  car: [
    { key: 'pickup', label: 'Pick-up at', placeholder: 'Lisbon Airport' },
    { key: 'dropoff', label: 'Drop-off at', placeholder: 'Faro Airport', more: true },
  ],
  restaurant: [
    { key: 'address', label: 'Address', placeholder: 'Av. Almirante Reis 1' },
    { key: 'partySize', label: 'Party size', placeholder: '6', numeric: true, more: true },
    { key: 'phone', label: 'Phone', placeholder: '+351 21 000 0000', more: true },
  ],
};

/** "LHR → LIS" for a trip from A to B, or nothing for a booking that stays put. */
export const routeOf = (b: Booking) => {
  const from = b.details.from;
  const to = b.details.to;
  return typeof from === 'string' && typeof to === 'string' && from && to ? `${from} → ${to}` : null;
};

/** The headline: "TAP Air Portugal TP1234", "Casa do Alfama", "Flight". */
export const titleOf = (b: Booking) => {
  const number = b.details.flightNumber ?? b.details.trainNumber;
  return (
    [b.provider, typeof number === 'string' ? number : null].filter(Boolean).join(' ') ||
    BOOKING_META[b.type].label
  );
};
