import type { FastifyBaseLogger } from 'fastify';

export interface Mailer {
  sendLoginCode(email: string, code: string): Promise<void>;
}

/**
 * Development mailer: prints the code in the API log instead of sending email.
 * Swap for a real provider (SES, Postmark) before launch.
 */
export const logMailer = (log: FastifyBaseLogger): Mailer => ({
  async sendLoginCode(email, code) {
    log.info({ email, code }, `Sign-in code for ${email}: ${code}`);
  },
});
