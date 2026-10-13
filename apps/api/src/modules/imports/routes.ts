import { AddImportInput, CreateImportInput, DismissImportInput } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { originOf } from '../../lib/events';
import { parse } from '../../lib/validate';
import { createImportsService } from './service';

const TripParams = z.object({ id: z.string().uuid() });
const ImportParams = z.object({ importId: z.string().uuid() });

/** Bookings found in emails, pasted text and ticket files, for review. */
export const importsRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const service = createImportsService(deps.db, deps.redis, deps.storage, deps.env.IMPORT_ADDRESS);
  app.addHook('preHandler', app.authenticate);

  app.get('/trips/:id/imports', async (request) => {
    const { id } = parse(TripParams, request.params);
    return { imports: await service.list(id, request.user.sub) };
  });

  app.post('/trips/:id/imports', async (request, reply) => {
    const { id } = parse(TripParams, request.params);
    const input = parse(CreateImportInput, request.body);
    const { import: found, created } = await service.create(id, request.user.sub, input, originOf(request));
    return reply.status(created ? 201 : 200).send(found);
  });

  app.post('/imports/:importId/add', async (request) => {
    const { importId } = parse(ImportParams, request.params);
    const input = parse(AddImportInput, request.body);
    return service.add(importId, request.user.sub, input, originOf(request));
  });

  app.post('/imports/:importId/dismiss', async (request) => {
    const { importId } = parse(ImportParams, request.params);
    const input = parse(DismissImportInput, request.body ?? {});
    return service.dismiss(importId, request.user.sub, input, originOf(request));
  });

  /** The address to forward confirmations to, or null when this server has no inbox. */
  app.get('/trips/:id/inbox', async (request) => {
    const { id } = parse(TripParams, request.params);
    return service.inbox(id, request.user.sub);
  });

  app.post('/trips/:id/inbox/rotate', async (request) => {
    const { id } = parse(TripParams, request.params);
    return service.rotateInbox(id, request.user.sub);
  });
};
