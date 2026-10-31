/**
 * Verifikasi anti-spam untuk semua formulir publik (pendaftaran peserta,
 * pendaftaran lembaga, komentar acara).
 *
 * Server yang menentukan jenisnya: selama PB PII belum mengisi kunci Cloudflare,
 * Apps Script membuat soal hitung sendiri sehingga tidak ada biaya, tidak ada
 * daftar ke penyedia mana pun, dan tidak ada kunci yang bocor ke browser. Begitu
 * Settings `turnstileSiteKey` + `turnstileSecret` terisi, widget yang sama
 * otomatis beralih ke Turnstile.
 *
 * Pemakaian:
 *   const verifikasi = PBPIICaptcha.attach(host);
 *   await verifikasi.ready();          // soal sudah tampil
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
    if (!result || !result.ok) throw new Error(result?.error || 'Soal verifikasi belum dapat diambil.');
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

  function mountLocal(host, soal) {
    host.innerHTML = `
      <div class="captcha-box captcha-local">
        <label class="captcha-question" for="captcha-${soal.id.slice(0, 8)}">${escapeHTML(soal.question)}</label>
        <input id="captcha-${soal.id.slice(0, 8)}" class="captcha-answer" type="text"
          inputmode="numeric" autocomplete="off" maxlength="6" placeholder="Jawaban"
          aria-describedby="captcha-help">
        <button class="captcha-refresh" type="button" aria-label="Ambil soal baru">↻</button>
      </div>
      <p class="captcha-help" id="captcha-help">Hitung dalam kepala, isi hasilnya. Sekali pakai, jadi kirim segera setelah menjawab.</p>`;
    const input = host.querySelector('.captcha-answer');
    const state = { id: soal.id, question: soal.question };
    return {
      kind: 'local',
      fields: () => ({ captchaId: state.id, captchaAnswer: input.value.trim() }),
      valid: () => Boolean(state.id && input.value.trim()),
      reset: () => { input.value = ''; },
      focus: () => input.focus(),
      state
    };
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  /**
   * @param {HTMLElement} host wadah tempat widget ditampilkan
   * @param {{onChange?:Function}} options dipanggil tiap soal berganti
   */
  function attach(host, options = {}) {
    if (!host) throw new Error('Wadah verifikasi tidak ditemukan.');
    host.classList.add('captcha');
    host.innerHTML = '<p class="captcha-loading" role="status">Mengambil soal verifikasi…</p>';

    let current = null;
    let pending = null;

    async function load() {
      const soal = await issue();
      if (soal.kind === 'turnstile') {
        try {
          current = await mountTurnstile(host, soal.siteKey);
        } catch (error) {
          host.innerHTML = `<p class="captcha-help is-error">${escapeHTML(error.message)}</p>`;
          current = { kind: 'error', fields: () => ({}), valid: () => false, reset() {} };
        }
      } else {
        current = mountLocal(host, soal);
        current.reload = load;
        host.querySelector('.captcha-refresh')?.addEventListener('click', () => load());
      }
      options.onChange?.(current.kind);
      return current;
    }

    pending = load().catch((error) => {
      host.innerHTML = `<p class="captcha-help is-error">${escapeHTML(error.message)} Tombol kirim tetap dicoba; server akan meminta verifikasi ulang.</p>`;
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
