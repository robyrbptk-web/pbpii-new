import { createTtlCache } from './proxy.js';
import { getSources } from './cctv.js';
import { alerts, earthquakes, flights, hotspots, volcanoes } from './situasi-alam.js';

export const CITIES = Object.freeze({
  jakarta: { name: 'Jakarta', lat: -6.2, lon: 106.85 },
  bandung: { name: 'Bandung', lat: -6.9175, lon: 107.6191 },
  medan: { name: 'Medan', lat: 3.5952, lon: 98.6722 },
  surabaya: { name: 'Surabaya', lat: -7.2575, lon: 112.7521 },
  pontianak: { name: 'Pontianak', lat: -0.0263, lon: 109.3425 },
  makassar: { name: 'Makassar', lat: -5.1477, lon: 119.4327 },
  denpasar: { name: 'Denpasar', lat: -8.65, lon: 115.2167 },
  jayapura: { name: 'Jayapura', lat: -2.5337, lon: 140.7181 },
});

export async function fetchSource(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'PBPII-Ruang-Situasi/1.0', Accept: 'application/json, application/xml, application/rss+xml, text/html' },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Sumber menjawab HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 3_500_000) {
      await reader.cancel();
      throw new Error('Respons sumber terlalu besar');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function plainText(value) {
  return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
      const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
    }).replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[name])
    .replace(/\s+/g, ' ').trim();
}

export function xmlValue(xml, name) {
  return plainText(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(xml)?.[1] || '');
}

export function safeLink(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function parseRss(xml, source) {
  if (!/<rss\b|<feed\b/i.test(xml)) throw new Error('Sumber tidak mengirim umpan berita');
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0, 40).map(([, body]) => ({
    title: xmlValue(body, 'title'),
    url: safeLink(xmlValue(body, 'link')),
    time: xmlValue(body, 'pubDate'),
    source: xmlValue(body, 'source') || source,
    summary: xmlValue(body, 'description').slice(0, 220),
    traffic: xmlValue(body, 'ht:approx_traffic'),
    related: safeLink(xmlValue(body, 'ht:news_item_url')),
  })).filter((item) => item.title && item.url);
}

const NEWS = [
  ['ANTARA', 'https://www.antaranews.com/rss/terkini'],
  ['BBC Indonesia', 'https://feeds.bbci.co.uk/indonesia/rss.xml'],
  ['CNBC Indonesia', 'https://www.cnbcindonesia.com/rss'],
];
const OPINION_URL = 'https://news.google.com/rss/search?q=opini+Indonesia+when:2d&hl=id&gl=ID&ceid=ID:id';
const TREND_URL = 'https://trends.google.com/trending/rss?geo=ID';

async function news() {
  const packs = await Promise.allSettled(NEWS.map(async ([name, url]) => parseRss(await fetchSource(url), name)));
  const items = packs.filter((p) => p.status === 'fulfilled').flatMap((p) => p.value);
  if (!items.length) throw new Error('Umpan berita belum dapat diambil');
  const seen = new Set();
  return {
    items: items.filter((item) => !seen.has(item.url) && seen.add(item.url)).sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0)).slice(0, 65),
    source: 'ANTARA · BBC Indonesia · CNBC Indonesia',
    note: 'Judul dan ringkasan dari penerbit. Buka sumber untuk membaca berita lengkap.',
    partial: packs.some((p) => p.status === 'rejected'),
  };
}

async function trends() {
  const [trend, opinion] = await Promise.allSettled([
    fetchSource(TREND_URL).then((s) => parseRss(s, 'Google Trends')),
    fetchSource(OPINION_URL).then((s) => parseRss(s, 'Google News')),
  ]);
  if (trend.status === 'rejected' && opinion.status === 'rejected') throw new Error('Umpan opini dan tren belum dapat diambil');
  return { items: trend.status === 'fulfilled' ? trend.value : [], opinions: opinion.status === 'fulfilled' ? opinion.value : [],
    source: 'Google Trends · Google News', note: 'Tren pencarian bukan sentimen media sosial. Opini adalah pendapat penulis, bukan fakta terverifikasi. Umpan langsung X, Instagram, dan TikTok tidak disertakan.', partial: trend.status !== 'fulfilled' || opinion.status !== 'fulfilled' };
}

