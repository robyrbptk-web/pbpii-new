/*
 * Globe orthographic PII Situation Room.
 * Diadaptasi dari console PII Situation Room (d3-geo + canvas) agar titik BMKG, MAGMA,
 * SIPONGI, ADS-B, kegiatan PII, dan cuaca tampil pada globe yang sama.
 */
(() => {
  'use strict';

  const HOME = Object.freeze({ lat: -2.5, lon: 118, zoom: 2.2 });
  const ZOOM_MAX = 48;
  const ZOOM_MIN = 0.9;
  const COLORS = {
    gempa: '#ff5a4e', gunung: '#ff9f0a', peringatan: '#e8b45e', hotspot: '#f29257',
    pesawat: '#93a9e8', cuaca: '#7fb8dd', kegiatan: '#5fd58a',
  };
  const LEVEL_COLORS = { 'LEVEL IV': '#ff3b30', 'LEVEL III': '#ff9f0a', 'LEVEL II': '#ffd60a', 'LEVEL I': '#8d8d8d' };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);

  const canvas = document.getElementById('sit-globe');
  const wrap = canvas?.closest('.sit-mapwrap') || null;
  const tip = document.getElementById('globeTip');
  if (!canvas || !wrap) return;

  const state = {
    ready: false, enabled: false, mode: 'globe',
    view: { ...HOME }, points: [], hits: [], selected: '', activeQuake: null,
    fly: null, vel: null, gesture: null, pointers: new Map(),
    raf: 0, lastDraw: 0, lastGestEnd: -1e9, anim: false, suppressClick: 0,
    shakeX: 0, shakeY: 0, baseKey: '', base: null, baseCtx: null, proj: null,
  };
  const geo = { world: null, idn: null, prov: null };
  let landIndex = null;
  const jitterCache = new Map();
  let observer = null;
  let geoPromise = null;
  let hideTimer = 0;

  const hasD3 = () => typeof window.d3 !== 'undefined';

  function hexAlpha(hex, alpha) {
    const clean = String(hex || '#8d8d8d').replace('#', '');
    const value = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0');
    return `rgba(${parseInt(value.slice(0, 2), 16)},${parseInt(value.slice(2, 4), 16)},${parseInt(value.slice(4, 6), 16)},${alpha})`;
  }

  function loadGeo() {
    if (geoPromise) return geoPromise;
    if (!hasD3()) {
      state.ready = false;
      return Promise.resolve(false);
    }
    const grab = (url) => fetch(url).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
      return response.json();
    });
    geoPromise = Promise.allSettled([
      grab('/assets/geo/world110.geo.json'),
      grab('/assets/geo/idn.geo.json'),
      grab('/assets/geo/idn-prov.geo.json'),
    ]).then((results) => {
      geo.world = results[0].status === 'fulfilled' ? results[0].value : null;
      geo.idn = results[1].status === 'fulfilled' ? results[1].value : null;
      geo.prov = results[2].status === 'fulfilled' ? results[2].value : null;
      state.ready = !!(geo.world || geo.idn || geo.prov);
      landIndex = null;
      pulse();
      return state.ready;
    });
    return geoPromise;
  }

  function project() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const radius = (Math.min(width, height) / 2 - 8) * state.view.zoom;
    return window.d3.geoOrthographic()
      .rotate([-state.view.lon, -state.view.lat])
      .translate([width / 2, height / 2 + 2])
      .scale(radius)
      .clipAngle(90);
  }

  function wake() {
    if (!state.enabled || state.mode !== 'globe' || document.hidden || !state.ready) return;
    if (!state.raf) state.raf = requestAnimationFrame(loop);
  }

  function pulse() {
    state.anim = true;
    wake();
  }

  function loop(now) {
    state.raf = 0;
    if (!state.enabled || state.mode !== 'globe' || document.hidden || !state.ready) return;
    const busy = state.pointers.size > 0 || !!state.fly || !!state.vel || now - state.lastGestEnd < 250;
    if (now - state.lastDraw > (busy ? 4 : 45)) {
      state.lastDraw = now;
      draw(now);
    }
    if (busy || state.anim) state.raf = requestAnimationFrame(loop);
  }

  function tickFly(now) {
    if (!state.fly) return;
    const t = clamp((now - state.fly.start) / state.fly.dur, 0, 1);
    const eased = easeInOutCubic(t);
    state.view.lon = ((state.fly.from.lon + (state.fly.to.lon - state.fly.from.lon) * eased + 540) % 360) - 180;
    state.view.lat = state.fly.from.lat + (state.fly.to.lat - state.fly.from.lat) * eased;
    state.view.zoom = state.fly.from.zoom + (state.fly.to.zoom - state.fly.from.zoom) * eased;
    state.anim = true;
    if (t >= 1) state.fly = null;
  }

  function flyTo(lat, lon, zoom) {
    state.vel = null;
    let dLon = lon - state.view.lon;
    while (dLon > 180) dLon -= 360;
    while (dLon < -180) dLon += 360;
    const duration = reduced ? 1 : 1150;
    state.fly = {
      from: { ...state.view },
      to: { lon: state.view.lon + dLon, lat, zoom: clamp(Number(zoom) || state.view.zoom, ZOOM_MIN, ZOOM_MAX) },
      start: performance.now(), dur: duration,
    };
    pulse();
  }

  function zoomAt(clientX, clientY, factor) {
    state.fly = null;
    state.vel = null;
    const next = clamp(state.view.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    const ratio = next / state.view.zoom;
    const previous = project();
    state.view.zoom = next;
    if (ratio === 1 || !previous.invert) { pulse(); return; }
    const rect = canvas.getBoundingClientRect();
    const inverted = previous.invert([clientX - rect.left, clientY - rect.top]);
    if (!inverted || !Number.isFinite(inverted[0]) || !Number.isFinite(inverted[1])) { pulse(); return; }
    const [lonPoint, latPoint] = inverted;
    if (Math.abs(latPoint) > Math.PI / 2 || Math.abs(lonPoint) > Math.PI) { pulse(); return; }
    const latCenter = state.view.lat * Math.PI / 180;
    const lonCenter = state.view.lon * Math.PI / 180;
    const c1 = (v) => Math.min(1, Math.max(-1, v));
    const cosTheta = Math.sin(latCenter) * Math.sin(latPoint) + Math.cos(latCenter) * Math.cos(latPoint) * Math.cos(lonPoint - lonCenter);
    const theta = Math.acos(c1(cosTheta));
    const sinTheta = Math.sin(theta);
    if (sinTheta < 1e-6) { pulse(); return; }
    const theta2 = Math.asin(c1(sinTheta / ratio));
    const delta = theta - theta2;
    if (Math.abs(delta) < 1e-9) { pulse(); return; }
    const A = [Math.cos(latCenter) * Math.cos(lonCenter), Math.cos(latCenter) * Math.sin(lonCenter), Math.sin(latCenter)];
    const B = [Math.cos(latPoint) * Math.cos(lonPoint), Math.cos(latPoint) * Math.sin(lonPoint), Math.sin(latPoint)];
    const t = delta / theta;
    const sA = Math.sin((1 - t) * theta) / sinTheta;
    const sB = Math.sin(t * theta) / sinTheta;
    state.view.lat = clamp(Math.asin(c1(A[2] * sA + B[2] * sB)) * 180 / Math.PI, -80, 80);
    state.view.lon = ((Math.atan2(A[1] * sA + B[1] * sB, A[0] * sA + B[0] * sB) * 180 / Math.PI + 540) % 360) - 180;
    pulse();
  }

  function indexLand() {
    if (landIndex || !geo.idn) return landIndex;
    landIndex = [];
    for (const feature of geo.idn.features) {
      const geometry = feature.geometry;
      if (!geometry) continue;
      for (const polygon of (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates)) {
        let minLon = 1e9, minLat = 1e9, maxLon = -1e9, maxLat = -1e9;
        for (const q of polygon[0]) {
          if (q[0] < minLon) minLon = q[0];
          if (q[0] > maxLon) maxLon = q[0];
          if (q[1] < minLat) minLat = q[1];
          if (q[1] > maxLat) maxLat = q[1];
        }
        landIndex.push({ polygon, box: [minLon, minLat, maxLon, maxLat] });
      }
    }
    return landIndex;
  }

  function inRing(ring, x, y) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  function onLand(lon, lat) {
    const index = indexLand();
    if (!index) return true;
    for (const { polygon, box } of index) {
      if (lon < box[0] || lon > box[2] || lat < box[1] || lat > box[3]) continue;
      if (inRing(polygon[0], lon, lat) && !polygon.slice(1).some((hole) => inRing(hole, lon, lat))) return true;
    }
    return false;
  }

  function jitter(point, slot) {
    const name = point.name || '';
    if (!name || !slot || !indexLand()) return [point.la, point.lo];
    const key = `${name}|${slot}|${point.la.toFixed(3)},${point.lo.toFixed(3)}`;
    const saved = jitterCache.get(key);
    if (saved) return saved;
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    const wide = point.precision === 'prov' || point.precision === 'region';
    const maxKm = wide ? 140 : 24;
    const baseKm = wide ? 18 : 3;
    const km = Math.min(baseKm + Math.sqrt(slot) * (wide ? 22 : 4.2), maxKm);
    const angle0 = slot * 2.399963 + (hash % 628) / 100;
    const cosLat = Math.cos(point.la * Math.PI / 180) || 1e-6;
    let output = [point.la, point.lo];
    outer: for (let shrink = 1; shrink >= 0.2; shrink -= 0.2) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const angle = angle0 + attempt * 0.5236;
        const distance = km * shrink * (attempt % 2 ? 0.75 : 1);
        const lat = point.la + Math.sin(angle) * distance / 110.57;
        const lon = point.lo + Math.cos(angle) * distance / (111.32 * cosLat);
        if (onLand(lon, lat)) { output = [lat, lon]; break outer; }
      }
    }
    jitterCache.set(key, output);
    return output;
  }

  function drawBase(width, height, dpr, key) {
    if (!state.base) {
      state.base = document.createElement('canvas');
      state.baseCtx = state.base.getContext('2d');
    }
    if (state.base.width !== Math.round(width * dpr) || state.base.height !== Math.round(height * dpr)) {
      state.base.width = Math.round(width * dpr);
      state.base.height = Math.round(height * dpr);
    }
    if (state.baseKey === key) return;
    const ctx = state.baseCtx;
    const d3 = window.d3;
    const path = d3.geoPath(state.proj, ctx);
    const radius = Math.min(width, height) / 2 - 8;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createRadialGradient(width * 0.38, height * 0.34, radius * state.view.zoom * 0.12, width / 2, height / 2, radius * state.view.zoom + 2);
    gradient.addColorStop(0, '#161616');
    gradient.addColorStop(0.72, '#101010');
    gradient.addColorStop(1, '#0b0b0b');
    ctx.beginPath(); path({ type: 'Sphere' });
    ctx.fillStyle = gradient; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = '#2e2e2e'; ctx.stroke();

    ctx.beginPath(); path(d3.geoGraticule10());
    ctx.lineWidth = 0.45; ctx.strokeStyle = 'rgba(255,255,255,.065)'; ctx.stroke();

    if (geo.world) {
      for (const feature of geo.world.features) {
        ctx.beginPath(); path(feature);
        ctx.fillStyle = '#141414'; ctx.fill();
        ctx.lineWidth = 0.55; ctx.strokeStyle = '#222'; ctx.stroke();
      }
    }
    if (geo.idn) {
      for (const feature of geo.idn.features) {
        ctx.beginPath(); path(feature);
        ctx.fillStyle = '#202020'; ctx.fill();
        ctx.lineWidth = 0.9; ctx.strokeStyle = '#4e4e4e'; ctx.stroke();
      }
    }
    if (geo.prov && !state.gesture) {
      ctx.save();
      if (geo.idn) {
        ctx.beginPath();
        for (const feature of geo.idn.features) path(feature);
        ctx.clip();
      }
      ctx.beginPath(); path(geo.prov);
      ctx.lineWidth = 0.7; ctx.strokeStyle = 'rgba(200,200,200,.28)'; ctx.stroke();
      ctx.restore();
    }

    ctx.beginPath(); path({ type: 'Sphere' });
    ctx.lineWidth = 2.2; ctx.strokeStyle = 'rgba(96,96,96,.32)'; ctx.stroke();
    state.baseKey = key;
  }

  function draw(now) {
    if (!hasD3() || !state.ready) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    tickFly(now);
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    state.proj = project();
    const center = [state.view.lon, state.view.lat];

    let shakeX = 0, shakeY = 0;
    const quake = state.activeQuake;
    if (!reduced && quake && state.view.zoom > 3) {
      const zoomFactor = Math.min(1, (state.view.zoom - 3) / 2);
      const magnitude = Number(quake.mag) || 5;
      const amplitude = Math.min(3.2, Math.max(1, (magnitude - 2.5) * 0.6)) * zoomFactor;
      shakeX = Math.sin(now / 37) * amplitude;
      shakeY = Math.cos(now / 53) * amplitude * 0.7;
    }
    state.shakeX = shakeX; state.shakeY = shakeY;
    ctx.setTransform(dpr, 0, 0, dpr, shakeX * dpr, shakeY * dpr);
    ctx.clearRect(-8, -8, width + 16, height + 16);

    const baseKey = [width, height, dpr, state.view.lon.toFixed(4), state.view.lat.toFixed(4), state.view.zoom.toFixed(5), geo.world ? 1 : 0, geo.idn ? 1 : 0, geo.prov && !state.gesture ? 1 : 0].join('|');
    drawBase(width, height, dpr, baseKey);
    ctx.drawImage(state.base, 0, 0, width, height);

    const d3 = window.d3;
    const zoomTaper = state.view.zoom > 8 ? Math.max(0.45, 8 / state.view.zoom) : 1;
    const zoomBoost = Math.min(4.5, (state.view.zoom - 1) * 0.55) * zoomTaper;
    const slotCounts = {};
    const points = [];
    let animated = false;

    for (const point of state.points) {
      if (d3.geoDistance([point.lo, point.la], center) >= Math.PI / 2 - 0.03) continue;
      const slot = slotCounts[point.name] || 0;
      slotCounts[point.name] = slot + 1;
      const [lat, lon] = jitter(point, slot);
      const xy = state.proj([lon, lat]);
      if (!xy) continue;
      const fresh = now - (point.ts || 0) < 45 * 60e3;
      const radius = 1.35 + (point.weight || 0.3) * 2.5 + zoomBoost;
      const color = point.sub === 'gempa' ? COLORS.gempa
        : point.sub === 'volcano' ? (LEVEL_COLORS[point.lvl] || COLORS.gunung)
          : (COLORS[point.kind] || '#8d8d8d');
      points.push({ x: xy[0], y: xy[1], r: radius, color, fresh, point });
    }
    points.sort((a, b) => a.r - b.r);

    for (const item of points) {
      const selected = !!(state.selected && item.point.id === state.selected);
      const dim = !!(state.selected && !selected);
      if (item.point.sub === 'gempa') {
        if (!reduced) animated = true;
        const magnitude = Number(item.point.mag) || 3;
        const baseRadius = item.r + 2 + magnitude * 0.9;
        for (let ring = 0; ring < 3; ring++) {
          const progress = reduced ? 0.5 : ((((now / 1000) * (0.55 - ring * 0.08) + item.point.la * 5.1 + ring * 0.37 + Math.abs(item.point.lo) * 0.013) % 1) + 1) % 1;
          ctx.beginPath();
          ctx.arc(item.x, item.y, baseRadius + progress * (16 + magnitude * 5), 0, Math.PI * 2);
          ctx.strokeStyle = hexAlpha(item.color, (dim ? 0.1 : (1 - progress) * (0.75 - ring * 0.18)));
          ctx.lineWidth = ring === 0 ? 1.6 : 1;
          ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(item.x, item.y, item.r * 0.7, 0, Math.PI * 2);
        ctx.strokeStyle = hexAlpha(item.color, dim ? 0.25 : 0.9);
        ctx.lineWidth = 1; ctx.stroke();
        continue;
      }
      if (item.point.sub === 'volcano') {
        const size = item.r * 2.4;
        const alert = item.point.lvl === 'LEVEL IV' || item.point.lvl === 'LEVEL III';
        if (alert && !dim) {
          if (!reduced) animated = true;
          const progress = reduced ? 0.5 : ((((now / 1000) * 0.8 + item.point.la * 3.7) % 1) + 1) % 1;
          ctx.beginPath(); ctx.arc(item.x, item.y, size * 0.9 + progress * 14, 0, Math.PI * 2);
          ctx.strokeStyle = hexAlpha(item.color, (1 - progress) * 0.55);
          ctx.lineWidth = 1.2; ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(item.x, item.y - size);
        ctx.lineTo(item.x + size * 0.92, item.y + size * 0.62);
        ctx.lineTo(item.x - size * 0.92, item.y + size * 0.62);
        ctx.closePath();
        ctx.save();
        ctx.shadowColor = item.color;
        ctx.shadowBlur = dim ? 0 : (alert ? 12 : 5);
        ctx.fillStyle = hexAlpha(item.color, (alert ? 0.95 : 0.72) * (dim ? 0.3 : 1));
        ctx.fill(); ctx.restore();
        ctx.lineWidth = 0.9; ctx.strokeStyle = '#0d0d0d'; ctx.stroke();
        continue;
      }

      if (item.fresh && !dim) {
        if (!reduced) animated = true;
        const alpha = reduced ? 0.45 : 0.25 + (Math.sin(now / 480 + item.point.la * 3 + Math.abs(item.point.lo)) * 0.5 + 0.5) * 0.35;
        ctx.beginPath(); ctx.arc(item.x, item.y, item.r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = hexAlpha(item.color, alpha);
        ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
      ctx.save();
      ctx.shadowColor = item.color;
      ctx.shadowBlur = dim ? 0 : 7;
      ctx.fillStyle = hexAlpha(item.color, (item.fresh ? 0.96 : 0.65) * (dim ? 0.3 : 1));
      ctx.fill(); ctx.restore();
      ctx.lineWidth = 0.7; ctx.strokeStyle = '#0d0d0d'; ctx.stroke();
      if ((item.point.precision === 'prov' || item.point.precision === 'region') && !dim) {
        ctx.save(); ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.arc(item.x, item.y, item.r + 3.2, 0, Math.PI * 2);
        ctx.strokeStyle = hexAlpha(item.color, 0.7); ctx.lineWidth = 0.9; ctx.stroke();
        ctx.restore();
      }
    }

    const selectedHit = state.selected && points.find((item) => item.point.id === state.selected);
    if (selectedHit) {
      ctx.beginPath(); ctx.arc(selectedHit.x, selectedHit.y, selectedHit.r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    if (state.view.zoom >= 1 && !state.gesture && points.length <= 400) {
      const groups = new Map();
      for (const item of points) {
        const name = item.point.name;
        if (!name) continue;
        if (!groups.has(name)) groups.set(name, { name: name.toUpperCase(), x: 0, y: 0, count: 0 });
        const group = groups.get(name);
        group.x += item.x; group.y += item.y; group.count++;
      }
      const labels = [...groups.values()]
        .map((group) => ({ name: group.name, x: group.x / group.count, y: group.y / group.count, count: group.count }))
        .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
      const maxLabels = state.view.zoom < 1.42 ? 5 : state.view.zoom < 2.2 ? 20 : state.view.zoom < 8 ? 60 : Math.max(10, Math.round(60 * 8 / state.view.zoom));
      ctx.font = '600 8px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      const placed = [];
      for (const label of labels) {
        const text = `${label.name} ${label.count}`;
        const textWidth = ctx.measureText(text).width;
        const boxWidth = textWidth + 6, boxHeight = 13;
        let boxX = label.x + 11;
        if (boxX + boxWidth > width - 4 && label.x - 11 - boxWidth >= 4) boxX = label.x - 11 - boxWidth;
        const box = { x: boxX, y: label.y - 6, w: boxWidth, h: boxHeight };
        if (box.x < 2 || box.x + box.w > width - 2 || box.y < 2 || box.y + box.h > height - 2) continue;
        if (placed.length >= maxLabels) break;
        if (placed.some((other) => other.x < box.x + box.w && other.x + other.w > box.x && other.y < box.y + box.h && other.y + other.h > box.y)) continue;
        ctx.fillStyle = 'rgba(10,10,10,.72)';
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.strokeStyle = 'rgba(255,255,255,.09)';
        ctx.lineWidth = 1; ctx.strokeRect(box.x, box.y, box.w, box.h);
        ctx.fillStyle = '#d4d4d4';
        ctx.fillText(text, box.x + 3, box.y + box.h / 2 + 0.5);
        placed.push(box);
      }
    }

    state.hits = points;
    state.anim = (animated && points.length <= 700) || !!(shakeX || shakeY);
    if (state.anim || state.pointers.size || state.fly || state.vel) wake();
  }

  function hitTest(x, y) {
    const tolerance = state.view.zoom > 8 ? 6 : Math.max(8, 12 / Math.max(1, state.view.zoom * 0.6));
    let best = null;
    for (const item of state.hits) {
      const distance = Math.hypot(item.x + state.shakeX - x, item.y + state.shakeY - y);
      const limit = Math.max(item.r + 5, tolerance, item.r > 10 ? 10 : 0);
      if (distance <= limit && (!best || distance < best.distance)) best = { item, distance };
    }
    return best?.item || null;
  }

  function placeTip(x, y) {
    const width = tip.offsetWidth, height = tip.offsetHeight;
    let left = x + 12, top = y + 12;
    if (left + width > wrap.clientWidth - 6) left = x - width - 12;
    if (top + height > wrap.clientHeight - 6) top = y - height - 12;
    tip.style.left = `${Math.max(6, left)}px`;
    tip.style.top = `${Math.max(6, top)}px`;
  }

  function showTip(item, clientX, clientY) {
    if (!tip || !item) return;
    clearTimeout(hideTimer);
    if (!tip.hidden && state.selected === item.point.id) {
      placeTip(clientX, clientY);
      return;
    }
    state.selected = item.point.id;
    state.activeQuake = item.point.sub === 'gempa' ? item.point : null;
    const point = item.point;
    tip.replaceChildren();
    const head = document.createElement('span');
    head.className = 'gt-k';
    head.style.color = item.color;
    head.textContent = `${point.label || point.kind}${point.name ? ` · ${point.name}` : ''}`;
    const title = document.createElement('b');
    title.className = 'gt-t';
    title.textContent = point.title || 'Informasi';
    const meta = document.createElement('span');
    meta.className = 'gt-m';
    const time = point.ts ? new Date(point.ts).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }) : '';
    meta.textContent = [point.source, time ? `${time} WIB` : ''].filter(Boolean).join(' · ');
    tip.append(head, title);
    if (meta.textContent) tip.append(meta);
    if (point.url) {
      const link = document.createElement('a');
      link.className = 'gt-go';
      link.href = point.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Buka sumber ↗';
      tip.append(link);
    }
    tip.hidden = false;
    placeTip(clientX, clientY);
    pulse();
  }

  function hideTip() {
    if (!tip) return;
    tip.hidden = true;
    tip.replaceChildren();
    state.selected = '';
    state.activeQuake = null;
    pulse();
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, cx: event.clientX, cy: event.clientY };
  }

  function endPointer(event) {
    state.pointers.delete(event.pointerId);
    if (!state.pointers.size) {
      const gesture = state.gesture;
      const wasDrag = gesture && gesture.moved > 8;
      if (wasDrag) {
        state.suppressClick = performance.now();
        if (gesture.mode === 'rotate' && gesture.vx !== undefined && Math.hypot(gesture.vx, gesture.vy) > 0.08) {
          state.vel = { vx: -gesture.vx * 0.22, vy: gesture.vy * 0.2 };
        }
        state.lastGestEnd = performance.now();
        pulse();
      } else if (gesture && (event.pointerType === 'touch' || event.pointerType === 'pen')) {
        state.suppressClick = performance.now();
        const rect = canvas.getBoundingClientRect();
        const item = hitTest(event.clientX - rect.left, event.clientY - rect.top);
        if (item) showTip(item, event.clientX - rect.left, event.clientY - rect.top);
        else hideTip();
      }
      state.gesture = null;
      canvas.style.cursor = 'grab';
    } else if (state.pointers.size === 1) {
      const remaining = state.pointers.values().next().value;
      state.gesture = { mode: 'rotate', startLon: state.view.lon, startLat: state.view.lat, x: remaining.x, y: remaining.y, moved: 0 };
    }
  }

  function bind() {
    canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* pointer capture is optional */ }
      state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      state.fly = null; state.vel = null;
      if (state.pointers.size === 1) {
        state.gesture = { mode: 'rotate', startLon: state.view.lon, startLat: state.view.lat, x: event.clientX, y: event.clientY, moved: 0 };
      } else if (state.pointers.size === 2) {
        const [a, b] = [...state.pointers.values()];
        state.gesture = { mode: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: state.view.zoom, moved: 0 };
      }
      canvas.style.cursor = 'grabbing';
      hideTip();
      pulse();
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!state.pointers.has(event.pointerId) && event.pointerType !== 'touch') {
        const pos = pointerPosition(event);
        const item = hitTest(pos.x, pos.y);
        if (item) {
          canvas.style.cursor = 'pointer';
          showTip(item, pos.x, pos.y);
        } else {
          canvas.style.cursor = 'grab';
          if (!tip.hidden) hideTip();
        }
        return;
      }
      state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (!state.gesture) return;
      if (state.gesture.mode === 'rotate' && state.pointers.size === 1) {
        const dx = event.clientX - state.gesture.x;
        const dy = event.clientY - state.gesture.y;
        state.gesture.moved += Math.abs(dx) + Math.abs(dy);
        state.view.lon = ((state.gesture.startLon - dx * 0.2 + 540) % 360) - 180;
        state.view.lat = clamp(state.gesture.startLat + dy * 0.18, -64, 64);
        const now = performance.now();
        const elapsed = now - (state.gesture.pt || now);
        if (elapsed > 0 && elapsed < 120) {
          const vx = (event.clientX - (state.gesture.px ?? event.clientX)) / elapsed;
          const vy = (event.clientY - (state.gesture.py ?? event.clientY)) / elapsed;
          state.gesture.vx = state.gesture.vx === undefined ? vx : state.gesture.vx * 0.7 + vx * 0.3;
          state.gesture.vy = state.gesture.vy === undefined ? vy : state.gesture.vy * 0.7 + vy * 0.3;
        }
        state.gesture.px = event.clientX; state.gesture.py = event.clientY; state.gesture.pt = now;
      } else if (state.gesture.mode === 'pinch' && state.pointers.size === 2) {
        const [a, b] = [...state.pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (state.gesture.dist > 0) {
          const wanted = clamp(state.gesture.zoom * distance / state.gesture.dist, ZOOM_MIN, ZOOM_MAX);
          zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, wanted / state.view.zoom);
        }
        state.gesture.moved += 1;
      }
      state.lastGestEnd = performance.now();
      pulse();
    });

    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('lostpointercapture', (event) => { if (state.pointers.has(event.pointerId)) endPointer(event); });
    window.addEventListener('pointerup', (event) => { if (state.pointers.has(event.pointerId)) endPointer(event); });
    window.addEventListener('pointercancel', (event) => { if (state.pointers.has(event.pointerId)) endPointer(event); });
    window.addEventListener('blur', () => {
      state.pointers.clear(); state.gesture = null; canvas.style.cursor = 'grab'; hideTip();
    });

    let wheelAccumulator = 0, wheelTime = 0;
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      state.fly = null; state.vel = null;
      wheelAccumulator += event.deltaY;
      const now = performance.now();
      if (now - wheelTime < 90) { state.lastGestEnd = now; return; }
      wheelTime = now;
      const factor = wheelAccumulator < 0 ? 1.4 : 1 / 1.4;
      wheelAccumulator = 0;
      zoomAt(event.clientX, event.clientY, factor);
      state.lastGestEnd = now;
    }, { passive: false });

    canvas.addEventListener('mouseleave', () => {
      if (!state.pointers.size) {
        canvas.style.cursor = 'grab';
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          if (!state.pointers.size && !tip?.matches(':hover')) hideTip();
        }, 220);
      }
    });

    if (tip) {
      tip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
      tip.addEventListener('mouseleave', () => {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => { if (!state.pointers.size) hideTip(); }, 180);
      });
    }

    canvas.addEventListener('click', (event) => {
      if (performance.now() - state.suppressClick < 350) return;
      if (event.pointerType === 'touch' || event.pointerType === 'pen') return;
      const pos = pointerPosition(event);
      const item = hitTest(pos.x, pos.y);
      if (item) showTip(item, pos.x, pos.y);
      else hideTip();
    });

    canvas.addEventListener('dblclick', (event) => {
      event.preventDefault();
      state.lastGestEnd = performance.now();
      reset();
    });

    canvas.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 12 : 4;
      if (event.key === 'ArrowLeft') { state.view.lon = ((state.view.lon - step + 540) % 360) - 180; }
      else if (event.key === 'ArrowRight') { state.view.lon = ((state.view.lon + step + 540) % 360) - 180; }
      else if (event.key === 'ArrowUp') { state.view.lat = clamp(state.view.lat + step, -64, 64); }
      else if (event.key === 'ArrowDown') { state.view.lat = clamp(state.view.lat - step, -64, 64); }
      else if (event.key === '+' || event.key === '=') { state.view.zoom = clamp(state.view.zoom * 1.25, ZOOM_MIN, ZOOM_MAX); }
      else if (event.key === '-' || event.key === '_') { state.view.zoom = clamp(state.view.zoom / 1.25, ZOOM_MIN, ZOOM_MAX); }
      else if (event.key === 'Home' || event.key === '0') { reset(); }
      else return;
      event.preventDefault();
      pulse();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) wake();
    });

    if ('ResizeObserver' in window && wrap) {
      observer = new ResizeObserver(() => {
        state.baseKey = '';
        pulse();
      });
      observer.observe(wrap);
    }
  }

  function reset() {
    flyTo(HOME.lat, HOME.lon, HOME.zoom);
  }

  function focus(lat, lon, zoom) {
    const latitude = Number(lat), longitude = Number(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    flyTo(latitude, longitude, zoom || Math.max(8, state.view.zoom));
  }

  function setPoints(points) {
    state.points = Array.isArray(points) ? points.filter((point) => Number.isFinite(point.la) && Number.isFinite(point.lo)) : [];
    if (state.selected && !state.points.some((point) => point.id === state.selected)) {
      state.selected = '';
      state.activeQuake = null;
    }
    if (tip && !tip.hidden) hideTip();
    pulse();
  }

  function setMode(mode) {
    state.mode = mode === 'map' ? 'map' : 'globe';
    if (state.mode === 'map') {
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = 0;
      hideTip();
    } else {
      state.baseKey = '';
      pulse();
    }
  }

  function resume() {
    state.enabled = true;
    if (state.mode === 'globe') {
      state.baseKey = '';
      pulse();
    }
  }

  function suspend() {
    state.enabled = false;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.pointers.clear(); state.gesture = null; state.fly = null; state.vel = null;
    hideTip();
  }

  function destroy() {
    suspend();
    observer?.disconnect();
    observer = null;
    state.points = [];
    state.hits = [];
  }

  function init() {
    if (state.enabled) return;
    state.enabled = true;
    bind();
    loadGeo().then((ok) => {
      if (!ok) {
        const legend = document.getElementById('mapLegend');
        if (legend) legend.textContent = 'Batas dunia belum dapat dimuat. Tarik untuk mencoba lagi.';
      }
    });
    pulse();
  }

  window.PIIGlobe = {
    init, resume, suspend, destroy, setPoints, setMode, focus, reset,
    isReady: () => state.ready,
    debug: () => ({ ready: state.ready, enabled: state.enabled, mode: state.mode, points: state.points.length, view: { ...state.view }, hits: state.hits.slice(0, 3).map((hit) => ({ x: Math.round(hit.x), y: Math.round(hit.y), title: hit.point.title })) }),
    home: HOME,
  };
})();
