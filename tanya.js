/**
 * "Tanya PII" — asisten AI resmi PB PII.
 *
 * Dua mode dalam satu berkas:
 *  - tanya.html  → aplikasi chat layar penuh (riwayat, saran, kuota).
 *  - halaman lain → tombol melayang yang mengarahkan ke halaman tersebut.
 *
 * Kunci AI tidak pernah sampai ke browser: pertanyaan dikirim ke /api/chat dan
 * layanan AI dipanggil di server (Vercel function), dengan fallback ke layanan
 * gratis tanpa kunci supaya fitur tetap menjawab walau backend Apps Script
 * belum versi baru.
 */
(() => {
  'use strict';

  const ENDPOINT = window.PBPII_CONFIG?.chatEndpoint || '/api/chat';
  const ADMIN_TOKEN_KEY = 'pbpii_admin_token';
  const ORG_TOKEN_KEY = 'pbpii_org_token';
  const THREAD_KEY = 'pbpii_tanya_thread';
  const DEVICE_KEY = 'pbpii_tanya_device';
  const MAX_TURNS = 12;

  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);

  /**
   * Sesi ikut terkirim supaya kuota longgar diberikan ke akun yang benar:
   * kader (Google atau email) dari PBPIIAkun, pengurus/admin dari sesi login halaman dashboard.
   */
  const sessionToken = () => window.PBPIIAkun?.sessionToken?.()
    || sessionStorage.getItem(ADMIN_TOKEN_KEY)
    || sessionStorage.getItem(ORG_TOKEN_KEY)
    || '';

  function deviceId() {
    let stored = localStorage.getItem(DEVICE_KEY);
    if (stored) return stored;
    const bytes = new Uint8Array(8);
    (window.crypto || window.msCrypto)?.getRandomValues?.(bytes);
    stored = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
      || `web${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_KEY, stored);
    return stored;
  }

  /** Teks AI ditampilkan apa adanya: hanya bold, list, dan baris baru yang dikenali. */
  function richText(text) {
    return escapeHTML(text)
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .split('\n')
      .map((line) => {
        const bullet = line.trim().match(/^[-*•]\s+(.*)$/);
        return bullet ? `<li>${bullet[1]}</li>` : `<p>${line || '&nbsp;'}</p>`;
      })
      .join('')
      .replace(/(?:<li>.*?<\/li>\s*)+/g, (block) => `<ul>${block}</ul>`);
  }

  async function askServer(payload) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => null);
    if (!result || !result.ok) {
      const error = new Error(result?.error || 'Tanya PII tidak dapat dihubungi.');
      error.code = String(result?.code || '');
      error.retryAfter = Number(result?.retryAfter) || 0;
      error.batas = Number(result?.batas) || 0;
      throw error;
    }
    return result.data;
  }

  // ------------------------------------------------------------------- halaman

  function initChat() {
    const scroll = document.querySelector('#tanyaScroll');
    const thread = document.querySelector('#tanyaThread');
    const intro = document.querySelector('#tanyaIntro');
    const chips = document.querySelector('#tanyaChips');
    const form = document.querySelector('#tanyaComposer');
    const input = document.querySelector('#tanyaInput');
    const submit = document.querySelector('#tanyaSubmit');
    const quota = document.querySelector('#tanyaQuota');
    const reset = document.querySelector('#tanyaReset');
    if (!scroll || !thread || !form) return;

    let turns = [];
    try {
      const stored = JSON.parse(localStorage.getItem(THREAD_KEY) || '[]');
      turns = Array.isArray(stored) ? stored.slice(-MAX_TURNS) : [];
    } catch { turns = []; }

    let busy = false;
    let retryTimer = null;

    const stick = () => {
      scroll.scrollTop = scroll.scrollHeight;
    };

    function bubble(role, content) {
      const row = document.createElement('div');
      row.className = `tanya-row is-${role}`;
      row.innerHTML = `
        <span class="tanya-avatar" aria-hidden="true">${
          role === 'assistant'
            ? '<img src="/assets/logo-pii.png" alt="" onerror="this.onerror=null;this.src=\'assets/logo-pii.png\'">'
            : 'A'
        }</span>
        <div class="tanya-msg">${richText(content)}</div>`;
      thread.append(row);
      return row;
    }

    function pending(label) {
      const row = document.createElement('div');
      row.className = 'tanya-row is-assistant is-pending';
      row.innerHTML = `
        <span class="tanya-avatar" aria-hidden="true"><img src="/assets/logo-pii.png" alt=""></span>
        <div class="tanya-msg"><span class="tanya-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="tanya-pending-text">${escapeHTML(label)}</span></div>`;
      thread.append(row);
      return row;
    }

    function errorRow(message, seconds, onRetry) {
      const row = document.createElement('div');
      row.className = 'tanya-row is-assistant is-error';
      row.innerHTML = `
        <span class="tanya-avatar" aria-hidden="true"><img src="/assets/logo-pii.png" alt=""></span>
        <div class="tanya-msg">
          <p>${escapeHTML(message)}</p>
          <button type="button" class="tanya-retry">Coba lagi</button>
        </div>`;
      const button = row.querySelector('.tanya-retry');
      button.addEventListener('click', () => { clearTimeout(retryTimer); row.remove(); onRetry(); });
      thread.append(row);

      if (seconds > 0) {
        let left = seconds;
        const tick = () => {
          if (!row.isConnected) return;
          button.textContent = `Coba lagi (${left}s)`;
          if (left <= 0) { row.remove(); onRetry(); return; }
          left -= 1;
          retryTimer = setTimeout(tick, 1000);
        };
        tick();
      }
      return row;
    }

    /** Jatah habis: tawarkan jalan keluar, bukan tombol coba ulang yang buntu. */
    function upgradeRow(message) {
      const boleh = window.PBPIIAkun?.canSignIn?.() !== false;
      const ajakan = boleh ? `
          <button type="button" class="tanya-upgrade" data-tab="daftar">Daftar akun kader</button>
          <button type="button" class="tanya-upgrade is-plain" data-tab="email">Masuk dengan akun yang sudah ada</button>` : '';
      const row = document.createElement('div');
      row.className = 'tanya-row is-assistant is-quota';
      row.innerHTML = `
        <span class="tanya-avatar" aria-hidden="true"><img src="/assets/logo-pii.png" alt=""></span>
        <div class="tanya-msg">
          <p>${escapeHTML(message)}</p>${ajakan}
        </div>`;
      row.querySelectorAll('.tanya-upgrade').forEach((button) => {
        button.addEventListener('click', () => window.PBPIIAkun?.openPanel('', button.dataset.tab));
      });
      thread.append(row);
      return row;
    }

    function paint() {
      thread.replaceChildren();
      turns.forEach((turn) => bubble(turn.role, turn.content));
      intro.hidden = turns.length > 0;
      stick();
    }

    const save = () => {
      localStorage.setItem(THREAD_KEY, JSON.stringify(turns.slice(-MAX_TURNS)));
    };

    function setBusy(value) {
      busy = value;
      submit.disabled = value;
      input.disabled = value;
      form.classList.toggle('is-busy', value);
    }

    async function send(question) {
      const text = String(question || '').trim();
      if (!text || busy) return;
      clearTimeout(retryTimer);

      turns.push({ role: 'user', content: text });
      if (turns.length > MAX_TURNS) turns = turns.slice(-MAX_TURNS);
      paint();
      intro.hidden = true;
      input.value = '';
      grow();
      setBusy(true);

      const history = turns.slice(-MAX_TURNS, -1);
      const row = pending('Sedang menuliskan jawaban…');
      const start = Date.now();

      try {
        const data = await askServer({
          action: 'chat',
          message: text,
          history,
          token: sessionToken(),
          device: deviceId()
        });
        row.remove();
        const reply = String(data?.reply || '').trim() || 'Layanan AI tidak menghasilkan jawaban.';
        turns.push({ role: 'assistant', content: reply });
        save();
        paint();
        showQuota(data, start);
      } catch (error) {
        row.remove();
        paint();
        if (error.code === 'quota') upgradeRow(error.message);
        else errorRow(error.message, Number(error.retryAfter) || 0, () => send(text));
        stick();
        loadQuota();
      } finally {
        setBusy(false);
        if (!errorShown()) input.focus();
      }
    }

    const errorShown = () => Boolean(thread.querySelector('.is-error'));

    function showQuota(data, askedAt) {
      if (typeof data?.sisa !== 'number') return;
      paintMeter({
        sisa: data.sisa,
        batas: data.batas,
        akun: data.akun || (sessionToken() ? 'akun' : 'tamu'),
        detik: Math.max(1, Math.round((Date.now() - (askedAt || Date.now())) / 1000))
      });
    }

    async function loadQuota() {
      try {
        const status = await askServer({ action: 'chatStatus', token: sessionToken(), device: deviceId() });
        paintMeter({
          sisa: status.sisa,
          batas: status.batas,
          akun: status.akun || (sessionToken() ? 'akun' : 'tamu'),
          habis: status.boleh === false
        });
      } catch {
        quota.textContent = 'Kuota harian berlaku; jawaban tetap dikirim bila layanan AI sedang longgar.';
      }
    }

    /** Pill kuota: singkat agar muat di layar kecil, plus pintasan masuk saat jatah tamu habis. */
    function paintMeter({ sisa, batas, akun, detik, habis }) {
      const tamu = akun === 'tamu';
      const nama = window.PBPIIAkun?.account?.().name || '';
      const inti = `Sisa ${sisa}/${batas || (tamu ? 5 : 20)} pertanyaan hari ini`;
      const ekor = tamu ? ' · gratis dari jaringan ini' : (nama ? ` · ${nama}` : '');
      quota.textContent = inti + ekor + (detik ? ` · ${detik}s` : '');
      if (tamu && (habis || sisa === 0) && window.PBPIIAkun?.canSignIn?.() !== false) {
        const tombol = document.createElement('button');
        tombol.type = 'button';
        tombol.className = 'tanya-quota-cta';
        tombol.textContent = 'Masuk kader, jatah naik jadi 20';
        tombol.addEventListener('click', () => window.PBPIIAkun?.openPanel('', 'daftar'));
        quota.append(' ', tombol);
      }
    }

    // Tinggi textarea mengikuti isi, maksimal enam baris.
    const grow = () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 168)}px`;
    };

    input.addEventListener('input', grow);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send(input.value);
      }
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      send(input.value);
    });
    chips?.addEventListener('click', (event) => {
      const chip = event.target.closest('button');
      if (chip) send(chip.textContent);
    });
    reset?.addEventListener('click', () => {
      clearTimeout(retryTimer);
      turns = [];
      localStorage.removeItem(THREAD_KEY);
      paint();
      intro.hidden = false;
      loadQuota();
      input.focus();
    });

    // Ganti akun (misal baru daftar) langsung memperbarui jatah yang tampil.
    let tokenTerakhir = sessionToken();
    window.PBPIIAkun?.onChange?.(() => {
      if (sessionToken() === tokenTerakhir) return;
      tokenTerakhir = sessionToken();
      loadQuota();
    });

    // Papan ketik ponsel tidak boleh menutupi kolom tulis, terutama di iOS.
    const viewport = window.visualViewport;
    if (viewport) {
      const ukur = () => {
        const naik = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
        const terbuka = naik > 60;
        document.documentElement.style.setProperty('--tanya-keyboard', `${terbuka ? naik : 0}px`);
        document.body.classList.toggle('tanya-keyboard-up', terbuka);
        if (terbuka) stick();
      };
      viewport.addEventListener('resize', ukur);
      viewport.addEventListener('scroll', ukur);
    }

    paint();
    loadQuota();
    if (!window.matchMedia('(pointer: coarse)').matches) input.focus({ noScroll: true });
  }

  if (document.querySelector('#tanyaThread')) {
    document.addEventListener('DOMContentLoaded', initChat);
  }
})();
