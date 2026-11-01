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
let activeArticleSlug = '';
let originalArticleMetadata = null;

function articleParagraphs(content) {
  return String(content || '')
    .split(/\n{2,}|\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${formatLines(paragraph)}</p>`)
    .join('');
}

function articleContentHtml(content) {
  const raw = String(content || '');
  if (!/<\s*[a-z/][^>]*>/i.test(raw)) return articleParagraphs(raw);

  const parsed = new DOMParser().parseFromString(raw, 'text/html');
  const allowed = new Set(['p','div','br','hr','h2','h3','h4','strong','b','em','i','u','s','del','ul','ol','li','blockquote','a','img','span','font']);
  const blocked = new Set(['script','style','iframe','object','svg','math','template']);
  const voids = new Set(['br','hr','img']);
  const safeHref = (value) => {
    const href = String(value || '').trim();
    if (/^https:\/\/[^\s]+$/i.test(href) || /^mailto:[^\s@]+@[^\s@]+$/i.test(href)) return href;
    return /^(?:\/(?!\/)|#|\.\/|\.\.\/)[^\s]*$/.test(href) && !/[\\\u0000-\u001f]/.test(href) ? href : '';
  };
  const copy = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
    const sourceTag = node.tagName.toLowerCase();
    if (blocked.has(sourceTag)) return document.createDocumentFragment();
    const tag = sourceTag === 'font' ? 'span' : sourceTag;
    if (!allowed.has(sourceTag)) {
      const fragment = document.createDocumentFragment();
      node.childNodes.forEach((child) => fragment.append(copy(child)));
      return fragment;
    }

    const element = document.createElement(tag);
    if (tag === 'a') {
      const href = safeHref(node.getAttribute('href'));
      if (href) {
        element.setAttribute('href', href);
        element.setAttribute('rel', 'noopener noreferrer');
        if (/^https:\/\//i.test(href)) element.setAttribute('target', '_blank');
      }
    } else if (tag === 'img') {
      const src = String(node.getAttribute('src') || '').trim();
      if (!/^https:\/\/[^\s]+$/i.test(src)) return document.createDocumentFragment();
      element.setAttribute('src', src);
      element.setAttribute('alt', String(node.getAttribute('alt') || '').slice(0, 300));
      element.setAttribute('loading', 'lazy');
      return element;
    } else if (tag === 'span') {
      const size = sourceTag === 'font'
        ? (['1','2'].includes(node.getAttribute('size')) ? 'small' : ['4','5','6','7'].includes(node.getAttribute('size')) ? 'large' : '')
        : node.getAttribute('data-size');
      const font = sourceTag === 'font'
        ? (/georgia|times|serif/i.test(node.getAttribute('face') || '') ? 'serif' : /arial|sans/i.test(node.getAttribute('face') || '') ? 'sans' : '')
        : node.getAttribute('data-font');
      if (['small','normal','large'].includes(size)) element.dataset.size = size;
      if (['serif','sans'].includes(font)) element.dataset.font = font;
    }
    if (!voids.has(tag)) node.childNodes.forEach((child) => element.append(copy(child)));
    return element;
  };
  const output = document.createElement('div');
  parsed.body.childNodes.forEach((node) => output.append(copy(node)));
  return output.innerHTML;
}

function setArticleMetadata(article) {
  const selectors = [
    ['description', 'name'],
    ['keywords', 'name'],
    ['og:title', 'property'],
    ['og:description', 'property'],
    ['og:image', 'property']
  ];
  if (!originalArticleMetadata) {
    originalArticleMetadata = {
      title: document.title,
      elements: selectors.map(([value, attribute]) => {
        const selector = `meta[${attribute}="${value}"]`;
        const element = document.querySelector(selector);
        return { selector, element, content: element?.getAttribute('content') || '' };
      }),
      canonical: document.querySelector('link[rel="canonical"]'),
      canonicalHref: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || ''
    };
  }
  const title = String(article.seoTitle || article.title || 'Artikel PB PII');
  const description = String(article.seoDescription || article.excerpt || '')
    .replace(/\s+/g, ' ').trim().slice(0, 180);
  document.title = `${title} | PB PII`;
  const values = {
    description,
    keywords: String(article.seoKeywords || '').slice(0, 300),
    'og:title': title,
    'og:description': description,
    'og:image': /^https:\/\//i.test(String(article.coverImage || '')) ? String(article.coverImage) : ''
  };
  selectors.forEach(([key, attribute]) => {
    let element = document.querySelector(`meta[${attribute}="${key}"]`);
    if (!element) {
      element = document.createElement('meta');
      element.setAttribute(attribute, key);
      document.head.appendChild(element);
    }
    element.setAttribute('content', values[key]);
  });
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  const url = new URL(location.href);
  url.searchParams.set('artikel', String(article.slug || ''));
  canonical.href = url.href;
}

function restoreArticleMetadata() {
  if (!originalArticleMetadata) return;
  document.title = originalArticleMetadata.title;
  originalArticleMetadata.elements.forEach(({ selector, element, content }) => {
    const current = document.querySelector(selector);
    if (element) element.setAttribute('content', content);
    else current?.remove();
  });
  const canonical = document.querySelector('link[rel="canonical"]');
  if (originalArticleMetadata.canonical) {
    originalArticleMetadata.canonical.setAttribute('href', originalArticleMetadata.canonicalHref);
  } else canonical?.remove();
  originalArticleMetadata = null;
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
    restoreArticleMetadata();
    const url = new URL(location.href);
    if (url.searchParams.get('artikel') === activeArticleSlug
      || history.state?.pbpiiArticle === activeArticleSlug) {
      url.searchParams.delete('artikel');
      const state = { ...(history.state || {}) };
      delete state.pbpiiArticle;
      history.replaceState(state, '', url);
    }
    activeArticleSlug = '';
  };
  dialog.closeArticleReader = shutdown;

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

function openReader(index, directLink = false) {
  const article = publishedArticles[index];
  if (!article) return;
  const dialog = readerDialog();
  const slug = String(article.slug || '');
  activeArticleSlug = slug;
  if (slug) {
    const url = new URL(location.href);
    url.searchParams.set('artikel', slug);
    history[directLink ? 'replaceState' : 'pushState'](
      { ...(history.state || {}), pbpiiArticle: slug },
      '',
      url
    );
    setArticleMetadata(article);
  }
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
      ${articleContentHtml(article.content || article.excerpt || '')}
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

window.addEventListener('popstate', () => {
  document.querySelector('#articleReader')?.closeArticleReader?.();
});

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

    const articles = Array.isArray(data.articles) ? data.articles : [];
    publishedArticles = articles;
    $('#articles').innerHTML = articles.length
      ? articles.slice(0, 6).map((article, index) => renderArticle(article, index)).join('')
      : `<div class="empty-state"><h3>Artikel segera hadir</h3><p>Ruang ini akan memuat berita, opini, dan kabar kegiatan PB PII.</p></div>`;
    bindArticleReader();
    const requestedArticle = new URLSearchParams(location.search).get('artikel');
    const requestedIndex = requestedArticle
      ? publishedArticles.findIndex((article) => String(article.slug || '') === requestedArticle)
      : -1;
    if (requestedIndex >= 0) openReader(requestedIndex, true);

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
