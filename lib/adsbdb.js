/**
 * Shared client for the adsBDB aircraft/route lookups.
 *
 * The globe enriches every visible aircraft, so a single map frame can fire
 * sixty lookups at once and adsBDB answers that burst with 429s. Requests are
 * therefore queued two-at-a-time (they are cached for a day, so the queue only
 * runs on fresh hexes), and a rejected request puts the upstream on a short
 * cooldown instead of being retried immediately.
 */

const MAX_CONCURRENT = 2;
const COOLDOWN_MS = 15_000;
const PER_REQUEST_TIMEOUT_MS = 8_000;

let active = 0;
let cooldownUntil = 0;
/** @type {Array<() => void>} */
const waiters = [];

function acquire() {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(() => { active += 1; resolve(); }));
}

function release() {
  active -= 1;
  const next = waiters.shift();
  if (next) next();
}

/** Throwing (not returning a miss) keeps a rate limit from being cached as "aircraft unknown". */
export class AdsbdbUnavailable extends Error {}

/**
 * Fetch the first candidate URL that yields a usable JSON body.
 *
 * @param {string[]} urls tried in order
 * @param {(json: any) => any} parse narrows the payload, or returns null to keep trying
 * @returns {Promise<any>} parsed value, or null when every candidate answered cleanly with nothing
 */
export async function fetchAdsbdb(urls, parse) {
  if (Date.now() < cooldownUntil) throw new AdsbdbUnavailable('adsBDB is rate-limiting this instance');
  await acquire();
  try {
    let sawNetworkError = false;
    for (const url of urls) {
      try {
        const upstream = await fetch(url, {
          signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
          headers: { Accept: 'application/json', 'User-Agent': 'pii-global-view/1.0' },
          redirect: 'follow',
        });
        if (upstream.status === 429 || upstream.status === 402) {
          cooldownUntil = Date.now() + COOLDOWN_MS;
          throw new AdsbdbUnavailable(`adsBDB rate limit (HTTP ${upstream.status})`);
        }
        if (!upstream.ok) continue;
        const value = parse(await upstream.json());
        if (value) return value;
      } catch (error) {
        if (error instanceof AdsbdbUnavailable) throw error;
        sawNetworkError = true;
      }
    }
    if (sawNetworkError) throw new AdsbdbUnavailable('adsBDB unreachable');
    return null;
  } finally {
    release();
  }
}
