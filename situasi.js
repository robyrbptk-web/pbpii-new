(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const TOKENS = ['pbpii_kader_token', 'pbpii_admin_token', 'pbpii_org_token'];
  const token = () => TOKENS.map((key) => localStorage.getItem(key)).find(Boolean) || '';
  const SECTIONS = {
    berita: ['Berita terkini', 'KABAR NUSANTARA'], tren: ['Opini & tren', 'PERCAKAPAN PUBLIK'],
    pasar: ['Pasar IDX', 'INDEKS & SAHAM'], cctv: ['CCTV Indonesia', 'KAMERA PUBLIK'],
    cuaca: ['Cuaca & udara', 'PRAKIRAAN & MODEL'], peringatan: ['Peringatan BMKG', 'NOWCAST CUACA'],
    gempa: ['Gempa terkini', 'PENGAMATAN BMKG'], gunung: ['Aktivitas gunung api', 'MAGMA ESDM'],
    hotspot: ['Titik panas satelit', 'PANTAUAN SIPONGI'], pesawat: ['Penerbangan', 'PENGAMATAN ADS-B'],
    kegiatan: ['Kegiatan PII', 'LOKASI & JADWAL'],
  };
  const COLORS = { cctv: '#85bddd', gempa: '#edb264', gunung: '#e89376', hotspot: '#f29257', pesawat: '#acb8eb', kegiatan: '#91d1b3', peringatan: '#efa167', cuaca: '#85bddd' };
  let active = 'berita', authorized = false, sessionVersion = 0, serial = 0, authToken = '';
  let data = null, shown = 35, map, points, radarLayer, controller, hls, videoTimer, camera, videoVersion = 0;
  const text = (tag, value, className) => { const el = document.createElement(tag); el.textContent = value == null ? '' : String(value); if (className) el.className = className; return el; };
  const num = (value, digits = 1) => Number.isFinite(value) ? value.toLocaleString('id-ID', { maximumFractionDigits: digits }) : '—';
  function date(value, full = false) {
    if (!value) return 'Waktu tidak dicantumkan';
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', ...(full ? { year: 'numeric' } : { hour: '2-digit', minute: '2-digit' }) }).format(d) + (full ? '' : ' WIB') : String(value);
  }
  function link(url, label) {
    try {
      const u = new URL(url, location.origin);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return text('span', label);
      const a = text('a', label); a.href = u.href;
      if (u.origin !== location.origin) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      return a;
    } catch { return text('span', label); }
  }
  function action(label, fn) { const b = text('button', label); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function positioned(item) { return item.lat != null && item.lon != null && item.lat !== '' && item.lon !== '' && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)) && Math.abs(Number(item.lat)) <= 90 && Math.abs(Number(item.lon)) <= 180; }
  async function api(kind, signal) {
    const session = token();
    if (!session) throw Object.assign(new Error('Masuk untuk membuka Ruang Situasi.'), { status: 401 });
    const response = await fetch('/api/situasi', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` }, body: JSON.stringify({ kind, city: $('city').value }), signal: signal || AbortSignal.timeout(55000), cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw Object.assign(new Error(payload.error || 'Informasi belum dapat diambil. Coba lagi sebentar.'), { status: response.status });
    return payload.data;
  }
  function locked(message = 'Masuk dengan akun kader atau pengurus untuk membuka seluruh pantauan.', retry = false) {
    authorized = false; sessionVersion++; serial++; controller?.abort();
    stopVideo(); if ($('viewer').open) $('viewer').close();
    if (map) { map.remove(); map = null; points = null; radarLayer = null; }
    $('radarToggle').checked = false; $('radarNote').hidden = true;
    data = null; $('results').replaceChildren(); $('source').textContent = ''; $('sourceNote').textContent = '';
    $('room').hidden = true; $('gate').hidden = false;
    $('gateTitle').textContent = retry ? 'Sesi belum dapat diperiksa' : 'Satu ruang, pantauan Indonesia';
    $('gateNote').textContent = message; $('loginLink').hidden = retry; $('sessionRetry').hidden = !retry;
  }
  async function checkSession() {
    const session = token();
    if (!session) { locked(); return; }
    const version = ++sessionVersion;
    try {
      await api('sesi');
      if (version !== sessionVersion || token() !== session) return;
      authToken = session; authorized = true; $('gate').hidden = true; $('room').hidden = false;
      if (!map) {
        initMap();
        const requested = location.hash.slice(1).split('&')[0];
        select(Object.hasOwn(SECTIONS, requested) ? requested : 'berita', false);
      }
    } catch (error) {
      if (version === sessionVersion) locked(error.message, error.status !== 401);
    }
  }
  function initMap() {
    if (!window.L) { $('map').textContent = 'Peta belum dapat dimuat. Muat ulang halaman untuk mencoba kembali.'; return; }
    map = L.map('map', { preferCanvas: true, minZoom: 3, maxZoom: 16, zoomControl: true }).setView([-2.4, 118], 4);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: 'Tiles &copy; Esri — Esri, HERE, Garmin, OpenStreetMap contributors' }).addTo(map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, pane: 'overlayPane', attribution: '' }).addTo(map);
    points = L.layerGroup().addTo(map);
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has('lat') && params.has('lon')) {
      const item = { lat: params.get('lat'), lon: params.get('lon') };
      if (positioned(item)) map.setView([Number(item.lat), Number(item.lon)], 11);
    }
    requestAnimationFrame(() => map?.invalidateSize());
  }
  async function select(kind, updateHash = true) {
    if (!authorized) return;
    active = kind; shown = 35; data = null; $('search').value = '';
    stopVideo(); if ($('viewer').open) $('viewer').close();
    points?.clearLayers();
    document.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
    $('panelTitle').textContent = SECTIONS[kind][0]; $('panelKicker').textContent = SECTIONS[kind][1];
    $('mapTitle').textContent = ['berita', 'tren', 'pasar'].includes(kind) ? 'Indonesia, dalam pantauan' : SECTIONS[kind][0];
    $('cityLabel').hidden = kind !== 'cuaca'; $('search').disabled = kind === 'cuaca';
    if (updateHash) history.replaceState(null, '', `#${kind}`);
    await load();
  }
  async function load() {
    if (!authorized) return;
    controller?.abort(); controller = new AbortController();
    const pending = controller;
    const request = ++serial, kind = active;
    const timer = setTimeout(() => pending.abort(), 55000);
    $('refresh').disabled = true; $('results').replaceChildren(); $('more').hidden = true;
    $('resultCount').textContent = ''; $('updated').textContent = ''; $('source').textContent = ''; $('sourceNote').textContent = '';
    $('status').textContent = 'Mengambil informasi dari sumber…';
    try {
      const result = await api(kind, controller.signal);
      if (request !== serial || !authorized) return;
      data = result;
      $('source').textContent = result.source || '';
      $('sourceNote').textContent = result.note || '';
      $('updated').textContent = `Diambil ${date(result.fetchedAt)}`;
      $('status').textContent = result.cache === 'stale' ? 'Sumber belum merespons. Menampilkan salinan terakhir; periksa waktu datanya.' : result.partial ? 'Sebagian sumber belum merespons. Data yang tersedia tetap ditampilkan.' : '';
      render();
    } catch (error) {
      if (request !== serial) return;
      if (error.status === 401) { locked(error.message); return; }
      data = null; points?.clearLayers();
      $('mapLegend').textContent = 'Data pantauan belum tersedia.';
      $('status').textContent = error.name === 'AbortError' ? 'Sumber terlalu lama merespons. Pilih Segarkan untuk mencoba lagi.' : error.message;
    } finally { clearTimeout(timer); if (request === serial) $('refresh').disabled = false; }
  }
  function filtered(items) {
    const query = $('search').value.trim().toLocaleLowerCase('id');
    return (items || []).filter((item) => !query || [item.title, item.name, item.location, item.city, item.region, item.province, item.source, item.summary, item.satellite].filter(Boolean).join(' ').toLocaleLowerCase('id').includes(query));
  }
  function render() {
    if (!data) return;
    $('results').replaceChildren(); $('more').hidden = true;
    if (active === 'cuaca') { renderWeather(); return; }
    if (active === 'pasar') { renderMarkets(); return; }
    const items = filtered(data.items);
    $('resultCount').textContent = `${num(items.length, 0)} ${active === 'cctv' ? 'kamera' : active === 'hotspot' ? 'deteksi' : 'informasi'}`;
    drawMap(items);
    if (active === 'tren') $('results').append(text('h3', 'TREN PENCARIAN INDONESIA', 'section-label'));
    items.slice(0, shown).forEach((item) => $('results').append(card(item)));
    if (!items.length) $('results').append(text('p', $('search').value ? 'Tidak ada hasil yang cocok pada data ini.' : 'Belum ada informasi yang dilaporkan sumber.', 'item'));
    $('more').hidden = shown >= items.length;
    if (active === 'tren') {
      $('results').append(text('h3', 'OPINI DARI MEDIA', 'section-label'));
      filtered(data.opinions).forEach((item) => $('results').append(card(item)));
    }
  }
  function card(item) {
    const el = text('article', '', 'item');
    const title = item.title || item.name || item.id || 'Informasi';
    const head = text('div', '', 'item-head');
    head.append(text('span', item.source || item.region || item.province || item.satellite || data.source || ''), text('span', item.time ? date(item.time) : item.level || ''));
    el.append(head);
    const heading = text('h3', ''); heading.append(item.url && active !== 'cctv' ? link(item.url, title) : text('span', title)); el.append(heading);
    if (item.traffic) el.append(text('p', `${item.traffic} pencarian · Google Trends`, 'badge'));
    if (item.summary) el.append(text('p', item.summary));
    if (active === 'kegiatan') { el.append(text('p', `${date(item.date, true)}${item.endDate ? ` — ${date(item.endDate, true)}` : ''}`)); el.append(text('p', [item.location, item.level, item.host].filter(Boolean).join(' · '))); }
    if (active === 'hotspot') el.append(text('p', `Keyakinan deteksi: ${item.confidence || 'tidak dicantumkan'} · Bukan kepastian kebakaran`));
    if (active === 'pesawat') el.append(text('p', `Ketinggian ${num(item.altitude, 0)} m · Kecepatan ${num(item.speed, 0)} m/detik${item.stale ? ' · Posisi lama' : ''}`));
    if (active === 'peringatan') {
      const end = Date.parse(item.expires), start = Date.parse(item.effective);
      const state = end <= Date.now() ? 'Berakhir' : start > Date.now() ? 'Akan berlaku' : 'Dalam masa berlaku';
      el.append(text('p', `${state} · hingga ${date(item.expires)}`, 'badge'));
    }
    const controls = text('div', '', 'item-actions');
    if (positioned(item) || item.polygons?.length) controls.append(action('Lihat di peta', () => focusItem(item)));
    if (active === 'cctv') controls.append(action('Putar kamera', () => openCamera(item)));
    if (item.related) controls.append(link(item.related, 'Baca berita terkait ↗'));
    if (active === 'kegiatan' && item.url) controls.append(link(item.url, 'Detail & pendaftaran →'));
    if (controls.childElementCount) el.append(controls);
    return el;
  }
  function popup(item) {
    const box = text('div', ''); box.append(text('b', item.title || item.name || 'Lokasi'));
    if (item.summary) box.append(text('p', item.summary));
    if (item.time) box.append(text('p', date(item.time)));
    if (active === 'cctv') box.append(action('Putar kamera', () => openCamera(item)));
    if (active === 'kegiatan') { box.append(text('p', `${date(item.date, true)} — ${date(item.endDate || item.date, true)}`)); if (item.url) box.append(link(item.url, 'Detail kegiatan →')); }
    return box;
  }
  function drawMap(items) {
    points?.clearLayers();
    // A hotspot list can hold thousands of detections; paint the newest slice
    // so a phone map stays responsive, and say so instead of hiding the rest.
    const drawn = items.slice(0, 1500);
    let count = 0;
    if (map && points) drawn.forEach((item) => {
      if (active === 'peringatan' && Array.isArray(item.polygons) && Date.parse(item.expires) > Date.now()) {
        item.polygons.forEach((poly) => {
          if (!Array.isArray(poly) || poly.length < 3 || !poly.every((p) => Array.isArray(p) && positioned({ lat: p[0], lon: p[1] }))) return;
          L.polygon(poly, { color: COLORS.peringatan, weight: 1, fillOpacity: .13 }).bindPopup(popup(item)).addTo(points); count++;
        });
      } else if (positioned(item) && active !== 'peringatan') {
        L.circleMarker([Number(item.lat), Number(item.lon)], { radius: active === 'hotspot' ? 3 : active === 'gempa' ? 7 : 5, color: COLORS[active] || '#eeb660', weight: 1, fillColor: COLORS[active] || '#eeb660', fillOpacity: .75 }).bindPopup(popup(item)).addTo(points); count++;
      }
    });
    $('mapLegend').textContent = count ? `${num(count, 0)} ${active === 'peringatan' ? 'area peringatan yang belum berakhir' : 'titik'} · ${SECTIONS[active][0]}${items.length > drawn.length ? ` · ${num(items.length - drawn.length, 0)} titik lain di daftar` : ''}` : ['berita', 'tren', 'pasar'].includes(active) ? 'Informasi nasional tidak diberi lokasi perkiraan.' : 'Tidak ada koordinat yang tersedia untuk hasil ini.';
  }
  function focusItem(item) {
    if (!map) return;
    if (positioned(item)) { map.setView([Number(item.lat), Number(item.lon)], active === 'cctv' ? 14 : 9); L.popup().setLatLng([item.lat, item.lon]).setContent(popup(item)).openOn(map); }
    else if (item.polygons?.length) map.fitBounds(L.latLngBounds(item.polygons.flat()), { maxZoom: 9 });
    if (innerWidth <= 720) $('mapTitle').scrollIntoView({ behavior: 'instant', block: 'start' });
  }
  function renderMarkets() {
    const grid = text('div', '', 'market-grid'), items = filtered(data.items);
    $('resultCount').textContent = `${items.length} instrumen`;
    drawMap([]);
    items.forEach((item) => {
      const card = text('article', '', 'market'); card.append(text('h3', item.title), text('div', num(item.price, 2), 'price'));
      card.append(text('p', `${item.change >= 0 ? '+' : ''}${num(item.change, 2)} (${num(item.percent, 2)}%)`, `change ${item.change >= 0 ? 'positive' : 'negative'}`));
      const values = (item.points || []).filter(Number.isFinite);
      if (values.length > 1) {
        const min = Math.min(...values), range = Math.max(...values) - min || 1;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 180 38'); svg.classList.add('sparkline'); svg.setAttribute('aria-label', 'Pergerakan intrahari'); svg.setAttribute('role', 'img');
        const line = document.createElementNS(svg.namespaceURI, 'polyline'); line.setAttribute('points', values.map((v, i) => `${i / (values.length - 1) * 180},${35 - (v - min) / range * 32}`).join(' ')); line.setAttribute('fill', 'none'); line.setAttribute('stroke', item.change >= 0 ? '#81cfb2' : '#f29898'); line.setAttribute('stroke-width', '1.5'); svg.append(line); card.append(svg);
      }
      card.append(text('small', item.name), text('small', `${item.currency || 'IDR'} · ${date(item.time)}`)); grid.append(card);
    });
    $('results').append(grid);
  }
  function renderWeather() {
    drawMap([{ ...data.city, title: data.city?.name }]);
    $('resultCount').textContent = data.city?.name || '';
    const current = data.current;
    if (current) {
      const hero = text('div', '', 'weather-hero'); hero.append(text('div', `${num(current.temperature_2m)}°`, 'temperature'));
      const info = text('div', ''); info.append(text('h3', data.city.name), text('p', `Model cuaca · ${String(current.time).replace('T', ' ')} WIB`)); hero.append(info); $('results').append(hero);
    }
    const metrics = text('div', '', 'metrics');
    const metric = (label, value, unit) => { const el = text('div', label, 'metric'); el.append(text('b', value), text('span', unit)); metrics.append(el); };
    if (current) { metric('Curah hujan', num(current.precipitation), 'mm'); metric('Kecepatan angin', num(current.wind_speed_10m), 'km/jam'); }
    if (data.air) { metric('PM2.5 · model CAMS', num(data.air.pm2_5), 'µg/m³'); metric('Indeks udara · US AQI', num(data.air.us_aqi, 0), `Model ${String(data.air.time).replace('T', ' ')} WIB`); }
    $('results').append(metrics);
    if (data.hourly?.time?.length) {
      const table = text('table', '', 'hours'); const caption = text('caption', 'Prakiraan 12 jam berikutnya', 'section-label'); table.append(caption);
      const head = text('tr', ''); ['Waktu WIB', 'Suhu', 'Peluang hujan'].forEach((v) => head.append(text('th', v))); const thead = text('thead', ''); thead.append(head); table.append(thead);
      const body = text('tbody', '');
      data.hourly.time.map((time, i) => ({ time, i })).filter(({ time }) => Date.parse(`${time}+07:00`) >= Date.now() - 3600000).slice(0, 12).forEach(({ time, i }) => { const tr = text('tr', ''); [time.slice(11), `${num(data.hourly.temperature_2m[i])}°C`, `${num(data.hourly.precipitation_probability[i], 0)}%`].forEach((v) => tr.append(text('td', v))); body.append(tr); });
      table.append(body); $('results').append(table);
    }
  }
  async function toggleRadar() {
    if (radarLayer && map) { map.removeLayer(radarLayer); radarLayer = null; }
    if (!$('radarToggle').checked || !authorized || !map) { $('radarNote').hidden = true; return; }
    const version = sessionVersion;
    $('radarNote').hidden = false; $('radarNote').textContent = 'Memuat citra radar…';
    try {
      const result = await api('radar');
      if (!authorized || version !== sessionVersion || !$('radarToggle').checked || !map) return;
      const frame = result.items.at(-1);
      if (!frame || !/^\/v2\/radar\/[a-z0-9]+$/i.test(frame.path)) throw new Error('Citra radar belum tersedia.');
      radarLayer = L.tileLayer(`https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: .6, maxNativeZoom: 7, maxZoom: 16, attribution: 'RainViewer' }).addTo(map);
      $('radarNote').textContent = `Citra ${date(frame.time * 1000)}. ${result.note}`;
    } catch (error) { if (version === sessionVersion) { if (error.status === 401) locked(error.message); else { $('radarToggle').checked = false; $('radarNote').textContent = error.message; } } }
  }
  function stopVideo() {
    videoVersion++; clearTimeout(videoTimer); hls?.destroy(); hls = null;
    const video = $('video'); video.pause(); video.removeAttribute('src'); video.load();
    $('cameraImage').removeAttribute('src');
  }
  function openCamera(item) {
    if (!authorized) return;
    camera = item; $('viewerTitle').textContent = item.title || item.name || 'CCTV';
    if (!$('viewer').open) $('viewer').showModal(); playCamera();
  }
  function playCamera() {
    stopVideo(); if (!camera || !authorized || !$('viewer').open) return;
    const id = String(camera.id || '');
    if (!/^id-[a-z0-9_-]{2,96}$/i.test(id)) { $('videoStatus').textContent = 'Kamera tidak dapat diputar.'; return; }
    const version = videoVersion, video = $('video'), image = $('cameraImage');
    $('videoStatus').textContent = 'Menghubungkan ke kamera…'; $('retryVideo').hidden = true;
    const fail = () => { if (version !== videoVersion) return; clearTimeout(videoTimer); hls?.destroy(); hls = null; video.pause(); video.removeAttribute('src'); video.load(); $('videoStatus').textContent = 'Tayangan kamera belum dapat diputar. Coba lagi atau pilih kamera lain.'; $('retryVideo').hidden = false; };
    const playing = () => { if (version !== videoVersion) return; clearTimeout(videoTimer); $('videoStatus').textContent = 'Video sedang diputar · kamera publik'; };
    const isImage = /image|jpeg|jpg|snapshot/i.test(camera.feedType || camera.type || '');
    video.hidden = isImage; image.hidden = !isImage;
    videoTimer = setTimeout(fail, 45000);
    if (isImage) { image.onload = () => { if (version === videoVersion) { clearTimeout(videoTimer); $('videoStatus').textContent = 'Cuplikan kamera berhasil dimuat.'; } }; image.onerror = fail; image.src = `/api/cctv/frame/${encodeURIComponent(id)}`; return; }
    video.onplaying = playing; video.onerror = fail;
    const url = `/api/cctv/media/${encodeURIComponent(id)}`;
    if (window.Hls?.isSupported()) {
      hls = new Hls({ maxBufferLength: 15, maxMaxBufferLength: 30, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 1, fragLoadingMaxRetry: 1 });
      hls.on(Hls.Events.ERROR, (_, detail) => { if (detail.fatal) fail(); });
      hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => { if (version === videoVersion) $('videoStatus').textContent = 'Tekan tombol putar pada video untuk mulai.'; }); });
      hls.loadSource(url); hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = url; video.play().catch(() => { if (version === videoVersion) $('videoStatus').textContent = 'Tekan tombol putar pada video untuk mulai.'; }); }
    else fail();
  }
  $('categories').addEventListener('click', (event) => { const b = event.target.closest('[data-kind]'); if (b) select(b.dataset.kind); });
  $('refresh').addEventListener('click', load);
  $('sessionRetry').addEventListener('click', checkSession);
  $('city').addEventListener('change', load);
  $('search').addEventListener('input', () => { shown = 35; render(); });
  $('more').addEventListener('click', () => { shown += 35; render(); });
  $('resetMap').addEventListener('click', () => map?.setView([-2.4, 118], 4));
  $('radarToggle').addEventListener('change', toggleRadar);
  $('closeViewer').addEventListener('click', () => $('viewer').close());
  $('viewer').addEventListener('close', stopVideo);
  $('retryVideo').addEventListener('click', playCamera);
  window.addEventListener('pagehide', stopVideo);
  window.addEventListener('storage', (event) => { if (event.key === null || TOKENS.includes(event.key)) { locked(); checkSession(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopVideo(); else if (token() !== authToken || authorized) checkSession(); });
  window.addEventListener('hashchange', () => { const kind = location.hash.slice(1).split('&')[0]; if (Object.hasOwn(SECTIONS, kind) && kind !== active) select(kind, false); });
  const clock = () => { $('clock').textContent = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date()) + ' WIB'; };
  clock(); setInterval(clock, 30000);
  $('loginLink').href = `/sso.html?next=${encodeURIComponent(location.pathname + location.hash)}`;
  checkSession();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
