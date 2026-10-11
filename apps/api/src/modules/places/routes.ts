import { RecommendationCategory } from '@tagalong/shared';
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
});
const RecommendationQuery = z.object({ category: RecommendationCategory.default('sights') });

export const placesRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const service = createPlacesService(deps.db, deps.redis, deps.geo);
  app.addHook('preHandler', app.authenticate);

  app.get('/places/search', async (request) => {
    const { q, lat, lon } = parse(SearchQuery, request.query);
    const near = lat !== undefined && lon !== undefined ? { latitude: lat, longitude: lon } : undefined;
    return { results: await service.search(q, request.user.sub, near) };
  });

  app.get('/trips/:id/recommendations', async (request) => {
    const { id } = parse(TripParams, request.params);
    const { category } = parse(RecommendationQuery, request.query);
    return service.recommendations(id, request.user.sub, category);
  });

  app.get('/trips/:id/weather', async (request) => {
    const { id } = parse(TripParams, request.params);
    return service.weather(id, request.user.sub);
  });
};
