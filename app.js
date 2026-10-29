const API = window.PBPII_CONFIG?.apiEndpoint || '/api/pii';
const LOGO_URL = location.protocol === 'file:'
  ? 'public/assets/logo-pii.png'
  : '/assets/logo-pii.png';
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

function renderArticle(article) {
  const title = escapeHTML(article.title);
  const cover = article.coverImage
    ? `<img class="article-cover" src="${safeImageUrl(article.coverImage)}" alt="${title}" loading="lazy">`
    : `<div class="article-cover placeholder-cover"><img src="${LOGO_URL}" alt="" onerror="this.onerror=null;this.src='public/assets/logo-pii.png'"></div>`;
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
        <details>
          <summary>Baca artikel</summary>
          <div class="article-full">${formatLines(article.content || article.excerpt || '')}</div>
        </details>
      </div>
    </article>`;
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

async function init() {
  $('#year').textContent = new Date().getFullYear();

  if (location.protocol === 'file:') {
    showLoadError(
      'Mode pratinjau lokal',
      'Jalankan proyek dengan Vercel CLI (vercel dev) untuk memuat artikel dan galeri dari backend.'
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

    const articles = Array.isArray(data.articles) ? data.articles : [];
    $('#articles').innerHTML = articles.length
      ? articles.slice(0, 6).map(renderArticle).join('')
      : `<div class="empty-state"><h3>Artikel segera hadir</h3><p>Ruang ini akan memuat berita, opini, dan kabar kegiatan PB PII.</p></div>`;

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
  } catch (error) {
    showLoadError(
      'Konten belum tersedia',
      'Periksa koneksi backend Apps Script dan muat ulang halaman.'
    );
    console.error(error);
  }
}

document.addEventListener('DOMContentLoaded', init);
