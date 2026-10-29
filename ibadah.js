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
  const STORE = { city: 'pbpii:ibadah-city', adzan: 'pbpii:ibadah-adzan', surah: 'pbpii:ibadah-surah' };

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
    'KALIMANTAN BARAT', 'KALIMANTAN TENGAH', 'KALIMANTAN SELATAN', 'KALIMANTAN TIMUR', 'KALIMANTAN UTARA',
    'SULAWESI UTARA', 'GORONTALO', 'SULAWESI TENGAH', 'SULAWESI BARAT', 'SULAWESI SELATAN', 'SULAWESI TENGGARA',
  ]);
  const TZ_LABEL = { 'Asia/Jakarta': 'WIB', 'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT' };

  let schedule = null;
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

  function storedCity() {
    try {
      const saved = JSON.parse(storageGet(STORE.city, 'null'));
      if (saved && /^[a-f0-9]{32}$/i.test(String(saved.id || ''))) {
        return { id: saved.id, name: String(saved.name || 'Kota terpilih'), prov: String(saved.prov || '') };
      }
    } catch {
      /* fall through to the default */
    }
    return { ...DEFAULT_CITY };
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
      if (fresh && ADZAN_KEYS.has(current) && storageGet(STORE.adzan) === 'on' && !document.hidden) {
        playAdzan(PRAYER_LABEL[current]);
      }
    }

    const now = Date.now();
    if (now - lastDayCheck > 300000) {
      lastDayCheck = now;
      if (schedule.dayKey !== dateKeyIn(schedule.tz)) refreshSchedule(storedCity());
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
      lastPrayer = undefined;
      storageSet(STORE.city, JSON.stringify(schedule.city));
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

  // --------------------------------------------------------------------- adzan

  function setAdzanNote(message) {
    const note = document.querySelector('#adzanNote');
    if (note) note.textContent = message;
  }

  function playAdzan(label) {
    if (!adzanAudio) {
      adzanAudio = new Audio(ADZAN_SRC);
      adzanAudio.preload = 'none';
      adzanAudio.addEventListener('error', () => setAdzanNote('Berkas audio adzan tidak dapat dimuat.'));
    }
    adzanAudio.currentTime = 0;
    const started = adzanAudio.play();
    if (started?.then) {
      started
        .then(() => setAdzanNote(`Adzan${label ? ` ${label}` : ''} sedang diputar.`))
        .catch(() => setAdzanNote('Browser memblokir audio otomatis. Ketuk “Putar adzan” untuk mengizinkan suara.'));
    }
  }

  function initAdzan() {
    const toggle = document.querySelector('#adzanToggle');
    const button = document.querySelector('#adzanPlay');

    if (toggle) {
      toggle.checked = storageGet(STORE.adzan) === 'on';
      toggle.addEventListener('change', () => {
        storageSet(STORE.adzan, toggle.checked ? 'on' : 'off');
        setAdzanNote(toggle.checked
          ? 'Adzan otomatis aktif. Ketuk “Putar adzan” sekali agar browser mengizinkan suara.'
          : 'Adzan otomatis nonaktif. Kamu tetap bisa memutarnya manual.');
      });
    }

    if (button) button.addEventListener('click', () => playAdzan(''));
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
      storageSet(STORE.city, JSON.stringify(city));
      input.value = '';
      close();
      paintCity(city);
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
    results.innerHTML = '<li class="city-empty">Mencari kabupaten/kota…</li>';
    try {
      const body = await getJson(`${API}/kota?q=${encodeURIComponent(query)}`);
      const rows = (Array.isArray(body.data) ? body.data : []).slice(0, 12);
      results.innerHTML = rows.length
        ? rows.map((row) => {
          const name = prettyPlace(row.lokasi);
          return `<li><button type="button" data-id="${escapeHTML(row.id)}" data-name="${escapeHTML(name)}">${escapeHTML(name)}</button></li>`;
        }).join('')
        : '<li class="city-empty">Kabupaten/kota tidak ditemukan. Coba kata lain.</li>';
    } catch (error) {
      results.innerHTML = `<li class="city-empty">${escapeHTML(error.message)}</li>`;
    }
  }

  // --------------------------------------------------------------------- kiblat

  function setQiblaStatus(message) {
    const status = document.querySelector('#qiblaStatus');
    if (status) status.textContent = message;
  }

  async function loadQibla(lat, lon, sourceLabel) {
    setQiblaStatus(`Menghitung arah kiblat dari ${sourceLabel}…`);
    try {
      const body = await getJson(`${API}/qibla?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`);
      const direction = Number(body.data?.direction);
      if (!Number.isFinite(direction)) throw new Error('Arah kiblat tidak tersedia.');
      const needle = document.querySelector('#qiblaNeedle');
      if (needle) needle.setAttribute('transform', `rotate(${direction.toFixed(1)} 100 100)`);
      setText('#qiblaDegrees', `${direction.toFixed(1)}°`);
      setText('#qiblaSource', `dari ${sourceLabel}`);
      setQiblaStatus(`Kiblat dari ${sourceLabel}: ${direction.toFixed(1)}° dari utara sejati, searah jarum jam.`);
    } catch (error) {
      setQiblaStatus(error.message);
    }
  }

  function initQibla() {
    loadQibla(SECRETARIAT.lat, SECRETARIAT.lon, SECRETARIAT.label);

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
    let audio = null;
    let audioButton = null;

    function stopAudio() {
      if (audio && !audio.paused) audio.pause();
      if (audioButton) {
        audioButton.textContent = audioButton.dataset.idle || '▶ Putar';
        audioButton.classList.remove('is-playing');
        audioButton.setAttribute('aria-pressed', 'false');
      }
      audioButton = null;
    }

    function toggleAudio(button) {
      const src = button.dataset.audio;
      if (!src) return;
      if (!audio) {
        audio = new Audio();
        audio.preload = 'none';
        audio.addEventListener('ended', stopAudio);
      }
      if (audioButton === button && !audio.paused) {
        stopAudio();
        return;
      }
      stopAudio();
      audio.src = src;
      const started = audio.play();
      if (!started?.then) return;
      started.then(() => {
        button.dataset.idle = button.textContent;
        button.textContent = '❚❚ Jeda';
        button.classList.add('is-playing');
        button.setAttribute('aria-pressed', 'true');
        audioButton = button;
      }).catch(() => {
        button.textContent = 'Audio tidak dapat diputar';
      });
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

    function renderAyah(ayah) {
      const tafsir = cleanText(ayah?.tafsir?.kemenag?.short || '');
      return `
        <article class="ayah">
          <div class="ayah-head">
            <span class="ayah-no">${escapeHTML(String(ayah?.surah_number ?? ''))}:${escapeHTML(String(ayah?.ayah_number ?? ''))}</span>
            ${ayah?.audio_url ? `<button class="ayah-play" type="button" data-audio="${escapeHTML(ayah.audio_url)}" aria-label="Putar ayat ${escapeHTML(String(ayah.ayah_number ?? ''))}" aria-pressed="false">▶ Putar</button>` : ''}
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

      readerEl.innerHTML = `
        <div class="reader-head">
          <div>
            <h3>${escapeHTML(data.name_latin || data.name || 'Surat')}</h3>
            <p>Surat ke-${Number(data.number) || reader.number} · ${escapeHTML(meta)}</p>
          </div>
          ${data.audio_url ? `<button class="ayah-play" type="button" data-audio="${escapeHTML(data.audio_url)}" aria-pressed="false">▶ Murattal surat</button>` : ''}
        </div>
        ${ayahs.length ? ayahs.map(renderAyah).join('') : '<p class="muted">Ayat surat ini belum tersedia.</p>'}
        <div class="reader-pager">
          <button type="button" data-surah="${reader.number - 1}" ${reader.number <= 1 ? 'disabled' : ''}>← Surat sebelumnya</button>
          ${pages > 1
            ? `<span class="reader-pages">${Array.from({ length: pages }, (_, index) => `<button type="button" data-page="${index + 1}" class="${index + 1 === reader.page ? 'is-current' : ''}"${index + 1 === reader.page ? ' aria-current="page"' : ''}>${index + 1}</button>`).join('')}</span>`
            : '<span class="muted">Satu halaman penuh</span>'}
          <button type="button" data-surah="${reader.number + 1}" ${reader.number >= 114 ? 'disabled' : ''}>Surat berikutnya →</button>
        </div>`;
    }

    async function openSurah(number, page = 1) {
      if (!Number.isInteger(number) || number < 1 || number > 114) return;
      stopAudio();
      readerEl.innerHTML = `<p class="muted">Memuat surat ${number}…</p>`;
      try {
        const body = await getJson(`${API}/quran?nomor=${number}&page=${page}&limit=100`);
        reader = { number, page, data: body.data || {}, pagination: body.meta?.pagination || null };
        currentSurah = number;
        storageSet(STORE.surah, String(number));
        each('.surah-item', (item) => item.setAttribute('aria-current', item.dataset.surah === String(number) ? 'true' : 'false'));
        renderReader();
      } catch (error) {
        readerEl.innerHTML = `<p class="muted">${escapeHTML(error.message)}</p>`;
      }
    }

    list.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-surah]');
      if (button) openSurah(Number(button.dataset.surah), 1);
    });

    readerEl.addEventListener('click', (event) => {
      const audioButtonEl = event.target.closest('button[data-audio]');
      if (audioButtonEl) {
        toggleAudio(audioButtonEl);
        return;
      }
      const pageButton = event.target.closest('button[data-page]');
      if (pageButton && reader) {
        openSurah(reader.number, Number(pageButton.dataset.page));
        readerEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const surahButton = event.target.closest('button[data-surah]');
      if (surahButton) openSurah(Number(surahButton.dataset.surah), 1);
    });

    if (searchInput) {
      searchInput.addEventListener('input', () => renderSurahList(searchInput.value));
    }

    (async () => {
      try {
        const body = await getJson(`${API}/quran`);
        surahs = Array.isArray(body.data) ? body.data : [];
        renderSurahList(searchInput?.value || '');
        if (currentSurah) openSurah(currentSurah, 1);
      } catch (error) {
        list.innerHTML = `<li class="surah-empty">${escapeHTML(error.message)}</li>`;
      }
    })();
  }

  // ----------------------------------------------------------------------- app

  function init() {
    const year = document.querySelector('#year');
    if (year) year.textContent = new Date().getFullYear();

    const hasPrayerUi = Boolean(document.querySelector('#prayerGrid') || document.querySelector('[data-ibadah-widget]'));
    if (hasPrayerUi) {
      paintCity(storedCity());
      refreshSchedule(storedCity());
      initAdzan();
      initCitySearch();
    }
    if (document.querySelector('#quranReader')) initQuran();
    if (document.querySelector('#qiblaDegrees')) initQibla();
    if (document.querySelector('#prayerGrid')) loadHijri();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
