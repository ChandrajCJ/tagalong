import { AvatarUploadInput, SetAvatarInput } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { parse } from '../../lib/validate';
import { createAuthService } from '../auth/service';
import { createUsersService } from './service';

const UserParams = z.object({ id: z.string().uuid() });

export const usersRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const service = createUsersService(deps.db, deps.storage, deps.env.S3_URL_TTL_SEC);
  const auth = createAuthService(app, deps);
  app.addHook('preHandler', app.authenticate);

  app.post('/me/avatar', async (request) => service.uploadUrl(request.user.sub, parse(AvatarUploadInput, request.body)));

  app.put('/me/avatar', async (request) => {
    const { key } = parse(SetAvatarInput, request.body);
    await service.set(request.user.sub, key);
    return auth.me(request.user.sub);
  });

  app.delete('/me/avatar', async (request) => {
    await service.remove(request.user.sub);
    return auth.me(request.user.sub);
  });

  /** Redirects to a short-lived link; the private cache lets the phone keep it for most of the hour. */
  app.get('/users/:id/avatar', async (request, reply) => {
    const { id } = parse(UserParams, request.params);
    const url = await service.link(request.user.sub, id);
    return reply.header('cache-control', 'private, max-age=3000').redirect(url, 302);
  });
};
