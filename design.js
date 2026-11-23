/**
 * PB PII — poles ringan tanpa pustaka tambahan.
 *
 * Tugasnya hanya tiga: membuka elemen saat masuk pandangan, memberi tanda
 * pemuatan pada placeholder teks, dan memastikan gambar di luar lipatan atas
 * dimuat malas. Semua fungsi diam bila pengguna meminta pengurangan gerak.
 */
(() => {
  'use strict';

  const kurangGerak = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const PILIHAN = [
    'main > section',
    '.hero-copy',
    '.hero-mark',
    '.stats',
    '.greeting-photo',
    '.greeting-copy',
    '.section-heading',
    '.pillar-card',
    '.article-card',
    '.acara-card',
    '.gallery-item',
    '.app-sapa',
    '.app-card',
    '.panel',
    '.stat',
    'footer > *'
  ].join(',');

  function siap(callback) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
  }

  function reveal(node) {
    if (!node || node.dataset.revealBound) return;
    node.dataset.revealBound = '1';
    node.dataset.reveal = '';
    node.classList.add('is-revealed');
  }

  function siapUntukReveal(root) {
    const kandidat = [];
    if (root && root.matches && root.matches(PILIHAN)) kandidat.push(root);
    if (root && root.querySelectorAll) kandidat.push(...root.querySelectorAll(PILIHAN));

    kandidat.forEach((node, index) => {
      if (node.dataset.revealBound) return;
      node.dataset.revealBound = '1';
      node.style.setProperty('--pii-delay', Math.min(index % 5, 4) * 65 + 'ms');
      node.dataset.reveal = '';
      observer ? observer.observe(node) : node.classList.add('is-revealed');
    });
  }

  let observer = null;

  function pasangObserver() {
    if (kurangGerak || !('IntersectionObserver' in window)) return;
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });

    // Pengamat bisa gagal memberi tahu (tab latar, penyemak lama). Buka semua
    // setelah batas waktu supaya konten tidak pernah terjebak transparan.
    window.setTimeout(() => {
      document.querySelectorAll('[data-reveal]:not(.is-revealed)').forEach((node) => node.classList.add('is-revealed'));
    }, 2200);
  }

  function skeleton(root) {
    const cari = root && root.matches
      ? (selector) => [root, ...root.querySelectorAll(selector)]
      : (selector) => [...document.querySelectorAll(selector)];

    cari('p.muted, .app-kosong, .empty').forEach((node) => {
      if (/^memuat/i.test(String(node.textContent || '').trim())) node.classList.add('is-skeleton');
    });

    const strip = document.getElementById('dataStrip');
    if (strip && /^—$/.test(String(strip.querySelector('strong')?.textContent || '').trim())) {
      strip.classList.add('is-loading');
    }
  }

  function gambarMalas() {
    document.querySelectorAll('img:not([loading])').forEach((img) => {
      if (img.closest('.hero') || img.closest('.greeting-photo')) return;
      img.loading = 'lazy';
    });
    document.querySelectorAll('img').forEach((img) => {
      if (!img.decoding) img.decoding = 'async';
    });
  }

  function amankanPesan() {
    document.querySelectorAll('.message, .sso-msg, .kader-notice').forEach((node) => {
      if (!node.hasAttribute('role')) node.setAttribute('role', 'status');
      if (!node.hasAttribute('aria-live')) node.setAttribute('aria-live', 'polite');
    });
  }

  siap(() => {
    amankanPesan();
    gambarMalas();
    skeleton(document);

    if (!kurangGerak) {
      pasangObserver();
      siapUntukReveal(document.body);

      if ('MutationObserver' in window) {
        const antrean = new MutationObserver((mutations) => {
          let adaBaru = false;
          mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === 1 && node.matches && node.matches(PILIHAN)) adaBaru = true;
              if (node.nodeType === 1 && node.querySelectorAll && node.querySelectorAll(PILIHAN).length) adaBaru = true;
            });
          });
          if (!adaBaru) return;
          antrean.disconnect();
          siapUntukReveal(document.body);
          skeleton(document);
          gambarMalas();
          antrean.observe(document.body, { childList: true, subtree: true });
        });
        antrean.observe(document.body, { childList: true, subtree: true });
      }
    }
  });
})();
