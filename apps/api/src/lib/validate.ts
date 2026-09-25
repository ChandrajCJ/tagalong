import type { z } from 'zod';

/** Parses untrusted input. A ZodError becomes a 400 in the error handler. */
export const parse = <S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> =>
  schema.parse(data);
