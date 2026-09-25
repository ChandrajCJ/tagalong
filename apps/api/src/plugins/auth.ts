import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { unauthorized } from '../lib/errors';

export interface AccessClaims {
  sub: string;
  sid: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessClaims;
    user: AccessClaims;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp(async (app: FastifyInstance, opts: { secret: string }) => {
  await app.register(jwt, { secret: opts.secret });

  app.decorate('authenticate', async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw unauthorized();
    }
  });
});
