/**
 * TomTom key-presence probe for the traffic layer.
 *
 * The globe asks once per session whether live flow tiles are available and
 * falls back to simulated congestion when they are not. Only `hasKey` decides
 * that, so this function never touches TomTom — and never echoes the key.
 *
 * Wired as `/api/tomtom/status` (the file path IS the public path).
 */
import { dailyBudgetLimit, normalizeBudget, utcDayKey } from '../../lib/tomtomTiles.js';

const KEYLESS_BODY = JSON.stringify({
  ok: false,
  error: 'TOMTOM_API_KEY is not configured',
});

/** Warm-instance view of the daily tile counter (each lambda counts its own). */
let budget = null;

function currentBudget() {
  budget = normalizeBudget(budget, utcDayKey());
  return budget;
}

function send(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
    return;
  }

  const apiKey = String(process.env.TOMTOM_API_KEY || '').trim();
  if (!apiKey) {
    // 501 + JSON, never a 404: the globe must read "not wired up", not HTML.
    send(res, 501, KEYLESS_BODY);
    return;
  }

  const state = currentBudget();
  send(res, 200, JSON.stringify({
    ok: true,
    hasKey: true,
    dailyCount: state.count,
    budget: dailyBudgetLimit(),
    date: state.date,
  }));
}
