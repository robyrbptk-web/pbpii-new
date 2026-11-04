/*
 * Editor Visual/Kode untuk artikel dan surat.
 *
 * Bentuknya mengikuti penyunting yang sudah dikenal penulis: satu baris berisi
 * tombol media dan tab Visual | Kode, satu deret ikon pemformatan, lalu bidang
 * tulis. Kedua tab memakai satu daftar putih yang sama setiap kali berpindah,
 * jadi apa yang terlihat di mode Visual tidak pernah berbeda dengan yang
 * dikirim ke server.
 */
(() => {
  const BLOK = [
    ['p', 'Paragraf'],
    ['h2', 'Judul 2'],
    ['h3', 'Judul 3'],
    ['h4', 'Subjudul'],
    ['blockquote', 'Kutipan'],
  ];

  const DIIZINKAN = new Set([
    'p', 'div', 'br', 'hr', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'del',
    'sub', 'sup', 'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'span', 'font',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
  ]);
  const DIBLOKIR = new Set(['script', 'style', 'iframe', 'object', 'svg', 'math', 'template', 'form', 'link', 'meta', 'button']);
  const KOSONG = new Set(['br', 'hr', 'img']);
  const BLOK_SEJAJAR = new Set(['p', 'div', 'h2', 'h3', 'h4', 'blockquote', 'li', 'td', 'th']);
  const ANGKA_TABEL = new Set(['colspan', 'rowspan']);

  const escapeHTML = (value) => String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function tautanAman(value) {
    const href = String(value || '').trim();
    if (/^https:\/\/[^\s]+$/i.test(href) || /^mailto:[^\s@]+@[^\s@]+$/i.test(href)) return href;
    if (/^(?:\/(?!\/)|#|\.\/|\.\.\/)[^\s]*$/.test(href) && !/[\\\u0000-\u001f]/.test(href)) return href;
    return '';
  }

  /* Angka kolom dan baris tabel ditahan sebagai bilangan bulat kecil; atribut
     apa pun yang bisa membawa gaya atau pemroses tidak ikut tersalin. */
  function spanSel(nama, nilai) {
    if (!ANGKA_TABEL.has(nama)) return '';
    const angka = parseInt(String(nilai || '').trim(), 10);
    return Number.isFinite(angka) && angka >= 1 && angka <= 20 ? String(angka) : '';
  }

  /* Halaman yang tidak punya aturan gambar sendiri hanya boleh menyalin sumber
     yang benar-benar bisa dibuka pembaca. */
  function sumberAman(value) {
    const src = String(value || '').trim();
    return /^https:\/\/[^\s]+$/i.test(src) || /^data:image\/[a-z+.-]+;base64,[a-z0-9+/=]+$/i.test(src) ? src : '';
  }

  /**
   * Menyaring markup. `opsi.gambar(node, untukDisimpan)` mengembalikan
   * atribut yang boleh dipakai untuk <img> atau null supaya gambar dibuang;
   * halaman artikel dan halaman surat punya perlakuan gambar berbeda.
   */
  function saring(raw, opsi = {}) {
    const teks = String(raw || '');
    if (!/<\s*[a-z/][^>]*>/i.test(teks)) {
      return teks.split(/\n\s*\n/).map((bagian) => (bagian.trim()
        ? '<p>' + escapeHTML(bagian).replace(/\n/g, '<br>') + '</p>'
        : '')).filter(Boolean).join('');
    }
    const sumber = new DOMParser().parseFromString(teks, 'text/html');
    const salin = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || '');
      if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
      const asal = node.tagName.toLowerCase();
      if (DIBLOKIR.has(asal)) return document.createDocumentFragment();
      if (asal === 'font') return salin(gantiFont(node));
      if (!DIIZINKAN.has(asal)) {
        const pecahan = document.createDocumentFragment();
        node.childNodes.forEach((anak) => pecahan.append(salin(anak)));
        return pecahan;
      }
      const elemen = document.createElement(asal);
      if (asal === 'a') {
        const href = tautanAman(node.getAttribute('href'));
        if (href) {
          elemen.setAttribute('href', href);
          elemen.setAttribute('rel', 'noopener noreferrer');
        }
      } else if (asal === 'img') {
        const atribut = opsi.gambar
          ? opsi.gambar(node, !!opsi.untukDisimpan)
          : { src: sumberAman(node.getAttribute('src')), alt: String(node.getAttribute('alt') || '').slice(0, 300) };
        if (!atribut || !atribut.src) return document.createDocumentFragment();
        Object.keys(atribut).forEach((nama) => {
          if (nama.indexOf('data-') === 0 || ['src', 'alt', 'loading'].indexOf(nama) >= 0) {
            elemen.setAttribute(nama, String(atribut[nama]));
          }
        });
        elemen.setAttribute('loading', 'lazy');
        return elemen;
      } else if (asal === 'span') {
        const ukuran = node.getAttribute('data-size');
        if (['small', 'normal', 'large'].indexOf(ukuran) >= 0) elemen.dataset.size = ukuran;
        const huruf = node.getAttribute('data-font');
        if (['serif', 'sans'].indexOf(huruf) >= 0) elemen.dataset.font = huruf;
      } else if (asal === 'td' || asal === 'th') {
        ['colspan', 'rowspan'].forEach((nama) => {
          const nilai = spanSel(nama, node.getAttribute(nama));
          if (nilai) elemen.setAttribute(nama, nilai);
        });
      }
      if (BLOK_SEJAJAR.has(asal)) {
        const rata = String(node.style.textAlign || '').toLowerCase();
        if (['left', 'center', 'right', 'justify'].indexOf(rata) >= 0) elemen.style.textAlign = rata;
      }
      if (!KOSONG.has(asal)) node.childNodes.forEach((anak) => elemen.append(salin(anak)));
      return elemen;
    };
    const keluar = document.createElement('div');
    sumber.body.childNodes.forEach((node) => keluar.append(salin(node)));
    return keluar.innerHTML;
  }

  /* <font> warisan dari toolbar lama dipetakan ke span bertanda, bukan
     dibiarkan sebagai elemen yang tidak dikenal daftar putih. */
  function gantiFont(node) {
    const span = document.createElement('span');
    const ukuran = node.getAttribute('size');
    if (['1', '2'].indexOf(ukuran) >= 0) span.dataset.size = 'small';
    else if (['4', '5', '6', '7'].indexOf(ukuran) >= 0) span.dataset.size = 'large';
    const huruf = String(node.getAttribute('face') || '').toLowerCase();
    if (/georgia|times|serif/.test(huruf)) span.dataset.font = 'serif';
    else if (/arial|sans/.test(huruf)) span.dataset.font = 'sans';
    while (node.firstChild) span.append(node.firstChild);
    return span;
  }

  /* Tampilan tab Kode: satu elemen per baris supaya mudah dibaca dan diedit. */
  function rapikan(html) {
    return String(html || '')
      .replace(/<\/(p|h2|h3|h4|blockquote|li|tr|div|table|ul|ol)>/gi, '</$1>\n')
      .replace(/<(p|h2|h3|h4|blockquote|ul|ol|table|thead|tbody|tr|div)(\s[^>]*)?>/gi, '\n<$1$2>')
      .split('\n')
      .map((baris) => baris.trim())
      .filter(Boolean)
      .join('\n');
  }

  const IKON = {
    b: '<b>B</b>',
    i: '<i>I</i>',
    u: '<u>U</u>',
    s: '<s>S</s>',
    poin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="5" cy="6" r="1.4"/><circle cx="5" cy="12" r="1.4"/><circle cx="5" cy="18" r="1.4"/></svg>',
    nomor: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 5.5h1.6V9M4 15.5h2M4 15.5v1.6h2M4 20h2"/></svg>',
    kutip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7c-2.5 1-4 3.2-4 6v4h5v-5H6.6C6.9 10.4 7.9 9 9.6 8.2Z"/><path d="M18 7c-2.5 1-4 3.2-4 6v4h5v-5h-3.4c.3-1.6 1.3-3 3-3.8Z"/></svg>',
    kiri: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 10h10M4 14h16M4 18h10"/></svg>',
    tengah: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 10h10M4 14h16M7 18h10"/></svg>',
    kanan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M10 10h10M4 14h16M10 18h10"/></svg>',
    taut: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 14.5 14.5 9.5"/><path d="M13 7.5 14.6 6a4 4 0 0 1 5.6 5.6l-1.6 1.6M11 16.5l-1.6 1.6A4 4 0 0 1 3.8 12.5l1.6-1.6"/></svg>',
    lepas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8 4.5 4.5M16 16l3.5 3.5M13 7.5 14.6 6a4 4 0 0 1 5.6 5.6l-1.6 1.6M11 16.5l-1.6 1.6A4 4 0 0 1 3.8 12.5l1.6-1.6"/></svg>',
    tabel: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="1.6"/><path d="M3.5 9.5h17M9.5 9.5V19M15 9.5V19M3.5 14h17"/></svg>',
    garis: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M6 7h12M6 17h12"/></svg>',
    bersih: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>',
    undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 8H5V4"/><path d="M5.5 8.5A7.5 7.5 0 1 1 5 15"/></svg>',
    redo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 8h4V4"/><path d="M18.5 8.5A7.5 7.5 0 1 0 19 15"/></svg>',
    media: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 17.5 4.7-4.6 3.2 3 2.6-2.5 4 4"/></svg>',
  };

  function tombol(aksi, label, isi, nilai) {
    return `<button type="button" class="wp-btn" data-aksi="${aksi}"${
      nilai ? ` data-nilai="${nilai}"` : ''} title="${label}" aria-label="${label}">${isi}</button>`;
  }

  function mount(pilihan) {
    const host = pilihan.host;
    if (!host) return null;
    const gambar = typeof pilihan.gambar === 'function' ? pilihan.gambar : null;
    const placeholder = pilihan.placeholder
      || 'Tulis di sini. Gunakan toolbar untuk format, tautan, gambar, dan tabel.';

    host.classList.add('wp-editor');
    host.innerHTML = `
      <div class="wp-bar">
        <button type="button" class="wp-media">${IKON.media}<span>Tambahkan media</span></button>
        <div class="wp-tabs" role="tablist" aria-label="Mode penyuntingan">
          <button type="button" role="tab" class="is-active" data-mode="visual" aria-selected="true">Visual</button>
          <button type="button" role="tab" data-mode="code" aria-selected="false">Kode</button>
        </div>
        <span class="wp-hitung" aria-live="polite">0 kata</span>
      </div>
      <div class="wp-tools" role="toolbar" aria-label="Pemformatan">
        <select class="wp-blok" aria-label="Jenis blok">
          ${BLOK.map(([tag, label]) => `<option value="${tag}">${label}</option>`).join('')}
          <option value="">—</option>
        </select>
        ${tombol('bold', 'Tebal', IKON.b)}
        ${tombol('italic', 'Miring', IKON.i)}
        ${tombol('underline', 'Garis bawah', IKON.u)}
        ${tombol('strikeThrough', 'Coret', IKON.s)}
        <span class="wp-pemisah" aria-hidden="true"></span>
        ${tombol('insertUnorderedList', 'Daftar berpoin', IKON.poin)}
        ${tombol('insertOrderedList', 'Daftar bernomor', IKON.nomor)}
        ${tombol('formatBlock', 'Kutipan', IKON.kutip, 'blockquote')}
        <span class="wp-pemisah" aria-hidden="true"></span>
        ${tombol('justifyLeft', 'Rata kiri', IKON.kiri)}
        ${tombol('justifyCenter', 'Rata tengah', IKON.tengah)}
        ${tombol('justifyRight', 'Rata kanan', IKON.kanan)}
        <span class="wp-pemisah" aria-hidden="true"></span>
        ${tombol('link', 'Sisipkan tautan', IKON.taut)}
        ${tombol('unlink', 'Lepas tautan', IKON.lepas)}
        ${tombol('table', 'Sisipkan tabel', IKON.tabel)}
        ${tombol('insertHorizontalRule', 'Garis pemisah', IKON.garis)}
        <span class="wp-pemisah" aria-hidden="true"></span>
        ${tombol('undo', 'Urungkan', IKON.undo)}
        ${tombol('redo', 'Ulangi', IKON.redo)}
        ${tombol('removeFormat', 'Hapus pemformatan', IKON.bersih)}
      </div>
      <div class="wp-lapangan">
        <div class="wp-kaya" contenteditable="true" role="textbox" aria-multiline="true"
             data-placeholder="${escapeHTML(placeholder)}"></div>
        <textarea class="wp-kode" spellcheck="false" wrap="soft" aria-label="HTML artikel"></textarea>
      </div>
      <input class="wp-berkas" type="file" accept="image/*" hidden>`;

    const kaya = host.querySelector('.wp-kaya');
    if (pilihan.id) kaya.id = pilihan.id;
    const kode = host.querySelector('.wp-kode');
    const berkas = host.querySelector('.wp-berkas');
    const hitung = host.querySelector('.wp-hitung');
    const blok = host.querySelector('.wp-blok');
    let mode = 'visual';
    let simpanan = null;

    const baca = () => (mode === 'code' ? saring(kode.value, { untukDisimpan: true, gambar }) : kaya.innerHTML);

    function ubah() {
      const kata = kaya.textContent.trim().split(/\s+/).filter(Boolean).length;
      hitung.textContent = `${kata} kata · ${kata ? Math.max(1, Math.ceil(kata / 200)) : 0} menit baca`;
      if (pilihan.onChange) pilihan.onChange(baca());
    }

    function blokAktif() {
      const awal = window.getSelection()?.anchorNode;
      const simpul = awal && kaya.contains(awal) ? awal.parentElement : null;
      const leluhur = simpul && simpul.closest('p,h2,h3,h4,blockquote,li,td,th,div');
      const tag = leluhur ? leluhur.tagName.toLowerCase() : 'p';
      blok.value = BLOK.some(([isi]) => isi === tag) ? tag : '';
    }

    function simpanPilihan() {
      const seleksi = window.getSelection();
      if (seleksi && seleksi.rangeCount && kaya.contains(seleksi.anchorNode)) {
        simpanan = seleksi.getRangeAt(0).cloneRange();
      }
    }

    function pulihkanPilihan() {
      kaya.focus();
      if (!simpanan) return;
      const seleksi = window.getSelection();
      seleksi.removeAllRanges();
      seleksi.addRange(simpanan);
    }

    function sisip(html) {
      if (mode !== 'visual') kembaliVisual();
      pulihkanPilihan();
      document.execCommand('insertHTML', false, html);
      simpanPilihan();
      ubah();
    }

    function keKode() {
      kode.value = rapikan(saring(kaya.innerHTML, { untukDisimpan: true, gambar }));
      mode = 'code';
      host.dataset.mode = 'code';
      host.querySelectorAll('.wp-tabs [data-mode]').forEach((tab) => {
        const aktif = tab.dataset.mode === 'code';
        tab.classList.toggle('is-active', aktif);
        tab.setAttribute('aria-selected', String(aktif));
      });
      host.querySelector('.wp-tools').setAttribute('aria-disabled', 'true');
    }

    function kembaliVisual() {
      kaya.innerHTML = saring(kode.value, { untukDisimpan: false, gambar });
      mode = 'visual';
      host.dataset.mode = 'visual';
      host.querySelectorAll('.wp-tabs [data-mode]').forEach((tab) => {
        const aktif = tab.dataset.mode === 'visual';
        tab.classList.toggle('is-active', aktif);
        tab.setAttribute('aria-selected', String(aktif));
      });
      host.querySelector('.wp-tools').removeAttribute('aria-disabled');
    }

    host.querySelectorAll('.wp-tabs [data-mode]').forEach((tab) => {
      tab.addEventListener('click', () => {
        if (tab.dataset.mode === mode) return;
        if (tab.dataset.mode === 'code') keKode();
        else kembaliVisual();
        ubah();
      });
    });

    host.querySelector('.wp-tools').addEventListener('mousedown', (event) => {
      if (event.target.closest('button,select')) simpanPilihan();
    });
    host.querySelector('.wp-tools').addEventListener('click', (event) => {
      const tombolAktif = event.target.closest('[data-aksi]');
      if (!tombolAktif || mode !== 'visual') return;
      const aksi = tombolAktif.dataset.aksi;
      pulihkanPilihan();
      if (aksi === 'link') {
        const href = tautanAman(window.prompt(
          'Masukkan URL HTTPS, alamat email, atau tautan bagian halaman:', 'https://'));
        if (href) document.execCommand('createLink', false, href);
      } else if (aksi === 'table') {
        document.execCommand('insertHTML', false, `<table><thead><tr><th>Keterangan</th><th>Jumlah</th></tr></thead>`
          + '<tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p><br></p>');
      } else {
        const nilai = tombolAktif.dataset.nilai;
        document.execCommand(aksi, false, nilai ? `<${nilai}>` : null);
      }
      simpanPilihan();
      blokAktif();
      ubah();
    });

    blok.addEventListener('change', () => {
      if (!blok.value || mode !== 'visual') return;
      pulihkanPilihan();
      document.execCommand('formatBlock', false, `<${blok.value}>`);
      simpanPilihan();
      ubah();
    });

    const media = host.querySelector('.wp-media');
    media.addEventListener('click', () => {
      if (mode === 'code') return;
      simpanPilihan();
      berkas.click();
    });
    berkas.addEventListener('change', async () => {
      const file = berkas.files && berkas.files[0];
      if (!file) return;
      media.disabled = true;
      try {
        const src = await pilihan.ambilGambar(file);
        if (src) {
          sisip(pilihan.gambarTag
            ? pilihan.gambarTag(src)
            : `<img src="${escapeHTML(src)}" alt="">`);
        }
      } catch (error) {
        if (pilihan.gagal) pilihan.gagal(error);
      } finally {
        berkas.value = '';
        media.disabled = false;
      }
    });

    kaya.addEventListener('input', () => { blokAktif(); ubah(); });
    kaya.addEventListener('keyup', () => { simpanPilihan(); blokAktif(); });
    kaya.addEventListener('mouseup', () => { simpanPilihan(); blokAktif(); });
    kaya.addEventListener('focus', simpanPilihan);
    kaya.addEventListener('paste', (event) => {
      event.preventDefault();
      const html = event.clipboardData.getData('text/html');
      sisip(html ? saring(html, { gambar }) : escapeHTML(event.clipboardData.getData('text/plain')).replace(/\n/g, '<br>'));
    });
    kaya.addEventListener('drop', (event) => {
      event.preventDefault();
      if (pilihan.gagal) pilihan.gagal(new Error('Untuk menyisipkan gambar, gunakan tombol Tambahkan media.'));
    });
    kode.addEventListener('input', ubah);

    if (pilihan.ketik) {
      kaya.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          pilihan.ketik();
        }
      });
    }

    return {
      element: kaya,
      value: () => saring(baca(), { untukDisimpan: true, gambar }),
      text: () => kaya.textContent,
      setValue: (isi) => {
        const bersih = saring(isi, { untukDisimpan: false, gambar });
        kaya.innerHTML = bersih;
        kode.value = '';
        mode = 'visual';
        host.dataset.mode = 'visual';
        ubah();
      },
      fokus: () => kaya.focus(),
      ubah,
    };
  }

  window.PBPIIEditor = { mount, saring, escapeHTML, tautanAman };
})();
