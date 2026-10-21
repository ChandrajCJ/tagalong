/**
 * Render's free plan stops a web service after 15 minutes without incoming
 * requests, and the next visitor waits about a minute for it to start again.
 * Background jobs and timers don't count, only requests through Render's front
 * door do, so while awake the server asks its own public address for /health
 * every few minutes. It can't wake itself once stopped (after a restart the
 * first visitor or an outside pinger does that), but it never dozes off on its
 * own. Render sets RENDER_EXTERNAL_URL for every web service.
 */
export const startKeepAwake = (
  publicUrl: string | undefined,
  log: { warn: (o: object, msg: string) => void },
  { everyMs = 10 * 60_000, fetchImpl = fetch }: { everyMs?: number; fetchImpl?: typeof fetch } = {},
) => {
  if (!publicUrl) return () => {};
  const url = `${publicUrl.replace(/\/$/, '')}/health`;
  const timer = setInterval(() => {
    fetchImpl(url, { headers: { 'user-agent': 'tagalong-keep-awake' }, signal: AbortSignal.timeout(30_000) })
      .then((res) => {
        if (!res.ok) log.warn({ url, status: res.status }, 'Keep-awake ping got an error');
      })
      .catch((err: unknown) => log.warn({ url, err: String(err) }, 'Keep-awake ping failed'));
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
};
