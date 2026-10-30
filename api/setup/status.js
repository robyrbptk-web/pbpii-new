/**
 * Provider Settings status for the globe's "POWER UP" panel.
 *
 * The panel renders entirely from this payload (see the dev endpoint's
 * keySetupStatus shape): { keys, setCount, total, store }. On this hosted
 * website there is no writable credential store, so every entry reports
 * `set: false` with `managed: null` (the panel shows no REMOVE affordance)
 * plus an explicit `readOnly` flag. Honest, keeps the panel intact, and never
 * touches or echoes a credential value.
 *
 * Note: lib/proxy.js sendJson is deliberately not used here — a
 * credential-status surface must never carry a public cache header.
 */

/** Registry copied from gods-eye-view/src/keySetupCore.mjs KEY_SETUP_KEYS. */
const KEYS = Object.freeze([
  Object.freeze({
    id: 'google-maps',
    title: 'GOOGLE MAPS',
    unlocks: 'Planet 3D fotorealistik + pencarian tempat',
    getUrl: 'https://developers.google.com/maps/documentation/tile/get-api-key',
    envVars: Object.freeze(['GOOGLE_MAPS_API_KEY']),
    tier: 'metered',
    clientExposed: true,
  }),
  Object.freeze({
    id: 'openai',
    title: 'OPENAI',
    unlocks: 'Kontrol suara — bicara dengan planet',
    getUrl: 'https://platform.openai.com/api-keys',
    envVars: Object.freeze(['OPENAI_API_KEY']),
    tier: 'metered',
  }),
  Object.freeze({
    id: 'aisstream',
    title: 'AISSTREAM',
    unlocks: 'Kapal langsung, seluruh dunia',
    getUrl: 'https://aisstream.io',
    envVars: Object.freeze(['AISSTREAM_API_KEY']),
    tier: 'free',
  }),
  Object.freeze({
    id: 'firms',
    title: 'NASA FIRMS',
    unlocks: 'Deteksi kebakaran aktif langsung',
    getUrl: 'https://firms.modaps.eosdis.nasa.gov/api/map_key/',
    envVars: Object.freeze(['FIRMS_MAP_KEY']),
    tier: 'free',
  }),
  Object.freeze({
    id: 'tomtom',
    title: 'TOMTOM',
    unlocks: 'Lalu lintas asli (tanpa kunci memakai simulasi)',
    getUrl: 'https://developer.tomtom.com',
    envVars: Object.freeze(['TOMTOM_API_KEY']),
    tier: 'free',
  }),
  Object.freeze({
    id: 'cesium-ion',
    title: 'CESIUM ION',
    unlocks: 'Tumpukan peta citra Bing + terrain dunia',
    getUrl: 'https://ion.cesium.com/tokens',
    envVars: Object.freeze(['CESIUM_ION_TOKEN']),
    tier: 'free',
    clientExposed: true,
  }),
  Object.freeze({
    id: 'opensky',
    title: 'OPENSKY',
    unlocks: 'Kuota polling penerbangan lebih besar (anonim juga bisa)',
    getUrl: 'https://opensky-network.org',
    envVars: Object.freeze(['OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET']),
    tier: 'free',
  }),
  Object.freeze({
    id: 'launch-library',
    title: 'LAUNCH LIBRARY',
    unlocks: 'Kuota permintaan misi luar angkasa lebih tinggi',
    getUrl: 'https://thespacedevs.com',
    envVars: Object.freeze(['LL2_API_TOKEN']),
    tier: 'free',
  }),
  Object.freeze({
    id: 'api-indonesia',
    title: 'API INDONESIA',
    unlocks: 'Rumah sakit nasional + halte Transjakarta',
    getUrl: 'https://dashboard.apiindonesia.id',
    envVars: Object.freeze(['API_INDONESIA_KEY']),
    tier: 'free',
  }),
]);

export default async function handler(req, res) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    res.writeHead(405, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      Allow: 'GET',
    });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const keys = KEYS.map((entry) => Object.freeze({
    ...entry,
    envVars: [...entry.envVars],
    // Hosted deployment: this panel has no store to manage, so nothing here is
    // ever reported as set or file-managed, and no value is read from env.
    set: false,
    managed: null,
  }));

  // A credential-status response must never be cached by a proxy or disk.
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({
    keys,
    setCount: 0,
    total: keys.length,
    store: 'hosted-readonly',
    readOnly: true,
    available: false,
    message: 'Pengaturan kunci provider hanya tersedia pada server development lokal. Situs ini tidak menerima atau menyimpan kunci.',
  }));
}
