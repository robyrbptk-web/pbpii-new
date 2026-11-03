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
  const THREAD_VERSION_KEY = 'pbpii_tanya_thread_version';
  const DEVICE_KEY = 'pbpii_tanya_device';
  const MAX_TURNS = 12;
  /** Versi 3: jawaban boleh tanpa rujukan berkas dan menyimpan tautan web. */
  const THREAD_VERSION = '3';

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

  /** Nama berkas unduhan, diambil dari pertanyaan yang dijawab. */
  function namaBerkas(soal, tambahan) {
    const ringkas = String(soal || '').replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 38).replace(/^-+|-+$/g, '').toLowerCase();
    return `tanya-pii-${ringkas || 'jawaban'}${tambahan || ''}`;
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
    if (!scroll || !thread || !form) return;

    if (localStorage.getItem(THREAD_VERSION_KEY) !== THREAD_VERSION) {
      localStorage.removeItem(THREAD_KEY);
      localStorage.setItem(THREAD_VERSION_KEY, THREAD_VERSION);
    }

    let turns = [];
    try {
      const stored = JSON.parse(localStorage.getItem(THREAD_KEY) || '[]');
      turns = Array.isArray(stored) ? stored.slice(-MAX_TURNS) : [];
    } catch { turns = []; }

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
     * Nama berkas + halaman yang tadi dikutip model. Isinya tidak ikut dikirim ke
     * browser, hanya judul, kategori, dan nomor halaman sebagai rujukan pembaca.
     * Rujukan web ditampilkan sebagai tautan supaya sumbernya bisa diperiksa.
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
        const halaman = Array.isArray(sumber.halaman) && sumber.halaman.length
          ? (sumber.halaman[0] === sumber.halaman[1] ? ` hal. ${sumber.halaman[0]}` : ` hal. ${sumber.halaman[0]}-${sumber.halaman[1]}`)
          : '';
        const kategori = sumber.kategori ? `${sumber.kategori} ·` : '';
        return `<li><span>${escapeHTML(sumber.judul)}</span><em>${escapeHTML(`${kategori}${halaman}`)}</em></li>`;
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
      unduh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19h14"/></svg>',
      pdf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7L18 7.5V20H7z"/><path d="M14 3.5V7.5H18"/><path d="M9.5 16.5v-4h1.2a1.3 1.3 0 0 1 0 2.6H9.5"/><path d="M13.5 16.5v-4h1.1a1.9 1.9 0 0 1 0 4z"/></svg>',
      naik: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 21v-9l4.2-8.4a1.6 1.6 0 0 1 3 1.1L12.8 11H19l-2.2 8a1.6 1.6 0 0 1-1.6 1.2H7Z"/></svg>',
      turun: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v9l4.2 8.4a1.6 1.6 0 0 0 3-1.1L12.8 13H19l-2.2-8A1.6 1.6 0 0 0 15.2 3H7Z"/></svg>',
    };

    const ALAT_JAWABAN = [
      ['salin', 'Salin jawaban', 'Salin', IKON.salin],
      ['markdown', 'Unduh jawaban sebagai berkas Markdown', 'Markdown', IKON.unduh],
      ['txt', 'Unduh jawaban sebagai berkas teks', 'TXT', IKON.unduh],
      ['pdf', 'Ekspor jawaban ini ke PDF', 'PDF', IKON.pdf],
    ];
    const ALAT_PERASA = [
      ['suka', 'Jawaban ini membantu', IKON.naik],
      ['tidak', 'Jawaban ini kurang membantu', IKON.turun],
    ];

    /**
     * Toolbar di bawah setiap jawaban: salin, unduh Markdown/TXT, ekspor PDF,
     * penanda bantuan, dan jawab ulang. Tombol hanya ikon di layar sempit.
     */
    function alatBlok(urut, turn) {
      const kiri = ALAT_JAWABAN.map(([act, label, teks, ikon]) =>
        `<button type="button" class="tanya-act" data-act="${act}" aria-label="${label}" title="${label}">${ikon}<span>${teks}</span></button>`).join('');
      const rasa = ALAT_PERASA.map(([act, label, ikon]) =>
        `<button type="button" class="tanya-act is-rasa${turn?.rasa === act ? ' is-aktif' : ''}" data-act="${act}"`
        + ` aria-label="${label}" aria-pressed="${turn?.rasa === act ? 'true' : 'false'}" title="${label}">${ikon}</button>`).join('');
      const ulang = `<button type="button" class="tanya-act" data-act="ulang" aria-label="Jawab ulang pertanyaan ini" title="Jawab ulang">${IKON.ulang}<span>Ulangi</span></button>`;
      return `<div class="tanya-actions"><span class="tanya-actions_kiri">${kiri}</span>`
        + `<span class="tanya-actions_kanan">${rasa}${ulang}</span></div>`;
    }

    function bubble(role, content, rujukan, status, rujukanWeb, urut) {
      const row = document.createElement('div');
      row.className = `tanya-row is-${role}`;
      if (typeof urut === 'number') row.dataset.urut = String(urut);
      const turn = typeof urut === 'number' ? turns[urut] : null;
      const pesan = `<div class="tanya-msg">${richText(content)}${role === 'assistant' ? sumberBlok(rujukan, rujukanWeb, status) : ''}</div>`;
      row.innerHTML = role === 'assistant'
        ? `<span class="tanya-avatar" aria-hidden="true"><img src="/assets/logo-pii.png" alt="" onerror="this.onerror=null;this.src='assets/logo-pii.png'"></span>
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
          <img src="/assets/logo-pii.png" alt="" onerror="this.onerror=null;this.src='assets/logo-pii.png'">
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
        <span class="tanya-avatar" aria-hidden="true"><img src="/assets/logo-pii.png" alt=""></span>
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
      const soal = urut > 0 ? turns[urut - 1]?.content : '';

      if (act === 'salin') {
        salinTeks(teksJawaban(turn), tombol);
        toast('Berhasil disalin.');
      } else if (act === 'markdown') {
        unduhTeks(`${namaBerkas(soal)}.md`, salinanMarkdown(turn), 'text/markdown');
        toast('Berkas Markdown diunduh.');
      } else if (act === 'txt') {
        const teks = window.PBPIIMarkdown?.toPlainText
          ? window.PBPIIMarkdown.toPlainText(teksJawaban(turn)) : teksJawaban(turn);
        unduhTeks(`${namaBerkas(soal)}.txt`, `${soal ? `${soal}\n${'='.repeat(Math.min(60, soal.length))}\n\n` : ''}${teks}\n`, 'text/plain');
        toast('Berkas TXT diunduh.');
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

    /** Berkas .md: pertanyaan + jawaban mentah, rujukan di bawah sebagai catatan. */
    function salinanMarkdown(turn) {
      const urut = turns.indexOf(turn);
      const soal = urut > 0 ? turns[urut - 1]?.content : '';
      const sumber = rujukanTeks(turn);
      return [
        soal ? `# ${soal}\n` : '',
        teksJawaban(turn),
        sumber ? `\n\n---\n\n## Rujukan\n\n${sumber}` : '',
        '\n\n_Dijawab oleh Tanya PII — Asisten Pelajar Islam Indonesia, Badan Khusus Inovasi Digital PB PII._\n',
      ].join('\n');
    }

    function rujukanTeks(turn) {
      const berkas = (turn.rujukan || []).map((s) => `- **${s.judul}**${s.kategori ? ` — ${s.kategori}` : ''}${halamanTeks(s.halaman)}`);
      const daring = (turn.rujukanWeb || []).map((s) => `- [${s.judul}](${s.url})`);
      return [...berkas, ...daring].join('\n');
    }

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

    function lembarCetak(judul, daftar) {
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
          ${soal ? `<p class="tanya-cetak-label">Pertanyaan</p><h2 class="tanya-cetak-soal">${escapeHTML(soal)}</h2>` : ''}
          <p class="tanya-cetak-label">Jawaban Tanya PII</p>
          ${richText(turn.content)}
          ${sumberCetak(turn)}
        </section>`;
      }).join('');
      const kader = window.PBPIIAkun?.account?.().name;
      lembar.innerHTML = `
        <header class="tanya-cetak-kop">
          <img src="/assets/logo-pii.png" alt="">
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
        escapeHTML(`${sumber.kategori ? ` · ${sumber.kategori}` : ''}${halamanTeks(sumber.halaman)}`)}</li>`).join('');
      const daring = (turn.rujukanWeb || []).map((sumber) => `<li><b>${escapeHTML(sumber.judul)}</b> — ${escapeHTML(sumber.url)}</li>`).join('');
      if (!berkas && !daring) return '';
      return `<div class="tanya-cetak-sumber"><p class="tanya-cetak-label">Rujukan</p><ul>${berkas}${daring}</ul></div>`;
    }

    function cetak(judul, daftar) {
      if (!daftar.length) { toast('Belum ada jawaban untuk diekspor.'); return; }
      lembarCetak(judul, daftar);
      document.body.classList.add('tanya-mencetak');
      const selesai = () => {
        document.body.classList.remove('tanya-mencetak');
        window.removeEventListener('afterprint', selesai);
      };
      window.addEventListener('afterprint', selesai);
      setTimeout(() => { window.print(); setTimeout(selesai, 1500); }, 60);
    }

    function cetakJawaban(urut) {
      const jawaban = turns[urut];
      const soal = turns[urut - 1]?.content || 'Jawaban Tanya PII';
      cetak(soal, turns.slice(Math.max(0, urut - 1), urut + 1));
    }

    function cetakPercakapan() {
      const pertama = turns.find((turn) => turn.role === 'user');
      cetak(pertama ? `Percakapan Tanya PII — ${pertama.content.slice(0, 60)}` : 'Percakapan Tanya PII', turns);
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

    const save = () => {
      localStorage.setItem(THREAD_KEY, JSON.stringify(turns.slice(-MAX_TURNS)));
      localStorage.setItem(THREAD_VERSION_KEY, THREAD_VERSION);
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

    async function send(question) {
      const text = String(question || '').trim();
      if (!text || busy) return;
      clearTimeout(retryTimer);

      turns.push({ role: 'user', content: text });
      if (turns.length > MAX_TURNS) turns = turns.slice(-MAX_TURNS);
      paint(true);
      intro.hidden = true;
      input.value = '';
      grow();
      setBusy(true);

      const row = pending(text);
      stick(true);
      const start = Date.now();
      pembatal = typeof AbortController === 'function' ? new AbortController() : null;

      try {
        const data = await askServer({
          action: 'chat',
          message: text,
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
        showQuota(data, start);
      } catch (error) {
        row.remove();
        paint();
        if (error?.name === 'AbortError') {
          turns.pop();
          save();
          paint(true);
          toast('Jawaban dihentikan.');
        } else if (error.code === 'quota') upgradeRow(error.message);
        else errorRow(error.message, Number(error.retryAfter) || 0, () => send(text));
        stick();
        loadQuota();
      } finally {
        pembatal = null;
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
    reset?.addEventListener('click', () => {
      clearTimeout(retryTimer);
      turns = [];
      localStorage.removeItem(THREAD_KEY);
      localStorage.setItem(THREAD_VERSION_KEY, THREAD_VERSION);
      paint(true);
      intro.hidden = false;
      loadQuota();
      input.focus();
    });

    document.querySelector('#tanyaStop')?.addEventListener('click', () => pembatal?.abort());
    document.querySelector('#tanyaExport')?.addEventListener('click', cetakPercakapan);

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
    window.addEventListener('resize', ukurKomposer);
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
    loadQuota();
    if (!window.matchMedia('(pointer: coarse)').matches) input.focus({ noScroll: true });
  }

  if (document.querySelector('#tanyaThread')) {
    document.addEventListener('DOMContentLoaded', initChat);
  }
})();
