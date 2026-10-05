import { MarkReadInput, SendMessageInput, ToggleReactionInput } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { originOf } from '../../lib/events';
import { parse } from '../../lib/validate';
import { createChatService } from './service';

const TripParams = z.object({ id: z.string().uuid() });
const MessageParams = z.object({ messageId: z.string().uuid() });
const PageQuery = z.object({
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const chatRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const chat = createChatService(deps.db, deps.redis, deps.jobs);
  app.addHook('preHandler', app.authenticate);

  app.get('/trips/:id/messages', async (request) => {
    const { id } = parse(TripParams, request.params);
    const { before, limit } = parse(PageQuery, request.query);
    return chat.list(id, request.user.sub, before, limit);
  });

  app.post('/trips/:id/messages', async (request, reply) => {
    const { id } = parse(TripParams, request.params);
    const input = parse(SendMessageInput, request.body);
    const { message, created } = await chat.send(id, request.user.sub, input, originOf(request));
    return reply.status(created ? 201 : 200).send(message);
  });

  app.post('/messages/:messageId/reactions', async (request) => {
    const { messageId } = parse(MessageParams, request.params);
    const { emoji } = parse(ToggleReactionInput, request.body);
    return chat.toggleReaction(messageId, request.user.sub, emoji, originOf(request));
  });

  app.post('/trips/:id/read', async (request) => {
    const { id } = parse(TripParams, request.params);
    const { messageId } = parse(MarkReadInput, request.body);
    return chat.markRead(id, request.user.sub, messageId, originOf(request));
  });
};
