import {
  CreateListInput,
  CreateListItemInput,
  CreateNoteInput,
  UpdateListInput,
  UpdateListItemInput,
  UpdateNoteInput,
} from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { originOf } from '../../lib/events';
import { createNotifier } from '../../lib/notifier';
import { parse } from '../../lib/validate';
import { createNotesService } from './notes';
import { createListsService } from './service';

const TripParams = z.object({ id: z.string().uuid() });
const ListParams = z.object({ listId: z.string().uuid() });
const ListItemParams = z.object({ listItemId: z.string().uuid() });
const NoteParams = z.object({ noteId: z.string().uuid() });

/** Checklists (packing and to-dos) and trip notes. */
export const listsRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const service = createListsService(deps.db, deps.redis, createNotifier(deps.db, deps.redis, deps.jobs));
  const notes = createNotesService(deps.db, deps.redis);
  app.addHook('preHandler', app.authenticate);

  app.get('/trips/:id/lists', async (request) => {
    const { id } = parse(TripParams, request.params);
    return service.overview(id, request.user.sub);
  });

  app.post('/trips/:id/lists', async (request, reply) => {
    const { id } = parse(TripParams, request.params);
    const input = parse(CreateListInput, request.body);
    const { list, created } = await service.createList(id, request.user.sub, input, originOf(request));
    return reply.status(created ? 201 : 200).send(list);
  });

  app.patch('/lists/:listId', async (request) => {
    const { listId } = parse(ListParams, request.params);
    const input = parse(UpdateListInput, request.body);
    return service.updateList(listId, request.user.sub, input, originOf(request));
  });

  app.delete('/lists/:listId', async (request, reply) => {
    const { listId } = parse(ListParams, request.params);
    await service.removeList(listId, request.user.sub, originOf(request));
    return reply.status(204).send();
  });

  /** Answers with the line, and the list too when one was made for it. */
  app.post('/trips/:id/list-items', async (request, reply) => {
    const { id } = parse(TripParams, request.params);
    const input = parse(CreateListItemInput, request.body);
    const { item, created, list } = await service.createItem(id, request.user.sub, input, originOf(request));
    return reply.status(created ? 201 : 200).send({ item, list });
  });

  app.patch('/list-items/:listItemId', async (request) => {
    const { listItemId } = parse(ListItemParams, request.params);
    const input = parse(UpdateListItemInput, request.body);
    return service.updateItem(listItemId, request.user.sub, input, originOf(request));
  });

  app.delete('/list-items/:listItemId', async (request, reply) => {
    const { listItemId } = parse(ListItemParams, request.params);
    await service.removeItem(listItemId, request.user.sub, originOf(request));
    return reply.status(204).send();
  });

  app.post('/list-items/:listItemId/check', async (request) => {
    const { listItemId } = parse(ListItemParams, request.params);
    return service.check(listItemId, request.user.sub, true, originOf(request));
  });

  app.delete('/list-items/:listItemId/check', async (request) => {
    const { listItemId } = parse(ListItemParams, request.params);
    return service.check(listItemId, request.user.sub, false, originOf(request));
  });

  app.post('/list-items/:listItemId/done', async (request) => {
    const { listItemId } = parse(ListItemParams, request.params);
    return service.setDone(listItemId, request.user.sub, true, originOf(request));
  });

  app.delete('/list-items/:listItemId/done', async (request) => {
    const { listItemId } = parse(ListItemParams, request.params);
    return service.setDone(listItemId, request.user.sub, false, originOf(request));
  });

  app.get('/trips/:id/notes', async (request) => {
    const { id } = parse(TripParams, request.params);
    return { notes: await notes.list(id, request.user.sub) };
  });

  app.post('/trips/:id/notes', async (request, reply) => {
    const { id } = parse(TripParams, request.params);
    const input = parse(CreateNoteInput, request.body);
    const { note, created } = await notes.create(id, request.user.sub, input, originOf(request));
    return reply.status(created ? 201 : 200).send(note);
  });

  app.patch('/notes/:noteId', async (request) => {
    const { noteId } = parse(NoteParams, request.params);
    const input = parse(UpdateNoteInput, request.body);
    return notes.update(noteId, request.user.sub, input, originOf(request));
  });

  app.delete('/notes/:noteId', async (request, reply) => {
    const { noteId } = parse(NoteParams, request.params);
    await notes.remove(noteId, request.user.sub, originOf(request));
    return reply.status(204).send();
  });
};
