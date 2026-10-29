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
})();
