import { CreateDocumentInput, UpdateDocumentInput } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { originOf } from '../../lib/events';
import { parse } from '../../lib/validate';
import { createDocumentsService } from './service';

const TripParams = z.object({ id: z.string().uuid() });
const DocumentParams = z.object({ documentId: z.string().uuid() });

export const documentsRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const service = createDocumentsService(deps.db, deps.redis, deps.storage, deps.env);
  app.addHook('preHandler', app.authenticate);

  app.get('/trips/:id/documents', async (request) => {
    const { id } = parse(TripParams, request.params);
    return { documents: await service.list(id, request.user.sub) };
  });

  app.post('/trips/:id/documents', async (request, reply) => {
    const { id } = parse(TripParams, request.params);
    const input = parse(CreateDocumentInput, request.body);
    return reply.status(201).send(await service.start(id, request.user.sub, input));
  });

  app.post('/documents/:documentId/complete', async (request) => {
    const { documentId } = parse(DocumentParams, request.params);
    return service.complete(documentId, request.user.sub, originOf(request));
  });

  app.get('/documents/:documentId/url', async (request) => {
    const { documentId } = parse(DocumentParams, request.params);
    return service.link(documentId, request.user.sub);
  });

  app.patch('/documents/:documentId', async (request) => {
    const { documentId } = parse(DocumentParams, request.params);
    const input = parse(UpdateDocumentInput, request.body);
    return service.update(documentId, request.user.sub, input, originOf(request));
  });

  app.delete('/documents/:documentId', async (request, reply) => {
    const { documentId } = parse(DocumentParams, request.params);
    await service.remove(documentId, request.user.sub, originOf(request));
    return reply.status(204).send();
  });
};
