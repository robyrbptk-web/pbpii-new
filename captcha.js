/**
 * Verifikasi anti-bot untuk semua formulir masuk dan daftar (login admin,
 * lembaga, kader, pendaftaran peserta kegiatan).
 *
 * Satu-satunya widget adalah kotak centang Cloudflare Turnstile — gratis dan
 * tidak menyuruh siapa pun menghitung soal. Server yang menentukan jenisnya:
 * bila kunci belum dipasang, `captcha` mengembalikan 'none' dan wadah ini
 * disembunyikan sama sekali, jadi formulir tetap bisa dipakai.
 *
 * Pemakaian:
 *   const verifikasi = PBPIICaptcha.attach(host);
 *   await verifikasi.ready();          // widget sudah tampil (atau disembunyikan)
 *   kirim({ ...data, ...verifikasi.fields() })
 *   verifikasi.reset();                // setelah jawaban ditolak
 */
(() => {
  'use strict';

  const API = window.PBPII_CONFIG?.apiEndpoint || '/api/pii';
  const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

  async function issue() {
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'captcha' })
    });
    const result = await response.json().catch(() => null);
    if (!result || !result.ok) throw new Error(result?.error || 'Verifikasi belum dapat disiapkan.');
    return result.data;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src^="${src.split('?')[0]}"]`)) return resolve();
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Captcha tidak dapat dimuat. Muat ulang halaman lalu coba lagi.'));
      document.head.append(script);
    });
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function mountTurnstile(host, siteKey) {
    await loadScript(TURNSTILE_SRC);
    let attempts = 0;
    while (!window.turnstile && attempts < 40) {
      attempts += 1;
      await wait(50);
    }
    if (!window.turnstile) throw new Error('Captcha Cloudflare tidak dapat dimuat.');
    host.innerHTML = '<div class="captcha-box"></div>';
    const state = { token: '' };
    window.turnstile.render(host.firstElementChild, {
      sitekey: siteKey,
      theme: 'light',
      size: 'flexible',
      appearance: 'always',
      callback: (token) => { state.token = token; },
      'expired-callback': () => { state.token = ''; },
      'error-callback': () => { state.token = ''; }
    });
    return {
      kind: 'turnstile',
      fields: () => ({ captchaToken: state.token }),
      valid: () => Boolean(state.token),
      reset: () => { state.token = ''; }
    };
  }

  /** Tidak ada widget: wadah hilang dari layar dan kirim tidak pernah diblokir. */
  function mountTanpaWidget(host) {
    host.hidden = true;
    host.innerHTML = '';
    const wadah = host.closest('.field');
    if (wadah) wadah.hidden = true;
    return { kind: 'none', fields: () => ({}), valid: () => true, reset() {} };
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  /**
   * @param {HTMLElement} host wadah tempat widget ditampilkan
   * @param {{onChange?:Function}} options dipanggil tiap jenis verifikasi berganti
   */
  function attach(host, options = {}) {
    if (!host) throw new Error('Wadah verifikasi tidak ditemukan.');
    host.classList.add('captcha');
    host.hidden = false;
    host.innerHTML = '<p class="captcha-loading" role="status">Menyiapkan verifikasi…</p>';

    let current = null;
    let pending = null;

    async function load() {
      const data = await issue();
      if (data.kind === 'turnstile') {
        try {
          current = await mountTurnstile(host, data.siteKey);
        } catch (error) {
          host.innerHTML = `<p class="captcha-help is-error">${escapeHTML(error.message)}</p>`;
          current = { kind: 'error', fields: () => ({}), valid: () => false, reset() {} };
        }
      } else {
        current = mountTanpaWidget(host);
      }
      options.onChange?.(current.kind);
      return current;
    }

    pending = load().catch((error) => {
      host.innerHTML = `<p class="captcha-help is-error">${escapeHTML(error.message)} Coba kirim; server akan memberi tahu bila verifikasi diperlukan.</p>`;
      current = { kind: 'error', fields: () => ({}), valid: () => false, reset() {} };
      return current;
    });

    return {
      ready: () => pending,
      reload: () => { pending = load(); return pending; },
      fields: () => (current ? current.fields() : {}),
      valid: () => Boolean(current?.valid?.()),
      reset: () => current?.reset?.(),
      kind: () => current?.kind || 'none'
    };
  }

  window.PBPIICaptcha = { attach };
})();
