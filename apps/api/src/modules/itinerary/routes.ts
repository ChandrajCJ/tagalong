import { CreateItemInput, UpdateItemInput } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { originOf } from '../../lib/events';
import { parse } from '../../lib/validate';
import { createItineraryService } from './service';

const TripParams = z.object({ id: z.string().uuid() });
const ItemParams = z.object({ itemId: z.string().uuid() });

export const itineraryRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const service = createItineraryService(deps.db, deps.redis);
  app.addHook('preHandler', app.authenticate);

  app.get('/trips/:id/items', async (request) => {
    const { id } = parse(TripParams, request.params);
    return { items: await service.list(id, request.user.sub) };
  });

  app.post('/trips/:id/items', async (request, reply) => {
    const { id } = parse(TripParams, request.params);
    const input = parse(CreateItemInput, request.body);
    const { item, created } = await service.create(id, request.user.sub, input, originOf(request));
    return reply.status(created ? 201 : 200).send(item);
  });

  app.get('/items/:itemId', async (request) => {
    const { itemId } = parse(ItemParams, request.params);
    return service.get(itemId, request.user.sub);
  });

  app.patch('/items/:itemId', async (request) => {
    const { itemId } = parse(ItemParams, request.params);
    const input = parse(UpdateItemInput, request.body);
    return service.update(itemId, request.user.sub, input, originOf(request));
  });

  app.delete('/items/:itemId', async (request, reply) => {
    const { itemId } = parse(ItemParams, request.params);
    await service.remove(itemId, request.user.sub, originOf(request));
    return reply.status(204).send();
  });
};
