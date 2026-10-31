const API = window.PBPII_CONFIG?.apiEndpoint || '/api/pii';
// Relative so the same value works over http(s) and when the page is opened with file:
const LOGO_URL = 'assets/logo-pii.png';
const $ = (selector) => document.querySelector(selector);

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function formatLines(value = '') {
  return escapeHTML(value).replace(/\n/g, '<br>');
}

function safeImageUrl(value) {
  const url = String(value || '').trim();
  return /^https:\/\//i.test(url) ? escapeHTML(url) : LOGO_URL;
}

function renderFooterLinks(settings) {
  const links = [];
  const email = String(settings.contactEmail || '').trim();

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    links.push(`<a href="mailto:${escapeHTML(email)}">${escapeHTML(email)}</a>`);
  }

  [
    ['instagramUrl', 'Instagram'],
    ['youtubeUrl', 'YouTube']
  ].forEach(([key, label]) => {
    const url = String(settings[key] || '').trim();
    if (/^https:\/\//i.test(url)) {
      links.push(`<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`);
    }
  });

  $('#footerLinks').innerHTML = links.join('');
}

async function callApi(action) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action })
  });

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Server mengirim respons yang tidak valid.');
  }

  if (!response.ok || !result.ok) {
    throw new Error(result.error || 'Konten website gagal dimuat.');
  }

  return result.data;
}

function renderArticle(article, index) {
  const title = escapeHTML(article.title);
  const cover = article.coverImage
    ? `<img class="article-cover" src="${safeImageUrl(article.coverImage)}" alt="${title}" loading="lazy" onerror="this.onerror=null;this.src='${LOGO_URL}'">`
    : `<div class="article-cover placeholder-cover"><img src="${LOGO_URL}" alt=""></div>`;
  const date = article.createdAt
    ? new Date(article.createdAt).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
    : '';

  return `
    <article class="article-card">
      ${cover}
      <div class="article-body">
        <div class="article-meta">
          <span>${escapeHTML(article.category || 'Berita')}</span>
          <span>${escapeHTML(date)}</span>
        </div>
        <h3>${title}</h3>
        <p>${escapeHTML(article.excerpt || 'Baca kabar dan gagasan terbaru dari Pelajar Islam Indonesia.')}</p>
        <button class="button button-ghost article-open" type="button" data-index="${index}">
          Baca selengkapnya <span aria-hidden="true">↗</span>
        </button>
      </div>
    </article>`;
}

/* ------------------------------------------------------ pembaca layar penuh */

let publishedArticles = [];

