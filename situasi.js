(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const TOKENS = ['pbpii_kader_token', 'pbpii_admin_token', 'pbpii_org_token'];
  const token = () => TOKENS.map((key) => localStorage.getItem(key)).find(Boolean) || '';
  const OFFICE = {
    lat: -6.1844917, lon: 106.8344897, zoom: 5,
    name: 'Sekretariat PB PII',
    address: 'Jl. Menteng Raya No. 58, Kebon Sirih, Menteng, Jakarta Pusat',
    maps: 'https://www.google.com/maps/search/?api=1&query=-6.1844917,106.8344897',
  };
  const LAYERS = {
    gempa: { label: 'Gempa terkini', short: 'Gempa BMKG', unit: 'gempa', color: '#edb264', maxZoom: 5 },
    peringatan: { label: 'Peringatan BMKG', short: 'BMKG CAP', unit: 'peringatan', color: '#e8b45e', maxZoom: 7 },
    gunung: { label: 'Gunung api', short: 'MAGMA', unit: 'gunung', color: '#e89376', maxZoom: 7 },
    hotspot: { label: 'Titik panas', short: 'SIPONGI', unit: 'deteksi', color: '#f29257', maxZoom: 5 },
    pesawat: { label: 'Penerbangan', short: 'ADS-B', unit: 'pesawat', color: '#93a9e8', maxZoom: 5 },
    cuaca: { label: 'Cuaca & udara', short: 'Model cuaca', unit: 'kota', color: '#7fb8dd', maxZoom: 6 },
    kegiatan: { label: 'Kegiatan PII', short: 'Kegiatan PII', unit: 'kegiatan', color: '#5fd58a', maxZoom: 8 },
  };
  const PANES = { berita: '.pane-news', tren: '.pane-social', pasar: '.pane-market', cctv: '.pane-cctv', tv: '#btnTv' };
  const MAX_CAMERAS = 80;

  let authorized = false, sessionVersion = 0, authToken = '';
  let map, pointsLayer, officeLayer, radarLayer, controller;
  let viewMode = 'globe', globeInited = false;
  if (/^\/peta(?:\.html)?$/i.test(location.pathname)) viewMode = 'map';
  let layer = 'gempa', layerData = null, layerRequest = 0, fittedLayer = '';
  let hls, videoTimer, camera, videoVersion = 0;
  const cameraIndex = new Map();
  const store = { berita: null, pasar: null, tren: null, cctv: null, tv: null };
  let newsSource = '', newsQuery = '', socialTab = 'tren', socialQuery = '', cctvCity = '', cctvQuery = '';

  const el = (tag, className, value) => { const node = document.createElement(tag); if (className) node.className = className; if (value != null) node.textContent = String(value); return node; };
  const fmtInt = (value) => Number.isFinite(Number(value)) ? new Intl.NumberFormat('id-ID').format(Number(value)) : '—';
  const num = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('id-ID', { maximumFractionDigits: digits }) : '—';
  function date(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return String(value);
    return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d) + ' WIB';
  }
  function hm(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).format(d) : '—';
  }
  function day(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric' }).format(d) : String(value);
  }
  function link(url, label) {
    try {
      const u = new URL(url, location.origin);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return el('span', '', label);
      const a = el('a', '', label); a.href = u.href;
      if (u.origin !== location.origin) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      return a;
    } catch { return el('span', '', label); }
  }
  const positioned = (item) => item && item.lat != null && item.lon != null && item.lat !== '' && item.lon !== ''
    && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon))
    && Math.abs(Number(item.lat)) <= 90 && Math.abs(Number(item.lon)) <= 180;

  async function api(kind, signal) {
    const session = token();
    if (!session) throw Object.assign(new Error('Masuk untuk membuka Ruang Situasi.'), { status: 401 });
    const response = await fetch('/api/situasi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
      body: JSON.stringify({ kind, city: $('city').value }),
      signal: signal || AbortSignal.timeout(55000),
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw Object.assign(new Error(payload.error || 'Informasi belum dapat diambil. Coba lagi sebentar.'), { status: response.status });
    return payload.data;
  }

  function setSync(text) { $('syncState').textContent = text; }
  function clearAll() {
    ['newsLead', 'newsList', 'socialList', 'camGrid', 'stkChips', 'clusterList', 'tickerTrack', 'newsSources', 'cctvCities'].forEach((id) => $(id).replaceChildren());
    $('ihsgPrice').textContent = '—'; $('ihsgDelta').textContent = '—'; $('ihsgDelta').className = 'stk-d';
    $('ihsgSpark').replaceChildren();
    $('sitCount').textContent = '—'; $('sitCountLbl').textContent = 'menunggu data';
    $('sitMeta').textContent = 'sync —'; $('mktMeta').textContent = '—'; $('socMeta').textContent = '—';
    $('newsMeta').textContent = 'Memuat…'; $('cctvMeta').textContent = '—'; $('clusterCount').textContent = '';
    $('sitSync').textContent = 'live'; $('sitSyncTime').textContent = '—';
    $('mapLegend').textContent = 'Globe insiden Indonesia';
  }

  function locked(message = 'Masuk dengan akun kader atau pengurus untuk membuka seluruh pantauan.', retry = false) {
    if (!authorized && $('gate').dataset.locked === '1') return;
    authorized = false; sessionVersion++; layerRequest++; controller?.abort();
    stopVideo(); if ($('viewer').open) $('viewer').close(); if ($('tvDialog').open) $('tvDialog').close();
    if (window.PIIGlobe) window.PIIGlobe.suspend();
    if (map) { map.remove(); map = null; pointsLayer = null; officeLayer = null; }
    if (radarLayer) { radarLayer = null; }
    $('btnRadar').setAttribute('aria-pressed', 'false'); $('radarNote').hidden = true;
    layerData = null; fittedLayer = '';
    Object.keys(store).forEach((key) => { store[key] = null; }); cameraIndex.clear();
    clearAll();
    $('room').hidden = true; $('geobar').hidden = true; $('gate').hidden = false;
    $('gate').dataset.locked = '1';
    $('gateTitle').textContent = retry ? 'Sesi belum dapat diperiksa' : 'Satu console, pantauan Indonesia';
    $('gateNote').textContent = message;
    $('loginLink').hidden = retry; $('sessionRetry').hidden = !retry;
    setSync('offline');
  }

  async function checkSession() {
    const session = token();
    if (!session) { $('gate').dataset.locked = ''; locked(); return; }
    const version = ++sessionVersion;
    $('gate').dataset.locked = '';
    try {
      await api('sesi');
      if (version !== sessionVersion || token() !== session) return;
      authToken = session; authorized = true; $('gate').hidden = true; $('room').hidden = false; $('geobar').hidden = false;
      const requested = location.hash.slice(1).split('&')[0];
      if (requested === 'peta') viewMode = 'map';
      if (!globeInited) initGlobe(); else selectView(viewMode);
      if (LAYERS[requested]) layer = requested;
      syncLayerButtons();
      $('cityLabel').hidden = layer !== 'cuaca';
      refreshAll();
      if (PANES[requested] && requested !== 'tv') requestAnimationFrame(() => focusPane(requested, false));
    } catch (error) {
      if (version === sessionVersion) locked(error.message, error.status !== 401);
    }
  }

  function initGlobe() {
    if (!window.PIIGlobe || globeInited) return;
    globeInited = true;
    window.PIIGlobe.init();
    window.PIIGlobe.setMode(viewMode);
    selectView(viewMode);
    if (layerData) updateGlobe();
  }

  function selectView(mode) {
    if (mode !== 'globe' && mode !== 'map') return;
    viewMode = mode;
    const mapMode = mode === 'map';
    document.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === mode)));
    $('sit-globe').hidden = mapMode;
    $('map').hidden = !mapMode;
    $('globeReset').hidden = mapMode;
    if (mapMode) {
      window.PIIGlobe?.setMode('map');
      if (!map) initMap();
      if (layerData) {
        if (layerData.kind === 'cuaca') drawMap([{ ...(layerData.result.city || {}), title: layerData.result.city?.name }], LAYERS.cuaca);
        else drawMap(layerData.result.items || [], LAYERS[layerData.kind]);
      }
      requestAnimationFrame(() => map?.invalidateSize());
    } else {
      if (radarLayer) disableRadar();
      window.PIIGlobe?.setMode('globe');
      window.PIIGlobe?.resume();
    }
  }

  function initMap() {
    if (map) return;
    if (!window.L) { $('map').textContent = 'Peta belum dapat dimuat. Muat ulang halaman untuk mencoba kembali.'; return; }
    map = L.map('map', { preferCanvas: true, minZoom: 3, maxZoom: 16, zoomControl: false }).setView([OFFICE.lat, OFFICE.lon], OFFICE.zoom);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: 'Tiles &copy; Esri — HERE, Garmin, OpenStreetMap' }).addTo(map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, pane: 'overlayPane', attribution: '' }).addTo(map);
    pointsLayer = L.layerGroup().addTo(map);
    officeLayer = L.layerGroup().addTo(map);
    L.marker([OFFICE.lat, OFFICE.lon], {
      icon: L.divIcon({ className: 'office-pin', html: '<span></span>', iconSize: [16, 16], iconAnchor: [8, 8] }),
      keyboard: true, title: OFFICE.name, alt: OFFICE.name,
    }).bindPopup(officePopup()).addTo(officeLayer);
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has('lat') && params.has('lon')) {
      const item = { lat: params.get('lat'), lon: params.get('lon') };
      if (positioned(item)) map.setView([Number(item.lat), Number(item.lon)], 11);
    }
    requestAnimationFrame(() => map?.invalidateSize());
  }

  function officePopup() {
    const box = el('div');
    box.append(el('b', '', OFFICE.name), el('p', '', OFFICE.address), link(OFFICE.maps, 'Buka di Google Maps ↗'));
    return box;
  }

  function itemCenter(item, kind) {
    if (positioned(item)) return [Number(item.lat), Number(item.lon)];
    if (kind === 'peringatan' && Array.isArray(item.polygons)) {
      let lat = 0, lon = 0, count = 0;
      item.polygons.forEach((ring) => {
        if (!Array.isArray(ring)) return;
        ring.forEach((pair) => {
          if (!Array.isArray(pair) || !positioned({ lat: pair[0], lon: pair[1] })) return;
          lat += Number(pair[0]); lon += Number(pair[1]); count++;
        });
      });
      if (count) return [lat / count, lon / count];
    }
    return null;
  }

  function globePoint(item, kind, fetchedAt) {
    const center = itemCenter(item, kind);
    if (!center) return null;
    const timestamp = Date.parse(item.time || item.date || item.effective || fetchedAt);
    const name = kind === 'pesawat' ? ''
      : item.region || item.province || item.city || item.location || item.name || '';
    let weight = 0.35;
    if (kind === 'gempa') weight = Math.min(1.5, Math.max(0.35, (Number(item.magnitude) || 3) / 4.5));
    else if (kind === 'gunung') weight = 1;
    else if (kind === 'kegiatan') weight = 1.1;
    else if (kind === 'peringatan') weight = 0.8;
    return {
      id: String(item.id || `${kind}:${center[0].toFixed(4)}:${center[1].toFixed(4)}:${item.title || item.name || ''}`),
      la: center[0], lo: center[1], kind,
      sub: kind === 'gempa' ? 'gempa' : kind === 'gunung' ? 'volcano' : '',
      mag: Number.isFinite(Number(item.magnitude)) ? Number(item.magnitude) : null,
      lvl: item.levelLabel || '',
      name: String(name),
      title: item.title || item.name || LAYERS[kind]?.label || 'Informasi',
      ts: Number.isFinite(timestamp) ? timestamp : 0,
      url: item.url || '',
      label: LAYERS[kind]?.short || LAYERS[kind]?.label || kind,
      source: LAYERS[kind]?.short || kind,
      weight,
      precision: kind === 'peringatan' ? 'region' : '',
      item,
    };
  }

  function updateGlobe() {
    if (!window.PIIGlobe || !globeInited) return 0;
    if (!layerData) { window.PIIGlobe.setPoints([]); return 0; }
    const { kind, result } = layerData;
    if (kind === 'cuaca') {
      const city = result.city || {};
      const point = globePoint({ ...city, title: city.name || 'Kota', time: result.fetchedAt }, 'cuaca', result.fetchedAt);
      const points = point ? [point] : [];
      window.PIIGlobe.setPoints(points);
      return points.length;
    }
    const points = (Array.isArray(result.items) ? result.items : []).slice(0, 1500)
      .map((item) => globePoint(item, kind, result.fetchedAt))
      .filter(Boolean);
    window.PIIGlobe.setPoints(points);
    return points.length;
  }

  async function refreshAll() {
    if (!authorized) return;
    $('refreshAll').disabled = true; setSync('menyegarkan…');
    await Promise.allSettled([loadNews(), loadMarkets(), loadSocial(), loadCctv(), loadLayer(layer)]);
    if (!authorized) return;
    $('refreshAll').disabled = false; setSync('tersinkron');
    updateGeoStats();
  }

  function paneError(error, metaId, targetId, message) {
    if (error.status === 401) { locked(error.message); return; }
    $(metaId).textContent = 'sumber tidak tersedia';
    $(targetId).replaceChildren(el('p', 'empty', `${message} ${error.message || ''}`.trim()));
    updateGeoStats();
  }

  async function loadNews() {
    $('newsMeta').textContent = 'Memuat…';
    try {
      store.berita = await api('berita');
      renderNews(); renderTicker();
    } catch (error) {
      store.berita = null; paneError(error, 'newsMeta', 'newsList', 'Berita belum dapat dimuat.');
    }
    updateGeoStats();
  }

  function renderNews() {
    const all = store.berita?.items || [];
    const sources = [...new Set(all.map((item) => item.source).filter(Boolean))].slice(0, 14);
    if (newsSource && !sources.includes(newsSource)) newsSource = '';
    const bar = $('newsSources'); bar.replaceChildren();
    if (sources.length > 1) {
      [''].concat(sources).forEach((source) => {
        const b = el('button', '', source || 'Semua');
        b.type = 'button'; b.dataset.source = source; b.setAttribute('aria-pressed', String(newsSource === source));
        bar.append(b);
      });
    }
    const query = newsQuery.trim().toLocaleLowerCase('id');
    const items = all.filter((item) => {
      if (newsSource && item.source !== newsSource) return false;
      if (!query) return true;
      return [item.title, item.summary, item.source].filter(Boolean).join(' ').toLocaleLowerCase('id').includes(query);
    });
    $('newsMeta').textContent = `${fmtInt(items.length)}/${fmtInt(all.length)} berita · ${date(store.berita?.fetchedAt)}`;

    const leadBox = $('newsLead'); const list = $('newsList'); leadBox.replaceChildren(); list.replaceChildren();
    if (!items.length) {
      leadBox.hidden = true;
      list.append(el('p', 'empty', newsQuery || newsSource ? 'Tidak ada berita yang cocok dengan saringan ini.' : 'Belum ada berita yang dilaporkan sumber.'));
      return;
    }
    leadBox.hidden = false;
    const lead = items[0];
    const top = el('div', 'nw-top'); top.append(el('b', '', lead.source || 'WIRE'), el('time', '', date(lead.time)));
    const heading = el('h3'); heading.append(link(lead.url, lead.title || 'Berita'));
    leadBox.append(top, heading);
    if (lead.summary) leadBox.append(el('p', '', lead.summary));
    const read = link(lead.url, 'baca sumber ↗'); read.classList.add('lead-src'); leadBox.append(read);

    items.slice(1, 80).forEach((item) => {
      const row = el('article', 'nw');
      const meta = el('div', 'nw-top'); meta.append(el('b', '', item.source || 'WIRE'), el('time', '', hm(item.time)));
      const title = el('div', 'nw-t'); title.append(link(item.url, item.title || 'Berita'));
      row.append(meta, title);
      if (item.summary) row.append(el('div', 'nw-d', item.summary));
      list.append(row);
    });
    updateGeoStats();
  }

  function renderTicker() {
    const headlines = (store.berita?.items || []).slice(0, 16);
    const track = $('tickerTrack'); track.replaceChildren();
    if (!headlines.length) { track.append(el('span', 'tk', 'Wire berita belum tersedia.')); return; }
    const make = (item) => {
      const span = el('span', 'tk');
      span.append(el('i', '', '▸'), el('b', '', item.title || 'Berita'), el('em', '', item.source || ''));
      return span;
    };
    headlines.forEach((item) => track.append(make(item)));
    headlines.forEach((item) => track.append(make(item)));
    track.style.animation = 'none'; void track.offsetWidth; track.style.animation = '';
  }

  async function loadMarkets() {
    try {
      store.pasar = await api('pasar');
      renderMarkets();
    } catch (error) {
      store.pasar = null; paneError(error, 'mktMeta', 'stkChips', 'Pasar belum dapat dimuat.');
    }
    updateGeoStats();
  }

  function renderMarkets() {
    const items = store.pasar?.items || [];
    const ihsg = items.find((item) => item.title === 'IHSG') || items[0];
    $('mktMeta').textContent = date(store.pasar?.fetchedAt);
    const chips = $('stkChips'); chips.replaceChildren();
    if (!ihsg) { chips.append(el('p', 'empty', 'Harga pasar belum tersedia.')); return; }
    $('ihsgPrice').textContent = num(ihsg.price, 2);
    const delta = $('ihsgDelta');
    const up = Number(ihsg.change) >= 0;
    delta.textContent = `${up ? '+' : ''}${num(ihsg.change, 2)} (${up ? '+' : ''}${num(ihsg.percent, 2)}%)`;
    delta.className = `stk-d ${up ? 'up' : 'down'}`;
    renderSpark(ihsg, up);
    items.filter((item) => item !== ihsg).slice(0, 12).forEach((item) => {
      const chip = el('div', 'stk-chip');
      chip.append(el('b', '', item.title || item.symbol || '—'), el('span', '', num(item.price, 2)));
      const move = el('em', Number(item.change) >= 0 ? 'up' : 'down');
      move.textContent = `${Number(item.change) >= 0 ? '+' : ''}${num(item.percent, 2)}%`;
      chip.append(move);
      chips.append(chip);
    });
    updateGeoStats();
  }

  function renderSpark(item, up) {
    const svg = $('ihsgSpark'); svg.replaceChildren();
    const values = (item.points || []).map(Number).filter(Number.isFinite);
    if (values.length < 2) return;
    const min = Math.min(...values), range = Math.max(...values) - min || 1;
    const line = document.createElementNS(svg.namespaceURI, 'polyline');
    line.setAttribute('points', values.map((value, index) => `${(index / (values.length - 1) * 200).toFixed(2)},${(42 - (value - min) / range * 38).toFixed(2)}`).join(' '));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', up ? '#5fd58a' : '#ef6d6d');
    line.setAttribute('stroke-width', '1.3');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(line);
  }

  async function loadSocial() {
    try {
      store.tren = await api('tren');
      renderSocial();
    } catch (error) {
      store.tren = null; paneError(error, 'socMeta', 'socialList', 'Opini dan tren belum dapat dimuat.');
    }
    updateGeoStats();
  }

  function renderSocial() {
    const source = socialTab === 'tren' ? store.tren?.items : store.tren?.opinions;
    const all = Array.isArray(source) ? source : [];
    const query = socialQuery.trim().toLocaleLowerCase('id');
    const items = all.filter((item) => !query || [item.title, item.summary, item.source].filter(Boolean).join(' ').toLocaleLowerCase('id').includes(query));
    $('socMeta').textContent = `${fmtInt(items.length)} ${socialTab === 'tren' ? 'tren' : 'opini'} · ${date(store.tren?.fetchedAt)}`;
    document.querySelectorAll('[data-soc]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.soc === socialTab)));
    const list = $('socialList'); list.replaceChildren();
    if (!items.length) { list.append(el('p', 'empty', socialTab === 'tren' ? 'Tren pencarian belum tersedia.' : 'Belum ada opini yang dilaporkan.')); return; }
    items.slice(0, 70).forEach((item, index) => {
      const row = el('article', 'soc');
      const meta = el('div', 'soc-top');
      meta.append(el('b', '', item.source || (socialTab === 'tren' ? 'Google Trends' : 'Opini')));
      if (item.traffic) meta.append(el('span', '', item.traffic));
      meta.append(el('time', '', hm(item.time)));
      const title = el('div', 'soc-t');
      if (socialTab === 'tren') title.append(el('span', 'rank', String(index + 1).padStart(2, '0')));
      title.append(item.url ? link(item.url, item.title || 'Tren') : el('span', '', item.title || 'Tren'));
      row.append(meta, title);
      if (item.summary && socialTab !== 'tren') row.append(el('div', 'soc-d', item.summary));
      list.append(row);
    });
    updateGeoStats();
  }

  async function loadCctv() {
    try {
      store.cctv = await api('cctv');
      renderCctv();
    } catch (error) {
      store.cctv = null; paneError(error, 'cctvMeta', 'camGrid', 'Katalog kamera belum dapat dimuat.');
    }
    updateGeoStats();
  }

  function renderCctv() {
    const all = store.cctv?.items || [];
    cameraIndex.clear();
    const cities = new Map();
    all.forEach((item) => { if (item.city) cities.set(item.city, (cities.get(item.city) || 0) + 1); });
    const ranked = [...cities.entries()].sort((a, b) => b[1] - a[1]).map(([city]) => city);
    if (cctvCity && !cities.has(cctvCity)) cctvCity = '';
    const bar = $('cctvCities'); bar.replaceChildren();
    if (ranked.length > 1) {
      [''].concat(ranked.slice(0, 10)).forEach((city) => {
        const b = el('button', '', city || 'Semua');
        b.type = 'button'; b.dataset.city = city; b.setAttribute('aria-pressed', String(cctvCity === city));
        bar.append(b);
      });
    }
    const query = cctvQuery.trim().toLocaleLowerCase('id');
    const items = all.filter((item) => {
      if (cctvCity && item.city !== cctvCity) return false;
      if (!query) return true;
      return [item.name, item.city, item.provider].filter(Boolean).join(' ').toLocaleLowerCase('id').includes(query);
    });
    $('cctvMeta').textContent = `${fmtInt(items.length)} kamera · ${fmtInt(ranked.length)} wilayah`;
    const grid = $('camGrid'); grid.replaceChildren();
    if (!items.length) { grid.append(el('p', 'empty', 'Tidak ada kamera yang cocok.')); return; }
    items.slice(0, MAX_CAMERAS).forEach((item) => {
      cameraIndex.set(item.id, item);
      const tile = el('button', 'cam');
      tile.type = 'button'; tile.dataset.camId = item.id;
      tile.title = `${item.name}${item.city ? ` — ${item.city}` : ''}`;
      const top = el('span', 'cam-top');
      top.append(el('span', 'cam-live', 'LIVE'), el('span', 'cam-city', item.city || 'Indonesia'));
      tile.append(top, el('b', '', item.name || 'Kamera publik'));
      grid.append(tile);
    });
    if (items.length > MAX_CAMERAS) grid.append(el('div', 'cam-more', `Menampilkan ${MAX_CAMERAS} dari ${fmtInt(items.length)} kamera. Persempit dengan pencarian atau wilayah.`));
    updateGeoStats();
  }

  function syncLayerButtons() {
    document.querySelectorAll('[data-layer]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layer === layer)));
    $('cityLabel').hidden = layer !== 'cuaca';
  }

  async function loadLayer(kind) {
    if (!authorized) return;
    const request = ++layerRequest;
    $('sitMeta').textContent = 'Memuat…';
    $('clusterList').replaceChildren(el('p', 'empty', 'Mengambil data lapisan…'));
    try {
      const result = await api(kind);
      if (request !== layerRequest || !authorized) return;
      layerData = { kind, result };
      renderLayer();
    } catch (error) {
      if (request !== layerRequest) return;
      if (error.status === 401) { locked(error.message); return; }
      layerData = null;
      $('sitMeta').textContent = 'sumber tidak tersedia';
      $('clusterList').replaceChildren(el('p', 'empty', `${LAYERS[kind]?.label || kind} belum dapat dimuat. ${error.message || ''}`.trim()));
      $('sitCount').textContent = '—'; $('sitCountLbl').textContent = 'tidak tersedia';
      $('mapLegend').textContent = 'Data lapisan belum tersedia.';
    }
    updateGeoStats();
  }

  function selectLayer(kind, updateHash = true) {
    if (!authorized || !LAYERS[kind]) return;
    layer = kind; layerData = null; fittedLayer = ''; layerRequest++;
    syncLayerButtons();
    if (updateHash) history.replaceState(null, '', `#${kind}`);
    loadLayer(kind);
  }

  function renderLayer() {
    if (!layerData) return;
    const { kind, result } = layerData;
    const info = LAYERS[kind];
    const items = Array.isArray(result.items) ? result.items : [];
    $('sitSync').textContent = result.cache === 'stale' ? 'stale' : 'live';
    $('sitSyncTime').textContent = hm(result.fetchedAt);
    if (kind === 'cuaca') { renderWeather(result); updateGeoStats(); return; }
    $('sitMeta').textContent = `${fmtInt(items.length)} ${info.unit} · ${date(result.fetchedAt)}`;
    $('sitCount').textContent = fmtInt(items.length);
    $('sitCountLbl').textContent = info.short || info.label;
    if (viewMode === 'map') drawMap(items, info);
    const plotted = updateGlobe();
    if (viewMode === 'globe') {
      $('mapLegend').textContent = plotted
        ? `Globe · ${fmtInt(plotted)} titik ${info.label}`
        : 'Tidak ada koordinat yang tersedia untuk lapisan ini.';
    }
    renderClusters(items, kind);
    updateGeoStats();
  }

  function drawMap(items, info) {
    if (!map || !pointsLayer || !window.L) return;
    pointsLayer.clearLayers();
    const drawn = items.slice(0, 1500);
    const bounds = L.latLngBounds([]);
    let count = 0;
    if (map && pointsLayer) drawn.forEach((item) => {
      if (layer === 'peringatan' && Array.isArray(item.polygons) && Date.parse(item.expires) > Date.now()) {
        item.polygons.forEach((poly) => {
          if (!Array.isArray(poly) || poly.length < 3 || !poly.every((p) => Array.isArray(p) && positioned({ lat: p[0], lon: p[1] }))) return;
          L.polygon(poly, { color: info.color, weight: 1, fillOpacity: .13 }).bindPopup(popup(item)).addTo(pointsLayer);
          poly.forEach((p) => bounds.extend([p[0], p[1]]));
          count++;
        });
      } else if (positioned(item) && layer !== 'peringatan') {
        const radius = layer === 'hotspot' ? 2.5 : layer === 'gempa' ? 6 : layer === 'pesawat' ? 3 : 5;
        L.circleMarker([Number(item.lat), Number(item.lon)], { radius, color: info.color, weight: 1, fillColor: info.color, fillOpacity: .72 })
          .bindPopup(popup(item)).addTo(pointsLayer);
        bounds.extend([Number(item.lat), Number(item.lon)]);
        count++;
      }
    });
    $('mapLegend').textContent = count
      ? `${fmtInt(count)} titik · ${info.label}${items.length > drawn.length ? ` · ${fmtInt(items.length - drawn.length)} lainnya di daftar` : ''}`
      : layer === 'peringatan' ? 'Tidak ada area peringatan yang sedang berlaku.' : 'Tidak ada koordinat yang tersedia untuk lapisan ini.';
    if (count && fittedLayer !== layer && bounds.isValid()) {
      map.fitBounds(bounds.pad(.18), { maxZoom: info.maxZoom || 6, animate: false });
      fittedLayer = layer;
    }
  }

  function renderClusters(items, kind) {
    const list = $('clusterList'); list.replaceChildren();
    $('clusterCount').textContent = `${fmtInt(items.length)} entri`;
    if (!items.length) { list.append(el('p', 'empty', 'Belum ada entri untuk lapisan ini.')); return; }
    items.slice(0, 80).forEach((item) => {
      const button = el('button', 'cl'); button.type = 'button';
      const top = el('div', 'cl-top');
      top.append(el('b', '', clusterTag(item, kind)), el('time', '', hm(item.time)));
      button.append(top, el('span', 'cl-t', item.title || item.name || 'Informasi'));
      const sub = clusterSub(item, kind);
      if (sub) button.append(el('small', '', sub));
      button.addEventListener('click', () => focusItem(item));
      list.append(button);
    });
  }

  function clusterTag(item, kind) {
    if (kind === 'gempa') return item.magnitude != null ? `M${num(item.magnitude, 1)}` : 'BMKG';
    if (kind === 'peringatan') return item.severity || 'BMKG';
    if (kind === 'gunung') return item.levelLabel || 'MAGMA';
    if (kind === 'hotspot') return item.satellite || 'SIPONGI';
    if (kind === 'pesawat') return item.callsign || 'ADS-B';
    if (kind === 'kegiatan') return item.level || 'PII';
    return item.province || item.region || 'LIVE';
  }

  function clusterSub(item, kind) {
    if (kind === 'gempa') return item.summary;
    if (kind === 'peringatan') {
      const end = Date.parse(item.expires), start = Date.parse(item.effective);
      const state = !Number.isFinite(end) ? 'Masa berlaku tidak dicantumkan' : end <= Date.now() ? 'Berakhir' : start > Date.now() ? 'Akan berlaku' : 'Dalam masa berlaku';
      return `${state}${item.expires ? ` · hingga ${date(item.expires)}` : ''}`;
    }
    if (kind === 'gunung') return item.summary;
    if (kind === 'hotspot') return `Keyakinan deteksi: ${item.confidence || 'tidak dicantumkan'} · Bukan kepastian kebakaran`;
    if (kind === 'pesawat') return `Ketinggian ${num(item.altitude, 0)} m · Kecepatan ${num(item.speed, 0)} m/detik${item.stale ? ' · Posisi lama' : ''}`;
    if (kind === 'kegiatan') return `${day(item.date)}${item.endDate ? ` — ${day(item.endDate)}` : ''}${item.location ? ` · ${item.location}` : ''}`;
    return item.summary;
  }

  function popup(item) {
    const box = el('div');
    box.append(el('b', '', item.title || item.name || 'Lokasi'));
    if (item.summary) box.append(el('p', '', item.summary));
    if (item.time) box.append(el('p', '', date(item.time)));
    if (layer === 'kegiatan') { box.append(el('p', '', `${day(item.date)} — ${day(item.endDate || item.date)}`)); if (item.url) box.append(link(item.url, 'Detail kegiatan →')); }
    return box;
  }

  function renderWeather(result) {
    const city = result.city || {};
    const current = result.current || null;
    $('sitMeta').textContent = `${city.name || 'Kota'} · ${date(result.fetchedAt)}`;
    $('sitCount').textContent = current ? `${num(current.temperature_2m, 1)}°` : '—';
    $('sitCountLbl').textContent = `${city.name || 'Kota'} · model cuaca`;
    if (viewMode === 'map') drawMap([{ ...city, title: city.name }], LAYERS.cuaca);
    updateGlobe();
    $('mapLegend').textContent = `${city.name || 'Kota'} · prakiraan Open-Meteo & CAMS, bukan pengukuran stasiun`;
    const list = $('clusterList'); list.replaceChildren();
    const box = el('div', 'wx');
    if (current) {
      const hero = el('div', 'wx-hero');
      hero.append(el('b', '', `${num(current.temperature_2m, 1)}°`));
      const info = el('div'); info.append(el('h3', '', city.name || 'Kota'), el('p', '', `Model cuaca · ${String(current.time || '').replace('T', ' ')} WIB`));
      hero.append(info); box.append(hero);
    }
    const metrics = el('div', 'wx-grid');
    const cell = (label, value, unit) => { const node = el('div', 'wx-cell'); node.append(el('span', '', label), el('b', '', value), el('small', '', unit)); metrics.append(node); };
    if (current) { cell('Curah hujan', num(current.precipitation), 'mm'); cell('Angin', num(current.wind_speed_10m), 'km/jam'); }
    if (result.air) { cell('PM2.5', num(result.air.pm2_5), 'µg/m³ · CAMS'); cell('US AQI', num(result.air.us_aqi, 0), 'indeks udara'); }
    box.append(metrics);
    if (result.hourly?.time?.length) {
      const table = el('table'); table.append(el('caption', '', 'Prakiraan 12 jam berikutnya'));
      const head = el('tr'); ['WIB', 'Suhu', 'Hujan'].forEach((label) => head.append(el('th', '', label)));
      const thead = el('thead'); thead.append(head); table.append(thead);
      const body = el('tbody');
      result.hourly.time.map((time, index) => ({ time, index }))
        .filter(({ time }) => Date.parse(`${time}+07:00`) >= Date.now() - 3600000).slice(0, 12)
        .forEach(({ time, index }) => {
          const row = el('tr');
          [time.slice(11, 16), `${num(result.hourly.temperature_2m[index])}°C`, `${num(result.hourly.precipitation_probability[index], 0)}%`].forEach((value) => row.append(el('td', '', value)));
          body.append(row);
        });
      table.append(body); box.append(table);
    }
    list.append(box);
  }

  function focusItem(item) {
    const center = itemCenter(item, layer);
    if (viewMode === 'globe') {
      if (center) window.PIIGlobe?.focus(center[0], center[1], layer === 'kegiatan' ? 10 : layer === 'gempa' ? 7 : 8);
    } else if (map) {
      if (positioned(item)) {
        map.setView([Number(item.lat), Number(item.lon)], layer === 'kegiatan' ? 13 : 9);
        L.popup().setLatLng([item.lat, item.lon]).setContent(popup(item)).openOn(map);
      } else if (Array.isArray(item.polygons) && item.polygons.length) {
        map.fitBounds(L.latLngBounds(item.polygons.flat()), { maxZoom: 9 });
      }
    }
    if (innerWidth <= 980) $('sitMapWrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function updateGeoStats() {
    const bar = $('geoStats'); bar.replaceChildren();
    const stat = (value, label) => {
      const node = el('span', 'geo-item'); node.append(el('b', '', fmtInt(value)), el('span', 'geo-l', label)); return node;
    };
    bar.append(stat((store.berita?.items || []).length, 'Berita'));
    bar.append(stat((store.pasar?.items || []).length, 'Pasar'));
    bar.append(stat((store.tren?.items || []).length, 'Tren'));
    bar.append(stat((store.cctv?.items || []).length, 'CCTV'));
    if (layerData?.kind !== 'cuaca' && Array.isArray(layerData?.result?.items)) {
      bar.append(stat(layerData.result.items.length, LAYERS[layerData.kind]?.unit || 'Lapisan'));
    }
  }

  function focusPane(kind, scroll = true) {
    if (kind === 'tv') { openTv(); return; }
    const selector = PANES[kind];
    if (!selector) return;
    const pane = document.querySelector(selector);
    if (!pane) return;
    if (scroll && innerWidth <= 980) pane.scrollIntoView({ behavior: 'smooth', block: 'start' });
    pane.classList.add('is-focus');
    setTimeout(() => pane.classList.remove('is-focus'), 900);
  }

  function disableRadar() {
    if (radarLayer && map) map.removeLayer(radarLayer);
    radarLayer = null;
    $('btnRadar').setAttribute('aria-pressed', 'false');
    $('radarNote').hidden = true;
  }

  async function toggleRadar() {
    const button = $('btnRadar');
    if (button.getAttribute('aria-pressed') === 'true') {
      disableRadar();
      return;
    }
    if (!authorized) return;
    if (viewMode !== 'map') selectView('map');
    if (!map) return;
    button.setAttribute('aria-pressed', 'true');
    const version = sessionVersion;
    $('radarNote').hidden = false; $('radarNote').textContent = 'Memuat citra radar…';
    try {
      const result = await api('radar');
      if (!authorized || version !== sessionVersion || button.getAttribute('aria-pressed') !== 'true' || !map) return;
      const frame = result.items.at(-1);
      if (!frame || !/^\/v2\/radar\/[a-z0-9]+$/i.test(frame.path)) throw new Error('Citra radar belum tersedia.');
      radarLayer = L.tileLayer(`https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: .6, maxNativeZoom: 7, maxZoom: 16, attribution: 'RainViewer' }).addTo(map);
      $('radarNote').textContent = `Citra ${date(frame.time * 1000)}. ${result.note}`;
    } catch (error) {
      if (version !== sessionVersion) return;
      if (error.status === 401) { locked(error.message); return; }
      button.setAttribute('aria-pressed', 'false');
      $('radarNote').textContent = error.message;
    }
  }

  async function openTv() {
    if (!authorized) return;
    if (!$('tvDialog').open) $('tvDialog').showModal();
    if (store.tv) { renderTv(); return; }
    $('tvGrid').replaceChildren(el('p', 'empty', 'Memuat daftar kanal…'));
    try {
      store.tv = await api('tv', AbortSignal.timeout(30000));
      renderTv();
    } catch (error) {
      if (error.status === 401) { locked(error.message); return; }
      $('tvGrid').replaceChildren(el('p', 'empty', `Daftar kanal belum dapat dimuat. ${error.message || ''}`.trim()));
    }
  }

  function renderTv() {
    const items = store.tv?.items || [];
    const grid = $('tvGrid'); grid.replaceChildren();
    if (!items.length) { grid.append(el('p', 'empty', 'Belum ada kanal yang tersedia.')); return; }
    [['Nasional', 'TELEVISI NASIONAL'], ['Internasional', 'TELEVISI INTERNASIONAL']].forEach(([group, label]) => {
      const channels = items.filter((item) => (item.group || 'Nasional') === group);
      if (!channels.length) return;
      const heading = el('h3', 'section-label', label);
      heading.style.cssText = 'grid-column:1/-1;font-size:8px;letter-spacing:1.2px;color:#586a75;margin-top:4px';
      grid.append(heading);
      channels.forEach((item) => {
        const tile = el('article', 'tv-channel');
        tile.append(el('span', 'tv-badge', group === 'Nasional' ? 'ID' : 'LIVE'), el('h3', '', item.title || 'Kanal'));
        const actions = el('div', 'tv-actions');
        const play = el('button', '', 'Tonton langsung'); play.type = 'button';
        play.addEventListener('click', () => playStream(item));
        actions.append(play);
        if (item.page) actions.append(link(item.page, 'Situs stasiun ↗'));
        tile.append(actions);
        grid.append(tile);
      });
    });
  }

  function playStream(item) {
    if (!authorized) return;
    let stream = '';
    try {
      const url = new URL(item.url);
      if (url.protocol === 'https:' && !url.username && !url.password) stream = url.href;
    } catch { return; }
    camera = { title: item.title || 'Siaran TV', stream };
    if ($('tvDialog').open) $('tvDialog').close();
    $('viewerKicker').textContent = 'SIARAN LANGSUNG';
    $('viewerTitle').textContent = camera.title;
    $('cameraImage').hidden = true;
    if (!$('viewer').open) $('viewer').showModal();
    playCamera();
  }

  function stopVideo() {
    videoVersion++; clearTimeout(videoTimer); hls?.destroy(); hls = null;
    const video = $('video'); video.pause(); video.removeAttribute('src'); video.load();
    $('cameraImage').removeAttribute('src');
  }

  function openCamera(item) {
    if (!authorized || !item) return;
    camera = item;
    $('viewerKicker').textContent = 'KAMERA PUBLIK';
    $('viewerTitle').textContent = item.name || item.title || 'CCTV';
    if (!$('viewer').open) $('viewer').showModal();
    playCamera();
  }

  function playCamera() {
    stopVideo(); if (!camera || !authorized || !$('viewer').open) return;
    const version = videoVersion, video = $('video'), image = $('cameraImage');
    const stream = typeof camera.stream === 'string' ? camera.stream : '';
    const fail = () => {
      if (version !== videoVersion) return;
      clearTimeout(videoTimer); hls?.destroy(); hls = null;
      video.pause(); video.removeAttribute('src'); video.load();
      $('videoStatus').textContent = stream ? 'Siaran belum dapat diputar. Coba lagi atau pilih kanal lain.' : 'Tayangan kamera belum dapat diputar. Coba lagi atau pilih kamera lain.';
      $('retryVideo').hidden = false;
    };
    const playing = () => {
      if (version !== videoVersion) return;
      clearTimeout(videoTimer);
      $('videoStatus').textContent = stream ? `Siaran ${camera.title || 'TV'} sedang diputar.` : 'Video sedang diputar · kamera publik';
    };
    if (stream) {
      video.hidden = false; image.hidden = true;
      $('videoStatus').textContent = 'Menghubungkan ke siaran…'; $('retryVideo').hidden = true;
      video.onplaying = playing; video.onerror = fail;
      videoTimer = setTimeout(fail, 30000);
      if (window.Hls?.isSupported()) {
        hls = new Hls({ maxBufferLength: 15, maxMaxBufferLength: 30, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 1, fragLoadingMaxRetry: 1 });
        hls.on(Hls.Events.ERROR, (_, detail) => { if (detail.fatal) fail(); });
        hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => { if (version === videoVersion) $('videoStatus').textContent = 'Tekan tombol putar pada video untuk mulai.'; }); });
        hls.loadSource(stream); hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = stream; video.play().catch(() => { if (version === videoVersion) $('videoStatus').textContent = 'Tekan tombol putar pada video untuk mulai.'; });
      } else fail();
      return;
    }
    const id = String(camera.id || '');
    if (!/^id-[a-z0-9_-]{2,96}$/i.test(id)) { $('videoStatus').textContent = 'Kamera tidak dapat diputar.'; return; }
    $('videoStatus').textContent = 'Menghubungkan ke kamera…'; $('retryVideo').hidden = true;
    const isImage = /image|jpeg|jpg|snapshot/i.test(camera.feedType || camera.type || '');
    video.hidden = isImage; image.hidden = !isImage;
    videoTimer = setTimeout(fail, 45000);
    if (isImage) {
      image.onload = () => { if (version === videoVersion) { clearTimeout(videoTimer); $('videoStatus').textContent = 'Cuplikan kamera berhasil dimuat.'; } };
      image.onerror = fail; image.src = `/api/cctv/frame/${encodeURIComponent(id)}`; return;
    }
    video.onplaying = playing; video.onerror = fail;
    const url = `/api/cctv/media/${encodeURIComponent(id)}`;
    if (window.Hls?.isSupported()) {
      hls = new Hls({ maxBufferLength: 15, maxMaxBufferLength: 30, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 1, fragLoadingMaxRetry: 1 });
      hls.on(Hls.Events.ERROR, (_, detail) => { if (detail.fatal) fail(); });
      hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => { if (version === videoVersion) $('videoStatus').textContent = 'Tekan tombol putar pada video untuk mulai.'; }); });
      hls.loadSource(url); hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url; video.play().catch(() => { if (version === videoVersion) $('videoStatus').textContent = 'Tekan tombol putar pada video untuk mulai.'; });
    } else fail();
  }

  // ── events ─────────────────────────────────────────────────
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => selectView(button.dataset.view)));
  $('globeReset').addEventListener('click', () => window.PIIGlobe?.reset());
  $('layerChips').addEventListener('click', (event) => { const b = event.target.closest('[data-layer]'); if (b) selectLayer(b.dataset.layer); });
  $('newsSources').addEventListener('click', (event) => {
    const b = event.target.closest('[data-source]'); if (!b) return;
    newsSource = b.dataset.source || ''; renderNews();
  });
  $('cctvCities').addEventListener('click', (event) => {
    const b = event.target.closest('[data-city]'); if (!b) return;
    cctvCity = b.dataset.city || ''; renderCctv();
  });
  document.querySelectorAll('[data-soc]').forEach((b) => b.addEventListener('click', () => {
    socialTab = b.dataset.soc; renderSocial();
  }));
  $('camGrid').addEventListener('click', (event) => {
    const tile = event.target.closest('[data-cam-id]'); if (!tile) return;
    openCamera(cameraIndex.get(tile.dataset.camId));
  });
  $('newsSearch').addEventListener('input', (event) => { newsQuery = event.target.value; renderNews(); });
  $('socialSearch').addEventListener('input', (event) => { socialQuery = event.target.value; renderSocial(); });
  $('cctvSearch').addEventListener('input', (event) => { cctvQuery = event.target.value; renderCctv(); });
  $('city').addEventListener('change', () => { if (layer === 'cuaca') loadLayer('cuaca'); });
  $('refreshAll').addEventListener('click', refreshAll);
  $('btnTv').addEventListener('click', openTv);
  $('btnRadar').addEventListener('click', toggleRadar);
  $('closeTv').addEventListener('click', () => $('tvDialog').close());
  $('closeViewer').addEventListener('click', () => $('viewer').close());
  $('viewer').addEventListener('close', stopVideo);
  $('retryVideo').addEventListener('click', playCamera);
  $('sessionRetry').addEventListener('click', checkSession);
  window.addEventListener('pagehide', stopVideo);
  window.addEventListener('storage', (event) => { if (event.key === null || TOKENS.includes(event.key)) { locked(); checkSession(); } });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopVideo(); return; }
    window.PIIGlobe?.resume();
    if (token() !== authToken) checkSession();
  });
  window.addEventListener('hashchange', () => {
    const kind = location.hash.slice(1).split('&')[0];
    if (kind === 'peta') { selectView('map'); return; }
    if (LAYERS[kind] && kind !== layer) selectLayer(kind, false);
    else if (PANES[kind]) focusPane(kind);
  });

  const clock = () => {
    $('clock').textContent = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date()) + ' WIB';
  };
  clock(); setInterval(clock, 30000);
  $('loginLink').href = `/sso.html?next=${encodeURIComponent(location.pathname + location.hash)}`;
  checkSession();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
