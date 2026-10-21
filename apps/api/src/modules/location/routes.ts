import { ShareLocationInput } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { originOf } from '../../lib/events';
import { parse } from '../../lib/validate';
import { createLocationService } from './service';

const TripParams = z.object({ id: z.string().uuid() });

export const locationRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const service = createLocationService(deps.db, deps.redis);
  app.addHook('preHandler', app.authenticate);

  app.post('/trips/:id/location', async (request) => {
    const { id } = parse(TripParams, request.params);
    return service.share(id, request.user.sub, parse(ShareLocationInput, request.body), originOf(request));
  });

  app.delete('/trips/:id/location', async (request, reply) => {
    await service.stop(parse(TripParams, request.params).id, request.user.sub, originOf(request));
    return reply.status(204).send();
  });

  app.get('/trips/:id/locations', async (request) => ({
    locations: await service.list(parse(TripParams, request.params).id, request.user.sub),
  }));
};
