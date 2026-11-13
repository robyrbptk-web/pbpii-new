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
  const CEK_BARU_JARAK = 60000;

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
  const ceritaEl = document.querySelector('#ceritaStrip');
  const startRowEl = document.querySelector('#feedStartRow');
  const startAvaEl = document.querySelector('#feedStartAva');
  const baruEl = document.querySelector('#feedBaru');
  const sideEl = document.querySelector('#feedSide');
  const shellEl = document.querySelector('.feed-shell');
  const railOpenEl = document.querySelector('#feedOpenRail');
  const railCloseEl = document.querySelector('#feedCloseRail');
  const searchFormEl = document.querySelector('#feedSearchForm');
  const searchEl = document.querySelector('#feedSearch');
  const searchResultEl = document.querySelector('#feedSearchResults');
  const sideTutupEl = document.querySelector('#feedSideTutup');
  const meEl = document.querySelector('#feedMe');
  const suggestListEl = document.querySelector('#feedSuggestList');
  const suggestEmptyEl = document.querySelector('#feedSuggestEmpty');
  const sideNoteEl = document.querySelector('#feedSideNote');
  const sideAgendaEl = document.querySelector('#feedSideAgenda');
  const sideAgendaListEl = document.querySelector('#feedSideAgendaList');
  const sideKabarEl = document.querySelector('#feedSideKabar');
  const sideKabarListEl = document.querySelector('#feedSideKabarList');
  const kosongEl = document.querySelector('#feedKosong');
  const kosongTeksEl = document.querySelector('#feedKosongTeks');
  const kosongCtaEl = document.querySelector('#feedKosongCta');
  const unhideEl = document.querySelector('#feedUnhide');
  const lightboxPrevEl = document.querySelector('#feedLightboxPrev');
  const lightboxNextEl = document.querySelector('#feedLightboxNext');
  const lightboxCountEl = document.querySelector('#feedLightboxCount');
  const startWriteEl = document.querySelector('#feedStartWrite');
  const fabEl = document.querySelector('#feedFab');
  const sortNoteEl = document.querySelector('#feedSortNote');
  const composerCloseEl = document.querySelector('#feedComposerClose');

  const tokenSaya = () => window.PBPIIAkun?.sessionToken?.() || window.PBPIIAkun?.token?.() || '';
  const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LOGO = 'assets/logo-pii.webp';

  const state = {
    tab: 'untuk-anda',
    items: [],
    total: 0,
    sisa: 0,
    mulai: 0,
    kemampuan: {},
    tokenMuat: '',
    events: null,
    loading: false,
    kinds: 'teks',
    media: [],
    editing: '',
    threads: new Map(),
    open: new Set(),
    /* Ikutan dibaca sekali per kunjungan dari sheet Follows; tanpa daftar ini
       tombol "Ikuti" pada kartu tidak bisa tahu siapa yang sudah diikuti. */
    mengikuti: new Set(),
    saya: null,
    cekBaruPada: 0,
    sisiSedangMuat: false,
    sisiPublik: null
  };

  const JENIS_LABEL = {
    teks: 'Kabar', foto: 'Foto', video: 'Video', pengumuman: 'Pengumuman', acara: 'Kegiatan', berbagi: 'Dibagikan'
  };

  const IKON = {
    suka: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.2s-7.4-4.5-7.4-9.4A4.1 4.1 0 0 1 12 8.1a4.1 4.1 0 0 1 7.4 2.7c0 4.9-7.4 9.4-7.4 9.4Z"/></svg>',
    balas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.2V17a2.5 2.5 0 0 1-1-2V7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5Z"/></svg>',
    sebar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.8 8.6h9.9l-2.6-2.8M19.2 15.4H9.3l2.6 2.8"/></svg>',
    kirim: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="12" r="2.6"/><circle cx="17.4" cy="6.6" r="2.6"/><circle cx="17.4" cy="17.4" r="2.6"/><path d="m9.4 10.8 5.8-3M9.4 13.2l5.8 3"/></svg>',
    simpan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.4 4.8h9.2v14.4l-4.6-3.4-4.6 3.4z"/></svg>'
  };

  const repostsOn = (card) => (Number(card.reposts) || 0) > 0;
  const diPonsel = () => window.matchMedia('(max-width: 680px)').matches;

  /* Kabar yang disembunyikan pembaca disimpan di perangkat ini saja; server
     tidak perlu tahu, dan tombol "Tampilkan lagi" memulihkan semuanya. */
  const HIDDEN_KEY = 'pbpii_feed_hidden';
  const hidden = (() => {
    try {
      const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]');
      return new Set(Array.isArray(raw) ? raw.map(String) : []);
    } catch {
      return new Set();
    }
  })();

  function simpanTersembunyi() {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
    } catch {
      /* penyimpanan penuh: sembunyikan tetap berlaku selama halaman terbuka */
    }
    if (!unhideEl) return;
    unhideEl.hidden = hidden.size === 0;
    unhideEl.textContent = `Tampilkan ${hidden.size.toLocaleString('id-ID')} kabar yang disembunyikan`;
  }

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
      // Panel akun belum terpasang: form masuk biasa tetap jalan, dan pengguna
      // dikembalikan ke halaman ini setelah masuk.
      location.href = 'sso.html?next=' + encodeURIComponent((location.pathname || '/') + (location.search || ''));
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
    const id = escapeHTML(card.id);
    const angka = (nilai) => (Number(nilai) || 0).toLocaleString('id-ID');
    const buttons = [];

    buttons.push(`<button class="feed-like${card.liked ? ' is-on' : ''}" type="button" data-like="${id}"
      aria-pressed="${card.liked ? 'true' : 'false'}" aria-label="Suka kabar ini">${IKON.suka}<span data-likes>${angka(card.likes)}</span></button>`);

    buttons.push(`<button class="feed-talk" type="button" data-thread="${id}" aria-expanded="false"
      aria-label="Komentar">${IKON.balas}<span data-comments>${angka(card.commentCount)}</span></button>`);

    if (eventCard) {
      buttons.push(`<button class="feed-repost" type="button" data-share-event="${escapeHTML(card.acara?.id || '')}"
        aria-label="Bagikan kegiatan ke feed">${IKON.sebar}<span data-reposts>${angka(card.reposts)}</span></button>`);
    } else {
      if (!card.author.mine) {
        buttons.push(`<button class="feed-repost${repostsOn(card) ? ' is-on' : ''}" type="button" data-repost="${id}"
          aria-label="Bagikan ulang kabar ini">${IKON.sebar}<span data-reposts>${angka(card.reposts)}</span></button>`);
      }
      buttons.push(`<button class="feed-share" type="button" data-share-post="${id}"
        aria-label="Sebarkan tautan kabar">${IKON.kirim}</button>`);
    }

    if (!eventCard) {
      buttons.push(`<button class="feed-save${card.bookmarked ? ' is-on' : ''}" type="button" data-bookmark="${id}"
        aria-pressed="${card.bookmarked ? 'true' : 'false'}" aria-label="Simpan kabar">${IKON.simpan}</button>`);
    }
    return `<div class="feed-actions">${buttons.join('')}</div>`;
  }

  /** Foto kader menjadi penanda kolom kabar; kabarnya sendiri dibuka lewat utas. */
  function avatarHtml(author, kelas = '') {
    const initial = escapeHTML(initials(author.name));
    const foto = author.picture
      ? `<img src="${safeImage(author.picture)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`
      : '';
    return `<span class="feed-ava${kelas}" aria-hidden="true">${initial}${foto}</span>`;
  }

  function railHtml(card) {
    const author = card.author || {};
    const ava = avatarHtml(author);
    return `<div class="feed-rail" aria-hidden="true">
      ${author.username
        ? `<a class="feed-author-ava" href="/profil.html?u=${escapeHTML(author.username)}" tabindex="-1">${ava}</a>`
        : ava}
      <i class="feed-sambung"></i>
    </div>`;
  }

  /** Satu tombol ikut dipakai kartu kabar, daftar saran, dan hasil pencarian. */
  function tombolIkut(kaderId) {
    const id = escapeHTML(kaderId);
    const sudah = state.mengikuti.has(String(kaderId));
    return `<button type="button" class="feed-follow${sudah ? ' is-on' : ''}" data-follow="${id}"
      aria-pressed="${sudah ? 'true' : 'false'}">${sudah ? 'Mengikuti' : 'Ikuti'}</button>`;
  }

  /* Semua tombol untuk orang yang sama diubah bersama, termasuk yang ada di
     panel samping, supaya statusnya tidak bercabang. */
  function catIkut(kaderId, mengikuti) {
    const id = String(kaderId);
    if (mengikuti) state.mengikuti.add(id);
    else state.mengikuti.delete(id);
    document.querySelectorAll(`[data-follow="${id.replace(/"/g, '\\"')}"]`).forEach((button) => {
      button.textContent = mengikuti ? 'Mengikuti' : 'Ikuti';
      button.classList.toggle('is-on', mengikuti);
      button.setAttribute('aria-pressed', mengikuti ? 'true' : 'false');
    });
  }

  function authorRow(card) {
    const author = card.author || {};
    const eventCard = String(card.id).indexOf('acara:') === 0;
    const menu = [];
    if (author.kind === 'kader' && !author.mine && author.id) {
      menu.push(tombolIkut(author.id));
    }
    if (!eventCard) {
      menu.push('<button type="button" class="feed-menu" data-menu aria-expanded="false" aria-label="Pilihan postingan">⋯</button>');
    }
    const ubah = card.updatedAt && card.updatedAt !== card.createdAt ? ' · diubah' : '';
    const jenis = ['pengumuman', 'acara'].indexOf(card.jenis) >= 0
      ? `<em class="feed-jenis">${escapeHTML(JENIS_LABEL[card.jenis] || 'Kabar')}</em>`
      : '';
    const nama = escapeHTML(author.name || 'Kader PII');
    const bawah = [escapeHTML(timeAgo(card.createdAt)), author.username ? '@' + escapeHTML(author.username) : '', ubah ? 'diubah' : '']
      .filter(Boolean).join(' · ');
    return `<div class="feed-author">
      <span class="feed-author-name">
        <span class="feed-author-line">
          ${author.username
            ? `<a class="feed-author-taut" href="/profil.html?u=${escapeHTML(author.username)}"><b>${nama}</b></a>`
            : `<b>${nama}</b>`}${jenis}
        </span>
        <small>${bawah}</small>
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
      ${railHtml(card)}
      <div class="feed-col">
        ${authorRow(card)}
        <div class="feed-body">${bodyHtml(card)}</div>
        ${actionBar(card)}
        <div class="feed-thread" data-thread-panel="${id}" hidden></div>
      </div>
    </article>`;
  }

  /* ------------------------------------------------------------- algoritma

     "Untuk Anda" disusun seperti linimasa media sosial pada umumnya:
     kesegaran, bobot interaksi, kedekatan penulis, keragaman penulis, dan
     kabar yang sudah pernah dilihat. Tab lain tetap kronologis supaya
     perilakunya mudah ditebak. Semua sinyal dihitung di perangkat, jadi
     tidak menambah permintaan ke server. */
  const SEEN_KEY = 'pbpii_feed_seen';
  const seen = (() => {
    try {
      const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  })();

  function simpanDilihat() {
    try {
      const terbaru = Object.keys(seen).sort((a, b) => seen[b] - seen[a]).slice(0, 250);
      const rapi = {};
      terbaru.forEach((key) => { rapi[key] = seen[key]; });
      localStorage.setItem(SEEN_KEY, JSON.stringify(rapi));
    } catch {
      /* penyimpanan penuh: ranking tetap jalan tanpa riwayat lihat */
    }
  }

  /* Angka acak yang stabil per kabar: memberi variasi tanpa mengubah urutan
     setiap kali daftar digambar ulang. */
  function acakStabil(id) {
    const teks = String(id);
    let nilai = 0;
    for (let i = 0; i < teks.length; i += 1) nilai = (nilai * 31 + teks.charCodeAt(i)) % 100003;
    return .94 + ((nilai % 1000) / 1000) * .12;
  }

  function skorKabar(card) {
    const waktu = Date.parse(String(card.createdAt || '')) || 0;
    const usiaJam = Math.max(0, (Date.now() - waktu) / 3600000);
    const segar = Math.pow(.5, usiaJam / 36);
    const interaksi =
      (Number(card.likes) || 0) +
      (Number(card.commentCount) || 0) * 2.4 +
      (Number(card.reposts) || 0) * 3.2 +
      (card.bookmarked ? 2.2 : 0) +
      (card.liked ? .5 : 0);
    const diikuti = state.mengikuti.has(String(card.author?.id || ''));
    const afinitas = diikuti ? 1.55 : card.author?.mine ? 1.06 : 1;
    const media = (card.media?.length || card.acara) ? 1.08 : 1;
    const jenis = card.jenis === 'pengumuman' ? 1.12 : 1;
    const sudahDilihat = seen[String(card.id)] ? .58 : 1;
    return (1 + interaksi) * Math.pow(segar, 1.18) * afinitas * media * jenis * sudahDilihat * acakStabil(card.id);
  }

  /* Urutan greedy: skor tertinggi dipilih lebih dulu, tetapi penulis yang
     sama diberi penalti berulang agar satu kader tidak memenuhi satu layar. */
  function urutkanUntukAnda(items) {
    if (state.tab !== 'untuk-anda' || items.length < 2) return items;
    const sisa = items.slice();
    const hasil = [];
    const skor = new Map(items.map((card) => [String(card.id), skorKabar(card)]));
    const perPenulis = new Map();
    while (sisa.length) {
      let pilih = 0;
      let terbaik = -Infinity;
      sisa.forEach((card, index) => {
        const penulis = String(card.author?.id || card.author?.name || '');
        const ulang = perPenulis.get(penulis) || 0;
        const nilai = (skor.get(String(card.id)) || 0) * Math.pow(.55, ulang);
        if (nilai > terbaik) {
          terbaik = nilai;
          pilih = index;
        }
      });
      const card = sisa.splice(pilih, 1)[0];
      hasil.push(card);
      const penulis = String(card.author?.id || card.author?.name || '');
      perPenulis.set(penulis, (perPenulis.get(penulis) || 0) + 1);
    }
    return hasil;
  }

  let pengamatDilihat = null;
  function pantauDilihat() {
    if (!('IntersectionObserver' in window)) return;
    pengamatDilihat?.disconnect();
    pengamatDilihat = new IntersectionObserver((entries) => {
      let berubah = false;
      entries.forEach((entry) => {
        if (!entry.isIntersecting || entry.intersectionRatio < .6) return;
        const id = entry.target.dataset.post;
        if (!id || seen[id]) return;
        seen[id] = Date.now();
        berubah = true;
        pengamatDilihat?.unobserve(entry.target);
      });
      if (berubah) simpanDilihat();
    }, { threshold: [.6] });
    listEl.querySelectorAll('.feed-card').forEach((node) => pengamatDilihat.observe(node));
  }

  function paintCards() {
    listEl.innerHTML = state.items.map(cardHtml).join('');
    const tersisa = Number(state.sisa) || 0;
    moreEl.hidden = tersisa <= 0;
    paintKosong();
    pantauDilihat();
  }

  /** Keadaan kosong digambar sebagai satu ajakan bertindak, bukan teks lepas. */
  function paintKosong() {
    const kosong = state.items.length === 0;
    emptyEl.hidden = true;
    if (!kosongEl) {
      if (kosong) {
        emptyEl.hidden = false;
        emptyEl.textContent = 'Belum ada kabar di feed. Jadilah yang pertama menuliskannya.';
      }
      return;
    }
    kosongEl.hidden = !kosong;
    if (!kosong) return;
    kosongTeksEl.textContent = state.tab === 'acara'
      ? 'Belum ada kegiatan terjadwal. Kegiatan yang dibagikan pengurus dan lembaga akan muncul di sini.'
      : state.tab === 'mengikuti'
        ? 'Anda belum mengikuti kader mana pun. Jelajahi kabar terbaru, lalu tekan Ikuti pada kader yang ingin Anda baca.'
        : 'Belum ada kabar di feed. Jadilah yang pertama membagikan gagasan atau kegiatan untuk kawan kader.';
    kosongCtaEl.textContent = state.tab === 'acara'
      ? 'Bagikan kegiatan'
      : state.tab === 'mengikuti'
        ? 'Lihat kabar terbaru'
        : 'Tulis kabar pertama';
    kosongCtaEl.hidden = !adaSesi();
  }

  function appendCards(items) {
    listEl.insertAdjacentHTML('beforeend', items.map(cardHtml).join(''));
    state.items = state.items.concat(items);
    moreEl.hidden = (Number(state.sisa) || 0) <= 0;
    paintKosong();
    pantauDilihat();
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
    const foto = avatarHtml({ name: comment.author, picture: comment.picture }, ' is-small');
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
    const akun = window.PBPIIAkun?.account?.();
    const saya = akun && akun.role !== 'tamu' ? initials(akun.name || 'K') : '·';
    const card = cardData(id);
    const foto = card?.media?.find((item) => !/^video\//i.test(item.mime || ''));
    panel.innerHTML = `<div class="feed-thread-inner">
        <div class="feed-thread-bar">
          <button type="button" class="feed-thread-back" data-thread-close aria-label="Tutup utas">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>
          </button>
          <b>Utas</b>
          <span data-total>Diskusi</span>
        </div>
        ${card ? `<div class="feed-thread-asal">
          ${avatarHtml(card.author || {}, ' is-small')}
          <div class="feed-thread-asal-copy">
            <b>${escapeHTML(card.author?.name || 'Kader PII')}</b>
            <small>${escapeHTML(timeAgo(card.createdAt))}${card.author?.username ? ' · @' + escapeHTML(card.author.username) : ''}</small>
            ${card.isi ? `<p>${escapeHTML(card.isi)}</p>` : ''}
            ${card.acara ? `<span class="feed-thread-acara">${escapeHTML(card.acara.title || 'Kegiatan PII')}</span>` : ''}
            ${foto ? `<button type="button" class="feed-thread-thumb" data-zoom="${safeImage(foto.url)}">
              <img src="${safeImage(foto.url)}" alt="Foto pada utas" loading="lazy"${imageAttrs(foto.url)} onerror="feedPhotoFailed(this)">
            </button>` : ''}
          </div>
        </div>` : ''}
        <ul class="feed-comments"><li class="feed-empty-comment">Memuat komentar…</li></ul>
        <form class="feed-reply" data-reply-form="${escapeHTML(id)}">
          <span class="feed-ava is-small" aria-hidden="true">${escapeHTML(saya)}</span>
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
    if (diPonsel()) state.open.forEach((lain) => { if (lain !== id) closeThread(lain, true); });
    buildThread(id);
    panel.hidden = false;
    panel.classList.add('is-open');
    cardFor(id)?.classList.add('is-open');
    state.open.add(id);
    document.body.classList.add('feed-thread-open');
    if (diPonsel() && history.pushState) history.pushState({ feedThread: id }, '');
    cardFor(id)?.querySelector('[data-thread]')?.setAttribute('aria-expanded', 'true');
    if (!state.threads.has(id)) await loadThread(id);
    else paintThread(id);
    const input = panel.querySelector('[data-reply-text]');
    if (input && !diPonsel()) input.focus();
  }

  function closeThread(id, dariRiwayat = false) {
    const panel = panelFor(id);
    state.open.delete(id);
    cardFor(id)?.classList.remove('is-open');
    if (!state.open.size) document.body.classList.remove('feed-thread-open');
    if (!panel) return;
    panel.hidden = true;
    panel.classList.remove('is-open');
    delete panel.dataset.built;
    cardFor(id)?.querySelector('[data-thread]')?.setAttribute('aria-expanded', 'false');
    /* Tombol kembali di layar utas memakai riwayat peramban supaya tombol
       Back ponsel menutup utas, bukan meninggalkan halaman feed. */
    if (diPonsel() && !dariRiwayat && history.state?.feedThread === id) history.back();
  }

  window.addEventListener('popstate', () => {
    [...state.open].forEach((id) => closeThread(id, true));
  });

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

  function isiAva(el, nama, foto) {
    if (!el) return;
    el.textContent = initials(nama || 'K');
    if (foto && !el.querySelector('img')) {
      el.insertAdjacentHTML('beforeend', `<img src="${safeImage(foto)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`);
    }
  }

  function paintComposer() {
    const boleh = bolehTulis();
    const unggah = bolehUnggah();
    const terbuka = composerEl.classList.contains('is-open');
    openComposerEl.hidden = !boleh;
    startRowEl.hidden = !boleh || terbuka;
    if (startWriteEl) startWriteEl.hidden = !boleh || terbuka;
    if (fabEl) fabEl.hidden = !boleh || terbuka;
    document.body.classList.toggle('feed-composing', terbuka);
    loginEl.hidden = boleh || !window.PBPIIAkun;
    videoKindEl.hidden = !unggah;
    if (adaSesi()) {
      const akun = window.PBPIIAkun.account();
      isiAva(meAvaEl, akun.name, akun.picture);
      isiAva(startAvaEl, akun.name, akun.picture);
    }
    paintSisi();
    /* Jenis yang sedang dipilih yang menentukan tombol berkasnya, jadi
       sinkronisasi komposer tetap dijalankan setelah hak unggah berubah. */
    syncComposer();
  }

  /* ------------------------------------------------------------ panel samping */

  /** Ringkasan kader untuk hasil pencarian dan daftar saran. */
  function barisOrang(kader) {
    const nama = escapeHTML(kader.nama || 'Kader PII');
    const username = String(kader.username || '');
    const ava = `<span class="feed-ava">${escapeHTML(initials(kader.nama))}${kader.avatar
      ? `<img src="${safeImage(kader.avatar)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`
      : ''}</span>`;
    const ket = username ? '@' + escapeHTML(username) : 'Kader PII';
    const pengikut = Number(kader.pengikut) || 0;
    return `<div class="feed-orang">${ava}
      <span class="feed-orang-isi"><b>${nama}</b><small>${ket}${pengikut ? ` · ${pengikut.toLocaleString('id-ID')} pengikut` : ''}</small></span>
      ${tombolIkut(kader.id)}</div>`;
  }

  function paintSaya() {
    if (!meEl || !adaSesi() || !state.saya) {
      if (meEl) meEl.hidden = true;
      return;
    }
    /* Username belum ikut di whoami; kartu kabar milik sendiri bisa
       melengkapinya tanpa permintaan tambahan. */
    const milik = state.items.find((card) => card.author?.mine && card.author?.kind === 'kader')?.author;
    const username = String(milik?.username || '');
    const foto = state.saya.picture || milik?.picture || '';
    meEl.innerHTML = `<div class="feed-saya-atas">
        <span class="feed-ava">${escapeHTML(initials(state.saya.nama))}${foto
          ? `<img src="${safeImage(foto)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`
          : ''}</span>
        <span class="feed-saya-ident"><b>${escapeHTML(state.saya.nama || 'Kader PII')}</b>
          <small>${username ? '@' + escapeHTML(username) : 'Kader PII'}</small></span>
      </div>
      <a href="/profil.html?id=${encodeURIComponent(state.saya.id)}">Lihat profil saya</a>`;
    meEl.hidden = false;
  }

  function paintSaran() {
    if (!suggestListEl || !adaSesi()) return;
    const kandidat = new Map();
    state.items.forEach((card) => {
      const author = card.author || {};
      const id = String(author.id || '');
      if (author.kind !== 'kader' || !id || author.mine) return;
      if (state.mengikuti.has(id) || kandidat.has(id)) return;
      kandidat.set(id, author);
    });
    const daftar = [...kandidat.values()].slice(0, 5);
    suggestListEl.innerHTML = daftar.map((author) => barisOrang({
      id: author.id, nama: author.name, username: author.username, avatar: author.picture
    })).join('');
    suggestEmptyEl.hidden = daftar.length > 0;
    if (!daftar.length) suggestEmptyEl.textContent = 'Belum ada saran. Cari kawan lewat kotak pencarian.';
  }

  /** Agenda dan artikel resmi memberi konteks organisasi di rel kanan. */
  function paintSisiOrganisasi(publik) {
    if (sideAgendaEl && sideAgendaListEl) {
      const mulaiHariIni = new Date();
      mulaiHariIni.setHours(0, 0, 0, 0);
      const agenda = (Array.isArray(publik?.events) ? publik.events : [])
        .filter((event) => {
          const waktu = Date.parse(String(event.date || '').slice(0, 10) + 'T00:00:00');
          return isFinite(waktu) && waktu >= mulaiHariIni.getTime();
        })
        .slice(0, 3);
      sideAgendaListEl.innerHTML = agenda.length
        ? agenda.map((event) => {
          const tanggal = new Date(String(event.date || '').slice(0, 10) + 'T00:00:00');
          const hari = isNaN(tanggal.getTime()) ? '—' : String(tanggal.getDate()).padStart(2, '0');
          const bulan = isNaN(tanggal.getTime()) ? '' : tanggal.toLocaleDateString('id-ID', { month: 'short' });
          return `<a class="feed-agenda" href="acara.html?event=${encodeURIComponent(event.id)}">
            <span class="feed-agenda-tgl"><b>${escapeHTML(hari)}</b><small>${escapeHTML(bulan)}</small></span>
            <span class="feed-agenda-isi"><b>${escapeHTML(event.title || 'Kegiatan PII')}</b>
              <small>${escapeHTML(event.location || 'Lokasi menyusul')}</small></span>
          </a>`;
        }).join('')
        : '<p class="feed-side-kosong muted">Belum ada agenda terbit. Kegiatan baru akan muncul di sini.</p>';
      sideAgendaEl.hidden = false;
    }

    if (sideKabarEl && sideKabarListEl) {
      const artikel = (Array.isArray(publik?.articles) ? publik.articles : []).slice(0, 3);
      sideKabarListEl.innerHTML = artikel.length
        ? artikel.map((item) => `<a class="feed-kabar-item" href="/app/artikel">
            <b>${escapeHTML(item.title || 'Artikel PII')}</b>
            <small>${escapeHTML(item.category || 'Artikel')}${item.createdAt
              ? ' · ' + escapeHTML(new Date(item.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }))
              : ''}</small>
          </a>`).join('')
        : '<p class="feed-side-kosong muted">Belum ada artikel terbit. Kabar resmi PB PII akan tampil di sini.</p>';
      sideKabarEl.hidden = false;
    }
  }

  /* Sesi bisa selesai diverifikasi sesudah feed.js terpasang, dan pemberitahuan
     akun.js untuk hasil itu tidak selalu sampai ke halaman ini. Selama token
     tersimpan tetapi peran belum terbaca, rel kanan menunggu sebentar lalu
     dicat ulang — tanpa permintaan tambahan, karena muatSisi memakai cache. */
  let pengawasSesi = 0;

  function tungguSesi() {
    if (adaSesi() || !tokenSaya() || pengawasSesi) return;
    const mulai = Date.now();
    pengawasSesi = setInterval(() => {
      if (adaSesi()) {
        clearInterval(pengawasSesi);
        pengawasSesi = 0;
        paintComposer();
        muatSisi();
        return;
      }
      if (Date.now() - mulai > 15000) {
        clearInterval(pengawasSesi);
        pengawasSesi = 0;
      }
    }, 250);
  }

  function paintSisi() {
    const sesi = adaSesi();
    if (!sesi) tungguSesi();
    if (railOpenEl) railOpenEl.hidden = !sesi;
    shellEl?.classList.toggle('is-tanpa-sisi', !sesi);
    if (sideEl) {
      sideEl.hidden = !sesi;
      if (!sesi) tutupRail();
    }
    if (searchFormEl) searchFormEl.hidden = !sesi;
    if (sideNoteEl) sideNoteEl.hidden = true;
    if (!sesi) return;
    state.mengikuti.forEach((id) => catIkut(id, true));
    paintSaya();
    paintSaran();
    /* Sesi baru diketahui setelah whoami menjawab, sedangkan muatSisi sudah
       dipanggil lebih awal saat akun masih tamu. Pemicu ini memastikan rel
       kanan tetap terisi walau whoami datang belakangan. */
    muatSisi();
  }

  /* Relasi dimuat sekali saat panel dibutuhkan, bukan setiap kali kartu
     digambar, supaya kuota baca backend tidak habis oleh panel samping. */
  async function muatSisi() {
    if (!adaSesi() || state.sisiSedangMuat) return;
    if (state.sisiPublik) {
      paintSisiOrganisasi(state.sisiPublik);
      return;
    }
    state.sisiSedangMuat = true;
    try {
      const token = tokenSaya();
      const [who, jaringan, publik] = await Promise.all([
        api({ action: 'whoami', token }),
        api({ action: 'kaderJaringan', jenis: 'mengikuti', token }),
        api({ action: 'public', token }).catch(() => null)
      ]);
      if (who?.role === 'kader') {
        state.saya = { id: who.id, nama: who.name, picture: who.picture || '' };
      }
      state.mengikuti = new Set((jaringan?.hasil || []).map((kader) => String(kader.id)));
      state.sisiPublik = publik || {};
      paintSisi();
      paintSisiOrganisasi(state.sisiPublik);
    } catch {
      state.sisiPublik = {};
      paintSisi();
      paintSisiOrganisasi(state.sisiPublik);
    } finally {
      state.sisiSedangMuat = false;
    }
  }

  async function cariKader(kata) {
    if (!adaSesi() || !searchResultEl) return;
    try {
      const data = await api({ action: 'kaderCari', kata, token: tokenSaya() });
      const hasil = data.hasil || [];
      searchResultEl.innerHTML = hasil.length
        ? hasil.map((kader) => barisOrang({ id: kader.id, nama: kader.nama, username: kader.username, avatar: kader.avatar, pengikut: kader.pengikut })).join('')
        : '<p class="feed-side-kosong muted">Tidak ada kader dengan nama itu.</p>';
      searchResultEl.hidden = false;
    } catch (error) {
      searchResultEl.innerHTML = `<p class="feed-side-kosong muted">${escapeHTML(error.message)}</p>`;
      searchResultEl.hidden = false;
    }
  }

  function bukaRail(buka) {
    if (!sideEl || sideEl.hidden) return;
    sideEl.classList.toggle('is-open', buka);
    document.body.classList.toggle('feed-side-open', buka);
    if (sideTutupEl) sideTutupEl.hidden = !buka;
    railOpenEl?.setAttribute('aria-expanded', String(buka));
    if (buka) {
      muatSisi();
      setTimeout(() => searchEl?.focus({ preventScroll: true }), 120);
    }
  }

  function tutupRail() {
    if (!sideEl) return;
    sideEl.classList.remove('is-open');
    document.body.classList.remove('feed-side-open');
    if (sideTutupEl) sideTutupEl.hidden = true;
    railOpenEl?.setAttribute('aria-expanded', 'false');
  }

  /* Kabar baru diperiksa saat pengunjung kembali ke tab ini, bukan lewat
     pengumuman langsung: Apps Script punya kuota harian yang harus dijaga. */
  async function cekBaru() {
    if (state.loading || !state.items.length || state.tab === 'acara') return;
    const sekarang = Date.now();
    if (sekarang - state.cekBaruPada < CEK_BARU_JARAK) return;
    state.cekBaruPada = sekarang;
    try {
      const data = await api({ action: 'feedList', tab: 'terbaru', mulai: 0, batas: 1, token: tokenSaya() });
      const teratas = data.items?.[0];
      if (!teratas) {
        baruEl.hidden = true;
        return;
      }
      const teratasBaru = Date.parse(String(teratas.createdAt || ''));
      /* Urutan kartu tidak lagi bisa dijadikan patokan karena tab "Untuk
         Anda" sudah di-ranking; bandingkan waktu terbit paling baru. */
      const terbaruDimuat = state.items.reduce((palingBaru, card) => {
        const waktu = Date.parse(String(card.createdAt || ''));
        return waktu > palingBaru ? waktu : palingBaru;
      }, 0);
      baruEl.hidden = !(teratasBaru > terbaruDimuat);
      if (!baruEl.hidden) baruEl.textContent = 'Kabar baru tersedia — ketuk untuk memuat';
    } catch {
      /* pemeriksaan latar belakang tidak perlu mengganggu pembaca */
    }
  }

  /* Tab bisa ditekan lagi sebelum permintaan sebelumnya selesai. Nomor urut
     memastikan respons tab lama dibuang, bukan menimpa tab yang sedang dibaca
     atau meninggalkan kerangka muat yang tak pernah terisi. */
  let urutanMuat = 0;

  async function loadFeed({ lebih = false } = {}) {
    if (lebih && state.loading) return;
    const nomor = ++urutanMuat;
    const tab = state.tab;
    state.loading = true;
    stateEl.textContent = lebih ? 'Memuat kabar berikutnya…' : '';
    /* Offset memakai jumlah baris mentah server, bukan jumlah kartu yang
       tampil: kabar tersembunyi tidak boleh menggeser halaman berikutnya. */
    const mulai = lebih ? state.mulai : 0;
    /* "Untuk Anda" butuh lebih banyak kandidat agar ranking punya pilihan;
       tab lain tetap memakai satu halaman pendek seperti sebelumnya. */
    const batas = !lebih && tab === 'untuk-anda' ? 20 : PAGE;
    const token = tokenSaya();
    try {
      const data = await api({ action: 'feedList', tab, mulai, batas, token });
      if (nomor !== urutanMuat) return;
      state.tokenMuat = token;
      state.mulai = mulai + (data.items || []).length;
      applyMeta(data);
      if (!lebih) window.PBPIICerita?.pasang(ceritaEl, data);
      const items = urutkanUntukAnda((data.items || []).filter((card) => !hidden.has(String(card.id))));
      if (lebih) appendCards(items);
      else {
        state.items = items;
        paintCards();
        baruEl.hidden = true;
        paintSaran();
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ tab: data.tab, items: state.items.slice(0, 8), pada: Date.now() }));
        } catch {
          /* penyimpanan penuh; feed tetap dibaca dari jaringan */
        }
      }
    } catch (error) {
      if (nomor !== urutanMuat) return;
      if (!lebih) {
        state.items = [];
        listEl.innerHTML = '';
        if (kosongEl) kosongEl.hidden = true;
        emptyEl.hidden = false;
        emptyEl.textContent = 'Feed belum dapat dimuat. Periksa koneksi Anda, lalu muat ulang halaman.';
        countEl.textContent = 'Kabar harian kader';
      } else {
        toast(moreEl, error.message);
      }
    } finally {
      if (nomor === urutanMuat) {
        state.loading = false;
        stateEl.textContent = '';
      }
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
        : 'Apa yang ingin kamu bagikan, Kawan?';
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
    if (jenis === 'acara' && !eventSelectEl.value) {
      note('Belum ada kegiatan terjadwal yang bisa dibagikan. Tulis kabar biasa dulu.');
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
      startRowEl.hidden = !bolehTulis();
      paintComposer();
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

  function denyut(button) {
    if (!button) return;
    button.classList.add('is-pop');
    setTimeout(() => button.classList.remove('is-pop'), 340);
    const node = button.closest('.feed-card');
    if (!node) return;
    const heart = document.createElement('span');
    heart.className = 'feed-heart-burst';
    heart.setAttribute('aria-hidden', 'true');
    heart.innerHTML = IKON.suka;
    const kotak = button.getBoundingClientRect();
    const induk = node.getBoundingClientRect();
    heart.style.left = `${kotak.left - induk.left + kotak.width / 2}px`;
    heart.style.top = `${kotak.top - induk.top + kotak.height / 2}px`;
    node.appendChild(heart);
    setTimeout(() => heart.remove(), 720);
  }

  async function toggleLike(button) {
    const id = button.dataset.like;
    const card = cardData(id);
    if (!card || button.disabled) return;
    if (!adaSesi()) {
      const account = await requireLogin('Masuk sebagai kader untuk menyukai kabar pada feed.');
      if (!account) return;
    }
    button.disabled = true;
    /* Tampilkan perubahan seketika; balasan server hanya mengonfirmasi angka
       akhirnya. Backend Apps Script bisa butuh beberapa detik, dan jeda itu
       membuat tombol suka terasa rusak. */
    const sebelum = { liked: Boolean(card.liked), likes: Number(card.likes) || 0 };
    card.liked = !sebelum.liked;
    card.likes = Math.max(0, sebelum.likes + (card.liked ? 1 : -1));
    syncCounters(card);
    if (card.liked) denyut(button);
    try {
      const data = isEventCard(id)
        ? await api({ action: 'eventLike', eventId: eventKey(id), token: tokenSaya() })
        : await api({ action: 'feedLike', id, token: tokenSaya() });
      card.liked = data.liked;
      card.likes = data.likes;
      syncCounters(card);
      const thread = state.threads.get(id);
      if (thread) { thread.liked = data.liked; thread.likes = data.likes; }
    } catch (error) {
      card.liked = sebelum.liked;
      card.likes = sebelum.likes;
      syncCounters(card);
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
      const mengikuti = Boolean(data.mengikuti);
      catIkut(kaderId, mengikuti);
      paintSaran();
      const card = button.closest('.feed-card');
      card?.classList.toggle('is-following', mengikuti);
      /* Menyusutnya daftar orang yang diikuti berarti tab tersebut perlu muat
         ulang; tidak dilakukan sendiri agar pengguna tidak kehilangan posisi. */
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
      if (diPonsel()) {
        const daftar = panel?.querySelector('.feed-comments');
        if (daftar) daftar.scrollTop = daftar.scrollHeight;
      }
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

  const tautanKabar = (cardId) => `${location.origin}/feed.html?kabar=${encodeURIComponent(cardId)}`;

  async function salinTautan(cardId, anchor) {
    const url = tautanKabar(cardId);
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        toast(anchor, 'Tautan kabar disalin.');
        return;
      } catch {
        /* clipboard bisa diblokir peramban; tautan tetap ditunjukkan */
      }
    }
    toast(anchor, url);
  }

  function sembunyikan(cardId) {
    hidden.add(String(cardId));
    simpanTersembunyi();
    state.items = state.items.filter((item) => String(item.id) !== String(cardId));
    state.threads.delete(String(cardId));
    cardFor(cardId)?.remove();
    if (!state.items.length) paintCards();
    toast(listEl, 'Kabar disembunyikan dari feed Anda.');
  }

  function tampilkanTersembunyi() {
    hidden.clear();
    simpanTersembunyi();
    loadFeed();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function menu(cardId) {
    const card = cardData(cardId);
    const node = cardFor(cardId);
    if (!card || !node) return;
    const menuWrap = node.querySelector('.feed-author-side');
    if (!menuWrap) return;
    if (menuWrap.querySelector('.feed-menu-pop')) {
      tutupMenu();
      return;
    }
    tutupMenu();
    const punyaSendiri = Boolean(card.author?.mine);
    const butir = punyaSendiri
      ? [
        '<button type="button" data-do-edit>Ubah kabar</button>',
        '<button type="button" data-do-share>Salin tautan</button>',
        '<button type="button" class="is-danger" data-do-delete>Hapus kabar</button>'
      ]
      : [
        '<button type="button" data-do-share>Salin tautan</button>',
        `<button type="button" data-do-save>${card.bookmarked ? 'Hapus dari simpanan' : 'Simpan kabar'}</button>`,
        '<button type="button" data-do-hide>Sembunyikan dari feed</button>'
      ];
    const pop = document.createElement('div');
    pop.className = 'feed-menu-pop';
    pop.innerHTML = butir.join('');
    menuWrap.appendChild(pop);
    menuWrap.querySelector('[data-menu]')?.setAttribute('aria-expanded', 'true');
    pop.addEventListener('click', (event) => {
      const tombol = event.target.closest('button');
      if (!tombol) return;
      if (tombol.matches('[data-do-edit]')) {
        tutupMenu();
        mulaiUbah(cardId);
        return;
      }
      if (tombol.matches('[data-do-delete]')) {
        mintaHapus(cardId, pop);
        return;
      }
      if (tombol.matches('[data-do-share]')) {
        tutupMenu();
        salinTautan(cardId, node);
        return;
      }
      if (tombol.matches('[data-do-save]')) {
        tutupMenu();
        const simpan = node.querySelector('[data-bookmark]');
        if (simpan) toggleBookmark(simpan);
        return;
      }
      if (tombol.matches('[data-do-hide]')) {
        tutupMenu();
        sembunyikan(cardId);
      }
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
    const payload = {
      title: 'Feed Kader PB PII',
      text: String(card.isi || 'Kabar dari kader Pelajar Islam Indonesia').slice(0, 200),
      url: tautanKabar(card.id)
    };
    if (navigator.share) {
      try {
        await navigator.share(payload);
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    salinTautan(card.id, button);
  }

  function pilihTab(button) {
    /* Mengetuk tab yang sudah aktif berarti "segarkan", seperti aplikasi
       media sosial: tidak mengganti saringan, hanya memuat ulang. */
    if (button.classList.contains('is-active') && button.dataset.tab === state.tab) {
      loadFeed();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    tabsEl.querySelectorAll('button').forEach((node) => {
      const aktif = node === button;
      node.classList.toggle('is-active', aktif);
      node.setAttribute('aria-selected', aktif ? 'true' : 'false');
    });
    state.tab = button.dataset.tab;
    state.editing = '';
    state.open.clear();
    document.body.classList.remove('feed-thread-open');
    moreEl.hidden = true;
    if (sortNoteEl) sortNoteEl.hidden = state.tab !== 'untuk-anda';
    countEl.textContent = 'Memuat kabar…';
    listEl.innerHTML = '<div class="feed-skeleton" aria-hidden="true"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>';
    loadFeed();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ------------------------------------------------------------------ event */

  tabsEl?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (button) pilihTab(button);
  });

  listEl.addEventListener('click', async (event) => {
    const target = event.target;
    const tutupUtas = target.closest('[data-thread-close]');
    if (tutupUtas) {
      const panel = tutupUtas.closest('[data-thread-panel]');
      if (panel) closeThread(panel.dataset.threadPanel);
      return;
    }
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
    if (zoom) return ketukZoom(zoom);
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
  unhideEl?.addEventListener('click', tampilkanTersembunyi);

  /* Kabar berikutnya ditarik begitu ujung daftar terlihat, seperti gulir
     tanpa batas pada aplikasi media sosial; tombol tetap ada untuk yang
     menjalankan peramban tanpa IntersectionObserver. */
  if (moreEl && 'IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (moreEl.hidden || state.loading) return;
      loadFeed({ lebih: true });
    }, { rootMargin: '320px' }).observe(moreEl);
  }

  railOpenEl?.addEventListener('click', () => bukaRail(true));
  railCloseEl?.addEventListener('click', () => tutupRail());
  sideTutupEl?.addEventListener('click', () => tutupRail());

  let cariJeda = 0;
  searchEl?.addEventListener('input', () => {
    clearTimeout(cariJeda);
    const kata = searchEl.value.trim();
    if (kata.length < 2) {
      searchResultEl.hidden = true;
      searchResultEl.innerHTML = '';
      return;
    }
    cariJeda = setTimeout(() => cariKader(kata), 320);
  });

  sideEl?.addEventListener('click', (event) => {
    const follow = event.target.closest('[data-follow]');
    if (follow) toggleFollow(follow);
  });

  baruEl?.addEventListener('click', () => {
    baruEl.hidden = true;
    loadFeed();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') cekBaru();
  });
  window.addEventListener('focus', cekBaru);

  openComposerEl?.addEventListener('click', async () => {
    const account = await requireLogin('Masuk sebagai kader untuk menulis kabar di feed.');
    if (!account) return;
    composerEl.hidden = false;
    composerEl.classList.add('is-open');
    paintComposer();
    startRowEl.hidden = true;
    textEl.focus();
    if (activeKind() === 'acara') await muatEvent();
  });

  function tutupKomposer() {
    composerEl.classList.remove('is-open');
    composerEl.hidden = true;
    paintComposer();
  }

  startWriteEl?.addEventListener('click', () => openComposerEl?.click());
  fabEl?.addEventListener('click', () => openComposerEl?.click());
  composerCloseEl?.addEventListener('click', tutupKomposer);

  document.querySelector('#feedLoginOpen')?.addEventListener('click', async () => {
    await requireLogin('Masuk sebagai kader untuk memakai feed.');
  });

  /* Ajakan pada keadaan kosong selalu berujung pada tindakan yang benar-benar
     tersedia: pindah tab, atau membuka komposer dengan jenis yang sesuai. */
  kosongCtaEl?.addEventListener('click', () => {
    if (state.tab === 'mengikuti') {
      tabsEl?.querySelector('[data-tab="terbaru"]')?.click();
      return;
    }
    if (state.tab === 'acara') {
      kindsEl?.querySelectorAll('button').forEach((node) => node.classList.toggle('is-active', node.dataset.jenis === 'acara'));
      state.media = [];
      paintPreviews();
    }
    openComposerEl?.click();
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

  let galeri = [];
  let galeriIndex = 0;

  function paintLightbox() {
    const img = lightboxEl?.querySelector('img');
    if (!img || !galeri.length) return;
    img.src = galeri[galeriIndex];
    const banyak = galeri.length > 1;
    if (lightboxCountEl) {
      lightboxCountEl.textContent = banyak ? `${galeriIndex + 1}/${galeri.length}` : '';
      lightboxCountEl.hidden = !banyak;
    }
    if (lightboxPrevEl) lightboxPrevEl.hidden = !banyak;
    if (lightboxNextEl) lightboxNextEl.hidden = !banyak;
  }

  /* Satu kabar bisa memuat sampai empat foto; panah, geser, dan tombol papan
     tuts memindahkan penampil tanpa perlu menutupnya. */
  function bukaLightbox(url, shot) {
    const img = lightboxEl?.querySelector('img');
    if (!img) return;
    const kartu = shot?.closest('.feed-card');
    galeri = kartu
      ? [...kartu.querySelectorAll('[data-zoom]')].map((node) => node.dataset.zoom).filter(Boolean)
      : [];
    if (!galeri.length) galeri = [url];
    const posisi = galeri.indexOf(url);
    galeriIndex = posisi >= 0 ? posisi : 0;
    paintLightbox();
    lightboxEl.hidden = false;
    lightboxEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('feed-zoomed');
  }

  function geserLightbox(arah) {
    if (!lightboxEl || lightboxEl.hidden || galeri.length < 2) return;
    galeriIndex = (galeriIndex + arah + galeri.length) % galeri.length;
    paintLightbox();
  }

  function tutupLightbox() {
    if (!lightboxEl || lightboxEl.hidden) return;
    lightboxEl.hidden = true;
    lightboxEl.setAttribute('aria-hidden', 'true');
    lightboxEl.querySelector('img').removeAttribute('src');
    galeri = [];
    galeriIndex = 0;
    document.body.classList.remove('feed-zoomed');
  }

  /* Ketuk dua kali pada foto menyukai kabar, seperti X. Ketuk sekali tetap
     membuka penampil penuh, tetapi ditunda sebentar di perangkat sentuh agar
     ketukan kedua sempat terdeteksi. */
  const perangkatSentuh = () => window.matchMedia('(hover: none), (pointer: coarse)').matches;
  let jedaZoom = 0;
  let ketukZoomTerakhir = 0;
  let ketukZoomId = '';

  function ketukZoom(shot) {
    if (!perangkatSentuh()) {
      bukaLightbox(shot.dataset.zoom, shot);
      return;
    }
    const id = shot.closest('.feed-card')?.dataset.post || '';
    const sekarang = Date.now();
    if (sekarang - ketukZoomTerakhir < 330 && ketukZoomId === id) {
      clearTimeout(jedaZoom);
      ketukZoomTerakhir = 0;
      ketukZoomId = '';
      const card = cardData(id);
      const like = cardFor(id)?.querySelector('[data-like]');
      if (!card || !like) return;
      if (card.liked) denyut(like);
      else toggleLike(like);
      return;
    }
    ketukZoomTerakhir = sekarang;
    ketukZoomId = id;
    jedaZoom = setTimeout(() => {
      ketukZoomTerakhir = 0;
      ketukZoomId = '';
      bukaLightbox(shot.dataset.zoom, shot);
    }, 300);
  }

  lightboxEl?.addEventListener('click', (event) => {
    if (event.target.matches('#feedLightboxClose') || event.target === lightboxEl) {
      tutupLightbox();
      return;
    }
    if (event.target.closest('#feedLightboxPrev')) {
      geserLightbox(-1);
      return;
    }
    if (event.target.closest('#feedLightboxNext')) geserLightbox(1);
  });

  let sentuhAwalX = null;
  lightboxEl?.addEventListener('touchstart', (event) => {
    sentuhAwalX = event.touches[0]?.clientX ?? null;
  }, { passive: true });
  lightboxEl?.addEventListener('touchend', (event) => {
    if (sentuhAwalX === null) return;
    const jarak = (event.changedTouches[0]?.clientX ?? sentuhAwalX) - sentuhAwalX;
    sentuhAwalX = null;
    if (Math.abs(jarak) > 46) geserLightbox(jarak < 0 ? 1 : -1);
  }, { passive: true });

  document.addEventListener('keydown', (event) => {
    if (!lightboxEl?.hidden) {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        geserLightbox(-1);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        geserLightbox(1);
        return;
      }
    }
    if (event.key !== 'Escape') return;
    if (!lightboxEl?.hidden) {
      tutupLightbox();
      return;
    }
    if (state.open.size) {
      [...state.open].forEach((id) => closeThread(id));
      return;
    }
    if (sideEl?.classList.contains('is-open')) {
      tutupRail();
      return;
    }
    if (composerEl.classList.contains('is-open')) {
      tutupKomposer();
      return;
    }
    tutupMenu();
  });

  window.PBPIIAkun?.onChange?.(() => {
    paintComposer();
    muatSisi();
    /* Kemampuan menulis dilaporkan server beserta isinya, jadi identitas yang
       baru selesai diverifikasi butuh muat ulang, bukan sekadar cat ulang komposer. */
    if (tokenSaya() !== state.tokenMuat) loadFeed();
    if (composerEl.classList.contains('is-open')) composerEl.hidden = false;
  });

  /* ------------------------------------------------------------------ mulai */

  /* Tab lengket berhenti tepat di bawah kepala halaman. Tingginya diukur
     karena perangkat berponi menambah safe-area di atas 68px. */
  function ukurKepala() {
    const kepala = document.querySelector('.site-header');
    const tampil = kepala && getComputedStyle(kepala).display !== 'none';
    const tinggi = tampil ? Math.round(kepala.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--feed-head-h', `${tinggi}px`);
  }
  ukurKepala();
  window.addEventListener('resize', ukurKepala);

  simpanTersembunyi();

  const cache = cachedFeed();
  if (cache?.items?.length) {
    state.items = cache.items.filter((card) => !hidden.has(String(card.id)));
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
  muatSisi();
})();
