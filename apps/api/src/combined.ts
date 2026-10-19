import type { Redis } from 'ioredis';
import { buildApp } from './app';
import { registerGateway } from './realtime/gateway';

type BuildDeps = Parameters<typeof buildApp>[0];

/**
 * The API and the realtime gateway on one server: `/ws` next to the API's
 * routes. For hosts that give one free server and one port (Render's free
 * plan); development and the Docker setup run them separately.
 */
export const buildCombined = async (deps: BuildDeps & { subscriber: Redis }) => {
  const { subscriber, ...appDeps } = deps;
  const app = await buildApp(appDeps);
  await registerGateway(app, { db: deps.db, redis: deps.redis, subscriber }, { healthRoute: false });
  return app;
};
