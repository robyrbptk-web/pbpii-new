/**
 * Harga emas, perak, dan kurs untuk kalkulator zakat Ruang Ibadah.
 *
 * Nisab ditentukan dari harga logam hari ini, jadi angka tidak boleh ditulis manual:
 * 85 gram emas atau 595 gram perak (konvensi MUI/BAZNAS) dikalikan harga gram dalam
 * rupiah. Kedua upstream bebas kunci, dan hasil perhitungannya disatukan di sini agar
 * browser tidak pernah melihat salah satu sumbernya sendirian.
 */
import { createTtlCache, sendJson } from './proxy.js';

const GOLD_URL = 'https://api.gold-api.com/price/XAU';
const SILVER_URL = 'https://api.gold-api.com/price/XAG';
const FOREX_URL = 'https://open.er-api.com/v6/latest/USD';
const GRAMS_PER_OUNCE = 31.1034768;
const NISAB_GOLD_GRAMS = 85;
const NISAB_SILVER_GRAMS = 595;

const cache = createTtlCache(30 * 60_000);

async function json(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} (${url})`);
  return response.json();
}

/** Harga satu troy ounce dalam dolar AS → harga satu gram dalam rupiah. */
function perGramInRupiah(usdPerOunce, usdToIdr) {
  return (usdPerOunce / GRAMS_PER_OUNCE) * usdToIdr;
}

/** `/zakat` — harga emas, perak, kurs, dan dua ambang nisab hari ini. */
export async function zakatHandler(req, res) {
  try {
    const { value, state } = await cache.get(async () => {
      const [gold, silver, forex] = await Promise.all([json(GOLD_URL), json(SILVER_URL), json(FOREX_URL)]);
      const usdToIdr = Number(forex?.rates?.IDR);
      const goldUsd = Number(gold?.price);
      const silverUsd = Number(silver?.price);
      if (!(usdToIdr > 0) || !(goldUsd > 0) || !(silverUsd > 0)) {
        throw new Error('Harga acuan tidak lengkap');
      }
      const goldPerGram = perGramInRupiah(goldUsd, usdToIdr);
      const silverPerGram = perGramInRupiah(silverUsd, usdToIdr);
      return {
        usdToIdr: Math.round(usdToIdr),
        goldPerGramIdr: Math.round(goldPerGram),
        silverPerGramIdr: Math.round(silverPerGram),
        nisabGoldGrams: NISAB_GOLD_GRAMS,
        nisabSilverGrams: NISAB_SILVER_GRAMS,
        nisabGoldIdr: Math.round(goldPerGram * NISAB_GOLD_GRAMS),
        nisabSilverIdr: Math.round(silverPerGram * NISAB_SILVER_GRAMS),
        ratesAt: String(forex?.time_last_update_utc || gold?.updatedAt || ''),
      };
    });

    sendJson(res, 200, { success: true, data: value }, state);
  } catch (error) {
    console.warn('[zakat] upstream unavailable:', error?.message || error);
    sendJson(res, 502, { success: false, error: 'Harga emas dan kurs sedang tidak tersedia, coba lagi sebentar.' }, 'miss');
  }
}
