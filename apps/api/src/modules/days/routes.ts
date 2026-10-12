import { ReorderDayInput, TravelMode } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { originOf } from '../../lib/events';
import { parse } from '../../lib/validate';
import { createDaysService } from './service';

const DayParams = z.object({
  id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
});
const ModeQuery = z.object({ mode: TravelMode.default('foot') });

/** One day of the plan as a whole: travel between its stops, and its order. */
export const daysRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const service = createDaysService(deps.db, deps.redis, deps.routing);
  app.addHook('preHandler', app.authenticate);

  app.get('/trips/:id/days/:date/route', async (request) => {
    const { id, date } = parse(DayParams, request.params);
    const { mode } = parse(ModeQuery, request.query);
    return service.route(id, date, request.user.sub, mode);
  });

  app.get('/trips/:id/days/:date/optimise', async (request) => {
    const { id, date } = parse(DayParams, request.params);
    const { mode } = parse(ModeQuery, request.query);
    return service.optimise(id, date, request.user.sub, mode);
  });

  app.post('/trips/:id/days/:date/order', async (request) => {
    const { id, date } = parse(DayParams, request.params);
    const input = parse(ReorderDayInput, request.body);
    return service.reorder(id, date, request.user.sub, input, originOf(request));
  });
};
