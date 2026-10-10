import { CreateTripInput, UpdateMemberInput, UpdateTripInput } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { originOf } from '../../lib/events';
import { parse } from '../../lib/validate';
import { createMembersService } from './members';
import { createTripsService } from './service';

const TripParams = z.object({ id: z.string().uuid() });
const MemberParams = TripParams.extend({ userId: z.string().uuid() });

export const tripsRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const tripsService = createTripsService(deps.db, deps.redis);
  const membersService = createMembersService(deps.db, deps.redis);
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

  app.patch('/trips/:id', async (request) => {
    const { id } = parse(TripParams, request.params);
    const input = parse(UpdateTripInput, request.body);
    return tripsService.update(id, request.user.sub, input, originOf(request));
  });

  app.patch('/trips/:id/members/:userId', async (request) => {
    const { id, userId } = parse(MemberParams, request.params);
    const { role } = parse(UpdateMemberInput, request.body);
    await membersService.updateRole(id, userId, role, request.user.sub);
    return tripsService.get(id, request.user.sub);
  });

  app.delete('/trips/:id/members/:userId', async (request, reply) => {
    const { id, userId } = parse(MemberParams, request.params);
    await membersService.remove(id, userId, request.user.sub);
    return reply.status(204).send();
  });
};
