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
  /** Riwayat lama: satu percakapan tunggal, dimigrasikan ke daftar di bawah. */
  const THREAD_KEY = 'pbpii_tanya_thread';
  const THREAD_VERSION_KEY = 'pbpii_tanya_thread_version';
  const THREADS_KEY = 'pbpii_tanya_threads';
  const AKTIF_KEY = 'pbpii_tanya_aktif';
  const DEVICE_KEY = 'pbpii_tanya_device';
  const MAX_TURNS = 40;
  const MAX_THREADS = 30;
  /** Versi 4: percakapan disimpan sebagai riwayat, bukan satu thread yang ditimpa. */
  const THREAD_VERSION = '4';

  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);

  /**
   * Sesi ikut terkirim supaya kuota longgar diberikan ke akun yang benar:
   * kader (Google atau email) dari PBPIIAkun, pengurus/admin dari sesi login halaman dashboard.
   */
  const sessionToken = () => window.PBPIIAkun?.sessionToken?.()
    || localStorage.getItem(ADMIN_TOKEN_KEY)
    || localStorage.getItem(ORG_TOKEN_KEY)
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

  // ------------------------------------------------------------------ riwayat

  /**
   * Percakapan disimpan sebagai daftar di perangkat penanya: "Percakapan baru"
   * membuka lembaran baru dan yang lama tetap bisa dibuka lagi, bukan dihapus.
   * Isinya kutipan jawaban dan rujukan yang sudah tampil, jadi tidak ada data
   * akun yang ikut tersimpan.
   */
  function idThread() {
    const bytes = new Uint8Array(6);
    (window.crypto || window.msCrypto)?.getRandomValues?.(bytes);
    const acak = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${acak || 't'}${Date.now().toString(36)}`;
  }

  function threadBaru() {
    const sekarang = Date.now();
    return { id: idThread(), judul: '', dibuat: sekarang, diubah: sekarang, turns: [] };
  }

  /** Pertanyaan pertama menjadi nama percakapan pada daftar riwayat. */
  function judulDari(teks) {
    const ringkas = String(teks || '').replace(/\s+/g, ' ').trim().slice(0, 58);
    return ringkas ? `${ringkas}${String(teks || '').trim().length > 58 ? '…' : ''}` : '';
  }

  function bersihkanTurns(turns) {
    return (Array.isArray(turns) ? turns : [])
      .filter((turn) => turn && (turn.role === 'user' || turn.role === 'assistant'))
      .map((turn) => ({
        role: turn.role,
        content: String(turn.content || '').slice(0, 9000),
        rujukan: Array.isArray(turn.rujukan) ? turn.rujukan.slice(0, 3) : [],
        rujukanWeb: Array.isArray(turn.rujukanWeb) ? turn.rujukanWeb.slice(0, 3) : [],
        status: turn.status === 'no_source' ? 'no_source' : '',
        rasa: turn.rasa === 'suka' || turn.rasa === 'tidak' ? turn.rasa : '',
      }))
      .filter((turn) => turn.content)
      .slice(-MAX_TURNS);
  }

  function muatThreads() {
    try {
      const disimpan = JSON.parse(localStorage.getItem(THREADS_KEY) || 'null');
      if (Array.isArray(disimpan)) {
        return disimpan
          .filter((thread) => thread && thread.id)
          .map((thread) => ({
            id: String(thread.id).slice(0, 40),
            judul: String(thread.judul || '').slice(0, 70),
            dibuat: Number(thread.dibuat) || 0,
            diubah: Number(thread.diubah) || Number(thread.dibuat) || 0,
            turns: bersihkanTurns(thread.turns),
          }))
          .filter((thread) => thread.turns.length)
          .sort((a, b) => b.diubah - a.diubah)
          .slice(0, MAX_THREADS);
      }
    } catch {
      /* daftar rusak: mulai dari riwayat tunggal di bawah */
    }

    /*
     * Migrasi sekali jalan untuk penanya yang sudah pakai Tanya PII sebelumnya:
     * satu-satunya percakapan yang ada dijadikan butir pertama, bukan dibuang.
     */
    let tunggal = [];
    try {
      const disimpan = JSON.parse(localStorage.getItem(THREAD_KEY) || '[]');
      tunggal = Array.isArray(disimpan) ? bersihkanTurns(disimpan) : [];
    } catch { tunggal = []; }
    localStorage.removeItem(THREAD_KEY);
    localStorage.setItem(THREAD_VERSION_KEY, THREAD_VERSION);
    if (!tunggal.length) return [];
    const pertama = threadBaru();
    pertama.turns = tunggal;
    pertama.judul = judulDari(tunggal.find((turn) => turn.role === 'user')?.content);
    return [pertama];
  }

  /**
   * Menulis daftar riwayat dengan penjagaan kuota: kalau penyimpanan perangkat
   * penuh, percakapan paling lama ditinggalkan sampai tulisannya muat — bukan
   * percakapan yang sedang berjalan.
   */
  function simpanThreads(threads) {
    let daftar = threads.slice(0, MAX_THREADS);
    for (let percobaan = 0; percobaan < MAX_THREADS; percobaan += 1) {
      try {
        localStorage.setItem(THREADS_KEY, JSON.stringify(daftar));
        localStorage.setItem(THREAD_VERSION_KEY, THREAD_VERSION);
        return daftar;
      } catch {
        if (daftar.length <= 1) return daftar;
        daftar = daftar.slice(0, -1);
      }
    }
    return daftar;
  }

  const WAKTU = new Intl.RelativeTimeFormat('id', { numeric: 'auto' });
  function waktuLalu(stamp) {
    const detik = Math.round((Number(stamp) - Date.now()) / 1000);
    if (!Number.isFinite(detik) || !stamp) return '';
    if (detik > -90) return 'baru saja';
    if (detik > -3600) return WAKTU.format(Math.round(detik / 60), 'minute');
    if (detik > -86400) return WAKTU.format(Math.round(detik / 3600), 'hour');
    if (detik > -604800) return WAKTU.format(Math.round(detik / 86400), 'day');
    return new Intl.DateTimeFormat('id', { day: 'numeric', month: 'short', year: '2-digit' }).format(new Date(stamp));
  }

  /**
   * Jawaban AI dirender oleh PBPIIMarkdown (markdown.js): judul, daftar,
   * kotak centang, tabel GFM, blok kode tersorot, blok terminal, dan rumus.
   * Perender itu mengescape seluruh teks dan hanya menerbitkan tag daftar
   * putih, jadi HTML atau skrip dari model tidak pernah berjalan di browser.
   */
  function richText(text) {
    if (window.PBPIIMarkdown?.render) return window.PBPIIMarkdown.render(text);
    return `<p>${escapeHTML(String(text || '')).replace(/\n/g, '<br>')}</p>`;
  }

  /** Isi jawaban tanpa tanda Markdown dan tanpa elemen antarmuka. */
  function teksJawaban(turn) {
    return String(turn?.content || '').trim();
  }

  function unduhTeks(nama, isi, tipe) {
    const berkas = new Blob([isi], { type: `${tipe || 'text/plain'};charset=utf-8` });
    const url = URL.createObjectURL(berkas);
    const tautan = document.createElement('a');
    tautan.href = url;
    tautan.download = nama;
    tautan.rel = 'noopener';
    document.body.append(tautan);
    tautan.click();
    tautan.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  let toastTimer = null;
  function toast(pesan) {
    let kotak = document.querySelector('.tanya-toast');
    if (!kotak) {
      kotak = document.createElement('div');
      kotak.className = 'tanya-toast';
      kotak.setAttribute('role', 'status');
      document.body.append(kotak);
    }
    kotak.textContent = pesan;
    kotak.classList.add('is-tampil');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => kotak.classList.remove('is-tampil'), 2100);
  }

  async function askServer(payload, signal) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal
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

  /**
   * Kegagalan jaringan selalu membawa teks teknis bahasa Inggris dari peramban.
   * Pembacca hanya perlu tahu apa yang bisa mereka lakukan berikutnya.
   */
  const GALAT_TEKNIS = /timeout|abort|network|failed to fetch|load failed|etimedout|socket|fetch/i;

  function pesanPembaca(message) {
    const teks = String(message || '').trim();
    if (!teks || GALAT_TEKNIS.test(teks)) return 'Koneksi ke Tanya PII terputus. Periksa jaringan, lalu kirim lagi.';
    return teks.slice(0, 200);
  }

  // ------------------------------------------------------------------- halaman

  function initChat() {
    const scroll = document.querySelector('#tanyaScroll');
    const thread = document.querySelector('#tanyaThread');
    const intro = document.querySelector('#tanyaIntro');
    const form = document.querySelector('#tanyaComposer');
    const input = document.querySelector('#tanyaInput');
    const submit = document.querySelector('#tanyaSubmit');
    const quota = document.querySelector('#tanyaQuota');
    const reset = document.querySelector('#tanyaReset');
    const panel = document.querySelector('#tanyaRiwayat');
    const panelBuka = document.querySelector('#tanyaRiwayatBuka');
    const panelDaftar = document.querySelector('#tanyaRiwayatDaftar');
    const panelKosong = document.querySelector('#tanyaRiwayatKosong');
    if (!scroll || !thread || !form) return;

    let threads = muatThreads();
    let aktifId = String(localStorage.getItem(AKTIF_KEY) || '');
    let aktif = threads.find((item) => item.id === aktifId) || threads[0];
    if (!aktif) {
      aktif = threadBaru();
      threads = [aktif];
    }
    aktifId = aktif.id;
    localStorage.setItem(AKTIF_KEY, aktifId);
    let turns = aktif.turns;
    /* Hasil migrasi langsung ditulis; kalau hanya ditahan di memori, percakapan
       lama hilang begitu halaman dibuka lagi. */
    if (turns.length) simpanThreads(threads);

    let busy = false;
    let retryTimer = null;
    let pembatal = null;

    /** Gulir hanya saat pembaca memang berada di dekat bawah; kalau sedang
        membaca pesan lama, kedatangan jawaban tidak boleh menculik layar. */
    const dekatBawah = () => scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 140;
    const stick = (paksa) => {
      if (!paksa && !dekatBawah()) return;
      scroll.scrollTop = scroll.scrollHeight;
    };

    /**
     * Tautan balik ke Pustaka: berkas dan halaman persis yang tadi dikutip,
     * jadi pembaca bisa memeriksa kutipan di dokumen aslinya. Id berkas dibatasi
     * karakter yang aman untuk query string.
     */
    function tautanBerkas(sumber) {
      const id = String(sumber.berkas || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
      if (!id) return '';
      const halaman = Number(Array.isArray(sumber.halaman) ? sumber.halaman[0] : 0) || 0;
      return `pustaka.html?doc=${encodeURIComponent(id)}${halaman ? `&hal=${halaman}` : ''}`;
    }

    /**
     * Nama berkas + halaman yang tadi dikutip model. Isinya tidak ikut dikirim ke
     * browser, hanya judul, kategori, bab, dan nomor halaman sebagai rujukan
     * pembaca. Rujukan web ditampilkan sebagai tautan supaya sumbernya bisa diperiksa.
     */
    function sumberBlok(rujukan, rujukanWeb, status) {
      const berkas = (Array.isArray(rujukan) ? rujukan : []).filter((item) => item && item.judul);
      const daring = (Array.isArray(rujukanWeb) ? rujukanWeb : []).filter((item) => item && item.judul && /^https:\/\//.test(item.url || ''));

      if (!berkas.length && !daring.length) {
        const keterangan = status === 'no_source'
          ? 'Berkas Pustaka dan penelusuran belum menghasilkan rujukan untuk pertanyaan ini.'
          : '';
        return keterangan
          ? `<div class="tanya-sumber is-empty"><p class="tanya-sumber-title">${escapeHTML(keterangan)}</p></div>`
          : '';
      }

      const tautanPustaka = sessionToken()
        ? ' · <a class="tanya-sumber-link" href="pustaka.html">buka Pustaka</a>'
        : '';
      const barisBerkas = berkas.slice(0, 3).map((sumber) => {
        const ket = [
          sumber.kategori,
          halamanTeks(sumber.halaman).replace(/^ /, ''),
          String(sumber.bab || '').slice(0, 60)
        ].filter(Boolean).join(' · ');
        const buka = tautanBerkas(sumber);
        const tombol = buka
          ? `<a class="tanya-sumber-buka" href="${escapeHTML(buka)}">baca bagian ini</a>`
          : '';
        return `<li><span>${escapeHTML(sumber.judul)}</span><em>${escapeHTML(ket)}</em>${tombol}</li>`;
      }).join('');
      const barisWeb = daring.slice(0, 3).map((sumber) => `
        <li>
          <a href="${escapeHTML(sumber.url)}" target="_blank" rel="nofollow noopener noreferrer">${escapeHTML(sumber.judul)}</a>
          <em>${escapeHTML(new URL(sumber.url).hostname.replace(/^www\./, ''))}</em>
        </li>`).join('');

      const bagian = [];
      if (barisBerkas) bagian.push(`<p class="tanya-sumber-title">Dijawab dari berkas organisasi${tautanPustaka}:</p><ul>${barisBerkas}</ul>`);
      if (barisWeb) bagian.push(`<p class="tanya-sumber-title">Ditelusuri dari web:</p><ul class="tanya-sumber-web">${barisWeb}</ul>`);
      return `<div class="tanya-sumber">${bagian.join('')}</div>`;
    }

    const IKON = {
      salin: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.4"/><path d="M15 6.5H6.5A2.5 2.5 0 0 0 4 9v8"/></svg>',
      ulang: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4.5V9h-4.5"/></svg>',
      pdf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19h14"/></svg>',
      naik: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 21v-9l4.2-8.4a1.6 1.6 0 0 1 3 1.1L12.8 11H19l-2.2 8a1.6 1.6 0 0 1-1.6 1.2H7Z"/></svg>',
      turun: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v9l4.2 8.4a1.6 1.6 0 0 0 3-1.1L12.8 13H19l-2.2-8A1.6 1.6 0 0 0 15.2 3H7Z"/></svg>',
      ganti: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5h4L19 9a2.5 2.5 0 0 0-3.5-3.5L5 16z"/><path d="m14.5 6.5 3 3"/></svg>',
      hapus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14"/><path d="M9.5 7V5.2h5V7"/><path d="M6.5 7 7.6 19a1.6 1.6 0 0 0 1.6 1.4h5.6A1.6 1.6 0 0 0 16.4 19L17.5 7"/><path d="M10.5 10.5v6M13.5 10.5v6"/></svg>',
    };

    /*
     * Unduhan PDF bersifat kontekstual, bukan perabot tetap setiap balon.
     * Sinyalnya permintaan dokumen dari penanya, dikonfirmasi bentuk
     * jawabannya: tanpa judul atau tabel, jawabannya masih narasi biasa dan
     * tidak ada berkas yang bisa diunduh.
     */
    const PERMINTAAN_DOKUMEN = /\b(surat|proposal|laporan|notulen|memo|memorandum|undangan|keterangan|sk|rab|rka|anggaran|konsep|draf|draft|materi|modul|panduan|makalah|kisi-kisi|kerangka|dokumen|pdf)\b/i;

    function adalahDokumen(soal, isi) {
      const teks = String(isi || '').trim();
      if (!soal || !PERMINTAAN_DOKUMEN.test(String(soal)) || teks.length < 320) return false;
      const judul = (teks.match(/^#{1,4}[^\n]*$/gm) || []).length;
      const barisTabel = (teks.match(/^\s*\|[^\n]*\|\s*$/gm) || []).length;
      return judul >= 2 || barisTabel >= 3;
    }

    /** Judul bab pertama dipakai sebagai nama dokumen pada lembar cetak. */
    function judulDokumen(isi) {
      const kepala = String(isi || '').match(/^#{1,3}[^\n]*$/m);
      return kepala ? kepala[0].replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim().slice(0, 120) : '';
    }

    /**
     * Toolbar jawaban: salin, suka, tidak suka, dan jawab ulang. Tombol unduh
     * PDF hanya menyelinap di antaranya bila balon ini memang sebuah dokumen.
     */
    function alatBlok(urut, turn) {
      const soal = urut > 0 ? turns[urut - 1]?.content : '';
      const tombol = [['salin', 'Salin jawaban', 'Salin', IKON.salin, '']];
      if (adalahDokumen(soal, turn?.content)) {
        tombol.push(['pdf', 'Unduh dokumen ini sebagai PDF', 'Unduh PDF', IKON.pdf, ' is-unduh']);
      }
      const kiri = tombol.map(([act, label, teks, ikon, extra]) =>
        `<button type="button" class="tanya-act${extra}" data-act="${act}" aria-label="${label}" title="${label}">${ikon}<span>${teks}</span></button>`).join('');
      const rasa = [['suka', 'Jawaban ini membantu', IKON.naik], ['tidak', 'Jawaban ini kurang membantu', IKON.turun]]
        .map(([act, label, ikon]) =>
          `<button type="button" class="tanya-act is-rasa${turn?.rasa === act ? ' is-aktif' : ''}" data-act="${act}"`
          + ` aria-label="${label}" aria-pressed="${turn?.rasa === act ? 'true' : 'false'}" title="${label}">${ikon}</button>`).join('');
      const ulang = `<button type="button" class="tanya-act" data-act="ulang" aria-label="Jawab ulang pertanyaan ini" title="Jawab ulang">${IKON.ulang}<span>Ulangi</span></button>`;
      return `<div class="tanya-actions">${kiri}${rasa}${ulang}</div>`;
    }

    function bubble(role, content, rujukan, status, rujukanWeb, urut) {
      const row = document.createElement('div');
      row.className = `tanya-row is-${role}`;
      if (typeof urut === 'number') row.dataset.urut = String(urut);
      const turn = typeof urut === 'number' ? turns[urut] : null;
      const pesan = `<div class="tanya-msg">${richText(content)}${role === 'assistant' ? sumberBlok(rujukan, rujukanWeb, status) : ''}</div>`;
      row.innerHTML = role === 'assistant'
        ? `<span class="tanya-avatar" aria-hidden="true"><img src="/assets/logo-pii.webp" alt="" onerror="this.onerror=null;this.src='assets/logo-pii.png'"></span>
           <div class="tanya-body">${pesan}${alatBlok(urut, turn)}</div>`
        : `<div class="tanya-body">${pesan}</div>`;
      thread.append(row);
      return row;
    }

    /*
     * Baris "sedang memproses": logo PII dikelilingi cincin yang berputar dan
     * teksnya berganti tahap supaya layar tidak tampak diam selama model bekerja.
     */
    const PERTANYAAN_ORGANISASI = /\b(pii|pelajar islam indonesia|kader|pengurus|kongres|munas|konferda|konfercab|ad\/art|pustaka|ketum|ketua umum)\b/i;

    function pending(question) {
      const tahap = PERTANYAAN_ORGANISASI.test(question)
        ? ['Memeriksa berkas Pustaka…', 'Menelusuri sumber terkait…', 'Menulis rangkuman…']
        : ['Menimbang jawaban…', 'Menulis rangkuman…'];
      const row = document.createElement('div');
      row.className = 'tanya-row is-assistant is-pending';
      row.innerHTML = `
        <span class="tanya-avatar" aria-hidden="true">
          <span class="tanya-orbit"></span>
          <img src="/assets/logo-pii.webp" alt="" onerror="this.onerror=null;this.src='assets/logo-pii.png'">
        </span>
        <div class="tanya-body"><div class="tanya-msg">
          <span class="tanya-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="tanya-pending-text">${escapeHTML(tahap[0])}</span>
          <span class="tanya-skeleton" aria-hidden="true"><i></i><i></i><i></i></span>
        </div></div>`;
      thread.append(row);

      const label = row.querySelector('.tanya-pending-text');
      let langkah = 0;
      const pindah = setInterval(() => {
        langkah = Math.min(langkah + 1, tahap.length - 1);
        label.textContent = tahap[langkah];
      }, 2200);
      // send() memanggil row.remove(); bersihkan intervalnya di sana supaya
      // label tidak terus berganti setelah jawaban datang.
      const lepas = row.remove.bind(row);
      row.remove = () => { clearInterval(pindah); lepas(); };
      return row;
    }

    function errorRow(message, seconds, onRetry) {
      const row = document.createElement('div');
      row.className = 'tanya-row is-assistant is-error';
      row.innerHTML = `
        <span class="tanya-avatar" aria-hidden="true"><img src="/assets/logo-pii.webp" alt="" onerror="this.onerror=null;this.src='assets/logo-pii.png'"></span>
        <div class="tanya-body"><div class="tanya-msg">
          <p>${escapeHTML(message)}</p>
          <button type="button" class="tanya-retry">Coba lagi</button>
        </div></div>`;
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

    /** Jatah tamu habis: satu jalan keluar fungsional, tanpa gaya promosi. */
    function upgradeRow(message) {
      const boleh = window.PBPIIAkun?.canSignIn?.() !== false;
      const ajakan = boleh
        ? '<button type="button" class="tanya-upgrade" data-tab="daftar">Masuk kader</button>' : '';
      const row = document.createElement('div');
      row.className = 'tanya-row is-assistant is-quota';
      row.innerHTML = `
        <span class="tanya-avatar" aria-hidden="true"><img src="/assets/logo-pii.webp" alt="" onerror="this.onerror=null;this.src='assets/logo-pii.png'"></span>
        <div class="tanya-body"><div class="tanya-msg">
          <p>${escapeHTML(message)}</p>${ajakan}
        </div></div>`;
      row.querySelectorAll('.tanya-upgrade').forEach((button) => {
        button.addEventListener('click', () => window.PBPIIAkun?.openPanel('', button.dataset.tab));
      });
      thread.append(row);
      return row;
    }

    function paint(paksa) {
      thread.replaceChildren();
      turns.forEach((turn, urut) => bubble(turn.role, turn.content, turn.rujukan, turn.status, turn.rujukanWeb, urut));
      intro.hidden = turns.length > 0;
      stick(paksa);
      if (typeof aturBawah === 'function') aturBawah();
    }

    /*
     * Satu pendengar untuk seluruh tombol di wadah percakapan: alat blok kode &
     * terminal dari markdown.js, lalu toolbar jawaban. Gelembung dibuat ulang
     * setiap kali, jadi tidak perlu memasang listener per tombol.
     */
    thread.addEventListener('click', (event) => {
      const tombol = event.target.closest('[data-act]');
      if (!tombol) return;
      const act = tombol.dataset.act;

      if (act === 'kode-salin' || act === 'terminal-perintah' || act === 'terminal-keluaran') {
        const sumber = tombol.closest('[data-kode],[data-perintah]');
        const isi = act === 'terminal-perintah' ? sumber?.dataset.perintah
          : act === 'terminal-keluaran' ? sumber?.dataset.keluaran : sumber?.dataset.kode;
        if (isi) { salinTeks(isi, tombol); toast('Kode disalin.'); }
        return;
      }
      if (act === 'kode-unduh') {
        const sumber = tombol.closest('[data-kode]');
        if (!sumber) return;
        unduhTeks(sumber.dataset.file || 'tanya-pii-kode.txt', sumber.dataset.kode || '', 'text/plain');
        toast('Berkas kode diunduh.');
        return;
      }
      if (act === 'kode-bentang') {
        const wadah = tombol.closest('.tanya-sorot');
        const terbuka = wadah?.classList.toggle('is-terbuka');
        tombol.textContent = terbuka ? 'Sembunyikan sebagian' : `Tampilkan semua ${wadah?.dataset.baris || ''} baris`;
        return;
      }

      const baris = tombol.closest('.tanya-row');
      const urut = Number(baris?.dataset.urut);
      const turn = turns[urut];
      if (!turn) return;

      if (act === 'salin') {
        salinTeks(teksJawaban(turn), tombol);
        toast('Berhasil disalin.');
      } else if (act === 'pdf') {
        cetakJawaban(urut);
      } else if (act === 'suka' || act === 'tidak') {
        turn.rasa = turn.rasa === act ? '' : act;
        save();
        paint();
        toast(turn.rasa ? (act === 'suka' ? 'Tersimpan — terima kasih.' : 'Masukan dicatat — terima kasih.') : 'Penanda dihapus.');
      } else if (act === 'ulang') {
        jawabUlang(urut);
      }
    });

    const halamanTeks = (halaman) => (Array.isArray(halaman) && halaman.length && Number(halaman[0])
      ? (halaman[0] === halaman[1] ? ` (hal. ${halaman[0]})` : ` (hal. ${halaman[0]}-${halaman[1]})`) : '');

    /* ------------------------------------------------------------------ PDF

     * Ekspor PDF memakai lembar cetak sendiri, bukan tangkapan layar: isinya
     * elemen HTML biasa yang disusun ulang di #tanyaPrint, lalu dicetak lewat
     * dialog browser. Stylesheet @media print mengatur A4, kop, penomoran
     * halaman, dan memutus bagian tanpa memotong tabel atau blok kode.
     */
    const TANGGAL = new Intl.DateTimeFormat('id-ID', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    /*
     * Lembar cetak khusus dokumen: judul dokumen menjadi kepala halaman dan
     * pertanyaan penanya tidak ikut dicetak, supaya hasilnya terbaca sebagai
     * surat/proposal/laporan, bukan sebagai tangkapan percakapan.
     */
    function lembarCetak(judul, daftar, dokumen) {
      let lembar = document.querySelector('#tanyaPrint');
      if (!lembar) {
        lembar = document.createElement('div');
        lembar.id = 'tanyaPrint';
        lembar.setAttribute('aria-hidden', 'true');
        document.body.append(lembar);
      }
      const bab = daftar.map((turn) => {
        if (turn.role !== 'assistant') return '';
        const urut = daftar.indexOf(turn);
        const soal = daftar[urut - 1]?.role === 'user' ? daftar[urut - 1].content : '';
        return `<section class="tanya-cetak-bab">
          ${!dokumen && soal ? `<p class="tanya-cetak-label">Pertanyaan</p><h2 class="tanya-cetak-soal">${escapeHTML(soal)}</h2>` : ''}
          ${dokumen ? '' : '<p class="tanya-cetak-label">Jawaban Tanya PII</p>'}
          ${richText(turn.content)}
          ${sumberCetak(turn)}
        </section>`;
      }).join('');
      const kader = window.PBPIIAkun?.account?.().name;
      lembar.innerHTML = `
        <header class="tanya-cetak-kop">
          <img src="/assets/logo-pii.webp" alt="" onerror="this.onerror=null;this.src='assets/logo-pii.png'">
          <span><b>Tanya PII</b><small>Asisten Pelajar Islam Indonesia</small></span>
          <em>Model AI karya Badan Khusus Inovasi Digital PB PII</em>
        </header>
        <h1 class="tanya-cetak-judul">${escapeHTML(judul)}</h1>
        <p class="tanya-cetak-info">Dicetak ${escapeHTML(TANGGAL.format(new Date()))}${kader ? ` · ${escapeHTML(kader)}` : ''}</p>
        <div class="tanya-cetak-isi">${bab}</div>
        <p class="tanya-cetak-kaki">Dokumen ini dihasilkan Tanya PII. Untuk keputusan organisasi,
          konfirmasi ke pengurus PB PII. Rujukan berkas merujuk ke Pustaka Pelajar Islam Indonesia.</p>`;
      return lembar;
    }

    function sumberCetak(turn) {
      const berkas = (turn.rujukan || []).map((sumber) => `<li><b>${escapeHTML(sumber.judul)}</b>${
        escapeHTML(`${sumber.kategori ? ` · ${sumber.kategori}` : ''}${sumber.bab ? ` · ${sumber.bab}` : ''}${halamanTeks(sumber.halaman)}`)}</li>`).join('');
      const daring = (turn.rujukanWeb || []).map((sumber) => `<li><b>${escapeHTML(sumber.judul)}</b> — ${escapeHTML(sumber.url)}</li>`).join('');
      if (!berkas && !daring) return '';
      return `<div class="tanya-cetak-sumber"><p class="tanya-cetak-label">Rujukan</p><ul>${berkas}${daring}</ul></div>`;
    }

    /** Lembar disusun dan diperiksa lebih dulu; dialog hanya terbuka bila isinya nyata. */
    function cetak(judul, daftar, dokumen) {
      const lembar = lembarCetak(judul, daftar, dokumen);
      const isi = lembar.querySelector('.tanya-cetak-isi');
      if (!isi || !isi.textContent.trim()) {
        toast('Dokumen belum tersusun, jadi PDF tidak dibuat.');
        return false;
      }
      document.body.classList.add('tanya-mencetak');
      const selesai = () => {
        document.body.classList.remove('tanya-mencetak');
        window.removeEventListener('afterprint', selesai);
      };
      window.addEventListener('afterprint', selesai);
      setTimeout(() => { window.print(); setTimeout(selesai, 1500); }, 60);
      return true;
    }

    /** Hanya satu jawaban yang dicetak; ekspor seluruh percakapan sudah dicabut. */
    function cetakJawaban(urut) {
      const jawaban = turns[urut];
      const soal = turns[urut - 1]?.content || '';
      const dokumen = adalahDokumen(soal, jawaban?.content);
      cetak(judulDokumen(jawaban?.content) || soal || 'Dokumen Tanya PII',
        turns.slice(Math.max(0, urut - 1), urut + 1), dokumen);
    }

    function salinTeks(teks, tombol) {
      const label = tombol.querySelector('span') || tombol;
      const selesai = () => {
        const asal = label.textContent;
        label.textContent = 'Tersalin';
        setTimeout(() => { label.textContent = asal; }, 1600);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(teks).then(selesai).catch(() => salinCadangan(teks, selesai));
      } else {
        salinCadangan(teks, selesai);
      }
    }

    function salinCadangan(teks, selesai) {
      const area = document.createElement('textarea');
      area.value = teks;
      area.style.cssText = 'position:fixed;top:-60px;opacity:0';
      document.body.append(area);
      area.select();
      try {
        if (document.execCommand('copy')) selesai();
      } catch {
        /* Clipboard ditolak browser: tidak ada yang perlu dirusak. */
      }
      area.remove();
    }

    /** Pertanyaan dan jawabannya dicabut, lalu pertanyaan yang sama dikirim ulang. */
    function jawabUlang(urut) {
      if (busy) return;
      let idxUser = -1;
      for (let i = urut - 1; i >= 0; i -= 1) {
        if (turns[i].role === 'user') { idxUser = i; break; }
      }
      if (idxUser < 0) return;
      const soal = turns[idxUser].content;
      turns.splice(idxUser, urut - idxUser + 1);
      save();
      paint(true);
      send(soal);
    }

    /**
     * Simpan percakapan yang sedang dibuka lalu susun ulang daftar riwayat:
     * yang terbaru selalu di atas, seperti daftar obrolan pada aplikasi pesan.
     */
    const save = () => {
      aktif.turns = turns;
      if (!aktif.judul) aktif.judul = judulDari(turns.find((item) => item.role === 'user')?.content);
      aktif.diubah = Date.now();
      threads = simpanThreads([aktif, ...threads.filter((item) => item.id !== aktif.id)]
        .sort((a, b) => b.diubah - a.diubah));
      aktif = threads.find((item) => item.id === aktifId) || aktif;
      aktifId = aktif.id;
      turns = aktif.turns;
      lukisRiwayat();
    };

    function setBusy(value) {
      busy = value;
      submit.disabled = value;
      input.disabled = value;
      form.classList.toggle('is-busy', value);
      const henti = document.querySelector('#tanyaStop');
      if (henti) henti.hidden = !value;
      submit.classList.toggle('is-tertutup', value);
    }

    /**
     * Cuplikan percakapan yang sedang dibuka, dikirim bersama pertanyaan supaya
     * "terus, yang kedua gimana?" masih tahu yang dimaksud. Hanya enam balasan
     * terakhir dan potongan pendek: konteks dibutuhkan, transkrip penuh tidak.
     */
    function riwayatUntukModel() {
      return turns.slice(0, -1).slice(-6)
        .map((turn) => ({
          role: turn.role,
          content: String(turn.content || '').slice(0, turn.role === 'user' ? 600 : 1200),
        }))
        .filter((turn) => turn.content.length > 1);
    }

    async function send(question) {
      const text = String(question || '').trim();
      if (!text || busy) return;
      clearTimeout(retryTimer);

      /* "Coba lagi" mengirim teks yang sama setelah jawaban gagal. Giliran
         pertanyaannya masih ada di riwayat, jadi jangan ditulis dua kali. */
      const terakhir = turns[turns.length - 1];
      if (!(terakhir && terakhir.role === 'user' && terakhir.content === text)) {
        turns.push({ role: 'user', content: text });
      }
      if (turns.length > MAX_TURNS) turns = turns.slice(-MAX_TURNS);
      paint(true);
      intro.hidden = true;
      input.value = '';
      grow();
      setBusy(true);

      const row = pending(text);
      stick(true);
      pembatal = typeof AbortController === 'function' ? new AbortController() : null;
      const sebelum = riwayatUntukModel();

      try {
        const data = await askServer({
          action: 'chat',
          message: text,
          riwayat: sebelum,
          token: sessionToken(),
          device: deviceId()
        }, pembatal?.signal);
        row.remove();
        const reply = String(data?.reply || '').trim() || 'Layanan AI tidak menghasilkan jawaban.';
        const rujukan = (Array.isArray(data?.rujukan) ? data.rujukan : [])
          .filter((sumber) => sumber?.judul)
          .map((sumber) => ({
            judul: String(sumber.judul).slice(0, 120),
            kategori: String(sumber.kategori || '').slice(0, 40),
            berkas: String(sumber.berkas || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60),
            bab: String(sumber.bab || '').slice(0, 120),
            halaman: Array.isArray(sumber.halaman) ? sumber.halaman.slice(0, 2) : [],
          }));
        const rujukanWeb = (Array.isArray(data?.rujukanWeb) ? data.rujukanWeb : [])
          .filter((sumber) => sumber?.judul && /^https:\/\/[^\s]+$/.test(String(sumber.url || '')))
          .map((sumber) => ({
            judul: String(sumber.judul).slice(0, 140),
            url: String(sumber.url),
          }));
        const status = data?.status === 'no_source' ? 'no_source' : '';
        turns.push({
          role: 'assistant',
          content: reply,
          rujukan,
          rujukanWeb,
          status,
        });
        save();
        paint();
        showQuota(data);
      } catch (error) {
        row.remove();
        if (error?.name === 'AbortError') {
          turns.pop();
          save();
          paint(true);
          toast('Jawaban dihentikan.');
        } else {
          /* Pertanyaan yang gagal dijawab tetap tinggal di riwayat; kalau tidak,
             percakapan lanjutannya hilang begitu halaman dibuka ulang. */
          save();
          paint();
          if (error.code === 'quota') upgradeRow(error.message);
          else errorRow(pesanPembaca(error.message), Number(error.retryAfter) || 0, () => send(text));
        }
        stick();
        loadQuota();
      } finally {
        pembatal = null;
        setBusy(false);
        if (!errorShown()) input.focus();
      }
    }

    const errorShown = () => Boolean(thread.querySelector('.is-error'));

    function showQuota(data) {
      if (typeof data?.sisa !== 'number') return;
      paintMeter({ sisa: data.sisa, batas: data.batas, akun: data.akun || (sessionToken() ? 'akun' : 'tamu') });
    }

    async function loadQuota() {
      try {
        const status = await askServer({ action: 'chatStatus', token: sessionToken(), device: deviceId() });
        paintMeter({
          sisa: status.sisa,
          batas: status.batas,
          akun: status.akun || (sessionToken() ? 'akun' : 'tamu'),
        });
      } catch {
        quota.hidden = true;
      }
    }

    /*
     * Baris kuota hanya angka: tidak ada lagi CTA "Masuk kader, jatah naik
     * jadi 20" di bawah kolom tulis. Bila statusnya tidak diketahui, barisnya
     * disembunyikan daripada menampilkan teks pengantar.
     */
    function paintMeter({ sisa, batas, akun }) {
      if (typeof sisa !== 'number') { quota.hidden = true; return; }
      quota.textContent = `Sisa ${sisa}/${batas || (akun === 'tamu' ? 5 : 20)} pertanyaan hari ini`;
      quota.hidden = false;
    }

    /* ------------------------------------------------------------- panel riwayat

     * Daftar percakapan yang pernah dibuka di perangkat ini. Isinya hanya judul,
     * jumlah balasan, dan kapan terakhir dipakai — cukup untuk mengenali
     * obrolan, tanpa menyalin jawabannya ke tempat lain.
     */
    function lukisRiwayat() {
      if (!panelDaftar) return;
      const isi = threads.filter((item) => item.turns.length);
      if (panelKosong) panelKosong.hidden = isi.length > 0;
      panelDaftar.innerHTML = isi.map((item) => {
        const pertanyaan = item.turns.filter((turn) => turn.role === 'user').length;
        return `
          <li class="tanya-riwayat-item${item.id === aktifId ? ' is-aktif' : ''}" data-id="${escapeHTML(item.id)}">
            <button type="button" class="tanya-riwayat-pilih" data-pilih="${escapeHTML(item.id)}">
              <span class="tanya-riwayat-judul">${escapeHTML(item.judul || 'Percakapan Tanya PII')}</span>
              <span class="tanya-riwayat-meta">${pertanyaan} pertanyaan · ${escapeHTML(waktuLalu(item.diubah))}</span>
            </button>
            <div class="tanya-riwayat-alat">
              <button type="button" class="tanya-riwayat-act" data-riw="ganti" data-id="${escapeHTML(item.id)}"
                aria-label="Ganti nama percakapan ini" title="Ganti nama">${IKON.ganti}</button>
              <button type="button" class="tanya-riwayat-act is-bahaya" data-riw="hapus" data-id="${escapeHTML(item.id)}"
                aria-label="Hapus percakapan ini" title="Hapus">${IKON.hapus}</button>
            </div>
          </li>`;
      }).join('');
      const terpilih = panelDaftar.querySelector('.is-aktif .tanya-riwayat-judul');
      if (terpilih) terpilih.scrollIntoView({ block: 'nearest' });
    }

    function bukaPanel() {
      if (!panel) return;
      lukisRiwayat();
      panel.classList.add('is-open');
      panel.setAttribute('aria-hidden', 'false');
      panelBuka?.setAttribute('aria-expanded', 'true');
      panelBuka?.classList.add('is-aktif');
      panel.querySelector('.tanya-riwayat-panel')?.focus?.();
    }

    function tutupRiwayat() {
      if (!panel) return;
      panel.classList.remove('is-open');
      panel.setAttribute('aria-hidden', 'true');
      panelBuka?.setAttribute('aria-expanded', 'false');
      panelBuka?.classList.remove('is-aktif');
    }

    /** Lembaran baru; percakapan yang sedang berjalan tidak dibuang, hanya ditinggalkan. */
    function buatPercakapan() {
      if (busy) { toast('Tunggu jawaban ini selesai.'); return; }
      clearTimeout(retryTimer);
      if (!turns.length) { input.focus(); return; }
      aktif.turns = turns;
      const baru = threadBaru();
      threads = simpanThreads([baru, ...threads.filter((item) => item.turns.length)]);
      aktif = baru;
      aktifId = baru.id;
      localStorage.setItem(AKTIF_KEY, aktifId);
      turns = aktif.turns;
      paint(true);
      intro.hidden = false;
      lukisRiwayat();
      loadQuota();
      input.focus();
    }

    function bukaPercakapan(id) {
      if (busy) { toast('Tunggu jawaban ini selesai.'); return; }
      const tujuan = threads.find((item) => item.id === id);
      if (!tujuan) return;
      if (tujuan.id === aktifId) { tutupRiwayat(); return; }
      clearTimeout(retryTimer);
      aktif.turns = turns;
      aktif = tujuan;
      aktifId = tujuan.id;
      localStorage.setItem(AKTIF_KEY, aktifId);
      turns = aktif.turns;
      paint(true);
      intro.hidden = turns.length > 0;
      lukisRiwayat();
      tutupRiwayat();
    }

    function hapusPercakapan(id) {
      const target = threads.find((item) => item.id === id);
      if (!target) return;
      threads = threads.filter((item) => item.id !== id);
      if (target.id === aktifId || !threads.length) threads = [threadBaru(), ...threads];
      threads = simpanThreads(threads);
      aktif = threads.find((item) => item.id === aktifId) || threads[0];
      aktifId = aktif.id;
      localStorage.setItem(AKTIF_KEY, aktifId);
      turns = aktif.turns;
      clearTimeout(retryTimer);
      paint(true);
      lukisRiwayat();
      toast('Percakapan dihapus dari riwayat.');
    }

    /**
     * Penghapusan riwayat dikonfirmasi di dalam barisnya sendiri, memakai
     * bentuk yang sama dengan hapus kabar pada Feed.
     */
    function konfirmasiHapus(id, baris) {
      baris.classList.add('is-konfirmasi');
      baris.innerHTML = `
        <span class="tanya-riwayat-tanya">Hapus percakapan ini dari riwayat?</span>
        <span class="tanya-riwayat-ya">
          <button type="button" class="tanya-riwayat-ya-hapus" data-riw="hapus-yakin" data-id="${escapeHTML(id)}">Ya, hapus</button>
          <button type="button" data-riw="batal">Batal</button>
        </span>`;
    }

    /** Ganti nama tanpa dialog browser: judulnya berubah menjadi kolom isian. */
    function gantiNama(id) {
      const item = threads.find((thread) => thread.id === id);
      const baris = panelDaftar?.querySelector(`.tanya-riwayat-item[data-id="${CSS.escape(id)}"]`);
      if (!item || !baris) return;
      const pilih = baris.querySelector('.tanya-riwayat-pilih');
      const alat = baris.querySelector('.tanya-riwayat-alat');
      pilih.hidden = true;
      alat.hidden = true;
      const kolom = document.createElement('input');
      kolom.className = 'tanya-riwayat-input';
      kolom.type = 'text';
      kolom.maxLength = 60;
      kolom.value = item.judul || '';
      kolom.placeholder = 'Nama percakapan';
      kolom.setAttribute('aria-label', 'Nama percakapan');
      baris.prepend(kolom);
      kolom.focus();
      kolom.select();
      const selesai = (simpan) => {
        const teks = String(kolom.value || '').trim();
        if (simpan && teks) {
          item.judul = teks.slice(0, 60);
          item.diubah = item.diubah || Date.now();
          threads = simpanThreads(threads);
        }
        lukisRiwayat();
      };
      kolom.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); selesai(true); }
        if (event.key === 'Escape') { event.preventDefault(); selesai(false); }
      });
      kolom.addEventListener('blur', () => selesai(true));
    }

    panelBuka?.addEventListener('click', () => (panel?.classList.contains('is-open') ? tutupRiwayat() : bukaPanel()));
    panel?.querySelector('.tanya-riwayat-backdrop')?.addEventListener('click', tutupRiwayat);
    panel?.querySelector('#tanyaRiwayatTutup')?.addEventListener('click', tutupRiwayat);
    panel?.querySelector('#tanyaRiwayatBaru')?.addEventListener('click', () => { buatPercakapan(); tutupRiwayat(); });
    panelDaftar?.addEventListener('click', (event) => {
      const alat = event.target.closest('[data-riw]');
      if (alat) {
        const baris = alat.closest('.tanya-riwayat-item');
        if (alat.dataset.riw === 'hapus') konfirmasiHapus(alat.dataset.id, baris);
        else if (alat.dataset.riw === 'hapus-yakin') hapusPercakapan(alat.dataset.id);
        else if (alat.dataset.riw === 'batal') lukisRiwayat();
        else gantiNama(alat.dataset.id);
        return;
      }
      const pilih = event.target.closest('[data-pilih]');
      if (pilih) bukaPercakapan(pilih.dataset.pilih);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') tutupRiwayat();
    });

    // Tinggi textarea mengikuti isi; sisanya menggulir di dalam kolom (lihat max-height CSS).
    const grow = () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 110)}px`;
    };

    input.addEventListener('input', grow);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send(input.value);
        return;
      }
      if (event.key === 'Escape') tutupRiwayat();
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      send(input.value);
    });
    reset?.addEventListener('click', buatPercakapan);

    document.querySelector('#tanyaStop')?.addEventListener('click', () => pembatal?.abort());

    /** Tombol lompat ke bawah: hanya muncul saat pembaca sedang menggulir ke atas. */
    const bawah = document.querySelector('#tanyaBawah');
    const aturBawah = () => {
      if (bawah) bawah.hidden = !thread.children.length || dekatBawah();
    };
    scroll.addEventListener('scroll', aturBawah, { passive: true });
    bawah?.addEventListener('click', () => { stick(true); aturBawah(); });

    // Ganti akun (misal baru daftar) langsung memperbarui jatah yang tampil.
    let tokenTerakhir = sessionToken();
    window.PBPIIAkun?.onChange?.(() => {
      if (sessionToken() === tokenTerakhir) return;
      tokenTerakhir = sessionToken();
      loadQuota();
    });

    // Papan ketik ponsel tidak boleh menutupi kolom tulis, terutama di iOS.
    const viewport = window.visualViewport;
    /** Tinggi komposer dipakai tombol "ke bawah" agar tidak menimpa kolom tulis. */
    const ukurKomposer = () => document.documentElement.style
      .setProperty('--tanya-composer-tinggi', `${form.offsetHeight}px`);
    ukurKomposer();
    // Komposer tumbuh saat menulis, bukan hanya saat jendela berubah ukuran.
    if (typeof ResizeObserver === 'function') new ResizeObserver(ukurKomposer).observe(form);
    else window.addEventListener('resize', ukurKomposer);
    if (viewport) {
      const ukur = () => {
        const naik = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
        const terbuka = naik > 60;
        document.documentElement.style.setProperty('--tanya-keyboard', `${terbuka ? naik : 0}px`);
        document.body.classList.toggle('tanya-keyboard-up', terbuka);
        ukurKomposer();
        if (terbuka) stick(true);
      };
      viewport.addEventListener('resize', ukur);
      viewport.addEventListener('scroll', ukur);
    }

    paint(true);
    lukisRiwayat();
    loadQuota();
    /* Serah-terima dari pembaca Pustaka: pertanyaan tentang bagian yang sedang
       dibaca sudah tersusun di URL, tinggal diperiksa lalu dikirim sendiri.
       Pertanyaan ini dibuka sebagai percakapan baru supaya riwayat yang sedang
       tampil tidak ikut terbawa ke jawabannya. */
    const bawaan = String(new URLSearchParams(window.location.search).get('tanya') || '').slice(0, 500);
    if (bawaan) {
      if (turns.length) buatPercakapan();
      input.value = bawaan;
      grow();
      input.focus({ noScroll: true });
      try {
        window.history.replaceState({}, '', window.location.pathname);
      } catch { /* pratinjau lokal tanpa server: biarkan alamatnya apa adanya */ }
    } else if (!window.matchMedia('(pointer: coarse)').matches) input.focus({ noScroll: true });
  }

  if (document.querySelector('#tanyaThread')) {
    document.addEventListener('DOMContentLoaded', initChat);
  }
})();
