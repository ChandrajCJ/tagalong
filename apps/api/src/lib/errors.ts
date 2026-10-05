export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    /** Extra fields sent with the error, such as the current copy on a conflict. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'bad_request') =>
  new HttpError(400, code, message);
export const unauthorized = (message = 'Sign in again to continue') =>
  new HttpError(401, 'unauthorized', message);
export const forbidden = (message = "You don't have access to do that") =>
  new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (message: string, details?: Record<string, unknown>) =>
  new HttpError(409, 'conflict', message, details);
export const tooMany = (message: string) => new HttpError(429, 'too_many_requests', message);
