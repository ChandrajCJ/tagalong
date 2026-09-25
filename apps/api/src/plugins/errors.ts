import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors';

export const errorsPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'validation_failed',
        message: error.issues[0]?.message ?? 'Invalid input',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: 'request_error', message: (error as Error).message });
    }
    request.log.error(error);
    return reply.status(500).send({ error: 'internal', message: 'Something went wrong' });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: 'not_found', message: 'Not found' }),
  );
});
