/**
 * HUD summary helpers, ported verbatim from the globe's source
 * (gods-eye-view/src/hudSummaryResponse.js and the HUD branch of its
 * vite.config.js) so the serverless route answers with EXACTLY the payload
 * the embedded HUD checks for.
 *
 * The keyless branch is the normal one on this website: no OPENAI_API_KEY is
 * required, and a deliberately keyless boot must stay an HTTP 200 capability
 * note, not an error the globe prints inside a panel.
 */

export const HUD_SUMMARY_UNCONFIGURED_CODE = 'OPENAI_NOT_CONFIGURED';

/** Default summary model; override with the OPENAI_HUD_SUMMARY_MODEL env var. */
export const OPENAI_HUD_SUMMARY_MODEL_DEFAULT = 'gpt-5-nano';

/**
 * Describe the optional HUD summary capability without turning a deliberately
 * keyless boot into an HTTP failure.
 *
 * @param {unknown} apiKey - Candidate server-side OpenAI credential.
 * @returns {{ statusCode: 200, payload: { configured: false, code: string, error: null, summary: null } }|null}
 *   A graceful unconfigured response, or null when the provider is configured.
 */
export function keylessHudSummaryResponse(apiKey) {
  if (String(apiKey ?? '').trim()) return null;
  return {
    statusCode: 200,
    payload: {
      configured: false,
      code: HUD_SUMMARY_UNCONFIGURED_CODE,
      error: null,
      summary: null,
    },
  };
}

/** Concatenate every text part an OpenAI /v1/responses payload may carry. */
export function extractOpenAiResponseText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }
  if (!Array.isArray(data?.output)) return '';
  return data.output
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((part) => part?.text || part?.output_text || '')
    .join(' ')
    .trim();
}

/** Trim model chatter down to the five bare words the HUD line can render. */
export function toFiveWordHudSummary(value) {
  return String(value || '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(' ');
}
