/**
 * Akun & hak akses — dimuat di semua halaman publik (beranda, acara, ibadah,
 * tanya, peta, formulir, daftar).
 *
 * Kader masuk lewat Google atau lewat email + kata sandi yang dibuat sendiri.
 * Untuk Google, browser hanya menyerahkan ID token dan server yang
 * memverifikasinya; peran hasil /api/pii action "whoami" dipakai untuk
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
  let emailAuth = false;
  let gsiPromise = null;
  let captchaAssets = null;
  const verifikasi = { google: null, email: null, daftar: null };
  let activeTab = 'email';
  let panelOpen = false;

  /** Jalur akun yang benar-benar bisa dipakai: jangan tawarkan yang pasti gagal. */
  const tabTersedia = (tab) => (tab === 'google' ? !!clientId : emailAuth);
  const adaJalurMasuk = () => !!(clientId || emailAuth);
  const tabAwal = () => (clientId ? 'google' : 'email');

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

  /** Isi sesi yang baru saja dibuat server, lalu tutup panel. */
  function applySession(data) {
    localStorage.setItem(TOKEN_KEY, data.token);
    account = {
      role: data.role || 'kader',
      id: data.kader?.id || '',
      name: data.kader?.name || '',
      picture: data.kader?.picture || '',
      token: data.token
    };
    emit();
    // Jawaban verifikasi Google sudah terpakai; buang widgetnya agar sesi
    // berikutnya tidak mengirim soal yang sudah kedaluwarsa.
    if (verifikasi.google) {
      verifikasi.google = null;
      document.querySelector('[data-captcha-slot="google"]')?.replaceChildren();
    }
    closePanel();
    return account;
  }

  async function signIn(idToken) {
    return applySession(await api({
      action: 'kaderLogin',
      idToken,
      ...(verifikasi.google?.fields?.() || {})
    }));
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
          signIn(response.credential).catch(async (error) => {
            setNotice(error.message);
            if (error.code === 'captcha' || /verifikasi/i.test(String(error.message))) await ulangiVerifikasi('google');
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

  function setNotice(message) {
    const box = document.querySelector('.kader-notice');
    if (!box) return;
    box.textContent = message || '';
    box.hidden = !message;
  }

  /** Berkas captcha hanya diambil saat tab daftar pertama kali dibuka. */
  function loadAsset(tag, src, attributes) {
    const selector = tag === 'link' ? `link[href="${src}"]` : `script[src="${src}"]`;
    const existing = document.querySelector(selector);
    if (existing) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const node = document.createElement(tag);
      Object.entries(attributes).forEach(([key, value]) => { node[key] = value; });
      node.onload = () => resolve();
      node.onerror = () => reject(new Error('Verifikasi formulir gagal dimuat. Muat ulang halaman lalu coba lagi.'));
      document.head.append(node);
    });
  }

  function captchaAssetsReady() {
    if (window.PBPIICaptcha) return Promise.resolve(window.PBPIICaptcha);
    if (!captchaAssets) {
      captchaAssets = Promise.all([
        loadAsset('link', '/captcha.css', { rel: 'stylesheet', href: '/captcha.css' }),
        loadAsset('script', '/captcha.js', { src: '/captcha.js' })
      ]).then(() => window.PBPIICaptcha || null, (error) => { captchaAssets = null; throw error; });
    }
    return captchaAssets;
  }

  const captchaSiap = {};

  async function ensureCaptcha(pane) {
    const host = document.querySelector(`[data-captcha-slot="${pane}"]`);
    if (!host || verifikasi[pane] || captchaSiap[pane]) return;
    captchaSiap[pane] = true;
    host.innerHTML = '<p class="captcha-loading" role="status">Menyiapkan verifikasi…</p>';
    try {
      const modul = await captchaAssetsReady();
      if (!modul) throw new Error('Verifikasi formulir gagal dimuat. Muat ulang halaman lalu coba lagi.');
      verifikasi[pane] = modul.attach(host);
      await verifikasi[pane].ready();
    } catch (error) {
      host.innerHTML = `<p class="captcha-help is-error">${escapeHTML(error.message)}</p>`;
    } finally {
      captchaSiap[pane] = false;
    }
  }

  /** Jawaban verifikasi sekali pakai: minta soal baru setiap kali server menolak. */
  async function ulangiVerifikasi(pane) {
    const state = verifikasi[pane];
    if (!state) return;
    state.reset();
    await state.reload?.().catch(() => {});
  }

  function buildPanel() {
    if (document.querySelector('.kader-dialog')) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'kader-dialog';
    dialog.innerHTML = `
      <div class="kader-card">
        <button class="kader-close" type="button" aria-label="Tutup">×</button>
        <img class="kader-mark" src="/assets/logo-pii.png" alt="" onerror="this.onerror=null;this.src='assets/logo-pii.png'">
        <h2>Masuk sebagai kader</h2>
        <p class="kader-lead">Pakai akun kader untuk menyukai dan mengomentari acara serta memperbesar jatah Tanya PII. Dasbor pengurus tetap tertutup.</p>
        <div class="kader-tabs" role="tablist" aria-label="Pilih cara masuk">
          <button class="kader-tab" type="button" role="tab" data-tab="google">Google</button>
          <button class="kader-tab" type="button" role="tab" data-tab="email">Email</button>
          <button class="kader-tab" type="button" role="tab" data-tab="daftar">Daftar</button>
        </div>
        <div class="kader-pane" data-pane="google">
          <div class="kader-google" data-google-slot></div>
          <div class="kader-captcha" data-captcha-slot="google"></div>
          <p class="kader-hint">Masuk dengan akun Google tanpa membuat kata sandi baru.</p>
        </div>
        <div class="kader-pane" data-pane="email" hidden>
          <form class="kader-form" data-form-email novalidate>
            <label class="kader-field"><span>Email</span>
              <input type="email" name="email" autocomplete="email" inputmode="email" required placeholder="nama@email.com">
            </label>
            <label class="kader-field"><span>Kata sandi</span>
              <span class="kader-pass">
                <input type="password" name="password" autocomplete="current-password" required placeholder="Kata sandi akun Anda">
                <button class="kader-eye" type="button" aria-pressed="false">Lihat</button>
              </span>
            </label>
            <div class="kader-captcha" data-captcha-slot="email"></div>
            <button class="kader-go" type="submit">Masuk</button>
            <p class="kader-alt">Belum punya akun? <button class="kader-link" type="button" data-tab="daftar">Daftar dulu</button></p>
          </form>
        </div>
        <div class="kader-pane" data-pane="daftar" hidden>
          <form class="kader-form" data-form-daftar novalidate>
            <label class="kader-field"><span>Nama</span>
              <input type="text" name="name" autocomplete="name" required placeholder="Nama yang tampil pada komentar">
            </label>
            <label class="kader-field"><span>Email</span>
              <input type="email" name="email" autocomplete="email" inputmode="email" required placeholder="nama@email.com">
            </label>
            <label class="kader-field"><span>Kata sandi</span>
              <span class="kader-pass">
                <input type="password" name="password" autocomplete="new-password" minlength="8" required placeholder="Minimal 8 karakter">
                <button class="kader-eye" type="button" aria-pressed="false">Lihat</button>
              </span>
            </label>
            <div class="kader-captcha" data-captcha-slot="daftar"></div>
            <p class="kader-hint">Simpan kata sandi Anda dengan baik. Bila lupa, pemulihan dilakukan lewat pengurus PB PII.</p>
            <button class="kader-go" type="submit">Buat akun kader</button>
            <p class="kader-alt">Sudah punya akun? <button class="kader-link" type="button" data-tab="email">Masuk</button></p>
          </form>
        </div>
        <p class="kader-notice" role="status" aria-live="polite" hidden></p>
        <p class="kader-fine">Dengan masuk, Anda bersedia menampilkan nama pada komentar acara PB PII.</p>
      </div>`;
    document.body.append(dialog);

    dialog.querySelector('.kader-close').addEventListener('click', closePanel);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closePanel();
    });
    dialog.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => setActive(button.dataset.tab));
    });
    dialog.querySelectorAll('.kader-eye').forEach((button) => {
      button.addEventListener('click', () => {
        const input = button.parentElement.querySelector('input');
        const shown = input.type === 'text';
        input.type = shown ? 'password' : 'text';
        button.setAttribute('aria-pressed', String(!shown));
        button.textContent = shown ? 'Lihat' : 'Sembunyi';
      });
    });
    dialog.querySelector('[data-form-email]').addEventListener('submit', (event) => {
      event.preventDefault();
      kirim(event.target, () => {
        const data = new FormData(event.target);
        return api({
          action: 'kaderEmailLogin',
          email: String(data.get('email') || '').trim(),
          password: String(data.get('password') || ''),
          ...(verifikasi.email?.fields?.() || {})
        });
      }, 'email');
    });
    dialog.querySelector('[data-form-daftar]').addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      const name = String(data.get('name') || '').trim();
      const email = String(data.get('email') || '').trim();
      const password = String(data.get('password') || '');
      if (name.length < 3) { setNotice('Tulis nama minimal 3 karakter.'); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setNotice('Alamat email belum benar.'); return; }
      if (password.length < 8) { setNotice('Kata sandi minimal 8 karakter.'); return; }
      kirim(event.target, () => api({
        action: 'kaderRegister', name, email, password,
        ...(verifikasi.daftar?.fields?.() || {})
      }), 'daftar');
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && panelOpen) closePanel();
    });
  }

  /** Kirim salah satu formulir panel dengan status tombol yang jelas. */
  async function kirim(form, jalankan, pane) {
    const button = form.querySelector('button[type="submit"]');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Mengirim…';
    setNotice('');
    try {
      applySession(await jalankan());
      // Jawaban verifikasi sekali pakai dan kredenter tidak boleh tertinggal
      // di perangkat, jadi formulir dibersihkan untuk pemakaian berikutnya.
      form.reset();
      if (pane) {
        verifikasi[pane] = null;
        document.querySelector(`[data-captcha-slot="${pane}"]`)?.replaceChildren();
      }
    } catch (error) {
      setNotice(error.message || 'Belum berhasil masuk. Coba lagi.');
      // Jawaban verifikasi sekali pakai: soal baru diperlukan setiap kali ditolak.
      if (pane && (error.code === 'captcha' || /verifikasi/i.test(String(error.message)))) {
        await ulangiVerifikasi(pane);
      }
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = label;
      }
    }
  }

  let keyboardWatch = null;

  /** Safari iOS tidak mengecilkan viewport tata letak saat papan ketik muncul,
      jadi lembar diangkat sendiri supaya tombol kirim tidak tertutup. */
  function watchKeyboard() {
    const viewport = window.visualViewport;
    if (!viewport || keyboardWatch) return;
    const ukur = () => {
      const naik = window.innerHeight - viewport.height - viewport.offsetTop;
      const tinggi = naik > 60 ? Math.round(naik) : 0;
      document.documentElement.style.setProperty('--kader-keyboard', `${tinggi}px`);
    };
    keyboardWatch = ukur;
    viewport.addEventListener('resize', ukur);
    viewport.addEventListener('scroll', ukur);
    ukur();
  }

  function releaseKeyboard() {
    if (!keyboardWatch) return;
    window.visualViewport?.removeEventListener('resize', keyboardWatch);
    window.visualViewport?.removeEventListener('scroll', keyboardWatch);
    keyboardWatch = null;
    document.documentElement.style.removeProperty('--kader-keyboard');
  }

  function setActive(tab) {
    const dialog = document.querySelector('.kader-dialog');
    if (!dialog) return;
    const diminta = tab || activeTab;
    activeTab = tabTersedia(diminta) ? diminta : (tabTersedia(activeTab) ? activeTab : tabAwal());
    const jalur = ['google', 'email', 'daftar'].filter(tabTersedia).length;
    dialog.querySelectorAll('[data-tab]').forEach((button) => {
      const on = button.dataset.tab === activeTab;
      button.classList.toggle('is-active', on);
      if (button.getAttribute('role') === 'tab') button.setAttribute('aria-selected', String(on));
      button.toggleAttribute('hidden', !tabTersedia(button.dataset.tab));
    });
    /* Satu jalur saja tidak perlu dijadikan pilihan tab. */
    dialog.querySelector('.kader-tabs')?.toggleAttribute('hidden', jalur < 2);
    dialog.querySelectorAll('[data-pane]').forEach((pane) => {
      pane.hidden = pane.dataset.pane !== activeTab;
    });
    setNotice('');
    if (activeTab === 'google') {
      renderGoogleButton(dialog.querySelector('[data-google-slot]'));
      ensureCaptcha('google');
    }
    if (activeTab === 'email') ensureCaptcha('email');
    if (activeTab === 'daftar') ensureCaptcha('daftar');
  }

  function openPanel(notice, tab) {
    if (!adaJalurMasuk()) return false;
    buildPanel();
    const dialog = document.querySelector('.kader-dialog');
    panelOpen = true;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    document.body.classList.add('has-kader-dialog');
    setActive(tab || tabAwal());
    setNotice(notice);
    watchKeyboard();
    return true;
  }

  function closePanel() {
    panelOpen = false;
    releaseKeyboard();
    const dialog = document.querySelector('.kader-dialog');
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    document.body.classList.remove('has-kader-dialog');
  }

  /** Dipakai tombol suka/komentar: kembalikan akun, atau buka login dulu. */
  async function requireAccount(notice) {
    if (account.role === 'kader' || account.role === 'org' || account.role === 'admin') return account;
    if (!openPanel(notice)) throw new Error('Masuk kader belum dibuka.');
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
        slot.innerHTML = adaJalurMasuk() ? `<button class="account-button is-guest" type="button" data-account-open>
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
      emailAuth = data?.capabilities?.kaderEmail === true;
      paintChip();
    } catch {
      clientId = '';
      emailAuth = false;
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
    canSignIn: adaJalurMasuk,
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
