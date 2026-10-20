import { PLACE_SCOPES, RecommendationCategory } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { parse } from '../../lib/validate';
import { createPlacesService } from './service';

const TripParams = z.object({ id: z.string().uuid() });
const SearchQuery = z.object({
  q: z.string().trim().min(2, 'Type a little more').max(100),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  scope: z.enum(PLACE_SCOPES).default('destination'),
  /** In place scope, the trip whose destination to search around. */
  tripId: z.string().uuid().optional(),
  /** Which of the trip's places to search around: by id (Explore), or the place of a day (a stop's date). */
  place: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const RecommendationQuery = z.object({
  category: RecommendationCategory.default('sights'),
  /** One of the trip's places; the first when left out. */
  place: z.string().uuid().optional(),
});

export const placesRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const service = createPlacesService(deps.db, deps.redis, deps.geo, deps.env.NODE_ENV === 'test' ? 0 : 2 * 60_000);
  app.addHook('preHandler', app.authenticate);

  app.get('/places/search', async (request) => {
    const { q, lat, lon, scope, tripId, place, date } = parse(SearchQuery, request.query);
    const near = lat !== undefined && lon !== undefined ? { latitude: lat, longitude: lon } : undefined;
    return { results: await service.search(q, request.user.sub, { near, scope, tripId, placeId: place, date }) };
  });

  app.get('/trips/:id/recommendations', async (request) => {
    const { id } = parse(TripParams, request.params);
    const { category, place } = parse(RecommendationQuery, request.query);
    return service.recommendations(id, request.user.sub, category, place);
  });

  app.get('/trips/:id/weather', async (request) => {
    const { id } = parse(TripParams, request.params);
    return service.weather(id, request.user.sub);
  });
};
