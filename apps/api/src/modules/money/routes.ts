import { CreateExpenseInput, CreateSettlementInput, UpdateExpenseInput } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { originOf } from '../../lib/events';
import { parse } from '../../lib/validate';
import { createMoneyService } from './service';

const TripParams = z.object({ id: z.string().uuid() });
const ExpenseParams = z.object({ expenseId: z.string().uuid() });
const SettlementParams = z.object({ settlementId: z.string().uuid() });
const currency = z.string().trim().length(3).toUpperCase();
const QuoteQuery = z.object({ from: currency, to: currency });

export const moneyRoutes = async (app: FastifyInstance, { deps }: { deps: Deps }) => {
  const service = createMoneyService(deps.db, deps.redis, deps.rates);
  app.addHook('preHandler', app.authenticate);

  app.get('/fx', async (request) => {
    const { from, to } = parse(QuoteQuery, request.query);
    return service.quote(from, to);
  });

  app.get('/trips/:id/money', async (request) => {
    const { id } = parse(TripParams, request.params);
    return service.summary(id, request.user.sub);
  });

  app.post('/trips/:id/expenses', async (request, reply) => {
    const { id } = parse(TripParams, request.params);
    const input = parse(CreateExpenseInput, request.body);
    const { expense, created } = await service.create(id, request.user.sub, input, originOf(request));
    return reply.status(created ? 201 : 200).send(expense);
  });

  app.patch('/expenses/:expenseId', async (request) => {
    const { expenseId } = parse(ExpenseParams, request.params);
    const input = parse(UpdateExpenseInput, request.body);
    return service.update(expenseId, request.user.sub, input, originOf(request));
  });

  app.delete('/expenses/:expenseId', async (request, reply) => {
    const { expenseId } = parse(ExpenseParams, request.params);
    await service.removeExpense(expenseId, request.user.sub, originOf(request));
    return reply.status(204).send();
  });

  app.post('/trips/:id/settlements', async (request, reply) => {
    const { id } = parse(TripParams, request.params);
    const input = parse(CreateSettlementInput, request.body);
    const { settlement, created } = await service.settle(id, request.user.sub, input, originOf(request));
    return reply.status(created ? 201 : 200).send(settlement);
  });

  app.delete('/settlements/:settlementId', async (request, reply) => {
    const { settlementId } = parse(SettlementParams, request.params);
    await service.removeSettlement(settlementId, request.user.sub, originOf(request));
    return reply.status(204).send();
  });
};
