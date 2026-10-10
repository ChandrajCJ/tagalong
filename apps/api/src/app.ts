import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { Deps } from './deps';
import { frankfurterRates } from './lib/fx';
import { bullJobs } from './lib/jobs';
import { logMailer } from './lib/mailer';
import { s3Storage } from './lib/storage';
import { authRoutes } from './modules/auth/routes';
import { bookingsRoutes } from './modules/bookings/routes';
import { chatRoutes } from './modules/chat/routes';
import { devicesRoutes } from './modules/devices/routes';
import { moneyRoutes } from './modules/money/routes';
import { documentsRoutes } from './modules/documents/routes';
import { healthRoutes } from './modules/health/routes';
import { ideasRoutes } from './modules/ideas/routes';
import { invitesRoutes } from './modules/invites/routes';
import { itineraryRoutes } from './modules/itinerary/routes';
import { photosRoutes } from './modules/photos/routes';
import { tripsRoutes } from './modules/trips/routes';
import { authPlugin } from './plugins/auth';
import { errorsPlugin } from './plugins/errors';

type BuildDeps = Omit<Deps, 'mailer' | 'jobs' | 'storage' | 'rates'> &
  Partial<Pick<Deps, 'mailer' | 'jobs' | 'storage' | 'rates'>>;

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
    storage: deps.storage ?? s3Storage(env),
    rates: deps.rates ?? frankfurterRates(deps.redis, env.FX_API_URL),
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
  await app.register(documentsRoutes, { deps: fullDeps });
  await app.register(bookingsRoutes, { deps: fullDeps });
  await app.register(photosRoutes, { deps: fullDeps });
  await app.register(devicesRoutes, { deps: fullDeps });
  await app.register(moneyRoutes, { deps: fullDeps });

  return app;
};
