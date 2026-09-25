import { CreateTripInput } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { parse } from '../../lib/validate';
import { createTripsService } from './service';

const TripParams = z.object({ id: z.string().uuid() });

export const tripsRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const tripsService = createTripsService(deps.db);
  app.addHook('preHandler', app.authenticate);

  app.get('/trips', async (request) => ({
    trips: await tripsService.listForUser(request.user.sub),
  }));

  app.post('/trips', async (request, reply) => {
    const input = parse(CreateTripInput, request.body);
    const { trip, created } = await tripsService.create(input, request.user.sub);
    return reply.status(created ? 201 : 200).send(trip);
  });

  app.get('/trips/:id', async (request) => {
    const { id } = parse(TripParams, request.params);
    return tripsService.get(id, request.user.sub);
  });
};
