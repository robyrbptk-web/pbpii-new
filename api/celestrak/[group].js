/**
 * `/api/celestrak/<group>` as a real route instead of only a rewrite.
 *
 * The rewrite in vercel.json maps the same path onto the query parameter, which
 * works until the catch-all `api/[...path].js` exists. Keeping an explicit named
 * route means the satellite layer resolves the same way on Vercel and locally.
 */
export { default } from '../celestrak.js';
