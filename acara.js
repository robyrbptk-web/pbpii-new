/**
 * Umpan acara publik PB PII.
 *
 * Sumber datanya sama dengan halaman utama (aksi `public`), jadi tidak ada
 * endpoint baru: yang dibaca adalah `data.events` beserta standar keaktifan
 * bawaan. Salinan terakhir disimpan di localStorage supaya daftar acara
 * langsung terisi selagi server menjawab.
 */
(() => {
  const API = window.PBPII_CONFIG?.apiEndpoint || '/api/pii';
  const CACHE_KEY = 'pbpii_acara_feed';
  const MAX_CARD = 24;

  const listEl = document.querySelector('#acaraList');
  const tabsEl = document.querySelector('#acaraTabs');
  const searchEl = document.querySelector('#acaraSearch');
  const levelEl = document.querySelector('#acaraLevel');
  const countEl = document.querySelector('#acaraCount');
  const standardEl = document.querySelector('#acaraStandard');
  const defaultEl = document.querySelector('#keaktifanDefault');
  const hiddenEl = document.querySelector('#acaraHidden');
  if (!listEl) return;

  const state = { events: [], filter: 'upcoming', query: '', level: '', defaultMin: null, stale: false };
  /** Utas yang sedang dibuka, supaya repaint tidak menghapus komentar yang sedang ditulis. */
  const open = new Set();
  let deepHandled = false;
  const akun = () => window.PBPIIAkun || null;
  const tokenSaya = () => window.PBPIIAkun?.token() || '';
  let lastToken = '';
  // Kartu dirender setelah site.js memasang pengamatnya, jadi halaman ini punya
  // pengamat sendiri. Tanpa pengamat, kelas .reveal akan mengunci kartu di
  // opacity 0 — karena itu kelas itu hanya ditempel kalau animasi memang jalan.
  const canReveal = 'IntersectionObserver' in window
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let cardObserver = null;
  const monthKey = (date = new Date()) => date.toISOString().slice(0, 7);
  const dayLabel = (value) => String(value || '').slice(8, 10);
  const monthShort = (value) => {
    const date = new Date(`${String(value || '').slice(0, 10)}T00:00:00`);
    return isNaN(date.getTime()) ? '' : date.toLocaleDateString('id-ID', { month: 'short' });
  };
  const longDate = (value) => {
    const date = new Date(`${String(value || '').slice(0, 10)}T00:00:00`);
    return isNaN(date.getTime()) ? '' : date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };
  const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeImage = (value) => {
    const url = String(value || '').trim();
    return /^https:\/\//i.test(url) ? escapeHTML(url) : 'assets/logo-pii.png';
  };

  /** Satu jalur POST untuk semua aksi: error server selalu punya pesan + kode. */
  async function api(body) {
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => null);
    if (!result || !result.ok) {
      const error = new Error(result?.error || 'Layanan acara belum dapat dihubungi.');
      error.code = String(result?.code || '');
      error.retryAfter = Number(result?.retryAfter) || 0;
      throw error;
    }
    return result.data;
  }

  const eventById = (id) => state.events.find((event) => String(event.id) === String(id));

  function timeAgo(value) {
    const time = Date.parse(String(value || ''));
    if (!isFinite(time)) return '';
    const menit = Math.round((Date.now() - time) / 60000);
    if (menit < 1) return 'baru saja';
    if (menit < 60) return `${menit} menit lalu`;
    const jam = Math.round(menit / 60);
    if (jam < 24) return `${jam} jam lalu`;
    const hari = Math.round(jam / 24);
    if (hari < 30) return `${hari} hari lalu`;
    return new Date(time).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function initials(name) {
    return String(name || 'K').trim().charAt(0).toUpperCase() || 'K';
  }

  function commentHtml(comment) {
    // Huruf awal tetap ada di belakang foto: kalau gambarnya gagal dimuat, kolom
    // avatar tidak ikut hilang dan teks komentar tidak menyempit.
    const initial = escapeHTML(initials(comment.author));
    const foto = comment.picture
      ? `<span class="acara-ava" aria-hidden="true">${initial}<img src="${escapeHTML(comment.picture)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()"></span>`
      : `<span class="acara-ava" aria-hidden="true">${initial}</span>`;
    return `<li class="acara-comment${comment.mine ? ' is-mine' : ''}">
      ${foto}
      <div>
        <b>${escapeHTML(comment.author || 'Kader PII')}${comment.mine ? ' <small>Anda</small>' : ''}</b>
        <p>${escapeHTML(comment.text)}</p>
        <small>${escapeHTML(timeAgo(comment.createdAt))}</small>
      </div>
    </li>`;
  }

  function composerHtml(event) {
    return `<form class="acara-composer" data-composer="${escapeHTML(event.id)}">
      <textarea name="text" rows="2" maxlength="500" placeholder="Tulis komentar singkat untuk acara ini…" aria-label="Komentar untuk ${escapeHTML(event.title)}"></textarea>
      <div class="composer-row">
        <p class="composer-note" data-note hidden></p>
        <button class="button button-solid acara-send" type="submit">Kirim komentar</button>
      </div>
    </form>`;
  }

  function cacheWrite(payload) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), events: payload.events.slice(0, 60), defaultMin: payload.defaultMin }));
    } catch {
      /* kuota penyimpanan penuh: halaman tetap berfungsi dari jaringan */
    }
  }

  function cacheRead() {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return raw && Array.isArray(raw.events) ? raw : null;
    } catch {
      return null;
    }
  }

  function matches(event) {
    if (state.filter === 'upcoming' && !event.upcoming) return false;
    if (state.filter === 'month' && String(event.date).slice(0, 7) !== monthKey()) return false;
    if (state.level && event.host?.jenjang !== state.level) return false;
    if (state.query) {
      const haystack = [event.title, event.category, event.location, event.host?.name, event.excerpt]
        .join(' ').toLowerCase();
      if (!haystack.includes(state.query)) return false;
    }
    return true;
  }

  function order(a, b) {
    // Mendatang: paling dekat lebih dulu. Sudah lewat: paling baru lebih dulu.
    if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
    return a.upcoming
      ? String(a.date).localeCompare(String(b.date))
      : String(b.date).localeCompare(String(a.date));
  }

  function card(event) {
    const form = event.form;
    const open = form && form.status === 'open';
    const cta = open
      ? `<a class="button button-solid acara-cta" href="${escapeHTML(form.url)}">Daftar sekarang</a>`
      : form
        ? `<a class="button button-ghost acara-cta" href="${escapeHTML(form.url)}">Formulir ditutup</a>`
        : '<span class="acara-nofom">Pendaftaran lewat panitia</span>';
    const quota = form && form.quota
      ? `<small>${(form.registered || 0).toLocaleString('id-ID')} / ${form.quota.toLocaleString('id-ID')} kuota terisi</small>`
      : form
        ? `<small>${(form.registered || 0).toLocaleString('id-ID')} pendaftar</small>`
        : '';
    const place = [event.location, event.host?.name].filter(Boolean).join(' · ');
    const id = escapeHTML(event.id);
    const likes = Number(event.likes) || 0;
    const replies = Number(event.commentCount) || 0;

    return `
      <article class="acara-card${canReveal ? ' reveal' : ''}${event.upcoming ? '' : ' is-past'}" data-event="${id}">
        <div class="acara-cover">
          <img src="${safeImage(event.coverImage)}" alt="${escapeHTML(event.title)}" loading="lazy" onerror="this.onerror=null;this.src='assets/logo-pii.png'">
          <span class="acara-date"><b>${escapeHTML(dayLabel(event.date))}</b><small>${escapeHTML(monthShort(event.date))}</small></span>
          ${event.upcoming ? '' : '<span class="acara-tag-lampau">Sudah berlangsung</span>'}
        </div>
        <div class="acara-body">
          <div class="acara-meta">
            <span>${escapeHTML(event.category || 'Kegiatan')}</span>
            <span class="acara-jenjang">${escapeHTML(event.host?.jenjangLabel || event.host?.jenjang || 'PII')}</span>
          </div>
          <h3>${escapeHTML(event.title)}</h3>
          <p class="acara-when">${escapeHTML(longDate(event.date))}</p>
          ${place ? `<p class="acara-where">${escapeHTML(place)}</p>` : ''}
          ${event.excerpt ? `<p class="acara-desc">${escapeHTML(event.excerpt)}</p>` : ''}
          <div class="acara-actions">${cta}${quota}</div>
          <div class="acara-social">
            <button class="acara-like${event.liked ? ' is-on' : ''}" type="button" data-like="${id}"
              aria-pressed="${event.liked ? 'true' : 'false'}" aria-label="Suka acara ini">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.2s-7.4-4.5-7.4-9.4A4.1 4.1 0 0 1 12 8.1a4.1 4.1 0 0 1 7.4 2.7c0 4.9-7.4 9.4-7.4 9.4Z"/></svg>
              <span data-likes>${likes.toLocaleString('id-ID')}</span>
            </button>
            <button class="acara-talk" type="button" data-thread="${id}" aria-expanded="false">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.2V17a2.5 2.5 0 0 1-1-2V7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5Z"/></svg>
              <span data-comments>${replies.toLocaleString('id-ID')}</span>
              <small>Komentar</small>
            </button>
            <button class="acara-share" type="button" data-share="${id}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="12" r="2.6"/><circle cx="17.4" cy="6.6" r="2.6"/><circle cx="17.4" cy="17.4" r="2.6"/><path d="m9.4 10.8 5.8-3M9.4 13.2l5.8 3"/></svg>
              <small>Bagikan</small>
            </button>
          </div>
          <div class="acara-thread" data-thread-panel="${id}" hidden></div>
        </div>
      </article>`;
  }

  function observeCards() {
    if (!canReveal) return;
    cardObserver?.disconnect();
    cardObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        cardObserver.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    listEl.querySelectorAll('.acara-card').forEach((node, index) => {
      node.style.transitionDelay = `${Math.min(index, 8) * 45}ms`;
      cardObserver.observe(node);
    });
  }

  // -------------------------------------------------- suka, komentar, bagikan

  const threads = new Map();

  const panelFor = (id) => listEl.querySelector(`[data-thread-panel="${CSS.escape(String(id))}"]`);
  const cardFor = (id) => listEl.querySelector(`.acara-card[data-event="${CSS.escape(String(id))}"]`);

  function paintHead(panel, event) {
    const data = threads.get(event.id);
    const head = panel.querySelector('.acara-thread-head');
    if (!head) return;
    const total = data?.comments?.length || 0;
    head.innerHTML = `<b>${total ? `${total} komentar` : 'Diskusi acara'}</b>
      <span>Komentar kader tampil terbuka untuk semua pengunjung.</span>`;
  }

  function paintComments(panel, event) {
    const data = threads.get(event.id);
    const list = panel.querySelector('.acara-comments');
    if (!list) return;
    if (!data) {
      list.innerHTML = '<li class="acara-empty">Memuat komentar…</li>';
      return;
    }
    list.innerHTML = data.comments.length
      ? data.comments.map(commentHtml).join('')
      : '<li class="acara-empty">Belum ada komentar. Jadilah yang pertama menyemangati panitianya.</li>';
    paintHead(panel, event);
    const counter = cardFor(event.id)?.querySelector('[data-comments]');
    if (counter) counter.textContent = String(data.comments.length);
  }

  function buildPanel(panel, event) {
    panel.dataset.built = String(event.id);
    panel.innerHTML = `<div class="acara-thread-head"></div>
      <ul class="acara-comments"></ul>
      ${composerHtml(event)}`;
    paintHead(panel, event);
    paintComments(panel, event);
  }

  async function showThread(id, { scroll = false } = {}) {
    const event = eventById(id);
    const panel = panelFor(id);
    if (!event || !panel) return;
    open.add(id);
    panel.hidden = false;
    panel.classList.add('is-open');
    cardFor(id)?.querySelector('[data-thread]')?.setAttribute('aria-expanded', 'true');
    if (panel.dataset.built !== String(event.id) || !panel.querySelector('.acara-composer')) buildPanel(panel, event);

    try {
      const data = await api({ action: 'eventThread', eventId: event.id, token: tokenSaya() });
      threads.set(event.id, data);
      const live = eventById(event.id);
      if (live) {
        live.likes = data.likes;
        live.liked = data.liked;
        live.commentCount = (data.comments || []).length;
        syncLike(live);
      }
      if (panelFor(id) === panel) paintComments(panel, event);
    } catch (error) {
      const list = panel.querySelector('.acara-comments');
      if (list && !threads.has(event.id)) {
        list.innerHTML = `<li class="acara-empty">${escapeHTML(error.message)}</li>`;
      }
    }
    if (scroll) {
      const go = () => panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Scroll halus yang dikirim sebelum halaman selesai dimuat dibuang browser,
      // jadi tautan berbagi yang dibuka langsung baru terlihat bergeser setelahnya.
      if (document.readyState === 'complete') go();
      else window.addEventListener('load', go, { once: true });
    }
  }

  function hideThread(id) {
    const panel = panelFor(id);
    open.delete(id);
    if (!panel) return;
    panel.hidden = true;
    panel.classList.remove('is-open');
    panel.removeAttribute('data-built');
    cardFor(id)?.querySelector('[data-thread]')?.setAttribute('aria-expanded', 'false');
  }

  function syncLike(event) {
    const card = cardFor(event.id);
    if (!card) return;
    const button = card.querySelector('[data-like]');
    button?.classList.toggle('is-on', Boolean(event.liked));
    if (button) button.setAttribute('aria-pressed', event.liked ? 'true' : 'false');
    const count = card.querySelector('[data-likes]');
    if (count) count.textContent = (Number(event.likes) || 0).toLocaleString('id-ID');
  }

  function noteIn(form, message, tone = 'err') {
    const box = form?.querySelector('[data-note]');
    if (!box) return;
    box.textContent = message;
    box.hidden = !message;
    box.classList.toggle('is-ok', tone === 'ok');
  }

  async function toggleLike(button) {
    const id = button.dataset.like;
    const event = eventById(id);
    if (!event || button.disabled) return;
    const account = await requireLogin('Masuk dengan akun Google untuk menyukai dan mengomentari acara PB PII.');
    if (!account) return;
    button.disabled = true;
    try {
      const data = await api({ action: 'eventLike', eventId: id, token: tokenSaya() });
      event.liked = data.liked;
      event.likes = data.likes;
      syncLike(event);
      button.classList.add('is-pop');
      setTimeout(() => button.classList.remove('is-pop'), 320);
      const thread = threads.get(id);
      if (thread) { thread.liked = data.liked; thread.likes = data.likes; }
    } catch (error) {
      toast(button, error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function shareEvent(button) {
    const id = button.dataset.share;
    const event = eventById(id);
    if (!event) return;
    const link = `${location.origin}${location.pathname}?event=${encodeURIComponent(id)}`;
    const payload = {
      title: event.title,
      text: `${event.title} — ${event.host?.name || 'PB PII'} (${longDate(event.date)})`,
      url: link
    };
    if (navigator.share) {
      try {
        await navigator.share(payload);
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      flash(button, 'Tautan tersalin');
      return;
    } catch {
      /* browser lama: minta salin manual */
    }
    window.prompt('Salin tautan acara ini:', link);
  }

  function toast(anchor, message) {
    if (!anchor) return;
    const box = document.createElement('span');
    box.className = 'acara-toast';
    box.setAttribute('role', 'status');
    box.textContent = message;
    anchor.insertAdjacentElement('afterend', box);
    setTimeout(() => box.remove(), 5200);
  }

  /** Kader wajib login; pengurus/admin sudah punya sesi. */
  async function requireLogin(message) {
    if (!akun()?.requireAccount) {
      toast(listEl.querySelector('.acara-guide'), 'Masuk kader belum tersedia di halaman ini.');
      return null;
    }
    try {
      return await akun().requireAccount(message);
    } catch {
      return null;
    }
  }

  function flash(button, label) {
    const small = button.querySelector('small');
    if (!small) return;
    const before = small.textContent;
    small.textContent = label;
    button.classList.add('is-done');
    setTimeout(() => {
      small.textContent = before;
      button.classList.remove('is-done');
    }, 2200);
  }

  async function postComment(form) {
    const id = form.dataset.composer;
    const event = eventById(id);
    if (!event) return;
    const text = form.elements.text.value.trim();
    const send = form.querySelector('.acara-send');
    noteIn(form, '');

    if (text.length < 3) return noteIn(form, 'Tulis komentar yang lebih jelas.');
    if (/@\S+\.\S+|https?:\/\/|wa\.me|\b08\d{6,}\b/i.test(text)) {
      return noteIn(form, 'Komentar tidak boleh memuat tautan, email, atau nomor kontak.');
    }
    const account = await requireLogin('Masuk dengan akun Google untuk berkomentar di acara PB PII.');
    if (!account) return;

    send.disabled = true;
    send.textContent = 'Mengirim…';
    try {
      const data = await api({
        action: 'eventComment',
        eventId: id,
        text,
        token: tokenSaya()
      });
      const thread = threads.get(id) || { comments: [], likes: event.likes, liked: event.liked };
      thread.comments = [...thread.comments, data.comment];
      threads.set(id, thread);
      event.commentCount = thread.comments.length;
      form.elements.text.value = '';
      const panel = panelFor(id);
      if (panel) paintComments(panel, event);
      noteIn(form, 'Komentar Anda tayang. Terima kasih.', 'ok');
    } catch (error) {
      noteIn(form, error.message);
    } finally {
      send.disabled = false;
      send.textContent = 'Kirim komentar';
    }
  }

  listEl.addEventListener('click', (event) => {
    const like = event.target.closest('[data-like]');
    if (like) return toggleLike(like);
    const talk = event.target.closest('[data-thread]');
    if (talk) return open.has(talk.dataset.thread) ? hideThread(talk.dataset.thread) : showThread(talk.dataset.thread);
    const share = event.target.closest('[data-share]');
    if (share) return shareEvent(share);
  });

  listEl.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-composer]');
    if (!form) return;
    event.preventDefault();
    postComment(form);
  });

  function paint() {
    const rows = state.events.filter(matches).sort(order);
    const shown = rows.slice(0, MAX_CARD);

    if (!rows.length) {
      listEl.innerHTML = state.stale
        ? '<div class="empty-state"><h3>Belum ada agenda yang tayang</h3><p>Daftar ini terisi otomatis begitu pengurus PB, PW, PD, atau PK menerbitkan kegiatan. Silakan dicek lagi nanti.</p></div>'
        : `<div class="empty-state"><h3>Belum ada acara pada saringan ini</h3><p>Coba pilih <b>Semua</b>, hapus kata kunci, atau ganti jenjang penyelenggara.</p></div>`;
      hiddenEl.hidden = true;
      return;
    }

    listEl.innerHTML = shown.map(card).join('');
    observeCards();
    open.forEach((id) => {
      if (eventById(id)) showThread(id);
    });
    const extra = rows.length - shown.length;
    hiddenEl.hidden = extra <= 0;
    hiddenEl.textContent = extra > 0 ? `${extra} acara lain cocok — persempit dengan pencarian atau jenjang.` : '';

    const upcoming = state.events.filter((event) => event.upcoming).length;
    countEl.textContent = upcoming
      ? `${upcoming} agenda mendatang`
      : `${state.events.length} dokumentasi kegiatan`;
  }

  function applyKeaktifan(defaultMin) {
    if (!Number.isFinite(defaultMin)) return;
    state.defaultMin = defaultMin;
    standardEl.textContent = `Standar keaktifan: minimal ${defaultMin} kegiatan/bulan`;
    defaultEl.textContent = `Standar bawaan website saat ini ${defaultMin} kegiatan per bulan. Pengurus Besar, wilayah, daerah, atau komisariat dapat menyetel angka lain untuk lembaga di bawahnya lewat tab Jejaring.`;
  }

  async function load() {
    const cached = cacheRead();
    if (cached) {
      state.events = cached.events;
      if (Number.isFinite(cached.defaultMin)) applyKeaktifan(cached.defaultMin);
      paint();
    }

    lastToken = tokenSaya();
    let data;
    try {
      data = await api({ action: 'public', token: lastToken });
    } catch (error) {
      if (!cached) {
        listEl.innerHTML = `<div class="empty-state"><h3>Koneksi belum tersambung</h3><p>${escapeHTML(error.message)} Periksa jaringan lalu muat ulang halaman.</p></div>`;
        countEl.textContent = 'Muat ulang untuk melihat agenda';
      } else {
        state.stale = true;
        paint();
        countEl.textContent = 'Menampilkan salinan terakhir';
      }
      return;
    }

    state.events = Array.isArray(data.events) ? data.events : [];
    state.stale = !Array.isArray(data.events);
    applyKeaktifan(Number(data.keaktifan?.defaultMin));
    cacheWrite({ events: state.events, defaultMin: state.defaultMin });
    paint();

    if (!deepHandled) {
      const wanted = new URLSearchParams(location.search).get('event');
      if (wanted && eventById(wanted)) {
        deepHandled = true;
        showThread(wanted, { scroll: true });
      }
    }
    if (!state.events.length) {
      countEl.textContent = 'Belum ada agenda terbit';
    }
  }

  tabsEl?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-filter]');
    if (!button) return;
    state.filter = button.dataset.filter;
    [...tabsEl.querySelectorAll('button')].forEach((item) => item.classList.toggle('is-active', item === button));
    paint();
  });

  searchEl?.addEventListener('input', () => {
    state.query = searchEl.value.trim().toLowerCase();
    paint();
  });

  levelEl?.addEventListener('change', () => {
    state.level = levelEl.value;
    paint();
  });

  document.addEventListener('DOMContentLoaded', () => {
    const year = document.querySelector('#year');
    if (year) year.textContent = String(new Date().getFullYear());
    load();
    // Suka per kader, jadi umpan diambil ulang begitu sesi berganti.
    akun()?.onChange?.(() => {
      if (tokenSaya() !== lastToken) load();
    });
  });
})();
