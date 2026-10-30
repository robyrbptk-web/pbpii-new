/**
 * Semua proxy data PB PII dan PII Global View lewat satu fungsi.
 *
 * Vercel Hobby menolak deployment dengan lebih dari 12 Serverless Functions, dan
 * proyek ini punya 39 proxy — sebelumnya setiap berkas di api/ menjadi satu
 * fungsi sehingga build gagal dalam hitungan detik ("No more than 12 Serverless
 * Functions can be added to a Deployment on the Hobby plan"). Seluruh proxy
 * sekarang hidup di proxies/ dan hanya berkas di api/ yang dihitung Vercel, jadi
 * satu router ini melayani semuanya. Impornya sengaja statis: Vercel menelusuri
 * dependensi fungsi dari pernyataan import, jadi import dinamis akan berujung
 * "Cannot find module" saat runtime.
 */
import adsbdbRoute from '../proxies/adsbdb/route/[code].js';
import adsbdbType from '../proxies/adsbdb/type/[type].js';
import adsblolMil from '../proxies/adsblol/mil.js';
import adsblolTrace from '../proxies/adsblol/trace.js';
import cctvFrame from '../proxies/cctv/frame/[id].js';
import cctvHealth from '../proxies/cctv/health.js';
import cctvMedia from '../proxies/cctv/media/[id].js';
import cctvSources from '../proxies/cctv/sources.js';
import celestrak from '../proxies/celestrak.js';
import celestrakGroup from '../proxies/celestrak/[group].js';
import firms from '../proxies/firms.js';
import gbfs from '../proxies/gbfs/[slug].js';
import geocodeJson from '../proxies/geocode/json.js';
import indonesiaHospitals from '../proxies/indonesia/hospitals.js';
import indonesiaTransjakarta from '../proxies/indonesia/transjakarta.js';
import launches from '../proxies/launches.js';
import militaryInstallations from '../proxies/military-installations.js';
import muslimJadwal from '../proxies/muslim/jadwal.js';
import muslimKalender from '../proxies/muslim/kalender.js';
import muslimKota from '../proxies/muslim/kota.js';
import muslimQibla from '../proxies/muslim/qibla.js';
import muslimQuran from '../proxies/muslim/quran.js';
import openaiHudSummary from '../proxies/openai/hud-summary.js';
import opensky from '../proxies/opensky.js';
import openskyTrack from '../proxies/opensky-track.js';
import overpass from '../proxies/overpass.js';
import radioClick from '../proxies/radio/click/[id].js';
import radioStations from '../proxies/radio/stations.js';
import regionalBrief from '../proxies/regional-brief.js';
import globeRoute from '../proxies/route.js';
import sekolah from '../proxies/sekolah.js';
import setupKeys from '../proxies/setup/keys.js';
import setupStatus from '../proxies/setup/status.js';
import terrainHeights from '../proxies/terrain/heights.js';
import tomtomFlow from '../proxies/tomtom/flow/[z]/[x]/[y].js';
import tomtomStatus from '../proxies/tomtom/status.js';
import volcanoes from '../proxies/volcanoes.js';
import weatherEffects from '../proxies/weather-effects.js';
import wilayah from '../proxies/wilayah.js';

/** Pola `:nama` ditafsirkan sama seperti Vercel pada nama berkas `[nama].js`. */
const ROUTES = [
  ['adsbdb/route/:code', adsbdbRoute],
  ['adsbdb/type/:type', adsbdbType],
  ['adsblol/mil', adsblolMil],
  ['adsblol/trace', adsblolTrace],
  ['cctv/health', cctvHealth],
  ['cctv/sources', cctvSources],
  ['cctv/frame/:id', cctvFrame],
  ['cctv/media/:id', cctvMedia],
  ['celestrak', celestrak],
  ['celestrak/:group', celestrakGroup],
  ['firms', firms],
  ['gbfs/:slug', gbfs],
  ['geocode/json', geocodeJson],
  ['indonesia/hospitals', indonesiaHospitals],
  ['indonesia/transjakarta', indonesiaTransjakarta],
  ['launches', launches],
  ['military-installations', militaryInstallations],
  ['muslim/jadwal', muslimJadwal],
  ['muslim/kalender', muslimKalender],
  ['muslim/kota', muslimKota],
  ['muslim/qibla', muslimQibla],
  ['muslim/quran', muslimQuran],
  ['openai/hud-summary', openaiHudSummary],
  ['opensky', opensky],
  ['opensky-track', openskyTrack],
  ['overpass', overpass],
  ['radio/stations', radioStations],
  ['radio/click/:id', radioClick],
  ['regional-brief', regionalBrief],
  ['route', globeRoute],
  ['sekolah', sekolah],
  ['setup/keys', setupKeys],
  ['setup/status', setupStatus],
  ['terrain/heights', terrainHeights],
  ['tomtom/status', tomtomStatus],
  ['tomtom/flow/:z/:x/:y', tomtomFlow],
  ['volcanoes', volcanoes],
  ['weather-effects', weatherEffects],
  ['wilayah', wilayah],
];

/**
 * Celah yang memang tidak bisa dilayani serverless. Balasan 501 dengan alasan
 * khusus membuat panel globe menampilkan penjelasan, bukan teks 404 Vercel.
 */
const UNAVAILABLE = [
  {
    prefix: '/api/ais-live',
    reason: 'Layer kapal butuh koneksi WebSocket AISStream dan kunci AISSTREAM_TOKEN — tidak bisa dijalankan sebagai fungsi serverless.',
  },
  {
    prefix: '/api/google/',
    reason: 'Pencarian tempat memakai Google Places, yang menuntut kunci berbayar GOOGLE_MAPS_API_KEY.',
  },
  {
    prefix: '/api/realtime',
    reason: 'Lapisan realtime butuh layanan WebSocket/Redis tersendiri, bukan fungsi serverless.',
  },
];

function match(pattern, segments) {
  const parts = pattern.split('/');
  if (parts.length !== segments.length) return null;
  const params = {};
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i].startsWith(':')) {
      params[parts[i].slice(1)] = decodeURIComponent(segments[i]);
    } else if (parts[i] !== segments[i]) {
      return null;
    }
  }
  return params;
}

export default async function handler(req, res) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  const rest = pathname.replace(/^\/+api\/+/, '').replace(/\/+$/, '');
  const segments = rest ? rest.split('/') : [];

  for (const [pattern, handlerForRoute] of ROUTES) {
    const params = match(pattern, segments);
    if (!params) continue;
    req.params = { ...(req.params || {}), ...params };
    return handlerForRoute(req, res);
  }

  const known = UNAVAILABLE.find((entry) => pathname.startsWith(entry.prefix));
  res.writeHead(501, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-PII-Route': 'unavailable',
  });
  res.end(JSON.stringify({
    ok: false,
    error: known ? 'layer_unavailable' : 'endpoint_not_configured',
    path: pathname,
    message: known
      ? known.reason
      : 'Lapisan ini belum punya proxy di proyek website. Tambahkan berkas di folder proxies/ lalu daftarkan di api/[...path].js.',
  }));
}
