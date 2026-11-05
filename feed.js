/**
 * Feed sosial kader PB PII.
 *
 * Semuanya lewat satu pintu /api/pii seperti halaman lain, jadi sesi yang sudah
 * ada dipakai tanpa minta login ulang. Kartu kegiatan pada tab "Acara" dibangun
 * dari data acara asli: suka dan komentarnya memakai mesin acara yang sudah
 * berjalan, bukan salinan baru.
 */
(() => {
  const API = window.PBPII_CONFIG?.apiEndpoint || '/api/pii';
  const CACHE_KEY = 'pbpii_feed_cache';
  const PAGE = 12;
  const MEDIA_MAX = 4;
  const MAX_BYTES = 3 * 1024 * 1024;
  const MAX_CHARS = 1800;

  const listEl = document.querySelector('#feedList');
  if (!listEl) return;

  const tabsEl = document.querySelector('#feedTabs');
  const countEl = document.querySelector('#feedCount');
  const emptyEl = document.querySelector('#feedEmpty');
  const moreEl = document.querySelector('#feedMore');
  const stateEl = document.querySelector('#feedState');
  const loginEl = document.querySelector('#feedLogin');
  const composerEl = document.querySelector('#feedComposer');
  const openComposerEl = document.querySelector('#feedOpenComposer');
  const textEl = document.querySelector('#feedText');
  const kindsEl = document.querySelector('#feedKinds');
  const counterEl = document.querySelector('#feedCounter');
  const noteEl = document.querySelector('#feedNote');
  const previewsEl = document.querySelector('#feedPreviews');
  const eventRowEl = document.querySelector('#feedEventRow');
  const eventSelectEl = document.querySelector('#feedEvent');
  const submitEl = document.querySelector('#feedSubmit');
  const photoInputEl = document.querySelector('#feedPhoto');
  const videoInputEl = document.querySelector('#feedVideo');
  const pickPhotoEl = document.querySelector('#feedPickPhoto');
  const pickVideoEl = document.querySelector('#feedPickVideo');
  const videoKindEl = document.querySelector('#feedKindVideo');
  const lightboxEl = document.querySelector('#feedLightbox');
  const meAvaEl = document.querySelector('#feedMeAva');

  const tokenSaya = () => window.PBPIIAkun?.sessionToken?.() || window.PBPIIAkun?.token?.() || '';
  const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LOGO = 'assets/logo-pii.webp';

  const state = {
    tab: 'untuk-anda',
    items: [],
    total: 0,
    sisa: 0,
    kemampuan: {},
    tokenMuat: '',
    events: null,
    loading: false,
    kinds: 'teks',
    media: [],
    editing: '',
    threads: new Map(),
    open: new Set()
  };

  const JENIS_LABEL = {
    teks: 'Kabar', foto: 'Foto', video: 'Video', pengumuman: 'Pengumuman', acara: 'Kegiatan', berbagi: 'Dibagikan'
  };

  /* ------------------------------------------------------------------ api */

  async function api(body) {
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => null);
    if (!result || !result.ok) {
      const error = new Error(result?.error || 'Feed belum dapat dihubungi.');
      error.code = String(result?.code || '');
      error.retryAfter = Number(result?.retryAfter) || 0;
      throw error;
    }
    return result.data;
  }

  function toast(anchor, message) {
    if (!anchor) return;
    const box = document.createElement('span');
    box.className = 'feed-toast';
    box.setAttribute('role', 'status');
    box.textContent = message;
    anchor.insertAdjacentElement('afterend', box);
    setTimeout(() => box.remove(), 5200);
  }

  function note(message, tone = 'err') {
    noteEl.textContent = message;
    noteEl.hidden = !message;
    noteEl.classList.toggle('is-ok', tone === 'ok');
  }

  async function requireLogin(message) {
    if (!window.PBPIIAkun?.requireAccount) {
      toast(composerEl, 'Masuk kader belum tersedia di halaman ini.');
      return null;
    }
    try {
      return await window.PBPIIAkun.requireAccount(message);
    } catch {
      return null;
    }
  }

  /* --------------------------------------------------------------- tampilan */

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

  const initials = (name) => String(name || 'K').trim().charAt(0).toUpperCase() || 'K';

  const longDate = (value) => {
    const date = new Date(`${String(value || '').slice(0, 10)}T00:00:00`);
    return isNaN(date.getTime()) ? '' : date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };

  /** Gambar Drive diuji lewat beberapa bentuk URL; satu CDN bisa diblokir jaringan. */
  const driveForms = [
    (id) => '/api/pii?imageId=' + encodeURIComponent(id),
    (id) => 'https://drive.usercontent.google.com/download?id=' + id + '&export=view&authuser=0',
    (id) => 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1200'
  ];
  const driveId = (value) => {
    const url = String(value || '').trim();
    if (!/^https:\/\//i.test(url)) return '';
    try {
      const parsed = new URL(url);
      if (['drive.google.com', 'drive.usercontent.google.com'].includes(parsed.hostname)) {
        return parsed.searchParams.get('id') || '';
      }
      if (parsed.hostname === 'lh3.googleusercontent.com') return parsed.pathname.match(/^\/d\/([A-Za-z0-9_-]+)/i)?.[1] || '';
      return '';
    } catch {
      return '';
    }
  };
  const safeImage = (value) => {
    const url = String(value || '').trim();
    if (!/^https:\/\//i.test(url)) return LOGO;
    const id = driveId(url);
    if (id) return '/api/pii?imageId=' + encodeURIComponent(id);
    try {
      return escapeHTML(new URL(url).href);
    } catch {
      return LOGO;
    }
  };
  /* Video butuh permintaan rentang supaya bisa diurut; proksi gambar hanya
     menyalin berkas utuh, jadi video memakai tautan Drive langsung. */
  const safeVideo = (value) => {
    const url = String(value || '').trim();
    return /^https:\/\/drive\.(usercontent\.)?google\.com\//i.test(url) ? escapeHTML(url) : '';
  };
  const imageAttrs = (value) => {
    const id = driveId(value);
    return id ? ` data-drive="${id}" data-coba="0"` : '';
  };
  window.feedPhotoFailed = (img) => {
    const id = img.dataset.drive;
    const sudah = Number(img.dataset.coba || 0);
    if (id && sudah < driveForms.length) {
      img.dataset.coba = String(sudah + 1);
      img.src = driveForms[sudah](id);
      return;
    }
    img.onerror = null;
    img.src = LOGO;
  };

  function mediaHtml(card) {
    if (!card.media?.length) return '';
    const video = card.jenis === 'video';
    return `<div class="feed-media${video ? ' is-video' : ''}" data-count="${card.media.length}">
      ${card.media.map((item) => (video
        ? `<video src="${safeVideo(item.url)}" controls playsinline preload="metadata" poster="${LOGO}"></video>`
        : `<button type="button" class="feed-shot" data-zoom="${safeImage(item.url)}">
            <img src="${safeImage(item.url)}" alt="Foto pada kabar ${escapeHTML(JENIS_LABEL[card.jenis] || 'kader')}" loading="lazy"${imageAttrs(item.url)} onerror="feedPhotoFailed(this)">
          </button>`)).join('')}
    </div>`;
  }

  function eventHtml(detail) {
    return `<a class="feed-event" href="${escapeHTML(detail.tautan)}">
      <span class="feed-event-cover">
        <img src="${safeImage(detail.coverImage)}" alt="${escapeHTML(detail.title)}" loading="lazy"${imageAttrs(detail.coverImage)} onerror="feedPhotoFailed(this)">
      </span>
      <span class="feed-event-copy">
        <b>${escapeHTML(detail.title)}</b>
        <small>${escapeHTML(longDate(detail.date))}</small>
        <small>${escapeHTML(detail.location || 'Lokasi menyusul')} · ${escapeHTML(detail.category || 'Kegiatan')}</small>
        ${detail.excerpt ? `<p>${escapeHTML(detail.excerpt)}</p>` : ''}
        <span class="feed-event-cta">${detail.upcoming ? 'Lihat &amp; daftar' : 'Lihat dokumentasi'} ↗</span>
      </span>
    </a>`;
  }

  function actionBar(card) {
    const eventCard = String(card.id).indexOf('acara:') === 0;
    const likes = Number(card.likes) || 0;
    const replies = Number(card.commentCount) || 0;
    const reposts = Number(card.reposts) || 0;
    const buttons = [];

    buttons.push(`<button class="feed-like${card.liked ? ' is-on' : ''}" type="button" data-like="${escapeHTML(card.id)}"
      aria-pressed="${card.liked ? 'true' : 'false'}" aria-label="Suka">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.2s-7.4-4.5-7.4-9.4A4.1 4.1 0 0 1 12 8.1a4.1 4.1 0 0 1 7.4 2.7c0 4.9-7.4 9.4-7.4 9.4Z"/></svg>
      <span data-likes>${likes.toLocaleString('id-ID')}</span>
    </button>`);

    buttons.push(`<button class="feed-talk" type="button" data-thread="${escapeHTML(card.id)}" aria-expanded="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.2V17a2.5 2.5 0 0 1-1-2V7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5Z"/></svg>
      <span data-comments>${replies.toLocaleString('id-ID')}</span>
      <small>Komentar</small>
    </button>`);

    if (eventCard) {
      buttons.push(`<button class="feed-repost" type="button" data-share-event="${escapeHTML(card.acara?.id || '')}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.8 8.6h9.9l-2.6-2.8M19.2 15.4H9.3l2.6 2.8"/></svg>
        <small>Bagikan</small>
      </button>`);
    } else if (!card.author.mine) {
      buttons.push(`<button class="feed-repost${reposts ? ' is-on' : ''}" type="button" data-repost="${escapeHTML(card.id)}" aria-label="Sebarkan kabar">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.8 8.6h9.9l-2.6-2.8M19.2 15.4H9.3l2.6 2.8"/></svg>
        <span data-reposts>${reposts.toLocaleString('id-ID')}</span>
      </button>`);
    } else {
      buttons.push(`<button class="feed-repost" type="button" data-share-post="${escapeHTML(card.id)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="12" r="2.6"/><circle cx="17.4" cy="6.6" r="2.6"/><circle cx="17.4" cy="17.4" r="2.6"/><path d="m9.4 10.8 5.8-3M9.4 13.2l5.8 3"/></svg>
        <small>Sebarkan</small>
      </button>`);
    }

    if (!eventCard) {
      buttons.push(`<button class="feed-save${card.bookmarked ? ' is-on' : ''}" type="button" data-bookmark="${escapeHTML(card.id)}"
        aria-pressed="${card.bookmarked ? 'true' : 'false'}" aria-label="Simpan">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.4 4.8h9.2v14.4l-4.6-3.4-4.6 3.4z"/></svg>
      </button>`);
    }
    return `<div class="feed-actions">${buttons.join('')}</div>`;
  }

  function authorRow(card) {
    const author = card.author || {};
    const foto = author.picture
      ? `<span class="feed-ava" aria-hidden="true">${escapeHTML(initials(author.name))}<img src="${safeImage(author.picture)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()"></span>`
      : `<span class="feed-ava" aria-hidden="true">${escapeHTML(initials(author.name))}</span>`;
    const menu = [];
    if (author.kind === 'kader' && !author.mine) {
      menu.push(`<button type="button" class="feed-follow" data-follow="${escapeHTML(author.id)}">Ikuti</button>`);
    }
    if (author.mine && String(card.id).indexOf('acara:') !== 0) {
      menu.push('<button type="button" class="feed-menu" data-menu aria-expanded="false" aria-label="Pilihan postingan">⋯</button>');
    }
    const ubah = card.updatedAt && card.updatedAt !== card.createdAt ? ' · diubah' : '';
    return `<div class="feed-author">
      ${author.username
        ? `<a class="feed-author-taut feed-author-ava" href="/profil.html?u=${escapeHTML(author.username)}" aria-hidden="true" tabindex="-1">${foto}</a>`
        : foto}
      <span class="feed-author-name">
        ${author.username
          ? `<a class="feed-author-taut" href="/profil.html?u=${escapeHTML(author.username)}"><b>${escapeHTML(author.name || 'Kader PII')}</b></a>`
          : `<b>${escapeHTML(author.name || 'Kader PII')}</b>`}
        <small>${escapeHTML(JENIS_LABEL[card.jenis] || 'Kabar')} · ${escapeHTML(timeAgo(card.createdAt))}${escapeHTML(ubah)}</small>
      </span>
      <span class="feed-author-side">${menu.join('')}</span>
    </div>`;
  }

  function bodyHtml(card) {
    if (state.editing === card.id) {
      return `<div class="feed-editing">
        <textarea data-edit-text maxlength="${MAX_CHARS}">${escapeHTML(card.isi || '')}</textarea>
        <div class="feed-editing-actions">
          <button type="button" class="button button-solid" data-edit-save="${escapeHTML(card.id)}">Simpan perubahan</button>
          <button type="button" class="text-link" data-edit-cancel>Batal</button>
        </div>
      </div>`;
    }
    const bagian = [];
    if (card.isi) bagian.push(`<p class="feed-text">${escapeHTML(card.isi)}</p>`);
    if (card.acara) bagian.push(eventHtml(card.acara));
    bagian.push(mediaHtml(card));
    if (card.asal) {
      bagian.push(`<div class="feed-origin">
        <span class="feed-origin-label">Kabar yang dibagikan</span>
        <b>${escapeHTML(card.asal.author?.name || 'Kader PII')}</b>
        ${card.asal.isi ? `<p>${escapeHTML(card.asal.isi)}</p>` : ''}
        ${card.asal.acara ? eventHtml(card.asal.acara) : ''}
        ${card.asal.media?.length ? mediaHtml({ ...card.asal, jenis: card.asal.media[0].mime?.indexOf('video') === 0 ? 'video' : 'foto' }) : ''}
      </div>`);
    }
    return bagian.join('');
  }

  function cardHtml(card) {
    const id = escapeHTML(card.id);
    return `<article class="feed-card" data-post="${id}">
      ${authorRow(card)}
      <div class="feed-body">${bodyHtml(card)}</div>
      ${actionBar(card)}
      <div class="feed-thread" data-thread-panel="${id}" hidden></div>
    </article>`;
  }

  function paintCards() {
    listEl.innerHTML = state.items.map(cardHtml).join('');
    const tersisa = Number(state.sisa) || 0;
    moreEl.hidden = tersisa <= 0;
    emptyEl.hidden = state.items.length > 0;
    if (!state.items.length) {
      emptyEl.textContent = state.tab === 'acara'
        ? 'Belum ada kegiatan terjadwal yang dapat dibagikan.'
        : state.tab === 'mengikuti'
          ? 'Anda belum mengikuti kader mana pun. Ikuti kawan dari kartu kabarnya di tab Terbaru.'
          : 'Belum ada kabar di feed. Jadilah yang pertama menuliskannya.';
    }
  }

  function appendCards(items) {
    listEl.insertAdjacentHTML('beforeend', items.map(cardHtml).join(''));
    state.items = state.items.concat(items);
    moreEl.hidden = (Number(state.sisa) || 0) <= 0;
    emptyEl.hidden = state.items.length > 0;
  }

  const cardFor = (id) => listEl.querySelector(`.feed-card[data-post="${CSS.escape(String(id))}"]`);
  const panelFor = (id) => listEl.querySelector(`[data-thread-panel="${CSS.escape(String(id))}"]`);
  const cardData = (id) => state.items.find((card) => String(card.id) === String(id));

  function syncCounters(card) {
    const node = cardFor(card.id);
    if (!node) return;
    const like = node.querySelector('[data-likes]');
    if (like) like.textContent = (Number(card.likes) || 0).toLocaleString('id-ID');
    const talk = node.querySelector('[data-comments]');
    if (talk) talk.textContent = (Number(card.commentCount) || 0).toLocaleString('id-ID');
    const rep = node.querySelector('[data-reposts]');
    if (rep) rep.textContent = (Number(card.reposts) || 0).toLocaleString('id-ID');
    node.querySelector('[data-like]')?.classList.toggle('is-on', Boolean(card.liked));
    node.querySelector('[data-like]')?.setAttribute('aria-pressed', card.liked ? 'true' : 'false');
    node.querySelector('[data-bookmark]')?.classList.toggle('is-on', Boolean(card.bookmarked));
    node.querySelector('[data-bookmark]')?.setAttribute('aria-pressed', card.bookmarked ? 'true' : 'false');
    node.querySelector('[data-repost]')?.classList.toggle('is-on', (Number(card.reposts) || 0) > 0);
  }

  /* ------------------------------------------------------------------ utas */

  function commentHtml(comment) {
    const initial = escapeHTML(initials(comment.author));
    const foto = comment.picture
      ? `<span class="feed-ava is-small" aria-hidden="true">${initial}<img src="${safeImage(comment.picture)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()"></span>`
      : `<span class="feed-ava is-small" aria-hidden="true">${initial}</span>`;
    return `<li class="feed-comment${comment.parentId ? ' is-reply' : ''}${comment.mine ? ' is-mine' : ''}" data-comment="${escapeHTML(comment.id)}">
      ${foto}
      <div>
        <b>${escapeHTML(comment.author || 'Kader PII')}${comment.mine ? ' <small>Anda</small>' : ''}</b>
        <p>${escapeHTML(comment.text)}</p>
        <small>${escapeHTML(timeAgo(comment.createdAt))}</small>
        <button type="button" class="feed-reply-to" data-reply="${escapeHTML(comment.id)}">Balas</button>
      </div>
    </li>`;
  }

  function paintThread(id) {
    const panel = panelFor(id);
    const data = state.threads.get(id);
    if (!panel || !data) return;
    const list = panel.querySelector('.feed-comments');
    if (list) {
      list.innerHTML = data.balasan.length
        ? data.balasan.map(commentHtml).join('')
        : '<li class="feed-empty-comment">Belum ada komentar. Sapa Kawan dengan kabar baik.</li>';
    }
    const total = panel.querySelector('[data-total]');
    if (total) total.textContent = data.balasan.length ? `${data.balasan.length} komentar` : 'Diskusi';
  }

  function buildThread(id) {
    const panel = panelFor(id);
    if (!panel) return;
    panel.innerHTML = `<div class="feed-thread-inner">
        <p class="feed-thread-head"><b data-total>Diskusi</b><span>Komentar kader terbaca oleh semua pengunjung.</span></p>
        <ul class="feed-comments"><li class="feed-empty-comment">Memuat komentar…</li></ul>
        <form class="feed-reply" data-reply-form="${escapeHTML(id)}">
          <input type="text" placeholder="Tulis balasan…" aria-label="Tulis balasan" maxlength="600" data-reply-text>
          <button type="submit" class="button button-solid">Kirim</button>
        </form>
        <p class="feed-note" data-reply-note hidden></p>
      </div>`;
    panel.dataset.built = '1';
  }

  async function openThread(id) {
    const panel = panelFor(id);
    if (!panel) return;
    if (!panel.hidden && panel.dataset.built) {
      closeThread(id);
      return;
    }
    buildThread(id);
    panel.hidden = false;
    panel.classList.add('is-open');
    state.open.add(id);
    panel.closest('[data-thread]')?.setAttribute?.('aria-expanded', 'true');
    cardFor(id)?.querySelector('[data-thread]')?.setAttribute('aria-expanded', 'true');
    if (!state.threads.has(id)) await loadThread(id);
    else paintThread(id);
    const input = panel.querySelector('[data-reply-text]');
    if (input && window.matchMedia('(min-width: 681px)').matches) input.focus();
  }

  function closeThread(id) {
    const panel = panelFor(id);
    state.open.delete(id);
    if (!panel) return;
    panel.hidden = true;
    panel.classList.remove('is-open');
    delete panel.dataset.built;
    cardFor(id)?.querySelector('[data-thread]')?.setAttribute('aria-expanded', 'false');
  }

  /** Kartu tab Acara berasal dari sheet kegiatan, jadi utasnya memakai mesin acara. */
  const isEventCard = (id) => String(id).indexOf('acara:') === 0;
  const eventKey = (id) => String(id).slice('acara:'.length);

  async function loadThread(id) {
    try {
      const data = isEventCard(id)
        ? await api({ action: 'eventThread', eventId: eventKey(id), token: tokenSaya() })
        : await api({ action: 'feedThread', id, token: tokenSaya() });
      state.threads.set(id, {
        balasan: (data.balasan || data.comments || []).slice().reverse(),
        likes: Number(data.likes) || 0,
        liked: Boolean(data.liked)
      });
      paintThread(id);
    } catch {
      const panel = panelFor(id);
      panel?.querySelector('.feed-comments')?.replaceChildren(
        Object.assign(document.createElement('li'), {
          className: 'feed-empty-comment',
          textContent: 'Komentar belum dapat dimuat. Periksa koneksi Anda, lalu coba lagi.'
        })
      );
    }
  }

  function replyTarget(id) {
    const panel = panelFor(id);
    return panel?.querySelector('[data-reply-form]')?.dataset.parent || '';
  }

  /* ------------------------------------------------------------------ muat */

  function applyMeta(data) {
    state.total = Number(data.total) || 0;
    state.sisa = Number(data.sisa) || 0;
    state.kemampuan = data.kemampuan || {};
    countEl.textContent = `${state.total.toLocaleString('id-ID')} kabar`;
    paintComposer();
  }

  /* Kemampuan menulis dan mengunggah dilaporkan server bersama isi feed.
     Selama respons pertama belum datang, sesi yang sudah ada yang dipakai —
     kader yang sudah login tidak boleh disuruh masuk lagi hanya karena feed-nya
     telat dimuat. */
  function adaSesi() {
    const akun = window.PBPIIAkun?.account?.();
    return Boolean(akun && akun.role !== 'tamu');
  }

  function bolehTulis() {
    return Object.keys(state.kemampuan).length
      ? Boolean(state.kemampuan.menulis)
      : adaSesi();
  }

  function bolehUnggah() {
    return Object.keys(state.kemampuan).length
      ? Boolean(state.kemampuan.unggah)
      : adaSesi();
  }

  function paintComposer() {
    const boleh = bolehTulis();
    const unggah = bolehUnggah();
    openComposerEl.hidden = !boleh;
    loginEl.hidden = boleh || !window.PBPIIAkun;
    videoKindEl.hidden = !unggah;
    if (adaSesi()) {
      const akun = window.PBPIIAkun.account();
      meAvaEl.textContent = initials(akun.name || 'K');
      if (akun.picture && !meAvaEl.querySelector('img')) {
        meAvaEl.insertAdjacentHTML('beforeend', `<img src="${safeImage(akun.picture)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`);
      }
    }
    /* Jenis yang sedang dipilih yang menentukan tombol berkasnya, jadi
       sinkronisasi komposer tetap dijalankan setelah hak unggah berubah. */
    syncComposer();
  }

  async function loadFeed({ lebih = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    stateEl.textContent = lebih ? 'Memuat kabar berikutnya…' : '';
    const mulai = lebih ? state.items.length : 0;
    const token = tokenSaya();
    try {
      const data = await api({ action: 'feedList', tab: state.tab, mulai, batas: PAGE, token });
      state.tokenMuat = token;
      applyMeta(data);
      if (lebih) appendCards(data.items || []);
      else {
        state.items = data.items || [];
        paintCards();
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ tab: data.tab, items: state.items.slice(0, 8), pada: Date.now() }));
        } catch {
          /* penyimpanan penuh; feed tetap dibaca dari jaringan */
        }
      }
    } catch (error) {
      if (!lebih) {
        state.items = [];
        listEl.innerHTML = '';
        emptyEl.hidden = false;
        emptyEl.textContent = 'Feed belum dapat dimuat. Periksa koneksi Anda, lalu muat ulang halaman.';
        countEl.textContent = 'Kabar harian kader';
      } else {
        toast(moreEl, error.message);
      }
    } finally {
      state.loading = false;
      stateEl.textContent = '';
    }
  }

  function cachedFeed() {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!raw || !Array.isArray(raw.items) || Date.now() - Number(raw.pada) > 86400000) return null;
      return raw;
    } catch {
      return null;
    }
  }

  /* --------------------------------------------------------------- komposer */

  function activeKind() {
    return kindsEl.querySelector('.is-active')?.dataset.jenis || 'teks';
  }

  function syncComposer() {
    const jenis = activeKind();
    const sisa = MAX_CHARS - textEl.value.length;
    counterEl.textContent = String(sisa);
    counterEl.classList.toggle('is-low', sisa < 120);
    eventRowEl.hidden = jenis !== 'acara';
    previewsEl.hidden = jenis !== 'foto' && jenis !== 'video';
    pickPhotoEl.hidden = jenis !== 'foto' || !bolehUnggah();
    pickVideoEl.hidden = jenis !== 'video' || !bolehUnggah();
    textEl.placeholder = jenis === 'pengumuman'
      ? 'Tulis pengumuman untuk kader…'
      : jenis === 'acara'
        ? 'Tambahkan pesan singkat (boleh dikosongkan)…'
        : 'Ada kabar apa hari ini, Kawan?';
  }

  function paintPreviews() {
    previewsEl.hidden = !state.media.length;
    previewsEl.innerHTML = state.media.map((item, index) => `
      <div class="feed-preview">
        ${item.mime?.indexOf('video') === 0
          ? `<video src="${safeVideo(item.url)}" muted playsinline preload="metadata"></video>`
          : `<img src="${safeImage(item.url)}" alt="" referrerpolicy="no-referrer"${imageAttrs(item.url)} onerror="feedPhotoFailed(this)">`}
        <button type="button" data-drop-media="${index}" aria-label="Keluarkan berkas">×</button>
        ${item.busy ? '<span class="feed-preview-busy" aria-hidden="true"></span>' : ''}
      </div>`).join('');
  }

  function bacaBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = () => reject(new Error('Berkas tidak dapat dibaca.'));
      reader.readAsDataURL(file);
    });
  }

  async function unggah(file) {
    if (file.size > MAX_BYTES) {
      note('Berkas melebihi 3 MB. Kecilkan dulu supaya kader lain tidak lama menunggu.');
      return null;
    }
    const slot = { name: file.name, mime: file.type, busy: true, url: URL.createObjectURL(file) };
    state.media.push(slot);
    paintPreviews();
    try {
      const data = await bacaBase64(file);
      const hasil = await api({ action: 'feedUpload', token: tokenSaya(), name: file.name, data });
      slot.url = hasil.url;
      slot.mime = hasil.mime;
      slot.busy = false;
      note('');
      return slot;
    } catch (error) {
      state.media = state.media.filter((item) => item !== slot);
      slot.busy = false;
      note(error.message);
      return null;
    } finally {
      paintPreviews();
    }
  }

  async function tambahBerkas(input) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    const ruang = MEDIA_MAX - state.media.length;
    if (ruang <= 0) {
      note(`Maksimal ${MEDIA_MAX} berkas dalam satu kabar.`);
      input.value = '';
      return;
    }
    submitEl.disabled = true;
    for (const file of files.slice(0, ruang)) await unggah(file);
    submitEl.disabled = false;
    input.value = '';
    syncComposer();
  }

  async function muatEvent() {
    if (state.events) return state.events;
    try {
      const data = await api({ action: 'public' });
      state.events = (data.events || []).filter((event) => /^\d{4}-\d{2}-\d{2}$/.test(String(event.date || '')));
      eventSelectEl.innerHTML = state.events.length
        ? state.events.map((event) => `<option value="${escapeHTML(event.id)}">${escapeHTML(event.title)} — ${escapeHTML(longDate(event.date))}</option>`).join('')
        : '<option value="">Belum ada kegiatan terjadwal</option>';
    } catch {
      eventSelectEl.innerHTML = '<option value="">Kegiatan belum dapat dimuat</option>';
    }
    return state.events;
  }

  async function kirim(event) {
    event.preventDefault();
    const jenis = activeKind();
    const isi = textEl.value.trim();
    if ((jenis === 'foto' || jenis === 'video') && !state.media.length) {
      note(jenis === 'video' ? 'Pilih video lebih dulu.' : 'Pilih foto lebih dulu.');
      return;
    }
    if (jenis !== 'acara' && isi.length < 4) {
      note('Tulis kabar yang lebih jelas.');
      return;
    }
    submitEl.disabled = true;
    note('');
    try {
      const body = { action: 'feedPost', token: tokenSaya(), jenis, isi };
      if (jenis === 'acara') body.eventId = eventSelectEl.value;
      if (jenis === 'foto' || jenis === 'video') {
        body.media = state.media.map((item) => ({ url: item.url, mime: item.mime }));
      }
      const data = await api(body);
      state.items.unshift(data.post);
      listEl.insertAdjacentHTML('afterbegin', cardHtml(data.post));
      emptyEl.hidden = true;
      textEl.value = '';
      state.media = [];
      paintPreviews();
      kindsEl.querySelector('[data-jenis="teks"]')?.click();
      composerEl.classList.remove('is-open');
      composerEl.hidden = true;
      note('Kabar Anda terbit di feed.', 'ok');
      setTimeout(() => note(''), 4200);
      loadFeed();
    } catch (error) {
      note(error.message);
    } finally {
      submitEl.disabled = false;
      syncComposer();
    }
  }

  /* ------------------------------------------------------------- interaksi */

  async function toggleLike(button) {
    const id = button.dataset.like;
    const card = cardData(id);
    if (!card || button.disabled) return;
    const account = await requireLogin('Masuk sebagai kader untuk menyukai kabar pada feed.');
    if (!account) return;
    button.disabled = true;
    try {
      const data = isEventCard(id)
        ? await api({ action: 'eventLike', eventId: eventKey(id), token: tokenSaya() })
        : await api({ action: 'feedLike', id, token: tokenSaya() });
      card.liked = data.liked;
      card.likes = data.likes;
      syncCounters(card);
      button.classList.add('is-pop');
      setTimeout(() => button.classList.remove('is-pop'), 320);
      const thread = state.threads.get(id);
      if (thread) { thread.liked = data.liked; thread.likes = data.likes; }
    } catch (error) {
      toast(button, error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function toggleRepost(button) {
    const id = button.dataset.repost;
    const card = cardData(id);
    if (!card || button.disabled) return;
    const account = await requireLogin('Masuk sebagai kader untuk membagikan kabar.');
    if (!account) return;
    button.disabled = true;
    try {
      const data = await api({ action: 'feedRepost', id, token: tokenSaya() });
      card.reposts = data.reposts;
      syncCounters(card);
      toast(button, data.dibagikan ? 'Kabar kawan tampil di feed Anda.' : 'Bagikan dibatalkan.');
      if (data.dibagikan) setTimeout(() => loadFeed(), 700);
    } catch (error) {
      toast(button, error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function bagikanAcaraKeFeed(button) {
    const eventId = button.dataset.shareEvent;
    if (!eventId || button.disabled) return;
    const account = await requireLogin('Masuk sebagai kader untuk membagikan kegiatan ke feed.');
    if (!account) return;
    button.disabled = true;
    try {
      await api({ action: 'feedPost', token: tokenSaya(), jenis: 'acara', eventId, isi: '' });
      toast(button, 'Kegiatan dibagikan ke feed.');
    } catch (error) {
      toast(button, error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function toggleBookmark(button) {
    const id = button.dataset.bookmark;
    const card = cardData(id);
    if (!card) return;
    const account = await requireLogin('Masuk sebagai kader untuk menyimpan kabar.');
    if (!account) return;
    try {
      const data = await api({ action: 'feedBookmark', id, token: tokenSaya() });
      card.bookmarked = data.bookmarked;
      syncCounters(card);
    } catch (error) {
      toast(button, error.message);
    }
  }

  async function toggleFollow(button) {
    const kaderId = button.dataset.follow;
    if (!kaderId || button.disabled) return;
    const account = await requireLogin('Masuk sebagai kader untuk mengikuti kawan.');
    if (!account) return;
    button.disabled = true;
    try {
      const data = await api({ action: 'feedFollow', kaderId, token: tokenSaya() });
      button.textContent = data.mengikuti ? 'Mengikuti' : 'Ikuti';
      button.classList.toggle('is-on', data.mengikuti);
      const card = button.closest('.feed-card');
      card?.classList.toggle('is-following', data.mengikuti);
    } catch (error) {
      toast(button, error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function kirimBalas(form) {
    const id = form.dataset.replyForm;
    const input = form.querySelector('[data-reply-text]');
    const panel = panelFor(id);
    const box = panel?.querySelector('[data-reply-note]');
    const text = input.value.trim();
    if (text.length < 3) return;
    const account = await requireLogin('Masuk sebagai kader untuk mengomentari kabar.');
    if (!account) return;
    form.querySelector('button').disabled = true;
    try {
      const parent = replyTarget(id);
      const data = isEventCard(id)
        ? await api({ action: 'eventComment', eventId: eventKey(id), text, token: tokenSaya() })
        : await api({ action: 'feedComment', id, text, parentId: parent, token: tokenSaya() });
      const balasan = data.balasan || data.comment;
      const thread = state.threads.get(id) || { balasan: [] };
      thread.balasan = (thread.balasan || []).concat(balasan);
      state.threads.set(id, thread);
      paintThread(id);
      const card = cardData(id);
      if (card) {
        card.commentCount = Number(data.commentCount ?? data.total ?? thread.balasan.length);
        syncCounters(card);
      }
      input.value = '';
      delete form.dataset.parent;
      panel.querySelector('.feed-reply-to.is-on')?.classList.remove('is-on');
      if (box) box.hidden = true;
    } catch (error) {
      if (box) {
        box.textContent = error.message;
        box.hidden = false;
        box.classList.remove('is-ok');
      }
    } finally {
      form.querySelector('button').disabled = false;
      input.focus();
    }
  }

  function bukaBalas(button) {
    const li = button.closest('.feed-comment');
    const id = li.closest('[data-thread-panel]').dataset.threadPanel;
    const form = panelFor(id).querySelector('[data-reply-form]');
    const input = form.querySelector('[data-reply-text]');
    const sedang = form.dataset.parent === button.dataset.reply;
    panelFor(id).querySelectorAll('.feed-reply-to').forEach((node) => node.classList.remove('is-on'));
    if (sedang) {
      delete form.dataset.parent;
      input.placeholder = 'Tulis balasan…';
      return;
    }
    form.dataset.parent = button.dataset.reply;
    button.classList.add('is-on');
    input.placeholder = `Balas ${li.querySelector('b')?.textContent?.replace('Anda', '').trim() || 'kader ini'}…`;
    input.focus();
  }

  function tutupMenu() {
    document.querySelectorAll('.feed-menu-pop').forEach((node) => node.remove());
    document.querySelectorAll('[data-menu][aria-expanded="true"]')
      .forEach((node) => node.setAttribute('aria-expanded', 'false'));
  }

  function menu(cardId) {
    const card = cardData(cardId);
    const node = cardFor(cardId);
    if (!card || !node || !card.author.mine) return;
    const menuWrap = node.querySelector('.feed-author-side');
    if (menuWrap.querySelector('.feed-menu-pop')) {
      tutupMenu();
      return;
    }
    tutupMenu();
    const pop = document.createElement('div');
    pop.className = 'feed-menu-pop';
    pop.innerHTML = '<button type="button" data-do-edit>Ubah kabar</button><button type="button" class="is-danger" data-do-delete>Hapus kabar</button>';
    menuWrap.appendChild(pop);
    menuWrap.querySelector('[data-menu]')?.setAttribute('aria-expanded', 'true');
    pop.addEventListener('click', (event) => {
      if (event.target.matches('[data-do-edit]')) mulaiUbah(cardId);
      if (event.target.matches('[data-do-delete]')) mintaHapus(cardId, pop);
    });
  }

  function mulaiUbah(cardId) {
    state.editing = cardId;
    paintCards();
    state.open.forEach((id) => {
      const panel = panelFor(id);
      if (panel) {
        panel.hidden = false;
        panel.dataset.built && buildThread(id);
        paintThread(id);
      }
    });
    cardFor(cardId)?.querySelector('[data-edit-text]')?.focus();
  }

  async function simpanUbah(button) {
    const id = button.dataset.editSave;
    const card = cardData(id);
    const textarea = cardFor(id)?.querySelector('[data-edit-text]');
    if (!card || !textarea) return;
    button.disabled = true;
    try {
      const data = await api({ action: 'feedEdit', id, isi: textarea.value.trim(), token: tokenSaya() });
      Object.assign(card, data.post);
      state.editing = '';
      paintCards();
      state.open.forEach(openThread);
      toast(listEl, 'Kabar diperbarui.');
    } catch (error) {
      toast(button, error.message);
    } finally {
      button.disabled = false;
    }
  }

  function mintaHapus(cardId, pop) {
    const card = cardData(cardId);
    if (!card) return;
    pop.innerHTML = '<span>Hapus kabar ini?</span><button type="button" data-confirm-yes>Ya, hapus</button><button type="button" data-confirm-no>Batal</button>';
    pop.addEventListener('click', async (event) => {
      if (event.target.matches('[data-confirm-no]')) {
        tutupMenu();
        return;
      }
      if (!event.target.matches('[data-confirm-yes]')) return;
      event.target.disabled = true;
      try {
        await api({ action: 'feedDelete', id: cardId, token: tokenSaya() });
        state.items = state.items.filter((item) => item.id !== cardId);
        cardFor(cardId)?.remove();
        state.threads.delete(cardId);
        if (!state.items.length) paintCards();
        loadFeed();
      } catch (error) {
        toast(cardFor(cardId), error.message);
        tutupMenu();
      }
    });
  }

  async function sebarkanKeluar(button) {
    const card = cardData(button.dataset.sharePost);
    if (!card) return;
    const url = `${location.origin}/feed.html?kabar=${encodeURIComponent(card.id)}`;
    const payload = { title: 'Feed Kader PB PII', text: String(card.isi || 'Kabar dari kader Pelajar Islam Indonesia').slice(0, 200), url };
    if (navigator.share) {
      try {
        await navigator.share(payload);
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        toast(button, 'Tautan kabar disalin.');
        return;
      } catch {
        /* clipboard bisa diblokir peramban; tautan tetap ditunjukkan di bawah */
      }
    }
    toast(button, url);
  }

  function pilihTab(button) {
    tabsEl.querySelectorAll('button').forEach((node) => {
      const aktif = node === button;
      node.classList.toggle('is-active', aktif);
      node.setAttribute('aria-selected', aktif ? 'true' : 'false');
    });
    state.tab = button.dataset.tab;
    state.editing = '';
    state.open.clear();
    listEl.innerHTML = '<div class="feed-skeleton" aria-hidden="true"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>';
    loadFeed();
  }

  /* ------------------------------------------------------------------ event */

  tabsEl?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (button) pilihTab(button);
  });

  listEl.addEventListener('click', async (event) => {
    const target = event.target;
    const like = target.closest('[data-like]');
    if (like) return toggleLike(like);
    const talk = target.closest('[data-thread]');
    if (talk) return openThread(talk.dataset.thread);
    const repost = target.closest('[data-repost]');
    if (repost) return toggleRepost(repost);
    const shareEvent = target.closest('[data-share-event]');
    if (shareEvent) return bagikanAcaraKeFeed(shareEvent);
    const sharePost = target.closest('[data-share-post]');
    if (sharePost) return sebarkanKeluar(sharePost);
    const bookmark = target.closest('[data-bookmark]');
    if (bookmark) return toggleBookmark(bookmark);
    const follow = target.closest('[data-follow]');
    if (follow) return toggleFollow(follow);
    const menuButton = target.closest('[data-menu]');
    if (menuButton) return menu(menuButton.closest('.feed-card').dataset.post);
    const replyTo = target.closest('[data-reply]');
    if (replyTo) return bukaBalas(replyTo);
    const zoom = target.closest('[data-zoom]');
    if (zoom) return bukaLightbox(zoom.dataset.zoom);
    if (target.closest('[data-edit-cancel]')) {
      state.editing = '';
      paintCards();
      state.open.forEach(openThread);
      return;
    }
    const save = target.closest('[data-edit-save]');
    if (save) return simpanUbah(save);
    const drop = target.closest('[data-drop-media]');
    if (drop) {
      state.media.splice(Number(drop.dataset.dropMedia), 1);
      paintPreviews();
      syncComposer();
    }
  });

  listEl.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-reply-form]');
    if (!form) return;
    event.preventDefault();
    kirimBalas(form);
  });

  moreEl?.addEventListener('click', () => loadFeed({ lebih: true }));

  openComposerEl?.addEventListener('click', async () => {
    const account = await requireLogin('Masuk sebagai kader untuk menulis kabar di feed.');
    if (!account) return;
    composerEl.hidden = false;
    composerEl.classList.add('is-open');
    paintComposer();
    textEl.focus();
    if (activeKind() === 'acara') await muatEvent();
  });

  document.querySelector('#feedLoginOpen')?.addEventListener('click', async () => {
    await requireLogin('Masuk sebagai kader untuk memakai feed.');
  });

  textEl?.addEventListener('input', syncComposer);
  composerEl?.addEventListener('submit', kirim);

  kindsEl?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-jenis]');
    if (!button) return;
    kindsEl.querySelectorAll('button').forEach((node) => node.classList.toggle('is-active', node === button));
    state.media = [];
    paintPreviews();
    syncComposer();
    if (button.dataset.jenis === 'acara') await muatEvent();
  });

  pickPhotoEl?.addEventListener('click', () => photoInputEl.click());
  pickVideoEl?.addEventListener('click', () => videoInputEl.click());
  photoInputEl?.addEventListener('change', () => tambahBerkas(photoInputEl));
  videoInputEl?.addEventListener('change', () => tambahBerkas(videoInputEl));

  document.addEventListener('click', (event) => {
    /* Path diambil lebih dulu: membuka dialog konfirmasi mengganti isi menu,
       sehingga event.target sudah lepas dari dokumen saat handler ini jalan. */
    const jalur = typeof event.composedPath === 'function'
      ? event.composedPath()
      : [event.target];
    if (jalur.some((node) => node?.nodeType === 1 && node.matches?.('.feed-menu-pop, .feed-author-side, [data-menu]'))) return;
    tutupMenu();
  });

  function bukaLightbox(url) {
    const img = lightboxEl?.querySelector('img');
    if (!img) return;
    img.src = url;
    lightboxEl.hidden = false;
    lightboxEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('feed-zoomed');
  }

  function tutupLightbox() {
    if (!lightboxEl || lightboxEl.hidden) return;
    lightboxEl.hidden = true;
    lightboxEl.setAttribute('aria-hidden', 'true');
    lightboxEl.querySelector('img').removeAttribute('src');
    document.body.classList.remove('feed-zoomed');
  }

  lightboxEl?.addEventListener('click', (event) => {
    if (event.target.matches('#feedLightboxClose') || event.target === lightboxEl) tutupLightbox();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!lightboxEl?.hidden) {
      tutupLightbox();
      return;
    }
    tutupMenu();
  });

  window.PBPIIAkun?.onChange?.(() => {
    paintComposer();
    /* Kemampuan menulis dilaporkan server beserta isinya, jadi identitas yang
       baru selesai diverifikasi butuh muat ulang, bukan sekadar cat ulang komposer. */
    if (tokenSaya() !== state.tokenMuat) loadFeed();
    if (composerEl.classList.contains('is-open')) composerEl.hidden = false;
  });

  /* ------------------------------------------------------------------ mulai */

  const cache = cachedFeed();
  if (cache?.items?.length) {
    state.items = cache.items;
    paintCards();
    countEl.textContent = `${state.items.length.toLocaleString('id-ID')} kabar terbaru dimuat dari perangkat…`;
  }

  const ingin = new URLSearchParams(location.search).get('kabar');
  loadFeed().then(() => {
    if (!ingin) return;
    const panel = panelFor(ingin);
    if (panel) {
      openThread(ingin);
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
  paintComposer();
})();
