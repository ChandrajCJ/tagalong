import { RefreshInput, RequestCodeInput, UpdateMeInput, VerifyCodeInput } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../deps';
import { parse } from '../../lib/validate';
import { createAuthService } from './service';

export const authRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const auth = createAuthService(app, deps);

  app.post('/auth/email/request-code', async (request, reply) => {
    const { email } = parse(RequestCodeInput, request.body);
    await auth.requestCode(email);
    return reply.status(202).send({ sent: true });
  });

  app.post('/auth/email/verify', async (request) => {
    const { email, code, deviceName } = parse(VerifyCodeInput, request.body);
    return auth.verifyCode(email, code, deviceName);
  });

  app.post('/auth/refresh', async (request) => {
    const { refreshToken } = parse(RefreshInput, request.body);
    return auth.refresh(refreshToken);
  });

  app.post('/auth/logout', { preHandler: app.authenticate }, async (request, reply) => {
    await auth.logout(request.user.sid);
    return reply.status(204).send();
  });

  app.get('/me', { preHandler: app.authenticate }, async (request) => auth.me(request.user.sub));

  app.patch('/me', { preHandler: app.authenticate }, async (request) => {
    const input = parse(UpdateMeInput, request.body);
    return auth.updateMe(request.user.sub, input);
  });
};
