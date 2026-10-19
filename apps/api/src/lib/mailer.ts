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

/** "Tagalong <hi@example.com>" → { name: "Tagalong", email: "hi@example.com" }. */
export const parseAddress = (from: string): { name?: string; email: string } => {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  if (!match) return { email: from.trim() };
  const name = match[1]!.trim();
  return name ? { name, email: match[2]!.trim() } : { email: match[2]!.trim() };
};

/**
 * Sends sign-in codes through Brevo's transactional email API over HTTPS.
 * For hosts that block outgoing SMTP (Render's free plan does). `from` must
 * be a sender verified in Brevo.
 */
export const brevoMailer = (
  apiKey: string,
  from: string,
  { fetch: fetchImpl = fetch, url = 'https://api.brevo.com/v3/smtp/email' }: { fetch?: typeof fetch; url?: string } = {},
): Mailer => ({
  async sendLoginCode(email, code) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: parseAddress(from),
        to: [{ email }],
        subject: `${code} is your Tagalong code`,
        textContent: `Your Tagalong sign-in code is ${code}.\n\nIt works for 10 minutes. If you didn't ask for it, you can ignore this email.`,
        htmlContent: `<p>Your Tagalong sign-in code is</p><p style="font-size:28px;font-weight:600;letter-spacing:4px">${code}</p><p>It works for 10 minutes. If you didn't ask for it, you can ignore this email.</p>`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Brevo refused the email (${response.status}): ${detail.slice(0, 200)}`);
    }
  },
});
