/**
 * Akun & hak akses — dimuat di semua halaman publik (beranda, acara, ibadah,
 * tanya, peta, formulir, daftar).
 *
 * Kader masuk lewat Google; browser hanya menyerahkan ID token, server yang
 * memverifikasinya. Peran hasil /api/pii action "whoami" dipakai untuk
 * menyembunyikan tautan dashboard dan PII Global View dari yang bukan pengurus.
 * Token disimpan di localStorage sehingga tidak perlu login ulang tiap buka.
 */
(() => {
  'use strict';

  const API = window.PBPII_CONFIG?.apiEndpoint || '/api/pii';
  const TOKEN_KEY = 'pbpii_kader_token';
  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  const listeners = new Set();

  let account = { role: 'tamu', name: '' };
  let clientId = '';
  let gsiPromise = null;
  let panelOpen = false;

  const token = () => localStorage.getItem(TOKEN_KEY) || '';

  async function api(body) {
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => null);
    if (!result || !result.ok) {
      const error = new Error(result?.error || 'Layanan akun PB PII belum dapat dihubungi.');
      error.code = String(result?.code || '');
      error.retryAfter = Number(result?.retryAfter) || 0;
      throw error;
    }
    return result.data;
  }

  function emit() {
    listeners.forEach((callback) => {
      try { callback(account); } catch (error) { console.warn('Pemantau akun gagal.', error); }
    });
  }

  function onChange(callback) {
    listeners.add(callback);
    callback(account);
    return () => listeners.delete(callback);
  }

  async function refresh() {
    const stored = token();
    if (!stored) {
      account = { role: 'tamu', name: '' };
      emit();
      return account;
    }
    try {
      const who = await api({ action: 'whoami', token: stored });
      if (who.role === 'tamu') localStorage.removeItem(TOKEN_KEY);
      account = { ...who, token: who.role === 'tamu' ? '' : stored };
    } catch (error) {
      // Server belum versi baru: jangan paksa pengunjung login berulang kali.
      console.warn('Cek akun gagal:', error.message);
      account = { role: 'tamu', name: '', unknown: true };
    }
    emit();
    return account;
  }

  /** Sesi untuk Tanya PII: kader dari localStorage, pengurus/admin dari sesi login. */
  function sessionToken() {
    const kader = token();
    if (kader) return kader;
    return sessionStorage.getItem('pbpii_admin_token') || sessionStorage.getItem('pbpii_org_token') || '';
  }

  async function signIn(idToken) {
    const data = await api({ action: 'kaderLogin', idToken });
    localStorage.setItem(TOKEN_KEY, data.token);
    account = { role: 'kader', id: data.kader.id, name: data.kader.name, picture: data.kader.picture, token: data.token };
    emit();
    closePanel();
    return account;
  }

  function signOut() {
    localStorage.removeItem(TOKEN_KEY);
    account = { role: 'tamu', name: '' };
    if (window.google?.accounts?.id) window.google.accounts.id.disableAutoSelect();
    emit();
  }

  function loadGis() {
    if (gsiPromise) return gsiPromise;
    gsiPromise = new Promise((resolve, reject) => {
      if (window.google?.accounts?.id) return resolve(window.google.accounts.id);
      const script = document.createElement('script');
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(window.google?.accounts?.id || null);
      script.onerror = () => reject(new Error('Tombol Google tidak dapat dimuat. Periksa koneksi lalu muat ulang.'));
      document.head.append(script);
    });
    return gsiPromise;
  }

  /** Tombol standar Google Identity Services, dirender ke dalam panel login. */
  async function renderGoogleButton(host) {
    if (!clientId) {
      host.hidden = true;
      return;
    }
    try {
      const gsi = await loadGis();
      if (!gsi) throw new Error('gsi');
      gsi.initialize({
        client_id: clientId,
        ux_mode: 'popup',
        callback: (response) => {
          signIn(response.credential).catch((error) => {
            setNotice(host, error.message);
          });
        }
      });
      host.replaceChildren();
      gsi.renderButton(host, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', logo_alignment: 'left' });
    } catch (error) {
      host.innerHTML = `<p class="kader-hint">${escapeHTML(error.message || 'Tombol Google gagal dimuat. Muat ulang halaman lalu coba lagi.')}</p>`;
    }
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function setNotice(host, message) {
    const box = document.querySelector('.kader-notice');
    if (!box) return;
    box.textContent = message || '';
    box.hidden = !message;
  }

  function buildPanel() {
    if (document.querySelector('.kader-dialog')) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'kader-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="kader-card">
        <button class="kader-close" type="button" aria-label="Tutup">×</button>
        <img class="kader-mark" src="/assets/logo-pii.png" alt="" onerror="this.onerror=null;this.src='assets/logo-pii.png'">
        <h2>Masuk sebagai kader</h2>
        <p>Akun Google dipakai untuk menyukai dan mengomentari acara serta memakai Tanya PII. Data pengurus dan PII Global View tetap tertutup untuk akun kader.</p>
        <div class="kader-google" data-google-slot></div>
        <p class="kader-notice" hidden></p>
        <p class="kader-fine">Dengan masuk, Anda bersedia menampilkan nama pada komentar acara PB PII.</p>
      </form>`;
    document.body.append(dialog);

    dialog.querySelector('.kader-close').addEventListener('click', closePanel);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closePanel();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && panelOpen) closePanel();
    });
  }

  function openPanel(notice) {
    buildPanel();
    const dialog = document.querySelector('.kader-dialog');
    panelOpen = true;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    document.body.classList.add('has-kader-dialog');
    setNotice(dialog.querySelector('[data-google-slot]'), notice);
    renderGoogleButton(dialog.querySelector('[data-google-slot]'));
  }

  function closePanel() {
    panelOpen = false;
    const dialog = document.querySelector('.kader-dialog');
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    document.body.classList.remove('has-kader-dialog');
  }

  /** Dipakai tombol suka/komentar: kembalikan akun, atau buka login dulu. */
  async function requireAccount(notice) {
    if (account.role === 'kader' || account.role === 'org' || account.role === 'admin') return account;
    openPanel(notice);
    return new Promise((resolve) => {
      const stop = onChange((current) => {
        if (current.role === 'tamu') return;
        stop();
        resolve(current);
      });
    });
  }

  function paintChip() {
    const slots = document.querySelectorAll('[data-account]');
    if (!slots.length) return;
    const isStaff = account.role === 'admin' || account.role === 'org';
    slots.forEach((slot) => {
      if (account.role === 'tamu') {
        // Tanpa Client ID, masuk kader belum dapat ditawarkan; slot dibiarkan
        // kosong supaya pengunjung tidak menemukan jalan buntu di halaman.
        slot.innerHTML = clientId ? `<button class="account-button is-guest" type="button" data-account-open>
          <span class="account-avatar" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="8.4" r="3.4"/><path d="M5.4 19.2c.6-3.2 2.8-5.1 6.6-5.1s6 1.9 6.6 5.1"/></svg>
          </span>
          <span class="account-label">Masuk kader</span>
        </button>` : '';
      } else {
        const initial = (account.name || 'K').trim().charAt(0).toUpperCase();
        const photo = account.picture
          ? `<img class="account-avatar" src="${escapeHTML(account.picture)}" alt="" referrerpolicy="no-referrer">`
          : `<span class="account-avatar" aria-hidden="true">${escapeHTML(initial)}</span>`;
        slot.innerHTML = `${photo}
          <button class="account-name" type="button" data-account-open>${escapeHTML(account.name || (isStaff ? 'Pengurus' : 'Kader'))}</button>
          <button class="account-signout" type="button" data-account-out>Keluar</button>`;
      }

      slot.querySelector('[data-account-open]')?.addEventListener('click', () => {
        if (account.role === 'tamu') openPanel();
        else slot.classList.toggle('is-open');
      });
      slot.querySelector('[data-account-out]')?.addEventListener('click', signOut);
    });
  }

  /**
   * Area khusus pengurus. Pengunjung tanpa akun tetap melihat tautannya karena
   * halaman masuk lembaga/admin memang publik; yang disembunyikan hanya akun
   * kader, sesuai batas hak akses kader.
   */
  function applyGating() {
    const locked = account.role === 'kader';
    document.querySelectorAll('[data-requires]').forEach((node) => {
      node.classList.toggle('is-locked', locked);
      node.toggleAttribute('hidden', locked);
      if (locked) node.removeAttribute('aria-current');
    });
  }

  async function init() {
    const slots = document.querySelectorAll('[data-account]');
    if (!slots.length) return;

    slots.forEach((slot) => {
      slot.classList.add('account-slot');
      slot.setAttribute('data-account', '');
    });
    paintChip();
    onChange(paintChip);

    applyGating();
    onChange(applyGating);

    try {
      const data = await api({ action: 'public' });
      clientId = String(data?.settings?.googleClientId || '').trim();
    } catch {
      clientId = '';
    }

    await refresh();
  }

  window.PBPIIAkun = {
    init,
    refresh,
    onChange,
    account: () => account,
    token,
    sessionToken,
    requireAccount,
    openPanel,
    closePanel,
    signOut,
    isStaff: () => account.role === 'admin' || account.role === 'org'
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
