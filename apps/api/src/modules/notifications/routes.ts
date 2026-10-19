import { UpdateNotificationPrefsInput, UpdateTripNotificationsInput } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { parse } from '../../lib/validate';
import { createNotificationsService } from './service';

const TripParams = z.object({ id: z.string().uuid() });

export const notificationsRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const service = createNotificationsService(deps.db);
  app.addHook('preHandler', app.authenticate);

  app.get('/me/notifications', async (request) => service.defaults(request.user.sub));

  app.patch('/me/notifications', async (request) =>
    service.updateDefaults(request.user.sub, parse(UpdateNotificationPrefsInput, request.body)),
  );

  app.get('/trips/:id/notifications', async (request) =>
    service.forTrip(parse(TripParams, request.params).id, request.user.sub),
  );

  app.patch('/trips/:id/notifications', async (request) =>
    service.updateTrip(
      parse(TripParams, request.params).id,
      request.user.sub,
      parse(UpdateTripNotificationsInput, request.body),
    ),
  );
};
