/**
 * `/api/opensky-track` — same handler as `/api/opensky`.
 *
 * The handler branches on the path, but Vercel only routes files that exist, so
 * this alias is what makes the trail endpoint resolve without a rewrite.
 */
export { default } from './opensky.js';
