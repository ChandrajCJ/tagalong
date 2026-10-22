import {
  AddJournalCommentInput,
  CreateJournalEntryInput,
  SaveToJournalInput,
  ToggleReactionInput,
  UpdateJournalEntryInput,
} from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { originOf } from '../../lib/events';
import { parse } from '../../lib/validate';
import { createPhotosService } from '../photos/service';
import { createJournalService } from './service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const TripParams = z.object({ id: z.string().uuid() });
const DayParams = TripParams.extend({ date: isoDate });
const EntryParams = z.object({ entryId: z.string().uuid() });
const CommentParams = z.object({ commentId: z.string().uuid() });
const MessageParams = z.object({ messageId: z.string().uuid() });
const RangeQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });
const TodayQuery = z.object({ today: isoDate.optional() });

export const journalRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const photos = createPhotosService(deps.db, deps.redis, deps.storage, deps.jobs, deps.env);
  const service = createJournalService(deps.db, deps.redis, photos.byIds, deps.storage, deps.env.S3_URL_TTL_SEC);
  app.addHook('preHandler', app.authenticate);

  app.get('/trips/:id/journal', async (request) => {
    const { id } = parse(TripParams, request.params);
    return service.days(id, request.user.sub, parse(RangeQuery, request.query));
  });

  app.get('/trips/:id/journal/:date', async (request) => {
    const { id, date } = parse(DayParams, request.params);
    return service.day(id, request.user.sub, date);
  });

  app.post('/trips/:id/journal', async (request, reply) => {
    const { id } = parse(TripParams, request.params);
    const input = parse(CreateJournalEntryInput, request.body);
    const { entry, created } = await service.create(id, request.user.sub, input, originOf(request));
    return reply.status(created ? 201 : 200).send(entry);
  });

  app.patch('/journal/:entryId', async (request) => {
    const { entryId } = parse(EntryParams, request.params);
    const input = parse(UpdateJournalEntryInput, request.body);
    return service.update(entryId, request.user.sub, input, originOf(request));
  });

  app.delete('/journal/:entryId', async (request, reply) => {
    const { entryId } = parse(EntryParams, request.params);
    await service.remove(entryId, request.user.sub, originOf(request));
    return reply.status(204).send();
  });

  app.post('/journal/:entryId/reactions', async (request) => {
    const { entryId } = parse(EntryParams, request.params);
    const { emoji } = parse(ToggleReactionInput, request.body);
    return service.toggleReaction(entryId, request.user.sub, emoji, originOf(request));
  });

  app.post('/journal/:entryId/comments', async (request, reply) => {
    const { entryId } = parse(EntryParams, request.params);
    const input = parse(AddJournalCommentInput, request.body);
    return reply.status(201).send(await service.addComment(entryId, request.user.sub, input, originOf(request)));
  });

  app.delete('/journal-comments/:commentId', async (request, reply) => {
    const { commentId } = parse(CommentParams, request.params);
    await service.removeComment(commentId, request.user.sub, originOf(request));
    return reply.status(204).send();
  });

  app.post('/messages/:messageId/save-to-journal', async (request, reply) => {
    const { messageId } = parse(MessageParams, request.params);
    const input = parse(SaveToJournalInput, request.body ?? {});
    const { entry, created } = await service.saveMessage(messageId, request.user.sub, input, originOf(request));
    return reply.status(created ? 201 : 200).send(entry);
  });

  app.get('/trips/:id/recap', async (request) => {
    const { id } = parse(TripParams, request.params);
    return service.recap(id, request.user.sub);
  });

  app.get('/me/memories', async (request) => {
    const { today } = parse(TodayQuery, request.query);
    return service.memories(request.user.sub, today ?? new Date().toISOString().slice(0, 10));
  });
};
