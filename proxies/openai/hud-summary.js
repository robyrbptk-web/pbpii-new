/**
 * HUD summary route — the intelligence-strip five-word place summary.
 *
 * Mirrors the dev proxy (`/api/openai/hud-summary`): POST with the camera
 * context JSON. Without an OPENAI_API_KEY the route answers the keyless
 * capability payload from lib/hudSummary.js with HTTP 200 — the HUD then
 * keeps its deterministic local summary line instead of printing an error.
 * A key is never required and never leaked.
 */
import { envValue } from '../../lib/proxy.js';
import {
  OPENAI_HUD_SUMMARY_MODEL_DEFAULT,
  extractOpenAiResponseText,
  keylessHudSummaryResponse,
  toFiveWordHudSummary,
} from '../../lib/hudSummary.js';

const MAX_BODY_BYTES = 64 * 1024;

function respond(res, status, payload) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

/** Vercel pre-parses JSON bodies; stream-read when invoked through a rewrite. */
function readBody(req) {
  if (typeof req.body === 'string') return Promise.resolve(req.body);
  if (req.body && typeof req.body === 'object') return Promise.resolve(JSON.stringify(req.body));
  if (typeof req.on !== 'function') return Promise.resolve('{}');
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  const method = String(req.method || 'POST').toUpperCase();
  if (method !== 'POST') {
    respond(res, 405, { error: 'Method not allowed' });
    return;
  }

  const apiKey = envValue('OPENAI_API_KEY');
  const keyless = keylessHudSummaryResponse(apiKey);
  if (keyless) {
    respond(res, keyless.statusCode, keyless.payload);
    return;
  }

  try {
    const body = await readBody(req);
    const context = JSON.parse(body || '{}');
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: envValue('OPENAI_HUD_SUMMARY_MODEL') || OPENAI_HUD_SUMMARY_MODEL_DEFAULT,
        instructions: [
          'Write one concise intelligence-HUD summary for the globe.',
          'Use only the supplied place, street, nearby-place, and enabled-layer text labels.',
          'Prefer the clearest named place and include a relevant enabled layer only when useful.',
          'Do not infer from coordinates or invent a place.',
          'Output exactly five words with no title, punctuation, markdown, or introductory phrase.',
        ].join(' '),
        input: JSON.stringify(context),
        reasoning: { effort: 'minimal' },
        max_output_tokens: 100,
      }),
    });
    const data = await response.json().catch(() => ({}));
    const summary = toFiveWordHudSummary(extractOpenAiResponseText(data));
    respond(res, response.ok && summary ? 200 : response.status || 502, {
      summary: summary || null,
      error: response.ok ? null : data.error?.message || 'OpenAI HUD summary request failed',
    });
  } catch (error) {
    // Never echo the credential or a raw provider error that could contain it.
    console.warn('[hud-summary] failed:', error?.message || error);
    respond(res, 502, { error: 'OpenAI HUD summary request failed' });
  }
}
