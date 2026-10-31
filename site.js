/**
 * Shared shell behaviour for every page: service worker, install prompt and
 * standalone detection. Kept outside app.js because the Ibadah, Peta, login
 * and admin pages do not load app.js.
 */
(() => {
  'use strict';

  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  if (standalone) document.documentElement.classList.add('is-standalone');

  document.querySelectorAll('nav a[href]').forEach((link) => {
    const url = new URL(link.getAttribute('href'), location.href);
    if (!url.hash && url.pathname === location.pathname && !link.hasAttribute('aria-current')) {
      link.setAttribute('aria-current', 'page');
    }
  });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
        console.warn('Service worker gagal dipasang.', error);
      });
    });
  }

  initNavSheet();
  initReveal();
  initScrollProgress();

  /**
   * Bagian halaman muncul saat pertama kali masuk viewport. Kelas .reveal baru
   * ditempel kalau pengamatnya ada, jadi konten tidak pernah tertahan tak terlihat.
   */
  function initReveal() {
    if (!('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const nodes = document.querySelectorAll(
      '.section, .greeting-section, .pillar-card, .article-card, .gallery-item, .teaser-card, .data-stat'
    );
    if (!nodes.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });

    nodes.forEach((node, index) => {
      node.classList.add('reveal');
      node.style.transitionDelay = `${Math.min(index, 6) * 45}ms`;
      observer.observe(node);
    });
  }

  /** Garis tipis di ujung atas yang menunjukkan sejauh mana halaman dibaca. */
  function initScrollProgress() {
    if (document.body.classList.contains('tanya-page')) return;
    const bar = document.createElement('div');
    bar.className = 'scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.append(bar);

    const paint = () => {
      const doc = document.documentElement;
      const rest = doc.scrollHeight - window.innerHeight;
      const ratio = rest > 40 ? Math.min(1, Math.max(0, window.scrollY / rest)) : 0;
      bar.style.setProperty('--progress', `${(ratio * 100).toFixed(1)}%`);
      bar.style.opacity = ratio > 0.005 ? '1' : '0';
    };

    window.addEventListener('scroll', paint, { passive: true });
    window.addEventListener('resize', paint);
    paint();
  }

  const button = document.getElementById('installApp');
  let installPrompt = null;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    if (button) button.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    if (button) button.hidden = true;
  });

  if (!button) return;

  button.addEventListener('click', async () => {
    if (!installPrompt) {
      button.hidden = true;
      return;
    }
    installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    button.hidden = choice?.outcome === 'accepted';
  });

  /**
   * Bar bawah hanya menampung empat menu utama; sisanya masuk ke sheet "Lainnya".
   * Sheet ditutup lewat backdrop, Esc, atau saat salah satu tautannya dipakai,
   * supaya perilakunya sama dengan drawer aplikasi ponsel.
   */
  function initNavSheet() {
    const toggle = document.getElementById('navMore');
    const sheet = document.getElementById('navMoreSheet');
    if (!toggle || !sheet) return;

    const isOpen = () => sheet.classList.contains('is-open');

    const setOpen = (open) => {
      sheet.classList.toggle('is-open', open);
      sheet.setAttribute('aria-hidden', open ? 'false' : 'true');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.classList.toggle('is-open', open);
    };

    toggle.addEventListener('click', () => setOpen(!isOpen()));
    sheet.querySelector('.nav-sheet-backdrop')?.addEventListener('click', () => setOpen(false));
    sheet.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen()) {
        setOpen(false);
        toggle.focus();
      }
    });
    // Layar lebar menampilkan semua menu inline, jadi sheet tidak pernah menggantung.
    window.matchMedia('(min-width: 681px)').addEventListener('change', (event) => {
      if (event.matches && isOpen()) setOpen(false);
    });
  }
})();
