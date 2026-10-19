import { CreateTripInput, SetCoverInput, UpdateMemberInput, UpdateTripInput } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { originOf } from '../../lib/events';
import { parse } from '../../lib/validate';
import { createCoverService } from './cover';
import { createMembersService } from './members';
import { createTripsService } from './service';

const TripParams = z.object({ id: z.string().uuid() });
const MemberParams = TripParams.extend({ userId: z.string().uuid() });

export const tripsRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const tripsService = createTripsService(deps.db, deps.redis, deps.geo, deps.storage, deps.env.S3_URL_TTL_SEC);
  const membersService = createMembersService(deps.db, deps.redis);
  const cover = createCoverService(deps.db, deps.redis, deps.storage, deps.jobs, deps.geo);
  app.addHook('preHandler', app.authenticate);

  app.get('/trips', async (request) => tripsService.listForUser(request.user.sub));

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

  app.delete('/trips/:id', async (request, reply) => {
    const { id } = parse(TripParams, request.params);
    await tripsService.remove(id, request.user.sub, originOf(request));
    return reply.status(204).send();
  });

  app.post('/trips/:id/restore', async (request) => {
    const { id } = parse(TripParams, request.params);
    return tripsService.restore(id, request.user.sub);
  });

  app.put('/trips/:id/cover', async (request) => {
    const { id } = parse(TripParams, request.params);
    const input = parse(SetCoverInput, request.body);
    await cover.set(id, request.user.sub, input);
    return tripsService.get(id, request.user.sub);
  });

  app.delete('/trips/:id/cover', async (request) => {
    const { id } = parse(TripParams, request.params);
    await cover.remove(id, request.user.sub);
    return tripsService.get(id, request.user.sub);
  });

  app.get('/trips/:id/cover-suggestion', async (request) => ({
    suggestion: await cover.suggestion(parse(TripParams, request.params).id, request.user.sub),
  }));

  app.post('/trips/:id/archive', async (request, reply) => {
    const { id } = parse(TripParams, request.params);
    await tripsService.setArchived(id, request.user.sub, true);
    return reply.status(204).send();
  });

  app.delete('/trips/:id/archive', async (request, reply) => {
    const { id } = parse(TripParams, request.params);
    await tripsService.setArchived(id, request.user.sub, false);
    return reply.status(204).send();
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
