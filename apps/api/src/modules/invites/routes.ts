import { CreateInviteInput } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { parse } from '../../lib/validate';
import { createInvitesService } from './service';

const TripParams = z.object({ id: z.string().uuid() });
const InviteParams = TripParams.extend({ inviteId: z.string().uuid() });
const TokenParams = z.object({ token: z.string().min(20).max(100) });

export const invitesRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const service = createInvitesService(deps.db);
  app.addHook('preHandler', app.authenticate);

  app.post('/trips/:id/invites', async (request, reply) => {
    const { id } = parse(TripParams, request.params);
    const input = parse(CreateInviteInput, request.body ?? {});
    return reply.status(201).send(await service.create(id, request.user.sub, input));
  });

  app.get('/trips/:id/invites', async (request) => {
    const { id } = parse(TripParams, request.params);
    return { invites: await service.listActive(id, request.user.sub) };
  });

  app.delete('/trips/:id/invites/:inviteId', async (request, reply) => {
    const { id, inviteId } = parse(InviteParams, request.params);
    await service.revoke(id, inviteId, request.user.sub);
    return reply.status(204).send();
  });

  app.get('/invites/:token', async (request) => {
    const { token } = parse(TokenParams, request.params);
    return service.preview(token, request.user.sub);
  });

  app.post('/invites/:token/accept', async (request) => {
    const { token } = parse(TokenParams, request.params);
    return service.accept(token, request.user.sub);
  });
};
