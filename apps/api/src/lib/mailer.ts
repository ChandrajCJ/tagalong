import type { FastifyBaseLogger } from 'fastify';
import nodemailer from 'nodemailer';

export interface Mailer {
  sendLoginCode(email: string, code: string): Promise<void>;
}

/** Development mailer: prints the code in the API log instead of sending email. */
export const logMailer = (log: FastifyBaseLogger): Mailer => ({
  async sendLoginCode(email, code) {
    log.info({ email, code }, `Sign-in code for ${email}: ${code}`);
  },
});

/**
 * Sends sign-in codes through any SMTP server, given as a URL such as
 * smtps://you%40gmail.com:app-password@smtp.gmail.com:465. A free Gmail
 * account with an app password is enough for a group of friends.
 */
export const smtpMailer = (smtpUrl: string, from: string): Mailer => {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async sendLoginCode(email, code) {
      await transport.sendMail({
        from,
        to: email,
        subject: `${code} is your Tagalong code`,
        text: `Your Tagalong sign-in code is ${code}.\n\nIt works for 10 minutes. If you didn't ask for it, you can ignore this email.`,
        html: `<p>Your Tagalong sign-in code is</p><p style="font-size:28px;font-weight:600;letter-spacing:4px">${code}</p><p>It works for 10 minutes. If you didn't ask for it, you can ignore this email.</p>`,
      });
    },
  };
};
