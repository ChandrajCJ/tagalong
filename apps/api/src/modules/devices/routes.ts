import { devices } from '@tagalong/db';
import { RegisterPushTokenInput } from '@tagalong/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../deps';
import { parse } from '../../lib/validate';

export const devicesRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  app.addHook('preHandler', app.authenticate);

  /**
   * Remembers where to send this person's push notifications. A token belongs
   * to one phone, so if another account signed in on it before, it moves over.
   */
  app.post('/me/devices/push-token', async (request, reply) => {
    const { token, platform } = parse(RegisterPushTokenInput, request.body);
    const userId = request.user.sub;
    const [existing] = await deps.db
      .select({ id: devices.id })
      .from(devices)
      .where(eq(devices.pushToken, token));
    if (existing) {
      await deps.db
        .update(devices)
        .set({ userId, platform, lastSeenAt: new Date() })
        .where(eq(devices.id, existing.id));
    } else {
      await deps.db.insert(devices).values({ userId, platform, pushToken: token });
    }
    return reply.status(204).send();
  });
};
