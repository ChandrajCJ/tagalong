import { CreatePhotoInput } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { originOf } from '../../lib/events';
import { parse } from '../../lib/validate';
import { createPhotosService } from './service';

const TripParams = z.object({ id: z.string().uuid() });
const PhotoParams = z.object({ photoId: z.string().uuid() });
const BatchParams = z.object({ id: z.string().uuid(), batchId: z.string().uuid() });

export const photosRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const service = createPhotosService(deps.db, deps.redis, deps.storage, deps.jobs, deps.env);
  app.addHook('preHandler', app.authenticate);

  app.get('/trips/:id/photos', async (request) => {
    const { id } = parse(TripParams, request.params);
    return service.list(id, request.user.sub);
  });

  app.post('/trips/:id/photos', async (request, reply) => {
    const { id } = parse(TripParams, request.params);
    const input = parse(CreatePhotoInput, request.body);
    return reply.status(201).send(await service.start(id, request.user.sub, input));
  });

  app.post('/trips/:id/photo-batches/:batchId/finish', async (request) => {
    const { id, batchId } = parse(BatchParams, request.params);
    return service.finishBatch(id, batchId, request.user.sub);
  });

  app.get('/photos/:photoId', async (request) => {
    const { photoId } = parse(PhotoParams, request.params);
    return service.get(photoId, request.user.sub);
  });

  app.post('/photos/:photoId/complete', async (request) => {
    const { photoId } = parse(PhotoParams, request.params);
    return service.complete(photoId, request.user.sub, originOf(request));
  });

  app.delete('/photos/:photoId', async (request, reply) => {
    const { photoId } = parse(PhotoParams, request.params);
    await service.remove(photoId, request.user.sub, originOf(request));
    return reply.status(204).send();
  });
};