function articleParagraphs(content) {
  return String(content || '')
    .split(/\n{2,}|\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${formatLines(paragraph)}</p>`)
    .join('');
}

function readerDialog() {
  let dialog = document.querySelector('#articleReader');
  if (dialog) return dialog;

  dialog = document.createElement('dialog');
  dialog.id = 'articleReader';
  dialog.className = 'article-reader';
  dialog.innerHTML = `
    <div class="reader-shell">
      <header class="reader-bar">
        <button class="reader-close" type="button" aria-label="Tutup artikel">✕ Tutup</button>
        <button class="reader-expand" type="button" aria-pressed="false">⤢ Layar penuh</button>
      </header>
      <div class="reader-scroll"></div>
    </div>`;
  document.body.appendChild(dialog);

  // Sebagian WebView (Electron) tidak memasang event "open"/"close" pada <dialog>,
  // jadi status buka selalu diselesaikan sendiri, bukan menunggu event.
  const shutdown = () => {
    if (dialog.open) dialog.close();
    document.body.classList.remove('is-locked');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };

  dialog.querySelector('.reader-close').addEventListener('click', shutdown);
  const expand = dialog.querySelector('.reader-expand');
  // Elemen <dialog> tidak boleh dijadikan target fullscreen, jadi yang diperbesar
  // adalah dokumen; dialog tetap tampil karena berada di top layer.
  if (!document.documentElement.requestFullscreen) expand.hidden = true;
  expand.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    document.documentElement.requestFullscreen().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    const on = Boolean(document.fullscreenElement);
    expand.textContent = on ? '⤡ Keluar layar penuh' : '⤢ Layar penuh';
    expand.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  // Clicking the dimmed edge closes the reader, the way a modal is expected to.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) shutdown();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      shutdown();
    }
  });
  return dialog;
}

function openReader(index) {
  const article = publishedArticles[index];
  if (!article) return;
  const dialog = readerDialog();
  const date = article.createdAt
    ? new Date(article.createdAt).toLocaleDateString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    })
    : '';

  const scroll = dialog.querySelector('.reader-scroll');
  scroll.innerHTML = `
    ${article.coverImage
      ? `<img class="reader-cover" src="${safeImageUrl(article.coverImage)}" alt="${escapeHTML(article.title)}">`
      : ''}
    <div class="reader-article">
      <div class="article-meta">
        <span>${escapeHTML(article.category || 'Berita')}</span>
        <span>${escapeHTML(date)}</span>
      </div>
      <h2>${escapeHTML(article.title)}</h2>
      ${article.excerpt ? `<p class="reader-lead">${escapeHTML(article.excerpt)}</p>` : ''}
      ${articleParagraphs(article.content || article.excerpt || '')}
      <p class="reader-byline">${escapeHTML(article.author || 'Redaksi PB PII')}</p>
    </div>`;
  if (dialog.open) dialog.close();
  dialog.showModal();
  document.body.classList.add('is-locked');
  scroll.scrollTop = 0;
}

function bindArticleReader() {
  document.querySelectorAll('.article-open').forEach((button) => {
    button.addEventListener('click', () => openReader(Number(button.dataset.index)));
  });
}


function showLoadError(title, description) {
  $('#articles').innerHTML = `
    <div class="empty-state">
      <h3>${escapeHTML(title)}</h3>
      <p>${escapeHTML(description)}</p>
    </div>`;
  $('#gallery').innerHTML = `
    <div class="empty-state">
      <h3>Galeri belum tersedia</h3>
      <p>${escapeHTML(description)}</p>
    </div>`;
}

async function loadDataStrip() {
  const note = $('#dataStripNote');
  const sources = [
    ['schools', '/api/sekolah', (body) => body?.data],
    ['volcanoes', '/api/volcanoes', (body) => (Array.isArray(body) ? body : body?.data)],
    ['hospitals', '/api/indonesia/hospitals', (body) => body?.data],
    ['transjakarta', '/api/indonesia/transjakarta', (body) => body?.data]
  ];
  const targets = sources
    .map(([key, url, pickRows]) => ({ key, url, pickRows, cell: document.querySelector(`[data-stat="${key}"]`) }))
    .filter((target) => target.cell);
  if (!targets.length) return;

  let answered = 0;

  await Promise.all(targets.map(async ({ url, pickRows, cell }) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
      const body = await response.json().catch(() => null);
      const rows = pickRows(body);
      if (!response.ok || !Array.isArray(rows) || !rows.length) {
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      cell.querySelector('strong').textContent = rows.length.toLocaleString('id-ID');
      answered += 1;
    } catch {
      // A missing key or an offline upstream must not look like a real zero.
      cell.classList.add('is-muted');
      cell.querySelector('strong').textContent = '—';
    }
  }));

  if (!note) return;
  const time = new Date().toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta'
  });
  note.textContent = answered === targets.length
    ? `Diperbarui ${time} WIB dari ${answered} sumber data publik.`
    : `${answered} dari ${targets.length} sumber data aktif per ${time} WIB; sisanya belum dapat dihubungi.`;
}

function renderEventTeaser(events) {
  const host = $('#events');
  if (!host) return;
  const rows = (Array.isArray(events) ? events : [])
    .filter((event) => event.upcoming)
    .slice(0, 3);

  if (!rows.length) {
    host.innerHTML = `<div class="empty-state"><h3>Belum ada agenda yang tampil di sini</h3><p>Umpan kegiatan diisi otomatis ketika pengurus PW, PD, atau PK menerbitkan acara di dashboard lembaga.</p></div>`;
    return;
  }

  host.innerHTML = rows.map((event) => {
    const form = event.form;
    const open = form && form.status === 'open';
    const cta = open
      ? `<a class="button button-solid acara-cta" href="${escapeHTML(form.url)}">Daftar</a>`
      : form
        ? `<a class="button button-ghost acara-cta" href="${escapeHTML(form.url)}">Formulir ditutup</a>`
        : '<span class="acara-nofom">Pendaftaran lewat panitia</span>';
    const day = String(event.date || '').slice(8, 10);
    const month = new Date(`${String(event.date || '').slice(0, 10)}T00:00:00`)
      .toLocaleDateString('id-ID', { month: 'short' });

    return `
      <article class="acara-card">
        <div class="acara-cover">
          <img src="${safeImageUrl(event.coverImage)}" alt="${escapeHTML(event.title)}" loading="lazy" onerror="this.onerror=null;this.src='${LOGO_URL}'">
          <span class="acara-date"><b>${escapeHTML(day)}</b><small>${escapeHTML(month)}</small></span>
        </div>
        <div class="acara-body">
          <div class="acara-meta">
            <span>${escapeHTML(event.category || 'Kegiatan')}</span>
            <span class="acara-jenjang">${escapeHTML(event.host?.jenjangLabel || event.host?.name || 'PII')}</span>
          </div>
          <h3>${escapeHTML(event.title)}</h3>
          ${event.location ? `<p class="acara-where">${escapeHTML(event.location)}</p>` : ''}
          <div class="acara-actions">${cta}</div>
        </div>
      </article>`;
  }).join('');
}

async function init() {
  $('#year').textContent = new Date().getFullYear();

  if (location.protocol === 'file:') {
    showLoadError(
      'Mode pratinjau lokal',
      'Konten dimuat melalui layanan data, jadi halaman ini perlu dibuka lewat alamat website, bukan berkas langsung.'
    );
    return;
  }

  loadDataStrip();

  try {
    const data = await callApi('public');
    const settings = data.settings || {};

    [
      ['#siteName', 'siteName'],
      ['#footerSiteName', 'siteName'],
      ['#siteTagline', 'tagline'],
      ['#footerTagline', 'tagline'],
      ['#heroTitle', 'heroTitle'],
      ['#heroText', 'heroText'],
      ['#chairmanName', 'chairmanName'],
      ['#chairmanRole', 'chairmanRole'],
      ['#aboutText', 'aboutText'],
      ['#footerText', 'footerText']
    ].forEach(([selector, key]) => {
      if (settings[key]) $(selector).textContent = settings[key];
    });
    const siteName = String(settings.siteName || '').trim();
    if (siteName) {
      const tagline = String(settings.tagline || '').trim();
      document.title = tagline && tagline !== siteName ? `${siteName} | ${tagline}` : siteName;
    }
    renderFooterLinks(settings);

    if (settings.chairmanGreetingVisible === 'false') {
      $('#sambutan').classList.add('hidden');
    } else {
      $('#chairmanGreeting').innerHTML = formatLines(settings.chairmanGreeting || '');
    }

    $('#chairPhoto').src = settings.chairmanPhoto
      ? safeImageUrl(settings.chairmanPhoto)
      : LOGO_URL;

    const articles = Array.isArray(data.articles) ? data.articles.slice(0, 6) : [];
    publishedArticles = articles;
    $('#articles').innerHTML = articles.length
      ? articles.map(renderArticle).join('')
      : `<div class="empty-state"><h3>Artikel segera hadir</h3><p>Ruang ini akan memuat berita, opini, dan kabar kegiatan PB PII.</p></div>`;
    bindArticleReader();

    const gallery = Array.isArray(data.gallery) ? data.gallery : [];
    $('#gallery').innerHTML = gallery.length
      ? gallery.map((item) => `
        <figure class="gallery-item">
          <img src="${safeImageUrl(item.imageUrl)}" alt="${escapeHTML(item.title)}" loading="lazy">
          <figcaption>
            <b>${escapeHTML(item.title)}</b>
            ${item.caption ? `<span>${escapeHTML(item.caption)}</span>` : ''}
          </figcaption>
        </figure>`).join('')
      : `<div class="empty-state"><h3>Galeri kegiatan</h3><p>Foto pilihan akan ditampilkan di sini oleh admin PB PII.</p></div>`;

    renderEventTeaser(data.events);
  } catch (error) {
    showLoadError(
      'Konten belum tersedia',
      'Berita dan galeri akan tampil otomatis begitu kontennya diterbitkan. Coba muat ulang beberapa saat lagi.'
    );
    console.error(error);
  }
}

document.addEventListener('DOMContentLoaded', init);