const STOCKS = ['^JKSE', 'BBCA.JK', 'BBRI.JK', 'BMRI.JK', 'TLKM.JK', 'ASII.JK', 'ANTM.JK', 'ICBP.JK'];
async function markets() {
  const packs = await Promise.allSettled(STOCKS.map(async (symbol) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=15m`;
    const data = JSON.parse(await fetchSource(url)).chart?.result?.[0];
    if (!data || !Number.isFinite(data.meta?.regularMarketPrice)) throw new Error('Harga tidak tersedia');
    const m = data.meta;
    const previous = m.chartPreviousClose || m.previousClose;
    const change = m.regularMarketPrice - previous;
    return { title: symbol === '^JKSE' ? 'IHSG' : symbol.replace('.JK', ''), name: m.longName || m.shortName || symbol,
      price: m.regularMarketPrice, change, percent: previous ? 100 * change / previous : null,
      currency: m.currency, time: new Date(m.regularMarketTime * 1000).toISOString(),
      points: (data.indicators?.quote?.[0]?.close || []).filter(Number.isFinite) };
  }));
  const items = packs.filter((p) => p.status === 'fulfilled').map((p) => p.value);
  if (!items.length) throw new Error('Harga pasar belum dapat diambil');
  return { items, source: 'Yahoo Finance · Bursa Efek Indonesia', note: 'Harga indikatif dapat tertunda; waktu transaksi tertera per instrumen. Bukan rekomendasi investasi.', partial: items.length < STOCKS.length };
}

async function weather(city) {
  const position = CITIES[city];
  const query = `latitude=${position.lat}&longitude=${position.lon}&timezone=Asia%2FJakarta`;
  const [forecast, air] = await Promise.allSettled([
    fetchSource(`https://api.open-meteo.com/v1/forecast?${query}&current=temperature_2m,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability&forecast_days=2`).then(JSON.parse),
    fetchSource(`https://air-quality-api.open-meteo.com/v1/air-quality?${query}&current=pm2_5,us_aqi,pm10`).then(JSON.parse),
  ]);
  if (forecast.status === 'rejected' && air.status === 'rejected') throw new Error('Cuaca belum dapat diambil');
  return { city: position, current: forecast.value?.current || null, hourly: forecast.value?.hourly || null, air: air.value?.current || null,
    items: [], source: 'Open-Meteo · CAMS', note: 'Prakiraan/model cuaca dan kualitas udara, bukan pengukuran stasiun AQMS. Semua waktu dalam WIB.', partial: forecast.status !== 'fulfilled' || air.status !== 'fulfilled' };
}

async function radar() {
  const data = JSON.parse(await fetchSource('https://api.rainviewer.com/public/weather-maps.json'));
  const frames = (data.radar?.past || []).filter((item) => /^\/v2\/radar\/[a-z0-9]+$/i.test(item.path) && Number.isFinite(item.time));
  if (!frames.length) throw new Error('Citra radar belum tersedia');
  return { items: frames, source: 'RainViewer', note: 'Cakupan radar bergantung stasiun yang tersedia. Area tanpa warna tidak selalu berarti tidak hujan.' };
}

const LOADERS = {
  berita: news, tren: trends, pasar: markets, cuaca: weather, radar,
  gempa: earthquakes, peringatan: alerts, gunung: volcanoes, hotspot: hotspots, pesawat: flights,
  cctv: async () => ({ items: await getSources(), source: 'JakCCTV · ATCS · BPJT', note: 'Ketersediaan video bergantung pengelola kamera. Status video diperiksa saat diputar.' }),
};
const TTL = {
  berita: 300_000, tren: 900_000, pasar: 120_000, cuaca: 600_000, radar: 300_000, cctv: 300_000,
  gempa: 120_000, peringatan: 300_000, gunung: 3_600_000, hotspot: 1_800_000,
  // OpenSky gives anonymous clients about 100 fetches/day for this bounding
  // box, so its snapshot must stay cached rather than polled like a local feed.
  pesawat: 1_800_000,
};
const caches = new Map();

export async function getSituation(kind, city = 'jakarta') {
  if (!Object.hasOwn(LOADERS, kind) || !Object.hasOwn(CITIES, city)) throw Object.assign(new Error('Pilihan data tidak dikenali'), { status: 400 });
  const key = `${kind}:${kind === 'cuaca' ? city : ''}`;
  if (!caches.has(key)) caches.set(key, createTtlCache(TTL[kind] || 300_000));
  const { value, state } = await caches.get(key).get(async () => ({ ...await LOADERS[kind](city), fetchedAt: new Date().toISOString() }));
  return { ...value, cache: state };
}
