import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { Deps } from './deps';
import { frankfurterRates } from './lib/fx';
import { openGeo } from './lib/geo';
import { bullJobs } from './lib/jobs';
import { logMailer, smtpMailer } from './lib/mailer';
import { osrmRouting } from './lib/routing';
import { s3Storage } from './lib/storage';
import { authRoutes } from './modules/auth/routes';
import { bookingsRoutes } from './modules/bookings/routes';
import { chatRoutes } from './modules/chat/routes';
import { daysRoutes } from './modules/days/routes';
import { devicesRoutes } from './modules/devices/routes';
import { moneyRoutes } from './modules/money/routes';
import { placesRoutes } from './modules/places/routes';
import { documentsRoutes } from './modules/documents/routes';
import { healthRoutes } from './modules/health/routes';
import { ideasRoutes } from './modules/ideas/routes';
import { invitesRoutes } from './modules/invites/routes';
import { itineraryRoutes } from './modules/itinerary/routes';
import { listsRoutes } from './modules/lists/routes';
import { photosRoutes } from './modules/photos/routes';
import { tripsRoutes } from './modules/trips/routes';
import { authPlugin } from './plugins/auth';
import { errorsPlugin } from './plugins/errors';

type Swappable = 'mailer' | 'jobs' | 'storage' | 'rates' | 'geo' | 'routing';
type BuildDeps = Omit<Deps, Swappable> & Partial<Pick<Deps, Swappable>>;

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
    mailer: deps.mailer ?? (env.SMTP_URL ? smtpMailer(env.SMTP_URL, env.MAIL_FROM) : logMailer(app.log)),
    jobs: deps.jobs ?? bullJobs(deps.redis),
    storage: deps.storage ?? s3Storage(env),
    rates: deps.rates ?? frankfurterRates(deps.redis, env.FX_API_URL),
    geo:
      deps.geo ??
      openGeo({
        userAgent: env.GEO_USER_AGENT,
        photonUrl: env.PHOTON_URL,
        overpassUrls: env.OVERPASS_URLS.split(',').map((u) => u.trim()).filter(Boolean),
        wikipediaApi: env.WIKIPEDIA_API,
      }),
    routing: deps.routing ?? osrmRouting({ baseUrl: env.ROUTING_URL, userAgent: env.GEO_USER_AGENT }),
  };
  app.addHook('onClose', async () => fullDeps.jobs.close());

  await app.register(errorsPlugin);
  // Phones don't send an Origin; this only limits which websites may call the API.
  const origins = env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);
  await app.register(cors, { origin: origins?.length ? origins : true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(authPlugin, { secret: env.JWT_SECRET });

  await app.register(healthRoutes, { deps: fullDeps });
  await app.register(authRoutes, { deps: fullDeps });
  await app.register(tripsRoutes, { deps: fullDeps });
  await app.register(invitesRoutes, { deps: fullDeps });
  await app.register(itineraryRoutes, { deps: fullDeps });
  await app.register(daysRoutes, { deps: fullDeps });
  await app.register(ideasRoutes, { deps: fullDeps });
  await app.register(chatRoutes, { deps: fullDeps });
  await app.register(documentsRoutes, { deps: fullDeps });
  await app.register(bookingsRoutes, { deps: fullDeps });
  await app.register(photosRoutes, { deps: fullDeps });
  await app.register(devicesRoutes, { deps: fullDeps });
  await app.register(moneyRoutes, { deps: fullDeps });
  await app.register(placesRoutes, { deps: fullDeps });
  await app.register(listsRoutes, { deps: fullDeps });

  return app;
};
