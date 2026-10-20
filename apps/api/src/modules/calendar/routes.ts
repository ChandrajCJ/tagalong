import { UpdateCalendarFeedInput } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { createCalendarService } from './service';

const FeedParams = z.object({ file: z.string().max(100) });
const TripParams = z.object({ id: z.string().uuid() });

/** Where links in calendar events point: the web app. */
const appUrlOf = (env: Deps['env']) => env.APP_URL ?? env.CORS_ORIGINS?.split(',')[0]?.trim() ?? null;

export const calendarRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const service = createCalendarService(deps.db, appUrlOf(deps.env));

  /** Read by calendar apps, with no sign-in: the token in the address is the key. */
  app.get('/calendar/:file', async (request, reply) => {
    const { file } = parse(FeedParams, request.params);
    const token = /^([A-Za-z0-9_-]{20,})\.ics$/.exec(file)?.[1];
    if (!token) throw notFound('No such calendar');
    const ics = await service.feed(token);
    return reply.type('text/calendar; charset=utf-8').header('cache-control', 'private, no-cache').send(ics);
  });

  app.register(async (signedIn) => {
    signedIn.addHook('preHandler', app.authenticate);

    signedIn.get('/me/calendar', async (request) => service.status(request.user.sub));
    signedIn.post('/me/calendar', async (request, reply) => reply.status(201).send(await service.create(request.user.sub)));
    signedIn.patch('/me/calendar', async (request) =>
      service.update(request.user.sub, parse(UpdateCalendarFeedInput, request.body).includeUntimed),
    );
    signedIn.delete('/me/calendar', async (request, reply) => {
      await service.remove(request.user.sub);
      return reply.status(204).send();
    });

    signedIn.get('/trips/:id/calendar.ics', async (request, reply) => {
      const { id } = parse(TripParams, request.params);
      const { name, ics } = await service.tripFile(id, request.user.sub);
      const fileName = `${name.replace(/[^\w -]+/g, '').trim() || 'trip'}.ics`;
      return reply
        .type('text/calendar; charset=utf-8')
        .header('content-disposition', `attachment; filename="${fileName}"`)
        .send(ics);
    });
  });
};
