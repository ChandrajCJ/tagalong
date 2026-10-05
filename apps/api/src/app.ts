import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { Deps } from './deps';
import { logMailer } from './lib/mailer';
import { authRoutes } from './modules/auth/routes';
import { healthRoutes } from './modules/health/routes';
import { invitesRoutes } from './modules/invites/routes';
import { tripsRoutes } from './modules/trips/routes';
import { authPlugin } from './plugins/auth';
import { errorsPlugin } from './plugins/errors';

export const buildApp = async (deps: Omit<Deps, 'mailer'> & { mailer?: Deps['mailer'] }) => {
  const { env } = deps;
  const app = Fastify({
    logger:
      env.NODE_ENV === 'test'
        ? false
        : {
            level: env.LOG_LEVEL,
            transport:
              env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
          },
  });

  const fullDeps: Deps = { ...deps, mailer: deps.mailer ?? logMailer(app.log) };

  await app.register(errorsPlugin);
  await app.register(cors, { origin: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
  await app.register(authPlugin, { secret: env.JWT_SECRET });

  await app.register(healthRoutes, { deps: fullDeps });
  await app.register(authRoutes, { deps: fullDeps });
  await app.register(tripsRoutes, { deps: fullDeps });
  await app.register(invitesRoutes, { deps: fullDeps });

  return app;
};
