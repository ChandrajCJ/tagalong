import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { Deps } from './deps';
import { bullJobs } from './lib/jobs';
import { logMailer } from './lib/mailer';
import { authRoutes } from './modules/auth/routes';
import { chatRoutes } from './modules/chat/routes';
import { devicesRoutes } from './modules/devices/routes';
import { healthRoutes } from './modules/health/routes';
import { ideasRoutes } from './modules/ideas/routes';
import { invitesRoutes } from './modules/invites/routes';
import { itineraryRoutes } from './modules/itinerary/routes';
import { tripsRoutes } from './modules/trips/routes';
import { authPlugin } from './plugins/auth';
import { errorsPlugin } from './plugins/errors';

type BuildDeps = Omit<Deps, 'mailer' | 'jobs'> & Partial<Pick<Deps, 'mailer' | 'jobs'>>;

export const buildApp = async (deps: BuildDeps) => {
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

  const fullDeps: Deps = {
    ...deps,
    mailer: deps.mailer ?? logMailer(app.log),
    jobs: deps.jobs ?? bullJobs(deps.redis),
  };
  app.addHook('onClose', async () => fullDeps.jobs.close());

  await app.register(errorsPlugin);
  await app.register(cors, { origin: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(authPlugin, { secret: env.JWT_SECRET });

  await app.register(healthRoutes, { deps: fullDeps });
  await app.register(authRoutes, { deps: fullDeps });
  await app.register(tripsRoutes, { deps: fullDeps });
  await app.register(invitesRoutes, { deps: fullDeps });
  await app.register(itineraryRoutes, { deps: fullDeps });
  await app.register(ideasRoutes, { deps: fullDeps });
  await app.register(chatRoutes, { deps: fullDeps });
  await app.register(devicesRoutes, { deps: fullDeps });

  return app;
};
