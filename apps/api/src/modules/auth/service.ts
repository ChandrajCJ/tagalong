import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { authIdentities, devices, loginCodes, sessions, users } from '@tagalong/db';
import type { AuthTokens, Me } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../deps';
import { randomCode, randomToken, safeEqual, sha256 } from '../../lib/crypto';
import { badRequest, tooMany, unauthorized } from '../../lib/errors';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODES_PER_WINDOW = 5;
const MAX_ATTEMPTS = 5;

export const createAuthService = (app: FastifyInstance, deps: Deps) => {
  const { db, env, mailer } = deps;

  const issueTokens = async (userId: string, sessionId: string, refreshToken: string) => {
    const accessToken = app.jwt.sign(
      { sub: userId, sid: sessionId },
      { expiresIn: env.ACCESS_TOKEN_TTL_SEC },
    );
    return { accessToken, refreshToken, expiresIn: env.ACCESS_TOKEN_TTL_SEC } satisfies AuthTokens;
  };

  const refreshExpiry = () => new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

  return {
    async requestCode(email: string) {
      const windowStart = new Date(Date.now() - CODE_TTL_MS);
      const [recent] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(loginCodes)
        .where(and(eq(loginCodes.email, email), gt(loginCodes.createdAt, windowStart)));
      if ((recent?.n ?? 0) >= MAX_CODES_PER_WINDOW) {
        throw tooMany('Too many codes requested. Try again in a few minutes.');
      }

      const code = randomCode();
      await db.insert(loginCodes).values({
        email,
        codeHash: sha256(`${email}:${code}`),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      });
      await mailer.sendLoginCode(email, code);
    },

    async verifyCode(email: string, code: string, deviceName?: string) {
      const [row] = await db
        .select()
        .from(loginCodes)
        .where(
          and(
            eq(loginCodes.email, email),
            isNull(loginCodes.consumedAt),
            gt(loginCodes.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(loginCodes.createdAt))
        .limit(1);

      if (!row) throw badRequest('That code has expired. Request a new one.', 'invalid_code');
      if (row.attempts >= MAX_ATTEMPTS) {
        throw tooMany('Too many wrong attempts. Request a new code.');
      }
      if (!safeEqual(row.codeHash, sha256(`${email}:${code}`))) {
        await db
          .update(loginCodes)
          .set({ attempts: sql`${loginCodes.attempts} + 1` })
          .where(eq(loginCodes.id, row.id));
        throw badRequest("That code isn't right. Check it and try again.", 'invalid_code');
      }

      const refreshToken = randomToken();
      const { userId, sessionId } = await db.transaction(async (tx) => {
        await tx.update(loginCodes).set({ consumedAt: new Date() }).where(eq(loginCodes.id, row.id));

        let [user] = await tx
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.email}) = ${email}`)
          .limit(1);
        if (!user) {
          [user] = await tx
            .insert(users)
            .values({ email, displayName: email.split('@')[0] ?? email })
            .returning({ id: users.id });
          if (!user) throw new Error('Failed to create user');
        }
        await tx
          .insert(authIdentities)
          .values({ userId: user.id, provider: 'email', providerUserId: email })
          .onConflictDoNothing();

        let deviceId: string | undefined;
        if (deviceName) {
          const [device] = await tx
            .insert(devices)
            .values({ userId: user.id, name: deviceName })
            .returning({ id: devices.id });
          deviceId = device?.id;
        }

        const [session] = await tx
          .insert(sessions)
          .values({
            userId: user.id,
            deviceId,
            refreshTokenHash: sha256(refreshToken),
            expiresAt: refreshExpiry(),
          })
          .returning({ id: sessions.id });
        if (!session) throw new Error('Failed to create session');
        return { userId: user.id, sessionId: session.id };
      });

      return issueTokens(userId, sessionId, refreshToken);
    },

    /** Rotates the refresh token: the old one stops working. */
    async refresh(refreshToken: string) {
      const newToken = randomToken();
      const [session] = await db
        .update(sessions)
        .set({ refreshTokenHash: sha256(newToken), expiresAt: refreshExpiry() })
        .where(
          and(
            eq(sessions.refreshTokenHash, sha256(refreshToken)),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, new Date()),
          ),
        )
        .returning({ id: sessions.id, userId: sessions.userId });
      if (!session) throw unauthorized();
      return issueTokens(session.userId, session.id, newToken);
    },

    async logout(sessionId: string) {
      await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
    },

    async me(userId: string): Promise<Me> {
      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          homeCurrency: users.homeCurrency,
        })
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .limit(1);
      if (!user) throw unauthorized();
      return user;
    },
  };
};
