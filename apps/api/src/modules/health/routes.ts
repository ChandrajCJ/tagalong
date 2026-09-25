import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../deps';

const check = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 'ok' as const;
  } catch {
    return 'down' as const;
  }
};

export const healthRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  app.get('/health', async (_request, reply) => {
    const [db, redis] = await Promise.all([
      check(() => deps.db.execute(sql`select 1`)),
      check(() => deps.redis.ping()),
    ]);
    const ok = db === 'ok' && redis === 'ok';
    return reply.status(ok ? 200 : 503).send({ status: ok ? 'ok' : 'degraded', db, redis });
  });
};
