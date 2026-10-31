/**
 * Ruang Ibadah — jadwal sholat, penanda adzan, arah kiblat, dan Al-Qur'an.
 *
 * Data comes from API Muslim (api.myquran.com/v3, sumber Kemenag RI) through
 * the same-origin /api/muslim/* proxies, which cache the immutable payloads.
 * Prayer times returned by the upstream are already local civil times for the
 * chosen kab/kota, so the countdown is computed against that city's clock.
 */
(() => {
  'use strict';

  const API = '/api/muslim';
  const ADZAN_SRC = 'https://www.islamcan.com/audio/adhan/azan1.mp3';
  const NETWORK_GEO = 'https://ipwho.is/';
  const REVERSE_GEO = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
  const AUTO_REFRESH_MS = 7 * 24 * 3600 * 1000;
  const STORE = {
    city: 'pbpii:ibadah-city',
    citySource: 'pbpii:ibadah-city-source',
    cityAt: 'pbpii:ibadah-city-at',
    adzan: 'pbpii:ibadah-adzan',
    surah: 'pbpii:ibadah-surah',
  };

  const DEFAULT_CITY = Object.freeze({ id: '58a2fc6ed39fd083f55d4182bf88826d', name: 'Kota Jakarta', prov: 'DKI Jakarta' });
  const SECRETARIAT = Object.freeze({ label: 'Sekretariat PB PII', lat: -6.1844917, lon: 106.8344897 });

  const PRAYERS = [
    ['imsak', 'Imsak'], ['subuh', 'Subuh'], ['terbit', 'Terbit'], ['dhuha', 'Dhuha'],
    ['dzuhur', 'Dzuhur'], ['ashar', 'Ashar'], ['maghrib', 'Maghrib'], ['isya', 'Isya'],
  ];
  const PRAYER_LABEL = Object.fromEntries(PRAYERS);
  const COUNTED = ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya'];
  const ADZAN_KEYS = new Set(COUNTED);

  const WIT_PROVINCES = new Set(['PAPUA', 'PAPUA BARAT', 'PAPUA BARAT DAYA', 'PAPUA TENGAH', 'PAPUA PEGUNUNGAN', 'PAPUA SELATAN', 'MALUKU', 'MALUKU UTARA']);
  const WITA_PROVINCES = new Set([
    'BALI', 'NUSA TENGGARA BARAT', 'NUSA TENGGARA TIMUR',
    'KALIMANTAN SELATAN', 'KALIMANTAN TIMUR', 'KALIMANTAN UTARA',
    'SULAWESI UTARA', 'GORONTALO', 'SULAWESI TENGAH', 'SULAWESI BARAT', 'SULAWESI SELATAN', 'SULAWESI TENGGARA',
  ]);
  const TZ_LABEL = { 'Asia/Jakarta': 'WIB', 'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT' };

  /* ipwho.is and BigDataCloud answer with English province names; map them back
     to the Indonesian names the city list uses before falling back to a capital. */
  const PROVINCE_ALIASES = {
    ACEH: 'ACEH', 'NANGGROE ACEH DARUSSALAM': 'ACEH', 'SPECIAL REGION OF ACEH': 'ACEH',
    'NORTH SUMATRA': 'SUMATERA UTARA', 'WEST SUMATRA': 'SUMATERA BARAT',
    'SOUTH SUMATRA': 'SUMATERA SELATAN',
    'RIAU ISLANDS': 'KEPULAUAN RIAU', 'BANGKA BELITUNG': 'KEPULAUAN BANGKA BELITUNG',
    JAKARTA: 'DKI JAKARTA', 'SPECIAL CAPITAL REGION OF JAKARTA': 'DKI JAKARTA',
    'WEST JAVA': 'JAWA BARAT', 'CENTRAL JAVA': 'JAWA TENGAH', 'EAST JAVA': 'JAWA TIMUR',
    YOGYAKARTA: 'DI YOGYAKARTA', 'SPECIAL REGION OF YOGYAKARTA': 'DI YOGYAKARTA',
    'WEST NUSA TENGGARA': 'NUSA TENGGARA BARAT', 'EAST NUSA TENGGARA': 'NUSA TENGGARA TIMUR',
    'WEST KALIMANTAN': 'KALIMANTAN BARAT', 'CENTRAL KALIMANTAN': 'KALIMANTAN TENGAH',
    'SOUTH KALIMANTAN': 'KALIMANTAN SELATAN', 'EAST KALIMANTAN': 'KALIMANTAN TIMUR',
    'NORTH KALIMANTAN': 'KALIMANTAN UTARA',
    'NORTH SULAWESI': 'SULAWESI UTARA', 'CENTRAL SULAWESI': 'SULAWESI TENGAH',
    'WEST SULAWESI': 'SULAWESI BARAT', 'SOUTH SULAWESI': 'SULAWESI SELATAN',
    'SOUTHEAST SULAWESI': 'SULAWESI TENGGARA',
    'NORTH MALUKU': 'MALUKU UTARA',
    'WEST PAPUA': 'PAPUA BARAT', 'SOUTHWEST PAPUA': 'PAPUA BARAT DAYA',
    'SOUTH PAPUA': 'PAPUA SELATAN', 'CENTRAL PAPUA': 'PAPUA TENGAH',
    'HIGHLAND PAPUA': 'PAPUA PEGUNUNGAN',
  };

  const PROVINCE_CAPITALS = {
    ACEH: 'Banda Aceh', 'SUMATERA UTARA': 'Medan', 'SUMATERA BARAT': 'Padang', RIAU: 'Pekanbaru',
    JAMBI: 'Jambi', 'SUMATERA SELATAN': 'Palembang', BENGKULU: 'Bengkulu', LAMPUNG: 'Bandar Lampung',
    'KEPULAUAN BANGKA BELITUNG': 'Pangkal Pinang', 'KEPULAUAN RIAU': 'Tanjung Pinang',
    'DKI JAKARTA': 'Jakarta', 'JAWA BARAT': 'Bandung', 'JAWA TENGAH': 'Semarang',
    'DI YOGYAKARTA': 'Yogyakarta', 'JAWA TIMUR': 'Surabaya', BANTEN: 'Serang', BALI: 'Denpasar',
    'NUSA TENGGARA BARAT': 'Mataram', 'NUSA TENGGARA TIMUR': 'Kupang',
    'KALIMANTAN BARAT': 'Pontianak', 'KALIMANTAN TENGAH': 'Palangka Raya',
    'KALIMANTAN SELATAN': 'Banjarmasin', 'KALIMANTAN TIMUR': 'Samarinda',
    'KALIMANTAN UTARA': 'Tanjung Selor', 'SULAWESI UTARA': 'Manado', GORONTALO: 'Gorontalo',
    'SULAWESI TENGAH': 'Palu', 'SULAWESI BARAT': 'Mamuju', 'SULAWESI SELATAN': 'Makassar',
    'SULAWESI TENGGARA': 'Kendari', MALUKU: 'Ambon', 'MALUKU UTARA': 'Ternate',
    PAPUA: 'Jayapura', 'PAPUA BARAT': 'Manokwari', 'PAPUA BARAT DAYA': 'Sorong',
    'PAPUA SELATAN': 'Merauke', 'PAPUA TENGAH': 'Nabire', 'PAPUA PEGUNUNGAN': 'Wamena',
  };

  let schedule = null;
  let activeCity = null;
  let qiblaDegrees = null;
  let locationToken = 0;
  let lastPrayer;
  let lastDayCheck = 0;
  let clockTimer = null;
  let adzanAudio = null;

  // ---------------------------------------------------------------- utilities

  function escapeHTML(value = '') {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function each(selector, run) {
    document.querySelectorAll(selector).forEach(run);
  }

  function setText(selector, value) {
    each(selector, (element) => { element.textContent = value; });
  }

  function storageGet(key, fallback = '') {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode — the preference simply does not persist */
    }
  }

  /* ---------------------------------------------------------------- caches
     Data ibadah bersifat tetap (isi surat) atau berubah sekali sehari (jadwal),
     sedangkan proxy di Vercel mulai dingin setiap kali instance baru muncul.
     Menyimpan jawaban terakhir di perangkat membuat halaman terisi begitu
     dibuka dan jaringan hanya dipakai untuk memperbarui di latar belakang. */

  const CACHE_PREFIX = 'pbpii:ibadah-cache:v1:';
  const QURAN_CACHE_LIMIT = 30;
  const QURAN_INDEX_KEY = 'pbpii:ibadah-cache:v1:quran-index';

  function cacheRead(key) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function cacheWrite(key, value) {
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  /** Simpan surat dengan urutan pemakaian: yang paling lama dibuang lebih dulu. */
  function quranCacheWrite(surahKey, payload) {
    let index = [];
    try {
      index = JSON.parse(storageGet(QURAN_INDEX_KEY, '[]')) || [];
    } catch {
      index = [];
    }
    index = index.filter((entry) => entry !== surahKey);
    index.push(surahKey);
    while (index.length > QURAN_CACHE_LIMIT) {
      const stale = index.shift();
      try {
        localStorage.removeItem(CACHE_PREFIX + stale);
      } catch {
        /* nothing else to do */
      }
    }
    if (!cacheWrite(surahKey, payload) && index.length > 1) {
      // Penyimpanan penuh: buang separuh terlama, lalu coba sekali lagi.
      for (const dropped of index.slice(0, Math.ceil(index.length / 2))) {
        try {
          localStorage.removeItem(CACHE_PREFIX + dropped);
        } catch {
          /* ignore */
        }
      }
      index = index.slice(Math.ceil(index.length / 2));
      cacheWrite(surahKey, payload);
    }
    storageSet(QURAN_INDEX_KEY, JSON.stringify(index));
  }

  const staticCache = new Map();

  /** Berkas statis hasil scripts/make-ibadah-static.mjs — tanpa API Muslim. */
  async function staticRows(name) {
    if (staticCache.has(name)) return staticCache.get(name);
    const response = await fetch(`assets/${name}`);
    if (!response.ok) throw new Error(`${name} tidak tersedia (${response.status}).`);
    const rows = await response.json();
    staticCache.set(name, rows);
    return rows;
  }

  function savedCity() {
    try {
      const saved = JSON.parse(storageGet(STORE.city, 'null'));
      if (saved && /^[a-f0-9]{32}$/i.test(String(saved.id || ''))) {
        return { id: saved.id, name: String(saved.name || 'Kota terpilih'), prov: String(saved.prov || '') };
      }
    } catch {
      /* fall through to the default */
    }
    return null;
  }

  function markSource(source) {
    storageSet(STORE.citySource, source);
    storageSet(STORE.cityAt, String(Date.now()));
  }

  function setLocationNote(message, tone = '') {
    each('#locationNote, [data-location-note]', (note) => {
      note.textContent = message;
      note.dataset.tone = tone;
    });
  }

  function normalizePlace(value = '') {
    return String(value).toUpperCase()
      .replace(/PROVINSI|PROVINCE|SPECIAL REGION OF|SPECIAL CAPITAL REGION OF/g, ' ')
      .replace(/\b(KABUPATEN|KAB|KOTA|KOTAMADYA|ADMINISTRASI|REGENCY|CITY)\b\.?/g, ' ')
      .replace(/[^A-Z ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function provinceKey(value = '') {
    const name = normalizePlace(value);
    return PROVINCE_ALIASES[name] || name;
  }

  /** Highest-scoring kab/kota from the 517-row list for a free-text place name. */
  function pickCity(rows, query) {
    let best = null;
    for (const row of rows) {
      const name = normalizePlace(row?.lokasi);
      if (!name || !/^[a-f0-9]{32}$/i.test(String(row?.id || ''))) continue;
      let score = 0;
      if (name === query) score = 100;
      else if (name.startsWith(`${query} `)) score = 80;
      else if (name.includes(query)) score = 55;
      else if (query.includes(name)) score = 45;
      else continue;
      if (/^KOTA\b/i.test(String(row.lokasi))) score += 10;
      if (!best || score > best.score) {
        best = { score, city: { id: row.id, name: prettyPlace(row.lokasi), prov: '' } };
      }
    }
    return best?.city || null;
  }

  const cityMatchCache = new Map();

  /**
   * Match a place name against the 517 kab/kota rows. IP geolocation often
   * returns a kecamatan ("Pontianak Tenggara"), so retry with fewer words and
   * score both directions (the row name inside the query and vice versa).
   *
   * Daftar kotanya dibundel (assets/ibadah-kota.json), jadi pencocokan berjalan
   * lokal: tanpa dua sampai empat permintaan proxy yang membuat lokasi baru
   * tampil beberapa detik setelah halaman terbuka.
   */
  async function matchCity(name) {
    const query = normalizePlace(name);
    if (query.length < 3) return null;
    if (query === 'JAKARTA') return { ...DEFAULT_CITY };
    if (cityMatchCache.has(query)) return cityMatchCache.get(query);

    let rows = [];
    try {
      rows = await staticRows('ibadah-kota.json');
    } catch {
      const body = await getJson(`${API}/kota`).catch(() => null);
      rows = Array.isArray(body?.data) ? body.data : [];
    }

    const words = query.split(' ');
    let match = null;
    for (let length = words.length; length >= 1 && !match; length -= 1) {
      const attempt = words.slice(0, length).join(' ');
      if (attempt.length < 3) continue;
      const hits = rows.filter((row) => normalizePlace(row.lokasi).includes(attempt));
      match = pickCity(hits, query) || pickCity(hits, attempt);
    }

    cityMatchCache.set(query, match);
    return match;
  }

  async function fetchPlace(url, timeout = 8000) {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /** Approximate position from the network, no permission prompt needed. */
  async function networkPlace() {
    // BigDataCloud answers from the caller IP when no coordinates are sent.
    const geo = await fetchPlace(`${REVERSE_GEO}?localityLanguage=id`).catch(() => null);
    if (geo && (!geo.countryCode || geo.countryCode === 'ID')) {
      return {
        country: String(geo.countryCode || 'ID'),
        city: String(geo.city || ''),
        locality: String(geo.locality || ''),
        region: String(geo.principalSubdivision || ''),
      };
    }
    if (geo) {
      return { country: String(geo.countryCode || ''), city: '', locality: '', region: '' };
    }

    const data = await fetchPlace(NETWORK_GEO).catch(() => null);
    if (!data || data.success === false) return null;
    return {
      country: String(data.country_code || ''),
      city: String(data.city || ''),
      locality: String(data.city || ''),
      region: String(data.region || ''),
    };
  }

  function devicePosition() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
        () => resolve(null),
        { timeout: 10000, maximumAge: 600000 },
      );
    });
  }

  /** Precise position from the device, reverse-geocoded to an Indonesian place. */
  async function devicePlace() {
    const position = await devicePosition();
    if (!position) return null;
    const geo = await fetchPlace(
      `${REVERSE_GEO}?latitude=${position.lat}&longitude=${position.lon}&localityLanguage=id`,
    ).catch(() => null);
    if (!geo) return null;
    return {
      country: String(geo.countryCode || (geo.countryName === 'Indonesia' ? 'ID' : '')),
      city: String(geo.city || ''),
      locality: String(geo.locality || ''),
      region: String(geo.principalSubdivision || ''),
    };
  }

  /** Resolve a detected place to a kab/kota id, capital of the province last. */
  async function locateCity(place) {
    if (!place || (place.country && place.country !== 'ID')) return null;

    for (const name of [place.city, place.locality]) {
      const city = await matchCity(name).catch(() => null);
      if (city) return { city, place };
    }

    const capital = PROVINCE_CAPITALS[provinceKey(place.region)];
    if (capital) {
      const city = await matchCity(capital).catch(() => null);
      if (city) return { city, place, viaProvince: true };
    }
    return null;
  }

  async function autoLocateOnce(firstVisit) {
    const source = storageGet(STORE.citySource);
    if (source === 'manual') return;

    if (source) {
      const detectedAt = Number(storageGet(STORE.cityAt, '0')) || 0;
      if (Date.now() - detectedAt < AUTO_REFRESH_MS) return;
    } else if (!firstVisit) {
      // A city saved before location tracking existed: respect that choice.
      markSource('manual');
      const saved = savedCity();
      setLocationNote(`Jadwal mengikuti ${saved ? saved.name : 'kota tersimpan'} yang tersimpan di perangkat ini. Ketuk “Deteksi lokasi saya” untuk menyesuaikan otomatis.`, 'manual');
      return;
    }

    setLocationNote('Menyesuaikan jadwal dengan lokasi Anda…', 'busy');
    const place = await networkPlace();
    const found = await locateCity(place);

    if (!found) {
      setLocationNote(place && place.country && place.country !== 'ID'
        ? 'Anda berada di luar Indonesia, jadi jadwal mengikuti Kota Jakarta (WIB).'
        : 'Lokasi tidak dikenali otomatis, jadi jadwal mengikuti Kota Jakarta. Pilih kota lewat kolom pencarian atau ketuk “Deteksi lokasi saya”.', 'muted');
      return;
    }
    await applyDetected(found, 'auto');
  }

  async function applyDetected(found, origin) {
    const token = ++locationToken;
    markSource(origin);
    await refreshSchedule(found.city);
    if (token !== locationToken) return false;

    const region = schedule?.city?.prov || '';
    const from = origin === 'device' ? 'lokasi perangkat Anda' : 'jaringan internet Anda';
    setLocationNote(found.viaProvince
      ? `${found.city.name} dipakai karena ${region || 'lokasi Anda'} berada di provinsi yang sama. Pilih kabupaten/kota lain lewat pencarian bila perlu.`
      : `${found.city.name} otomatis dipilih dari ${from}${region ? ` (${region})` : ''}. Pilih kabupaten/kota lain lewat pencarian bila perlu.`, 'auto');
    return true;
  }

  async function getJson(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      throw new Error(body?.error || `Permintaan gagal (HTTP ${response.status}).`);
    }
    return body;
  }

  const ABBREVIATIONS = new Set(['DI', 'DIY', 'DKI', 'NTB', 'NTT']);

  function prettyPlace(value = '') {
    return String(value).trim().split(/\s+/).map((word) => {
      const bare = word.toUpperCase().replace(/\./g, '');
      if (ABBREVIATIONS.has(bare)) return bare;
      if (bare === 'KAB') return 'Kab.';
      return word.toLowerCase().replace(/^[a-z]/, (letter) => letter.toUpperCase());
    }).join(' ');
  }

  function tzForProvince(province = '') {
    const name = String(province).trim().toUpperCase();
    if (WIT_PROVINCES.has(name)) return 'Asia/Jayapura';
    if (WITA_PROVINCES.has(name)) return 'Asia/Makassar';
    return 'Asia/Jakarta';
  }

  const clockFormats = new Map();
  function clockIn(timeZone) {
    let format = clockFormats.get(timeZone);
    if (!format) {
      format = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      clockFormats.set(timeZone, format);
    }
    const parts = format.formatToParts(new Date());
    const pick = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
    return { hour: pick('hour') % 24, minute: pick('minute'), second: pick('second') };
  }

  function dateKeyIn(timeZone) {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  function dateLabel(timeZone) {
    return new Intl.DateTimeFormat('id-ID', { timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  }

  const minutesOf = (value) => {
    const [hour, minute] = String(value || '').split(':').map(Number);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0;
  };

  function computeNext() {
    const { hour, minute, second } = clockIn(schedule.tz);
    const now = hour * 3600 + minute * 60 + second;
    for (const key of COUNTED) {
      const at = minutesOf(schedule.times[key]) * 60;
      if (at > now) return { key, label: PRAYER_LABEL[key], remaining: at - now, tomorrow: false };
    }
    const first = COUNTED[0];
    return {
      key: first,
      label: PRAYER_LABEL[first],
      remaining: 86400 - now + minutesOf(schedule.times[first]) * 60,
      tomorrow: true,
    };
  }

  function currentPrayer() {
    const { hour, minute } = clockIn(schedule.tz);
    const now = hour * 60 + minute;
    let current = null;
    for (const key of COUNTED) {
      if (minutesOf(schedule.times[key]) <= now) current = key;
    }
    return current;
  }

  function countdownText(totalSeconds) {
    const seconds = Math.max(0, Math.round(totalSeconds));
    const pad = (value) => String(value).padStart(2, '0');
    return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  }

  // ------------------------------------------------------------------ schedule

  async function fetchSchedule(city) {
    const body = await getJson(`${API}/jadwal?id=${encodeURIComponent(city.id)}`);
    const data = body.data || {};
    const days = data.jadwal || {};
    const dayKey = Object.keys(days)[0];
    const day = dayKey ? days[dayKey] : null;
    if (!day) throw new Error('Jadwal sholat hari ini belum tersedia untuk kota tersebut.');

    const province = String(data.prov || city.prov || '');
    return {
      city: { id: data.id || city.id, name: prettyPlace(data.kabko || city.name), prov: prettyPlace(province) },
      dayKey,
      date: day.tanggal || '',
      times: day,
      tz: tzForProvince(province),
    };
  }

  function renderTimes() {
    const grid = document.querySelector('#prayerGrid');
    if (grid) {
      grid.innerHTML = PRAYERS.map(([key, label]) => `
        <li class="prayer-card" data-prayer="${key}">
          <span class="prayer-name">${label}</span>
          <strong class="prayer-time">${escapeHTML(schedule.times[key] || '—')}</strong>
          <span class="prayer-tag"></span>
        </li>`).join('');
    }

    const teaser = document.querySelector('[data-times]');
    if (teaser) {
      teaser.innerHTML = COUNTED.map((key) => `
        <li data-prayer="${key}">
          <span>${PRAYER_LABEL[key]}</span>
          <strong>${escapeHTML(schedule.times[key] || '—')}</strong>
        </li>`).join('');
    }
  }

  function paintSchedule() {
    const name = schedule.city.name;
    const zone = TZ_LABEL[schedule.tz];
    const where = schedule.city.prov ? `${name}, ${schedule.city.prov}` : name;

    setText('#heroCity, [data-teaser-city]', where);
    setText('#jadwalDate', dateLabel(schedule.tz));
    setText('#jadwalSubtitle', `Waktu sholat setempat untuk ${name} · zona ${zone} · sumber Kemenag RI.`);
    setText('[data-ibadah-note]', `Jadwal ${name} · zona ${zone} · sumber Kemenag RI.`);
    renderTimes();
    paintLive();
  }

  function paintLive() {
    if (!schedule) return;

    const next = computeNext();
    setText('#nextPrayerName, [data-next-name]', next.label);
    setText('#nextPrayerCountdown, [data-next-countdown]', countdownText(next.remaining));
    const when = `${next.tomorrow ? 'Besok' : 'Hari ini'} pukul ${schedule.times[next.key] || '—'}`;
    setText('#nextPrayerTime, [data-next-time]', `${when} · ${TZ_LABEL[schedule.tz]}`);

    const { hour, minute } = clockIn(schedule.tz);
    const nowMinutes = hour * 60 + minute;

    each('#prayerGrid .prayer-card', (card) => {
      const key = card.dataset.prayer;
      const at = minutesOf(schedule.times[key]);
      card.classList.toggle('is-next', key === next.key);
      card.classList.toggle('is-past', at < nowMinutes && key !== next.key);
      const tag = card.querySelector('.prayer-tag');
      if (tag) tag.textContent = key === next.key ? (next.tomorrow ? 'Besok' : 'Berikutnya') : '';
    });

    each('[data-times] li', (row) => {
      row.classList.toggle('is-next', row.dataset.prayer === next.key && !next.tomorrow);
    });

    const current = currentPrayer();
    if (lastPrayer === undefined) {
      lastPrayer = current;
    } else if (current !== lastPrayer) {
      lastPrayer = current;
      const fresh = current && nowMinutes - minutesOf(schedule.times[current]) <= 1
        && nowMinutes >= minutesOf(schedule.times[current]);
      if (fresh && ADZAN_KEYS.has(current) && adzanEnabled()) {
        playAdzan(PRAYER_LABEL[current]);
      }
    }

    const now = Date.now();
    if (now - lastDayCheck > 300000) {
      lastDayCheck = now;
      if (schedule.dayKey !== dateKeyIn(schedule.tz)) refreshSchedule(activeCity || DEFAULT_CITY);
    }
  }

  function startClock() {
    if (clockTimer) return;
    clockTimer = setInterval(paintLive, 1000);
  }

  function paintCity(city) {
    setText('#heroCity, [data-teaser-city]', city.name);
  }

  async function refreshSchedule(city) {
    const status = document.querySelector('#jadwalStatus');
    if (status) status.textContent = 'Memuat jadwal sholat…';
    try {
      schedule = await fetchSchedule(city);
      activeCity = schedule.city;
      lastPrayer = undefined;
      storageSet(STORE.city, JSON.stringify(schedule.city));
      cacheWrite(`jadwal:${schedule.city.id}`, schedule);
      paintSchedule();
      startClock();
      if (status) {
        const now = clockIn(schedule.tz);
        status.textContent = `${schedule.city.name} · diperbarui ${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')} ${TZ_LABEL[schedule.tz]}`;
      }
    } catch (error) {
      if (status) status.textContent = error.message;
      setText('[data-ibadah-note]', error.message);
    }
  }

  /**
   * Pakai jadwal yang terakhir diambil hari ini sebelum jaringan menjawab, jadi
   * hitungan mundur sudah berjalan saat halaman baru saja terbuka.
   */
  function useCachedSchedule(city) {
    const cached = cacheRead(`jadwal:${city.id}`);
    if (!cached?.times || !cached?.tz) return false;
    if (cached.dayKey !== dateKeyIn(cached.tz)) return false;
    schedule = cached;
    activeCity = cached.city || city;
    lastPrayer = undefined;
    paintSchedule();
    startClock();
    return true;
  }

  // --------------------------------------------------------------------- adzan

  const ADZAN_RETRY_MS = 15000;
  const ADZAN_PENDING_WINDOW_MS = 20 * 60 * 1000;

  let adzanPending = null;
  let adzanPendingAt = 0;
  let adzanRetryTimer = null;
  let adzanArmed = false;
  let adzanIntentional = false;

  function setAdzanNote(message) {
    const note = document.querySelector('#adzanNote');
    if (note) note.textContent = message;
  }

  /** Adzan otomatis menyala kecuali pengunjung mematikannya sendiri. */
  function adzanEnabled() {
    return storageGet(STORE.adzan, 'on') !== 'off';
  }

  function ensureAdzanAudio() {
    if (!adzanAudio) {
      adzanAudio = new Audio(ADZAN_SRC);
      adzanAudio.preload = 'auto';
      adzanAudio.addEventListener('error', () => setAdzanNote('Berkas audio adzan tidak dapat dimuat.'));
      adzanAudio.addEventListener('ended', () => {
        adzanIntentional = false;
        paintAdzanButton(false);
      });
    }
    return adzanAudio;
  }

  function paintAdzanButton(playing) {
    const button = document.querySelector('#adzanPlay');
    if (!button) return;
    button.textContent = playing ? '■ Hentikan adzan' : '▶ Putar adzan';
    button.setAttribute('aria-pressed', playing ? 'true' : 'false');
  }

  /**
   * Browser hanya mengizinkan suara setelah ada satu sentuhan di halaman, jadi
   * sentuhan pertama dibelanjakan untuk audio sunyi. Setelah itu adzan berbunyi
   * sendiri tanpa ada yang perlu menekan tombol.
   */
  function armAdzanAudio() {
    if (adzanArmed) return;
    adzanArmed = true;
    const audio = ensureAdzanAudio();
    audio.volume = 0;
    const started = audio.play();
    if (!started?.then) {
      audio.pause();
      audio.volume = 1;
      return;
    }
    started
      .then(() => {
        audio.volume = 1;
        if (adzanPending && adzanEnabled()) {
          playAdzan(adzanPending);
          return;
        }
        if (!adzanIntentional) {
          audio.pause();
          audio.currentTime = 0;
        }
      })
      .catch(() => {
        audio.volume = 1;
        adzanArmed = false;
      });
  }

  function playAdzan(label = '') {
    const audio = ensureAdzanAudio();
    adzanIntentional = true;
    audio.currentTime = 0;
    const started = audio.play();
    if (!started?.then) {
      paintAdzanButton(true);
      return;
    }
    started
      .then(() => {
        adzanPending = null;
        clearAdzanRetry();
        paintAdzanButton(true);
        setAdzanNote(`Adzan${label ? ` ${label}` : ''} sedang diputar.`);
      })
      .catch(() => {
        adzanIntentional = false;
        queuePendingAdzan(label);
      });
  }

  /** Waktu adzan terlewat sebelum suara diizinkan: antre sampai sentuhan berikutnya. */
  function queuePendingAdzan(label) {
    adzanPending = label;
    adzanPendingAt = Date.now();
    setAdzanNote(
      `Waktu ${label || 'adzan'} tiba. Ketuk mana saja di halaman ini untuk mengizinkan suara; setelah itu adzan berbunyi otomatis.`,
    );
    if (!adzanRetryTimer) adzanRetryTimer = setInterval(retryPendingAdzan, ADZAN_RETRY_MS);
  }

  function clearAdzanRetry() {
    if (adzanRetryTimer) {
      clearInterval(adzanRetryTimer);
      adzanRetryTimer = null;
    }
  }

  function retryPendingAdzan() {
    if (!adzanPending) {
      clearAdzanRetry();
      return;
    }
    if (Date.now() - adzanPendingAt > ADZAN_PENDING_WINDOW_MS || !adzanEnabled()) {
      adzanPending = null;
      clearAdzanRetry();
      return;
    }
    if (adzanAudio && !adzanAudio.paused) return;
    playAdzan(adzanPending);
  }

  function stopAdzan() {
    adzanIntentional = false;
    if (adzanAudio && !adzanAudio.paused) {
      adzanAudio.pause();
      adzanAudio.currentTime = 0;
      setAdzanNote('Adzan dihentikan.');
    }
    adzanPending = null;
    clearAdzanRetry();
    paintAdzanButton(false);
  }

  function initAdzan() {
    const toggle = document.querySelector('#adzanToggle');
    const button = document.querySelector('#adzanPlay');

    if (toggle) {
      toggle.checked = adzanEnabled();
      toggle.addEventListener('change', () => {
        storageSet(STORE.adzan, toggle.checked ? 'on' : 'off');
        if (!toggle.checked) stopAdzan();
        setAdzanNote(toggle.checked
          ? 'Adzan otomatis aktif: berbunyi sendiri saat Subuh, Dzuhur, Ashar, Maghrib, dan Isya.'
          : 'Adzan otomatis dimatikan. Jadwal tetap jalan dan adzan masih bisa diputar manual.');
      });
    }

    if (button) {
      button.addEventListener('click', () => {
        if (adzanAudio && !adzanAudio.paused) stopAdzan();
        else playAdzan('');
      });
    }

    ['pointerdown', 'keydown', 'touchstart'].forEach((type) =>
      document.addEventListener(type, armAdzanAudio, { once: true, passive: true }));

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && adzanPending && adzanEnabled()) playAdzan(adzanPending);
    });

    // Unduh berkas adzan di latar belakang sejak halaman dibuka, supaya suaranya
    // langsung keluar pada menit waktu sholat, bukan setelah buffer selesai.
    if (adzanEnabled()) ensureAdzanAudio();
  }

  // ------------------------------------------------------------- lokasi sholat

  function initLocationButton() {
    const button = document.querySelector('#cityDetect');
    if (!button) return;

    button.addEventListener('click', async () => {
      if (button.disabled) return;
      const label = button.textContent;
      button.disabled = true;
      button.textContent = 'Mendeteksi…';
      setLocationNote('Mendeteksi lokasi Anda…', 'busy');

      let found = await locateCity(await devicePlace());
      let origin = 'device';
      if (!found) {
        found = await locateCity(await networkPlace());
        origin = 'auto';
      }

      if (found) {
        await applyDetected(found, origin);
      } else {
        setLocationNote('Lokasi tidak dapat dibaca. Pilih kabupaten/kota lewat kolom pencarian di atas.', 'muted');
      }

      button.disabled = false;
      button.textContent = label;
    });
  }

  // --------------------------------------------------------------- city search

  function initCitySearch() {
    const input = document.querySelector('#citySearch');
    const results = document.querySelector('#cityResults');
    if (!input || !results) return;

    let timer = null;
    const close = () => {
      results.hidden = true;
      results.innerHTML = '';
    };

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const query = input.value.trim();
      if (query.length < 2) {
        close();
        return;
      }
      timer = setTimeout(() => searchCities(query, results), 300);
    });

    results.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-id]');
      if (!button) return;
      const city = { id: button.dataset.id, name: button.dataset.name, prov: '' };
      locationToken += 1;
      markSource('manual');
      storageSet(STORE.city, JSON.stringify(city));
      input.value = '';
      close();
      paintCity(city);
      setLocationNote(`Jadwal mengikuti ${city.name} pilihan Anda. Ketuk “Deteksi lokasi saya” untuk kembali ke lokasi otomatis.`, 'manual');
      refreshSchedule(city);
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        close();
        input.blur();
      }
    });

    document.addEventListener('click', (event) => {
      if (!results.hidden && !results.contains(event.target) && event.target !== input) close();
    });
  }

  async function searchCities(query, results) {
    results.hidden = false;
    const needle = normalizePlace(query);
    const render = (rows) => {
      results.innerHTML = rows.length
        ? rows.map((row) => {
          const name = prettyPlace(row.lokasi);
          return `<li><button type="button" data-id="${escapeHTML(row.id)}" data-name="${escapeHTML(name)}">${escapeHTML(name)}</button></li>`;
        }).join('')
        : '<li class="city-empty">Kabupaten/kota tidak ditemukan. Coba kata lain.</li>';
    };

    try {
      const rows = await staticRows('ibadah-kota.json');
      render(rows.filter((row) => normalizePlace(row.lokasi).includes(needle)).slice(0, 12));
    } catch {
      results.innerHTML = '<li class="city-empty">Mencari kabupaten/kota…</li>';
      try {
        const body = await getJson(`${API}/kota?q=${encodeURIComponent(query)}`);
        render((Array.isArray(body.data) ? body.data : []).slice(0, 12));
      } catch (error) {
        results.innerHTML = `<li class="city-empty">${escapeHTML(error.message)}</li>`;
      }
    }
  }

  // --------------------------------------------------------------------- kiblat

  function setQiblaStatus(message) {
    const status = document.querySelector('#qiblaStatus');
    if (status) status.textContent = message;
  }

  function setQiblaAccuracy(message) {
    const line = document.querySelector('#qiblaAccuracy');
    if (line) line.textContent = message;
  }

  const compass = { on: false, heading: 0, smoothed: null, signalledAt: 0, aligned: false, vibrated: false };

  /** Selisih sudut terdekat, supaya 359° → 1° tidak dihitung berputar 358°. */
  function deltaAngle(from, to) {
    return ((to - from + 540) % 360) - 180;
  }

  function paintQibla() {
    const rose = document.querySelector('#qiblaRose');
    const needle = document.querySelector('#qiblaNeedle');
    const card = document.querySelector('#qiblaCard');
    if (!needle || qiblaDegrees === null) return;

    const manual = Number(document.querySelector('#qiblaManual')?.value || 0);
    const heading = compass.on ? compass.heading : manual;
    const relative = (qiblaDegrees - heading + 360) % 360;

    rose?.style.setProperty('transform', `rotate(${(-heading).toFixed(1)}deg)`);
    needle.style.transform = `rotate(${relative.toFixed(1)}deg)`;

    const aligned = Math.abs(deltaAngle(0, relative)) <= 6;
    card?.classList.toggle('is-aligned', aligned);
    if (aligned && compass.on && !compass.vibrated) {
      navigator.vibrate?.(22);
      compass.vibrated = true;
      setQiblaAccuracy('Menghadap Ka\'bah. Jaga ponsel tetap datar sejauh mungkin dari logam.');
    } else if (!aligned) {
      compass.vibrated = false;
      if (compass.on) {
        const side = deltaAngle(0, relative) > 0 ? 'kanan' : 'kiri';
        setQiblaAccuracy(`Kompas aktif · putar badan ke ${side} sampai kotak hijau berada di atas.`);
      }
    }
  }

  function onOrientation(event) {
    let raw = null;
    if (Number.isFinite(event.webkitCompassHeading)) raw = event.webkitCompassHeading;
    else if (Number.isFinite(event.alpha)) raw = (360 - event.alpha) % 360;
    if (raw === null) return;

    compass.signalledAt = Date.now();
    if (Number.isFinite(event.webkitCompassAccuracy) && event.webkitCompassAccuracy >= 0) {
      setQiblaAccuracy(`Kompas aktif · akurasi ±${Math.round(event.webkitCompassAccuracy)}°. Gerakkan ponsel membentuk angka 8 untuk kalibrasi.`);
    }

    const previous = compass.smoothed ?? raw;
    const step = deltaAngle(previous, raw);
    // Lompatan besar berarti magnetometer baru dikalibrasi: ikuti langsung.
    compass.smoothed = Math.abs(step) > 90 ? raw : (previous + step * 0.34 + 360) % 360;
    compass.heading = compass.smoothed;
    paintQibla();
  }

  function stopCompass(message) {
    compass.on = false;
    compass.smoothed = null;
    window.removeEventListener('deviceorientationabsolute', onOrientation, true);
    window.removeEventListener('deviceorientation', onOrientation, true);
    const button = document.querySelector('#qiblaCompass');
    if (button) {
      button.textContent = 'Aktifkan kompas';
      button.setAttribute('aria-pressed', 'false');
      button.classList.remove('is-on');
    }
    document.querySelector('#qiblaCard')?.classList.remove('is-aligned');
    if (message) setQiblaAccuracy(message);
    paintQibla();
  }

  /**
   * iOS 13+ hanya mengizinkan sensor kompas setelah tombol ditekan, jadi
   * permintaan izin harus tetap berada di dalam gesture pengguna.
   */
  async function startCompass(button) {
    if (typeof DeviceOrientationEvent === 'undefined') {
      setQiblaAccuracy('Perangkat ini tidak punya sensor kompas. Gunakan geseran utara di bawah.');
      return;
    }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      let granted = 'granted';
      try {
        granted = await DeviceOrientationEvent.requestPermission();
      } catch {
        granted = 'denied';
      }
      if (granted !== 'granted') {
        setQiblaAccuracy('Izin kompas ditolak. Gunakan geseran utara di bawah.');
        return;
      }
    }

    compass.signalledAt = 0;
    window.addEventListener('deviceorientationabsolute', onOrientation, true);
    window.addEventListener('deviceorientation', onOrientation, true);
    compass.on = true;
    button.textContent = 'Kompas aktif — matikan';
    button.setAttribute('aria-pressed', 'true');
    button.classList.add('is-on');
    setQiblaAccuracy('Kompas aktif. Letakkan ponsel datar dan jauhkan dari logam atau casing bermagnet.');
    paintQibla();

    setTimeout(() => {
      if (compass.on && compass.signalledAt === 0) {
        stopCompass('Sensor kompas tidak mengirim data dari peramban ini. Gunakan geseran utara di bawah.');
      }
    }, 3000);
  }

  function initCompass() {
    const button = document.querySelector('#qiblaCompass');
    const manual = document.querySelector('#qiblaManual');
    button?.addEventListener('click', () => {
      if (compass.on) stopCompass('Kompas dimatikan. Arah kiblat tetap dapat diputar manual.');
      else startCompass(button);
    });
    manual?.addEventListener('input', () => {
      if (compass.on) stopCompass('Kompas dimatikan karena utara diatur manual.');
      setQiblaAccuracy(`Utara kompas diatur ke ${Number(manual.value)}°. Selesaikan memutar cincin agar jarum hijau menunjuk Ka'bah.`);
      paintQibla();
    });
  }

  async function loadQibla(lat, lon, sourceLabel) {
    setQiblaStatus(`Menghitung arah kiblat dari ${sourceLabel}…`);
    try {
      const body = await getJson(`${API}/qibla?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`);
      const direction = Number(body.data?.direction);
      if (!Number.isFinite(direction)) throw new Error('Arah kiblat tidak tersedia.');
      qiblaDegrees = direction;
      setText('#qiblaDegrees', `${direction.toFixed(1)}°`);
      setText('#qiblaSource', `dari ${sourceLabel}`);
      setQiblaStatus(`Kiblat dari ${sourceLabel}: ${direction.toFixed(1)}° dari utara sejati, searah jarum jam.`);
      paintQibla();
    } catch (error) {
      setQiblaStatus(error.message);
    }
  }

  function initQibla() {
    loadQibla(SECRETARIAT.lat, SECRETARIAT.lon, SECRETARIAT.label);
    initCompass();

    const button = document.querySelector('#qiblaLocate');
    if (!button) return;
    button.addEventListener('click', () => {
      if (!navigator.geolocation) {
        setQiblaStatus('Perangkat ini tidak menyediakan layanan lokasi.');
        return;
      }
      setQiblaStatus('Meminta izin lokasi…');
      navigator.geolocation.getCurrentPosition(
        (position) => loadQibla(position.coords.latitude, position.coords.longitude, 'lokasi Anda'),
        (error) => setQiblaStatus(error?.code === 1
          ? 'Izin lokasi ditolak — arah kiblat tetap memakai Sekretariat PB PII.'
          : 'Lokasi tidak dapat dibaca. Arah kiblat tetap memakai Sekretariat PB PII.'),
        { timeout: 12000, maximumAge: 60000 },
      );
    });
  }

  // --------------------------------------------------------------- kalender

  async function loadHijri() {
    try {
      const body = await getJson(`${API}/kalender`);
      const today = body.data?.hijr?.today;
      if (today) setText('[data-hijri]', today);
    } catch {
      setText('[data-hijri]', 'Tanggal Hijriah tidak tersedia');
    }
  }

  // -------------------------------------------------------------------- qur'an

  function cleanText(value = '') {
    return String(value)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function initQuran() {
    const list = document.querySelector('#surahList');
    const readerEl = document.querySelector('#quranReader');
    const searchInput = document.querySelector('#surahSearch');
    if (!list || !readerEl) return;

    let surahs = [];
    let reader = null;
    let currentSurah = Number(storageGet(STORE.surah, '')) || 0;
    /** Pemutar murattal: satu Audio untuk semua tombol, jadi tidak ada tabrak audio. */
    let player = null;
    let track = null;

    const sheet = document.querySelector('#quranSheet');
    const sheetBody = document.querySelector('#quranSheetBody');
    const sheetFoot = document.querySelector('#quranSheetFoot');
    let sheetOpen = false;
    let sheetEntry = false;

    /** Layar kecil memakai sheet penuh; pembaca inline tetap dipakai di desktop. */
    const compactScreen = () => window.matchMedia('(max-width: 1024px)').matches;

    function openSheet() {
      if (!sheet || sheetOpen) return;
      sheetOpen = true;
      sheet.classList.add('is-open');
      sheet.setAttribute('aria-hidden', 'false');
      document.body.classList.add('is-locked');
      if (!sheetEntry) {
        sheetEntry = true;
        // Tombol back Android menutup surat lebih dulu, tidak langsung keluar halaman.
        history.pushState({ quranSheet: reader?.number || currentSurah }, '');
      }
    }

    function closeSheet() {
      if (!sheet || !sheetOpen) return;
      stopTrack();
      const wasPushed = sheetEntry;
      sheetOpen = false;
      sheetEntry = false;
      sheet.classList.remove('is-open');
      sheet.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('is-locked');
      if (wasPushed) history.back();
    }

    window.addEventListener('popstate', () => {
      if (sheetEntry) {
        sheetEntry = false;
        if (sheetOpen) {
          stopTrack();
          sheet.classList.remove('is-open');
          sheet.setAttribute('aria-hidden', 'true');
          document.body.classList.remove('is-locked');
          sheetOpen = false;
        }
      }
    });

    /**
     * Pemutar murattal. Satu objek Audio dipakai bersama tombol surat penuh dan
     * tombol per ayat, jadi mengetuk dua sumber tidak pernah membuat dua suara
     * bertabrakan. `load()` sengaja tidak dipanggil: di iOS memanggil ulang
     * sumber di dalam rantai gestur sering membatalkan `play()` itu sendiri.
     */
    let playerNote = '';

    function ensurePlayer() {
      if (player) return player;
      player = new Audio();
      player.preload = 'metadata';
      ['timeupdate', 'loadedmetadata', 'durationchange'].forEach((type) => {
        player.addEventListener(type, paintPlayers);
      });
      player.addEventListener('pause', () => { paintPlayers(); syncSheetAudio(); });
      player.addEventListener('play', () => { paintPlayers(); syncSheetAudio(); });
      player.addEventListener('ended', () => {
        track = null;
        playerNote = '';
        paintPlayers();
        syncSheetAudio();
      });
      player.addEventListener('error', () => {
        playerNote = 'Audio belum dapat diunduh. Periksa koneksi, lalu coba lagi.';
        paintPlayers();
        syncSheetAudio();
      });
      return player;
    }

    /** Surat penuh kadang hanya mengirim audio_url di halaman pertama, jadi dirakit dari nomor. */
    function surahUrl(number, data) {
      const url = String(data?.audio_url || '');
      return url.startsWith('http') ? url : `https://cdn.myquran.com/audio/surah/${number}.mp3`;
    }

    function clockText(seconds) {
      const total = Math.max(0, Math.floor(Number(seconds) || 0));
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    }

    function paintPlayer(bar) {
      const toggle = bar.querySelector('[data-player-toggle]');
      const label = bar.querySelector('[data-player-label]');
      const fill = bar.querySelector('[data-player-fill]');
      const seek = bar.querySelector('[data-player-seek]');
      const time = bar.querySelector('[data-player-time]');
      const live = Boolean(player && track && !player.paused);
      bar.hidden = !track;
      if (!track) return;
      if (label) label.textContent = playerNote || track.label;
      if (toggle) {
        toggle.textContent = live ? '❚❚' : '▶';
        toggle.setAttribute('aria-label', live ? 'Jeda murattal' : 'Putar murattal');
        toggle.setAttribute('aria-pressed', live ? 'true' : 'false');
        toggle.classList.toggle('is-live', live);
      }
      const duration = Number(player?.duration);
      const position = Number(player?.currentTime) || 0;
      const known = Number.isFinite(duration) && duration > 0;
      const ratio = known ? Math.min(1, position / duration) : 0;
      if (fill) fill.style.width = `${(ratio * 100).toFixed(2)}%`;
      if (seek && document.activeElement !== seek) seek.value = String(Math.round(ratio * 1000));
      if (time) time.textContent = `${clockText(position)} / ${known ? clockText(duration) : '—'}`;
    }

    /** Bar pemutar dipasang sekali per wadah; isinya dilukis ulang lewat paintPlayers(). */
    function renderPlayer() {
      return `
        <div class="quran-player" hidden>
          <button class="qp-toggle" type="button" data-player-toggle aria-pressed="false" aria-label="Putar murattal">▶</button>
          <div class="qp-main">
            <p class="qp-label" data-player-label>Murattal</p>
            <div class="qp-seek">
              <i data-player-fill></i>
              <input data-player-seek type="range" min="0" max="1000" step="1" value="0" aria-label="Geser posisi audio murattal">
            </div>
          </div>
          <span class="qp-time" data-player-time>0:00 / —</span>
          <button class="qp-close" type="button" data-player-close aria-label="Tutup pemutar audio">✕</button>
        </div>`;
    }

    function paintPlayers() {
      each('.quran-player', paintPlayer);
      // Tombol sumber yang sedang berbunyi diberi states, label tombol tidak diubah.
      const live = Boolean(track && player && !player.paused);
      each('button[data-audio]', (button) => {
        button.classList.toggle('is-playing', live && button.dataset.audio === track.src);
      });
    }

    /** Tombol bulat di bar surat: hanya menandai surat penuh yang sedang berbunyi. */
    function syncSheetAudio() {
      const button = document.querySelector('#quranSheetAudio');
      if (!button) return;
      const on = Boolean(track && !track.ayah && player && !player.paused);
      button.classList.toggle('is-audio-on', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.setAttribute('aria-label', `Murattal surat penuh${track && !track.ayah ? ' (sedang berputar)' : ''}`);
    }

    function playTrack(next) {
      if (!next?.src) return;
      const audio = ensurePlayer();
      if (track && track.src === next.src) {
        if (audio.paused) {
          const started = audio.play();
          if (started?.then) started.then(() => { playerNote = ''; paintPlayers(); syncSheetAudio(); }).catch(() => {
            playerNote = 'Ketuk sekali lagi untuk memutar audio.';
            paintPlayers();
          });
        } else {
          audio.pause();
        }
        return;
      }
      track = next;
      playerNote = '';
      audio.src = next.src;
      const started = audio.play();
      if (started?.then) started.catch(() => {
        playerNote = 'Ketuk sekali lagi untuk memutar audio.';
        paintPlayers();
      });
      paintPlayers();
      syncSheetAudio();
    }

    function stopTrack() {
      if (player && !player.paused) player.pause();
      track = null;
      playerNote = '';
      paintPlayers();
      syncSheetAudio();
    }

    /** Sumber audio dibaca dari tombolnya supaya label bar ikut berubah. */
    function trackFromButton(button) {
      const src = button.dataset.audio;
      if (!src) return null;
      return {
        src,
        ayah: Number(button.dataset.ayah) || null,
        label: button.dataset.label || 'Murattal',
      };
    }

    function handlePlayerClick(event) {
      const toggle = event.target.closest('[data-player-toggle]');
      if (toggle) {
        if (track) playTrack(track);
        return true;
      }
      if (event.target.closest('[data-player-close]')) {
        stopTrack();
        return true;
      }
      return false;
    }

    function handleAudioClick(event) {
      if (handlePlayerClick(event)) return;
      const source = event.target.closest('button[data-audio]');
      if (source) playTrack(trackFromButton(source));
    }

    function handleSeek(event) {
      const seek = event.target.closest('[data-player-seek]');
      const duration = Number(player?.duration);
      if (!seek || !track || !Number.isFinite(duration) || duration <= 0) return;
      player.currentTime = (Number(seek.value) / 1000) * duration;
      paintPlayers();
    }

    function renderSurahList(filter = '') {
      const query = filter.trim().toLowerCase();
      const rows = surahs.filter((surah) => !query || [surah.name, surah.name_latin, surah.translation, String(surah.number)]
        .some((value) => String(value || '').toLowerCase().includes(query)));

      if (!rows.length) {
        list.innerHTML = '<li class="surah-empty">Surat tidak ditemukan.</li>';
        return;
      }

      list.innerHTML = rows.map((surah) => `
        <li>
          <button class="surah-item" type="button" data-surah="${surah.number}" aria-current="${surah.number === currentSurah ? 'true' : 'false'}">
            <span class="surah-no">${surah.number}</span>
            <span class="surah-name">
              <b>${escapeHTML(surah.name_latin || surah.name || '')}</b>
              <small>${escapeHTML(surah.revelation || '')} · ${Number(surah.number_of_ayahs) || '?'} ayat</small>
            </span>
          </button>
        </li>`).join('');
    }

    function renderAyah(ayah, surahLatin = '') {
      const tafsir = cleanText(ayah?.tafsir?.kemenag?.short || '');
      const nomor = String(ayah?.ayah_number ?? '');
      return `
        <article class="ayah">
          <div class="ayah-head">
            <span class="ayah-no">${escapeHTML(String(ayah?.surah_number ?? ''))}:${escapeHTML(nomor)}</span>
            ${ayah?.audio_url ? `<button class="ayah-play" type="button" data-audio="${escapeHTML(ayah.audio_url)}" data-ayah="${escapeHTML(nomor)}" data-label="Ayat ${escapeHTML(nomor)} · ${escapeHTML(surahLatin)}" aria-label="Putar ayat ${escapeHTML(nomor)}" aria-pressed="false"><span aria-hidden="true">▶</span> Putar</button>` : ''}
          </div>
          <p class="ayah-arab" dir="rtl" lang="ar">${escapeHTML(ayah?.arab || '')}</p>
          <p class="ayah-text">${escapeHTML(ayah?.translation || '')}</p>
          ${tafsir ? `<details class="ayah-tafsir"><summary>Tafsir ringkas</summary><p>${escapeHTML(tafsir)}</p></details>` : ''}
        </article>`;
    }

    function renderReader() {
      if (!reader) return;
      const data = reader.data || {};
      const ayahs = Array.isArray(data.ayahs) ? data.ayahs : [];
      const meta = [data.revelation, `${Number(data.number_of_ayahs) || ayahs.length} ayat`, data.translation].filter(Boolean).join(' · ');
      const total = Number(reader.pagination?.total) || 0;
      const perPage = Number(reader.pagination?.limit) || 100;
      const pages = total > perPage ? Math.ceil(total / perPage) : 1;

      const pager = `
        <div class="reader-pager">
          <button type="button" data-surah="${reader.number - 1}" ${reader.number <= 1 ? 'disabled' : ''}>← Sebelumnya</button>
          ${pages > 1
            ? `<span class="reader-pages">${Array.from({ length: pages }, (_, index) => `<button type="button" data-page="${index + 1}" class="${index + 1 === reader.page ? 'is-current' : ''}"${index + 1 === reader.page ? ' aria-current="page"' : ''}>${index + 1}</button>`).join('')}</span>`
            : '<span class="muted">Satu halaman</span>'}
          <button type="button" data-surah="${reader.number + 1}" ${reader.number >= 114 ? 'disabled' : ''}>Berikutnya →</button>
        </div>`;
      const latin = data.name_latin || data.name || `Surat ${reader.number}`;
      const ayatRows = ayahs.length
        ? ayahs.map((ayah) => renderAyah(ayah, latin)).join('')
        : '<p class="muted">Ayat surat ini belum tersedia.</p>';
      const fullUrl = surahUrl(reader.number, data);
      // Basmala ditulis sendiri di awal surat, kecuali Al-Fatihah (ayat 1) dan At-Taubah.
      const basmalah = reader.page === 1 && reader.number !== 1 && reader.number !== 9
        ? '<p class="basmalah" dir="rtl" lang="ar">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</p>'
        : '';

      if (sheetOpen && sheetBody) {
        setText('#quranSheetName', latin);
        setText('#quranSheetMeta', `Surat ke-${Number(data.number) || reader.number} · ${meta}`);
        const arab = document.querySelector('#quranSheetArab');
        if (arab) {
          arab.textContent = data.name || '';
          arab.hidden = !data.name;
        }
        const sheetButton = document.querySelector('#quranSheetAudio');
        if (sheetButton) {
          sheetButton.dataset.audio = fullUrl;
          sheetButton.dataset.label = `Murattal penuh · ${latin}`;
        }
        sheetBody.innerHTML = `${basmalah}${ayatRows}`;
        sheetFoot.innerHTML = pager;
        paintPlayers();
        syncSheetAudio();
        return;
      }

      readerEl.innerHTML = `
        <div class="reader-head">
          <div>
            <h3>${escapeHTML(latin)}</h3>
            <p>Surat ke-${Number(data.number) || reader.number} · ${escapeHTML(meta)}</p>
          </div>
          <button class="ayah-play" type="button" data-audio="${escapeHTML(fullUrl)}" data-label="Murattal penuh · ${escapeHTML(latin)}" aria-pressed="false"><span aria-hidden="true">▶</span> Surat penuh</button>
        </div>
        ${renderPlayer()}
        ${basmalah}
        ${ayatRows}
        ${pager}`;
      paintPlayers();
    }

    /** Kartu "lanjutkan" supaya surat terakhir tidak langsung menutupi halaman. */
    function renderResumeChip() {
      const surah = surahs.find((item) => Number(item.number) === currentSurah);
      if (!surah) return;
      readerEl.innerHTML = `
        <div class="resume-card">
          <p class="eyebrow">LANJUTKAN MEMBACA</p>
          <b>${escapeHTML(surah.name_latin || surah.name || '')}</b>
          <small>${escapeHTML(surah.revelation || '')} · ${Number(surah.number_of_ayahs) || '?'} ayat</small>
          <button class="button button-solid" type="button" data-surah="${surah.number}">Buka surat</button>
        </div>`;
    }

    async function openSurah(number, page = 1) {
      if (!Number.isInteger(number) || number < 1 || number > 114) return;
      stopTrack();
      const cacheKey = `quran:${number}:${page}`;
      const cached = cacheRead(cacheKey);
      if (cached) {
        reader = cached;
        currentSurah = number;
        storageSet(STORE.surah, String(number));
        if (compactScreen()) openSheet();
        each('.surah-item', (item) => item.setAttribute('aria-current', item.dataset.surah === String(number) ? 'true' : 'false'));
        renderReader();
        if (sheetOpen) sheetBody.scrollTop = 0;
        return;
      }

      if (compactScreen()) {
        openSheet();
        sheetBody.innerHTML = `<p class="muted">Memuat surat ${number}…</p>`;
      } else {
        readerEl.innerHTML = `<p class="muted">Memuat surat ${number}…</p>`;
      }
      try {
        const body = await getJson(`${API}/quran?nomor=${number}&page=${page}&limit=100`);
        reader = { number, page, data: body.data || {}, pagination: body.meta?.pagination || null };
        currentSurah = number;
        storageSet(STORE.surah, String(number));
        // Teks ayat tidak berubah, jadi cukup sekali diunduh per perangkat.
        quranCacheWrite(cacheKey, reader);
        each('.surah-item', (item) => item.setAttribute('aria-current', item.dataset.surah === String(number) ? 'true' : 'false'));
        renderReader();
        if (sheetOpen) sheetBody.scrollTop = 0;
      } catch (error) {
        const message = `<p class="muted">${escapeHTML(error.message)}</p>`;
        if (sheetOpen) sheetBody.innerHTML = message; else readerEl.innerHTML = message;
      }
    }

    list.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-surah]');
      if (button) openSurah(Number(button.dataset.surah), 1);
    });

    function handleReaderClick(event) {
      const pageButton = event.target.closest('button[data-page]');
      if (pageButton && reader) {
        openSurah(reader.number, Number(pageButton.dataset.page));
        if (sheetOpen) sheetBody.scrollTop = 0; else readerEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const surahButton = event.target.closest('button[data-surah]');
      if (surahButton) openSurah(Number(surahButton.dataset.surah), 1);
    }

    readerEl.addEventListener('click', handleReaderClick);
    sheetBody?.addEventListener('click', handleReaderClick);
    sheetFoot?.addEventListener('click', handleReaderClick);
    const sheetPlayerHost = document.querySelector('#quranSheetPlayer');
    if (sheetPlayerHost) sheetPlayerHost.innerHTML = renderPlayer();
    [readerEl, sheet].filter(Boolean).forEach((root) => {
      root.addEventListener('click', handleAudioClick);
      root.addEventListener('input', handleSeek);
    });
    document.querySelector('#quranSheetClose')?.addEventListener('click', closeSheet);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && sheetOpen) closeSheet();
    });

    if (searchInput) {
      searchInput.addEventListener('input', () => renderSurahList(searchInput.value));
    }

    (async () => {
      try {
        surahs = await staticRows('quran-surah.json');
      } catch {
        const body = await getJson(`${API}/quran`).catch(() => null);
        surahs = Array.isArray(body?.data) ? body.data : [];
      }
      if (!surahs.length) {
        list.innerHTML = '<li class="surah-empty">Daftar surat belum dapat dimuat.</li>';
        return;
      }
      renderSurahList(searchInput?.value || '');
      // Surat terakhir hanya dipulihkan sebagai kartu; halaman tidak langsung tertutup sheet.
      if (currentSurah) renderResumeChip();
    })();
  }

  // ----------------------------------------------------------------------- app

  function init() {
    const year = document.querySelector('#year');
    if (year) year.textContent = new Date().getFullYear();

    const hasPrayerUi = Boolean(document.querySelector('#prayerGrid') || document.querySelector('[data-ibadah-widget]'));
    if (hasPrayerUi) {
      const saved = savedCity();
      activeCity = saved || { ...DEFAULT_CITY };
      paintCity(activeCity);
      useCachedSchedule(activeCity);
      refreshSchedule(activeCity).then(() => {
        const source = storageGet(STORE.citySource);
        if (source === 'manual') {
          setLocationNote(`Jadwal mengikuti ${activeCity.name} pilihan Anda. Ketuk “Deteksi lokasi saya” untuk menyesuaikan otomatis.`, 'manual');
          return;
        }
        if (source) {
          const from = source === 'device' ? 'lokasi perangkat' : 'jaringan internet';
          setLocationNote(`Jadwal mengikuti ${activeCity.name} dari ${from} yang tersimpan. Ketuk “Deteksi lokasi saya” untuk memperbarui.`, 'auto');
          return;
        }
        return autoLocateOnce(!saved);
      });
      initAdzan();
      initCitySearch();
      initLocationButton();
    }
    if (document.querySelector('#quranReader')) initQuran();
    if (document.querySelector('#qiblaDegrees')) initQibla();
    if (document.querySelector('#prayerGrid')) loadHijri();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
