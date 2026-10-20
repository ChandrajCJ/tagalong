import { and, eq, isNull, sql } from 'drizzle-orm';
import { changeLog, tripPlaces, trips, type Db, type Tx } from '@tagalong/db';
import {
  CreateTripPlaceInput,
  MAX_TRIP_PLACES,
  newId,
  placeDatesProblem,
  positionBetween,
  tripSummary,
  UpdateTripPlaceInput,
  type TripLocation,
  type TripPlace,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { requireTripRole } from '../../lib/access';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';
import type { Geo } from '../../lib/geo';

type Row = typeof tripPlaces.$inferSelect;
type CreatePlace = z.output<typeof CreateTripPlaceInput>;
type UpdatePlace = z.output<typeof UpdateTripPlaceInput>;

/** Plain byte order, matching how positions are made. */
const byPosition = (a: Row, b: Row) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export const toPlace = (r: Row): TripPlace => ({
  id: r.id,
  tripId: r.tripId,
  position: r.position,
  destination: r.destination,
  location:
    r.placeId && r.latitude !== null && r.longitude !== null
      ? { placeId: r.placeId, latitude: r.latitude, longitude: r.longitude, bounds: r.bounds ?? null, countryCode: r.countryCode?.trim() || null }
      : null,
  timezone: r.timezone,
  startDate: r.startDate,
  endDate: r.endDate,
  version: r.version,
});

/** A trip's places, in trip order. */
export const placeRows = async (db: Db | Tx, tripId: string) =>
  (await db.select().from(tripPlaces).where(eq(tripPlaces.tripId, tripId))).sort(byPosition);

/** The columns for a picked place (its time zone looked up, best effort), or none for free text. */
export const locationColumns = async (geo: Geo | undefined, location: TripLocation | null | undefined) =>
  location
    ? {
        placeId: location.placeId,
        latitude: location.latitude,
        longitude: location.longitude,
        bounds: location.bounds,
        countryCode: location.countryCode,
        timezone: (await geo?.timezoneAt(location).catch(() => null)) ?? null,
      }
    : { placeId: null, latitude: null, longitude: null, bounds: null, countryCode: null, timezone: null };

/** Refuses places whose dates leave the trip's or overlap (other than on a travel day). */
export const checkPlaceDates = (places: Pick<Row, 'destination' | 'startDate' | 'endDate'>[], trip: { startDate: string | null; endDate: string | null }) => {
  const problem = placeDatesProblem(places, trip);
  if (problem) throw badRequest(problem, 'place_dates');
};

/**
 * Rewrites the trip's destination fields from its places, so older phones
 * and every query that reads them keep working. Call inside the transaction
 * that changed the places; it bumps the trip's version.
 */
export const syncTripSummary = async (tx: Tx, tripId: string) => {
  const rows = await placeRows(tx, tripId);
  if (rows.length === 0) return;
  const summary = tripSummary(rows.map((r) => ({ ...r, countryCode: r.countryCode?.trim() || null })));
  await tx
    .update(trips)
    .set({ ...summary, version: sql`${trips.version} + 1` })
    .where(eq(trips.id, tripId));
};

/** The places on a trip: add, change, reorder and remove them. Editors and owners only. */
export const createTripPlacesService = (db: Db, redis?: Redis, geo?: Geo) => {
  /** Locks the trip while its places change, so two edits can't both pass the checks. */
  const lockTrip = async (tx: Tx, tripId: string) => {
    const [trip] = await tx
      .select({ startDate: trips.startDate, endDate: trips.endDate })
      .from(trips)
      .where(and(eq(trips.id, tripId), isNull(trips.deletedAt)))
      .for('update');
    if (!trip) throw notFound('Trip not found');
    return trip;
  };

  const logChange = (tx: Tx, tripId: string, placeId: string, op: 'upsert' | 'delete', userId: string) =>
    tx.insert(changeLog).values([
      { tripId, entity: 'place', entityId: placeId, op, changedBy: userId },
      { tripId, entity: 'trip', entityId: tripId, op: 'upsert', changedBy: userId },
    ]);

  /** The place itself, and the trip's summary for phones that only know about one place. */
  const announce = async (tripId: string, userId: string, origin: string | undefined, place: TripPlace | { deletedId: string }) => {
    if (!redis) return;
    if ('deletedId' in place) {
      await publishTripEvent(redis, { type: 'place.deleted', tripId, entityId: place.deletedId, actorId: userId, originClientId: origin });
    } else {
      await publishTripEvent(redis, {
        type: 'place.upserted',
        tripId,
        entityId: place.id,
        actorId: userId,
        version: place.version,
        payload: place,
        originClientId: origin,
      });
    }
    await publishTripEvent(redis, { type: 'trip.updated', tripId, entityId: tripId, actorId: userId, originClientId: origin });
  };

  return {
    async list(tripId: string, userId: string): Promise<TripPlace[]> {
      await requireTripRole(db, tripId, userId, 'viewer');
      return (await placeRows(db, tripId)).map(toPlace);
    },

    /** Adds a place, last unless a position is given. Retrying with the same id is safe. */
    async create(tripId: string, userId: string, input: CreatePlace, origin?: string): Promise<{ place: TripPlace; created: boolean }> {
      await requireTripRole(db, tripId, userId, 'editor');
      const id = input.id ?? newId();
      const columns = await locationColumns(geo, input.location);
      const result = await db.transaction(async (tx) => {
        const trip = await lockTrip(tx, tripId);
        const existing = await placeRows(tx, tripId);
        const already = existing.find((r) => r.id === id);
        if (already) return { row: already, created: false };
        if (existing.length >= MAX_TRIP_PLACES) throw badRequest(`A trip can have up to ${MAX_TRIP_PLACES} places`);
        const fresh = {
          destination: input.destination,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
        };
        checkPlaceDates([...existing, fresh], trip);
        const inserted = await tx
          .insert(tripPlaces)
          .values({ id, tripId, position: input.position ?? positionBetween(existing.at(-1)?.position ?? null, null), ...fresh, ...columns })
          .onConflictDoNothing()
          .returning();
        // The id is taken by another trip's place.
        if (inserted.length === 0) throw conflict('A place with that id already exists');
        await logChange(tx, tripId, id, 'upsert', userId);
        await syncTripSummary(tx, tripId);
        return { row: inserted[0]!, created: true };
      });
      const place = toPlace(result.row);
      if (result.created) await announce(tripId, userId, origin, place);
      return { place, created: result.created };
    },

    /** Renames, re-picks, re-dates or moves a place. A stale version gets 409 with the current copy. */
    async update(tripId: string, placeId: string, userId: string, input: UpdatePlace, origin?: string): Promise<TripPlace> {
      await requireTripRole(db, tripId, userId, 'editor');
      const { version, location, ...plain } = input;
      const columns = location === undefined ? {} : await locationColumns(geo, location);
      const result = await db.transaction(async (tx) => {
        const trip = await lockTrip(tx, tripId);
        const existing = await placeRows(tx, tripId);
        const current = existing.find((r) => r.id === placeId);
        if (!current) throw notFound('Place not found');
        if (current.version !== version) return { stale: current, row: null };
        const fields = Object.fromEntries(Object.entries(plain).filter(([, v]) => v !== undefined)) as Partial<Row>;
        const next = { ...current, ...fields };
        checkPlaceDates(
          existing.map((r) => (r.id === placeId ? next : r)),
          trip,
        );
        const [row] = await tx
          .update(tripPlaces)
          .set({ ...fields, ...columns, version: sql`${tripPlaces.version} + 1` })
          .where(eq(tripPlaces.id, placeId))
          .returning();
        await logChange(tx, tripId, placeId, 'upsert', userId);
        await syncTripSummary(tx, tripId);
        return { stale: null, row: row! };
      });
      if (result.stale) {
        throw conflict('Someone changed this place while you were editing. Showing the latest version.', {
          current: toPlace(result.stale),
        });
      }
      const place = toPlace(result.row!);
      await announce(tripId, userId, origin, place);
      return place;
    },

    /** Removes a place; the last one stays, since every trip is going somewhere. */
    async remove(tripId: string, placeId: string, userId: string, origin?: string) {
      await requireTripRole(db, tripId, userId, 'editor');
      await db.transaction(async (tx) => {
        await lockTrip(tx, tripId);
        const existing = await placeRows(tx, tripId);
        if (!existing.some((r) => r.id === placeId)) throw notFound('Place not found');
        if (existing.length === 1) throw badRequest('A trip needs at least one place. Change this one instead.', 'last_place');
        await tx.delete(tripPlaces).where(eq(tripPlaces.id, placeId));
        await logChange(tx, tripId, placeId, 'delete', userId);
        await syncTripSummary(tx, tripId);
      });
      await announce(tripId, userId, origin, { deletedId: placeId });
    },
  };
};
