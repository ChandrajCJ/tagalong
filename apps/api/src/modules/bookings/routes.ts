import { CreateBookingInput, UpdateBookingInput } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { originOf } from '../../lib/events';
import { parse } from '../../lib/validate';
import { createBookingsService } from './service';

const TripParams = z.object({ id: z.string().uuid() });
const BookingParams = z.object({ bookingId: z.string().uuid() });

export const bookingsRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const service = createBookingsService(deps.db, deps.redis);
  app.addHook('preHandler', app.authenticate);

  app.get('/trips/:id/bookings', async (request) => {
    const { id } = parse(TripParams, request.params);
    return { bookings: await service.list(id, request.user.sub) };
  });

  app.get('/trips/:id/next-up', async (request) => {
    const { id } = parse(TripParams, request.params);
    return service.nextUp(id, request.user.sub);
  });

  app.post('/trips/:id/bookings', async (request, reply) => {
    const { id } = parse(TripParams, request.params);
    const input = parse(CreateBookingInput, request.body);
    const { booking, created } = await service.create(id, request.user.sub, input, originOf(request));
    return reply.status(created ? 201 : 200).send(booking);
  });

  app.patch('/bookings/:bookingId', async (request) => {
    const { bookingId } = parse(BookingParams, request.params);
    const input = parse(UpdateBookingInput, request.body);
    return service.update(bookingId, request.user.sub, input, originOf(request));
  });

  app.delete('/bookings/:bookingId', async (request, reply) => {
    const { bookingId } = parse(BookingParams, request.params);
    await service.remove(bookingId, request.user.sub, originOf(request));
    return reply.status(204).send();
  });
};
