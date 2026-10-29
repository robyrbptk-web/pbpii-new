/**
 * Shared helpers for the PII Global View data proxies.
 *
 * These run as Vercel serverless functions in the same deployment as the
 * public site, so `/peta/` (the embedded globe) can call them same-origin
 * without a separate proxy host or any key reaching the browser.
 */

/** Write a JSON response once, tagging cache provenance for debugging. */
export function sendJson(res, status, body, cacheState = 'miss') {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': status === 200 ? 'public, max-age=3600' : 'no-store',
    'X-PII-Cache': cacheState,
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

/**
 * Module-level TTL cache with in-flight coalescing.
 *
 * Vercel keeps a warm instance alive between requests, so one fetch serves a
 * burst of globe/tab reloads. On an upstream failure a stale entry is still
 * better than an error, so it is served instead of throwing.
 */
export function createTtlCache(ttlMs) {
  let entry = null;
  let pending = null;

  return {
    async get(produce) {
      if (entry && Date.now() - entry.at < ttlMs) {
        return { value: entry.value, state: 'hit' };
      }
      if (pending) {
        return { value: await pending, state: 'coalesced' };
      }

      pending = produce().then((value) => {
        entry = { at: Date.now(), value };
        return value;
      });

      try {
        return { value: await pending, state: 'miss' };
      } catch (error) {
        if (entry) return { value: entry.value, state: 'stale' };
        throw error;
      } finally {
        pending = null;
      }
    },
  };
}

/** Trimmed env var or an empty string. */
export function envValue(name) {
  return String(process.env[name] || '').trim();
}
