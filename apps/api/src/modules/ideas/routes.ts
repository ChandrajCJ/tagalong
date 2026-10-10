import { CreateIdeaInput, PromoteIdeaInput, UpdateIdeaInput, VoteIdeaInput } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { originOf } from '../../lib/events';
import { parse } from '../../lib/validate';
import { createIdeasService } from './service';

const TripParams = z.object({ id: z.string().uuid() });
const IdeaParams = z.object({ ideaId: z.string().uuid() });

export const ideasRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const service = createIdeasService(deps.db, deps.redis);
  app.addHook('preHandler', app.authenticate);

  app.get('/trips/:id/ideas', async (request) => {
    const { id } = parse(TripParams, request.params);
    return { ideas: await service.list(id, request.user.sub) };
  });

  app.post('/trips/:id/ideas', async (request, reply) => {
    const { id } = parse(TripParams, request.params);
    const input = parse(CreateIdeaInput, request.body);
    const { idea, created } = await service.create(id, request.user.sub, input, originOf(request));
    return reply.status(created ? 201 : 200).send(idea);
  });

  app.patch('/ideas/:ideaId', async (request) => {
    const { ideaId } = parse(IdeaParams, request.params);
    const input = parse(UpdateIdeaInput, request.body);
    return service.update(ideaId, request.user.sub, input, originOf(request));
  });

  app.delete('/ideas/:ideaId', async (request, reply) => {
    const { ideaId } = parse(IdeaParams, request.params);
    await service.remove(ideaId, request.user.sub, originOf(request));
    return reply.status(204).send();
  });

  app.put('/ideas/:ideaId/vote', async (request) => {
    const { ideaId } = parse(IdeaParams, request.params);
    const { value } = parse(VoteIdeaInput, request.body);
    return service.vote(ideaId, request.user.sub, value, originOf(request));
  });

  app.delete('/ideas/:ideaId/vote', async (request) => {
    const { ideaId } = parse(IdeaParams, request.params);
    return service.vote(ideaId, request.user.sub, null, originOf(request));
  });

  app.post('/ideas/:ideaId/unpromote', async (request) => {
    const { ideaId } = parse(IdeaParams, request.params);
    return service.unpromote(ideaId, request.user.sub, originOf(request));
  });

  app.post('/ideas/:ideaId/promote', async (request) => {
    const { ideaId } = parse(IdeaParams, request.params);
    const { date } = parse(PromoteIdeaInput, request.body ?? {});
    return service.promote(ideaId, request.user.sub, date, originOf(request));
  });
};
