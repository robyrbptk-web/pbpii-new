/* ---------------------------------------------------------------------------
   Perpustakaan umum di halaman Pustaka.
   Koleksi dibacakan dari Internet Archive lewat /api/pustaka/*. Kunci API
   tidak pernah menyentuh sisi depan dan isi buku diunduh per bagian saja.
--------------------------------------------------------------------------- */

(() => {
  const el = (id) => document.getElementById(id);
  const AKAR = '/api/pustaka';
  const TEMA = ['siang', 'krem', 'malam'];
  const BAGIAN_TAMPIL = 6;
  /** Dua halaman berdampingan baru dipakai bila panggung cukup lebar. */
  const DUA_MIN = 940;
  /** Kanvas tersimpan secukupnya: satu halaman setara puluhan MB di RAM. */
  const KANVAS_SIMPAN = 4;
  const KUNCI = {
    tema: 'pbpii.perp.tema',
    ukuran: 'pbpii.perp.ukuran',
    lanjut: 'pbpii.perp.lanjut',
    zoom: 'pbpii.perp.zoom',
  };

  const state = {
    q: '',
    rak: '',
    halaman: 1,
    hasil: [],
    dimuat: false,
    buku: null,
    berkas: '',
    bagian: [],
    hal: 1,
    totalHal: 1,
    sedangMuat: false,
    tema: 'siang',
    ukuran: 17.5,
    mode: 'teks',
    zoom: 1,
  };

  function simpan(kunci, nilai) {
    try {
      localStorage.setItem(kunci, JSON.stringify(nilai));
    } catch {
      /* penyimpanan ditolak: pengaturan berlaku selama tab terbuka */
    }
  }

  function muat(kunci, cadangan) {
    try {
      const mentah = localStorage.getItem(kunci);
      return mentah === null ? cadangan : JSON.parse(mentah);
    } catch {
      return cadangan;
    }
  }

  const penanda = () => muat(KUNCI.lanjut, {});

  async function minta(path, params) {
    const url = new URL(path, window.location.origin);
    Object.entries(params || {}).forEach(([kunci, nilai]) => {
      if (nilai !== '' && nilai !== null && nilai !== undefined) url.searchParams.set(kunci, nilai);
    });
    const response = await fetch(url.pathname + url.search, { headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.ok === false) {
      const gagal = new Error((body && body.pesan) || 'Perpustakaan sedang tidak dapat dihubungi.');
      gagal.status = response.status;
      gagal.alamat = body && body.alamat;
      throw gagal;
    }
    return body;
  }

  // ------------------------------------------------------------------- tampilan

  const switchEl = el('perpSwitch');

  function tampilkan(nama) {
    document.body.dataset.perpView = nama;
    if (!switchEl) return;
    for (const tombol of switchEl.querySelectorAll('button')) {
      tombol.setAttribute('aria-selected', String(tombol.dataset.perpView === nama));
    }
    if (nama === 'perpustakaan' && !state.dimuat) unduhRak();
  }

  // ------------------------------------------------------------------ rak & cari

  const chipsEl = el('perpRak');
  const hasilEl = el('perpHasil');
  const statusEl = el('perpStatus');
  const kosongEl = el('perpKosong');
  const moreEl = el('perpMore');
  const inputEl = el('perpQuery');
  const clearEl = el('perpClear');

  function perbaruiChip() {
    if (!chipsEl) return;
    for (const tombol of chipsEl.querySelectorAll('button')) {
      tombol.setAttribute('aria-pressed', String(tombol.dataset.rak === state.rak));
    }
  }

  function rakLabel(daftar) {
    if (!chipsEl || chipsEl.childElementCount || !Array.isArray(daftar)) return;
    for (const rak of daftar) {
      const tombol = document.createElement('button');
      tombol.type = 'button';
      tombol.className = 'perp-chip';
      tombol.textContent = rak.label;
      tombol.dataset.rak = rak.kunci;
      tombol.addEventListener('click', () => {
        state.rak = state.rak === rak.kunci ? '' : rak.kunci;
        if (state.rak && inputEl) inputEl.value = '';
        state.q = inputEl ? inputEl.value.trim() : '';
        perbaruiChip();
        unduhRak(true);
      });
      chipsEl.appendChild(tombol);
    }
    perbaruiChip();
  }

  function lanjutButton(buku) {
    const tersimpan = penanda()[buku.id];
    if (!tersimpan) return null;
    const halaman = Number(tersimpan.halaman) || 0;
    const bagian = Number(tersimpan.hal) || 0;
    if (halaman < 2 && bagian < 2) return null;
    const tombol = document.createElement('button');
    tombol.type = 'button';
    tombol.className = 'perp-lanjut';
    tombol.textContent = halaman >= 2
      ? `Lanjut baca, halaman ${halaman} dari buku`
      : `Lanjut baca, bagian ${bagian} dari buku`;
    tombol.addEventListener('click', () => buka(buku, {
      mode: halaman >= 2 ? 'asli' : 'teks',
      halaman,
      hal: bagian,
    }));
    return tombol;
  }

  function kartu(buku) {
    const kartuEl = document.createElement('article');
    kartuEl.className = 'perp-card';
    kartuEl.dataset.id = buku.id;

    const sampul = document.createElement('div');
    sampul.className = 'perp-sampul';
    sampul.style.backgroundImage = `url("${buku.sampul}")`;
    sampul.setAttribute('role', 'img');
    sampul.setAttribute('aria-label', `Sampul ${buku.judul}`);

    const isi = document.createElement('div');
    isi.className = 'perp-karcis';

    const judul = document.createElement('button');
    judul.type = 'button';
    judul.className = 'perp-judul';
    judul.textContent = buku.judul;
    judul.addEventListener('click', () => buka(buku));

    const meta = document.createElement('p');
    meta.className = 'perp-meta';
    const bagian = [buku.penulis, buku.tahun, buku.bahasa].filter(Boolean);
    meta.textContent = bagian.length ? bagian.join(' · ') : 'Katalog Internet Archive';

    isi.append(judul, meta);
    const lanjut = lanjutButton(buku);
    if (lanjut) isi.appendChild(lanjut);

    const tombolBaca = document.createElement('button');
    tombolBaca.type = 'button';
    tombolBaca.className = 'perp-baca';
    tombolBaca.textContent = 'Baca';
    tombolBaca.addEventListener('click', () => buka(buku));
    isi.appendChild(tombolBaca);

    kartuEl.append(sampul, isi);
    return kartuEl;
  }

  function gambarRak() {
    if (!hasilEl) return;
    hasilEl.replaceChildren();
    const sudah = new Set();
    for (const buku of state.hasil) {
      if (sudah.has(buku.id)) continue;
      sudah.add(buku.id);
      hasilEl.appendChild(kartu(buku));
    }
  }

  async function unduhRak(baruan) {
    if (!statusEl || !hasilEl) return;
    if (baruan) {
      state.halaman = 1;
      state.hasil = [];
    }
    state.dimuat = true;
    moreEl.hidden = true;
    kosongEl.hidden = true;
    statusEl.textContent = state.q
      ? `Menelusuri “${state.q}”…`
      : 'Mengambil daftar buku dari perpustakaan…';

    try {
      const data = await minta(`${AKAR}/cari`, {
        q: state.q,
        rahang: state.rak,
        halaman: state.halaman,
        batas: 18,
      });
      rakLabel(data.rak);
      state.hasil = state.halaman === 1 ? data.hasil : state.hasil.concat(data.hasil);
      gambarRak();

      statusEl.textContent = data.total
        ? `${state.hasil.length} dari ±${data.total.toLocaleString('id-ID')} judul · sumber Internet Archive`
        : 'Belum ada judul untuk filter ini.';
      moreEl.hidden = !data.masihAda || !state.hasil.length;
      if (!state.hasil.length) {
        kosongEl.hidden = false;
        kosongEl.textContent = state.q
          ? 'Tidak ada judul yang cocok. Coba kata lain, misalnya nama penulis atau satu kata saja.'
          : 'Rak ini sedang kosong. Pilih rak lain di atas.';
      }
    } catch (error) {
      statusEl.textContent = error.message;
      if (!state.hasil.length) {
        kosongEl.hidden = false;
        kosongEl.textContent = error.message;
      }
    }
  }

  // -------------------------------------------------------------------- pembaca

  const reader = el('perpReader');
  const bodyEl = el('perpReaderBody');
  const judulEl = el('perpReaderJudul');
  const metaEl = el('perpReaderMeta');
  const infoEl = el('perpReaderInfo');
  const nextEl = el('perpReaderNext');
  const berkasEl = el('perpReaderBerkas');
  const temaEl = el('perpReaderTema');
  const sumberEl = el('perpReaderSumber');
  const majuEl = el('perpMaju');
  const panggungEl = el('perpReaderPanggung');
  const lembarEl = el('perpReaderBuku');
  const daunEl = lembarEl ? Array.from(lembarEl.querySelectorAll('.perp-daun')) : [];
  const sabarEl = el('perpUnduhan');
  const modeEl = el('perpReaderMode');
  const babEl = el('perpReaderBab');
  const sebelumEl = el('perpReaderSebelum');
  const berikutEl = el('perpReaderBerikut');
  const lompatEl = el('perpReaderLompat');

  /** Pembaca berkas asli; isinya diisi setelah pdf.js siap. */
  const pdf = {
    js: null,
    doc: null,
    tugas: null,
    id: '',
    hal: 1,
    total: 0,
    bab: [],
    kanvas: new Map(),
    berjalan: [],
    sedangMuat: false,
  };

  function terapkanTema() {
    if (!reader) return;
    reader.dataset.tema = state.tema;
    reader.style.setProperty('--perp-ukuran', `${state.ukuran}px`);
    if (temaEl) temaEl.textContent = state.tema === 'siang' ? 'Krem' : state.tema === 'krem' ? 'Malam' : 'Siang';
    simpan(KUNCI.tema, state.tema);
    simpan(KUNCI.ukuran, state.ukuran);
    simpan(KUNCI.zoom, state.zoom);
  }

  /** A−/A+ mengatur huruf di mode teks dan skala halaman di mode asli. */
  function ubahUkuran(arah) {
    if (state.mode === 'asli') {
      state.zoom = Math.min(1.8, Math.max(0.6, Math.round((state.zoom + arah * 0.1) * 10) / 10));
      terapkanTema();
      if (pdf.doc) gambar();
      return;
    }
    const baru = Math.round((state.ukuran + arah) * 10) / 10;
    state.ukuran = Math.min(23, Math.max(15, baru));
    terapkanTema();
  }

  function baris(teks, kelas) {
    const p = document.createElement('p');
    p.textContent = teks;
    if (kelas) p.className = kelas;
    return p;
  }

  /** Nomor bagian teratas yang masih terlihat; itu yang menjadi tanda baca. */
  function halTerlihat() {
    if (!state.bagian.length) return state.hal;
    const batas = bodyEl.getBoundingClientRect().top + 40;
    let hal = state.bagian[0].hal;
    for (const bagian of state.bagian) {
      if (bagian.node.getBoundingClientRect().top <= batas) hal = bagian.hal;
      else break;
    }
    return hal;
  }

  const palingAtas = () => (state.bagian.length ? state.bagian[0].hal : 1);
  const palingBawah = () => (state.bagian.length ? state.bagian[state.bagian.length - 1].hal : 0);

  function catatPosisi() {
    if (!state.buku) return;
    const tanda = penanda();
    const lama = tanda[state.buku.id] || {};
    const baru = state.mode === 'asli'
      ? { mode: 'asli', halaman: pdf.hal }
      : { mode: 'teks', berkas: state.berkas, hal: halTerlihat() };
    tanda[state.buku.id] = Object.assign({}, lama, baru);
    simpan(KUNCI.lanjut, tanda);
  }

  /** Bab terakhir yang sudah dilampaui halaman yang sedang tampil. */
  function babAktif() {
    let judul = '';
    for (const bab of pdf.bab) {
      if (bab.hal > pdf.hal) break;
      judul = bab.judul;
    }
    return judul;
  }

  /** Buku panjang tetap punya angka baca yang berarti di halaman awal. */
  function persenBaca(hal, total) {
    if (!total) return 0;
    const nilai = (hal / total) * 100;
    return nilai < 10 ? Math.round(nilai * 10) / 10 : Math.round(nilai);
  }

  const persenTampil = (nilai) => `${String(nilai).replace('.', ',')}%`;

  function perbaruiInfo() {
    if (state.mode === 'asli' && pdf.total) {
      const persen = persenBaca(pdf.hal, pdf.total);
      const bab = babAktif();
      if (infoEl) {
        infoEl.textContent = `halaman ${pdf.hal} dari ${pdf.total} · ±${persenTampil(persen)} dibaca${bab ? ` · ${bab}` : ''}`;
      }
      if (majuEl) majuEl.firstElementChild.style.width = `${persen}%`;
      if (sebelumEl) sebelumEl.disabled = pdf.hal <= 1;
      if (berikutEl) berikutEl.disabled = pdf.hal >= pdf.total;
      if (babEl && pdf.bab.length) {
        const aktif = pdf.bab.filter((b) => b.hal <= pdf.hal).pop();
        if (aktif) babEl.value = String(aktif.hal);
      }
      return;
    }

    const hal = halTerlihat();
    const persen = persenBaca(hal, state.totalHal);
    if (infoEl) {
      infoEl.textContent = `±${persenTampil(persen)} dibaca · bagian ${hal} dari ${state.totalHal}`;
    }
    if (majuEl) majuEl.firstElementChild.style.width = `${persen}%`;
    if (nextEl) nextEl.hidden = !state.buku || state.mode !== 'teks' || palingBawah() >= state.totalHal;
  }

  /**
   * Mengatur posisi gulir tanpa memicu pemuatan bagian berikutnya. Tanpa
   * penguncian ini, lompatan yang dibuat kode disalahartikan sebagai pembaca
   * yang mencapai ujung layar sehingga bagian dimuat berlapis.
   */
  let kunciScroll = false;
  let lepasScroll = null;
  function posisi(nilai) {
    kunciScroll = true;
    bodyEl.scrollTop = Math.max(0, nilai);
    if (lepasScroll) clearTimeout(lepasScroll);
    lepasScroll = setTimeout(() => {
      lepasScroll = null;
      kunciScroll = false;
    }, 220);
  }

  /**
   * Bagian paling jauh dibuang dari DOM supaya buku panjang tetap ringan
   * dibaca. Tinggi bagian yang dibuang dikompensasi agar posisi tidak melompat.
   */
  function pangkas(arah) {
    while (state.bagian.length > BAGIAN_TAMPIL) {
      if (arah === 'atas') {
        state.bagian.pop().node.remove();
        continue;
      }
      const lama = state.bagian.shift();
      const tinggi = lama.node.offsetHeight;
      lama.node.remove();
      posisi(bodyEl.scrollTop - tinggi);
    }
  }

  function susunHalaman(data) {
    const kolom = document.createElement('div');
    kolom.className = 'perp-halaman';
    kolom.dataset.hal = String(data.hal);

    if (data.hal === 1 && data.mutu === 0) {
      kolom.appendChild(baris(
        'Teks buku ini hasil pemindaian yang belum terbaca rapi. Bila mengganggu, pilih judul lain di rak yang sama.',
        'perp-warna',
      ));
    }
    if (data.terpotong && data.hal === data.totalHal) {
      kolom.appendChild(baris(
        'Bagian akhir buku tidak ikut dimuat karena berkasnya sangat panjang. Sisanya dapat dibaca langsung di Internet Archive.',
        'perp-petit',
      ));
    }
    for (const para of data.paragraf || []) {
      const kecil = para.length < 46 && !/[.,;:]$/.test(para);
      kolom.appendChild(baris(para, kecil ? 'perp-petit' : null));
    }
    return kolom;
  }

  async function muatBagian(nomor, opsi = {}) {
    if (!state.buku || state.sedangMuat) return;
    const atas = !!opsi.atas;
    if (opsi.mulaiBaru) {
      state.bagian = [];
      bodyEl.replaceChildren();
    } else if (state.bagian.some((bagian) => bagian.hal === nomor)) {
      return;
    }
    if (atas ? nomor < 1 : nomor > state.totalHal && state.totalHal > 0) return;

    state.sedangMuat = true;
    if (infoEl && !state.bagian.length) infoEl.textContent = 'Memuat isi buku…';

    try {
      const data = await minta(`${AKAR}/teks/${encodeURIComponent(state.buku.id)}`, {
        berkas: state.berkas,
        hal: nomor,
      });
      state.totalHal = data.totalHal;
      const kolom = susunHalaman(data);
      const tinggiSebelum = bodyEl.scrollHeight;

      if (atas) {
        bodyEl.prepend(kolom);
        state.bagian.unshift({ hal: data.hal, node: kolom });
        posisi(bodyEl.scrollTop + bodyEl.scrollHeight - tinggiSebelum);
      } else {
        bodyEl.appendChild(kolom);
        state.bagian.push({ hal: data.hal, node: kolom });
        state.hal = data.hal;
      }
      pangkas(atas ? 'atas' : 'bawah');
      if (opsi.mulaiBaru) posisi(0);
      perbaruiInfo();
      if (metaEl) {
        metaEl.textContent = `${state.buku.penulis || 'Penulis tidak tercatat'} · ${data.totalHal} bagian baca`;
      }
    } catch (error) {
      if (!state.bagian.length) bodyEl.appendChild(baris(error.message, 'perp-warna'));
      if (infoEl) infoEl.textContent = 'Isi buku gagal dimuat.';
    } finally {
      state.sedangMuat = false;
    }
  }

  // ------------------------------------------------------- tampilan dokumen asli

  /**
   * pdf.js baru diunduh saat pengunjung membuka buku ber-PDF. Rak isi teks
   * tetap ringan karena berkas pustakanya tidak pernah ikut muat awal.
   */
  async function pustakaPdf() {
    if (pdf.js) return pdf.js;
    const modul = await import('/vendor/pdfjs/pdf-5.4.530.min.js');
    modul.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker-5.4.530.js';
    pdf.js = modul;
    return modul;
  }

  function unduhan(rasio) {
    if (!sabarEl) return;
    const persen = Math.max(0, Math.min(100, Math.round(rasio * 100)));
    sabarEl.firstElementChild.style.width = `${persen}%`;
    sabarEl.classList.toggle('is-penuh', persen >= 100);
  }

  /** Membuang dokumen lama, termasuk kanvas dan pekerjaan yang masih jalan. */
  function tutupPdf() {
    for (const tugas of pdf.berjalan.slice()) {
      try {
        tugas.cancel();
      } catch {
        /* tugas sudah selesai sendiri */
      }
    }
    pdf.berjalan = [];
    for (const bisaDibuang of [pdf.tugas, pdf.doc]) {
      try {
        if (bisaDibuang) bisaDibuang.destroy();
      } catch {
        /* tidak ada yang perlu ditutup */
      }
    }
    pdf.tugas = null;
    pdf.doc = null;
    pdf.kanvas.clear();
    // Daun yang masih memegang halaman buku lama jangan sampai terlihat
    // selama buku berikutnya sedang dibuka.
    for (const sisi of daunEl) sisi.replaceChildren();
    pdf.bab = [];
    pdf.total = 0;
    pdf.hal = 1;
    pdf.id = '';
  }

  async function muatDokumen(detail) {
    const js = await pustakaPdf();
    let terbuka = false;
    tutupPdf();
    unduhan(0);
    if (metaEl) metaEl.textContent = 'Mengunduh halaman asli buku…';
    /** Keterangan halaman buku lama jangan bertahan selama buku baru dibuka. */
    if (infoEl) infoEl.textContent = 'Membuka halaman asli…';
    /**
     * Berkas diambil lewat proksi yang sama dengan halaman ini karena host
     * berkas Internet Archive tidak mengirim izin lintas asal. Range ikut
     * diteruskan sehingga hanya bagian yang dibaca yang melintas di server.
     */
    pdf.tugas = js.getDocument({
      url: detail.pdf.alamat,
      rangeChunkSize: 262_144,
      disableAutoFetch: true,
    });
    pdf.tugas.onProgress = (info) => {
      // Setelah halaman pertama tampil, potongan berikutnya mengalir sesuai
      // permintaan, jadi batang unduhan tidak boleh mundur lagi.
      if (!terbuka && info && info.total > 0) unduhan(info.loaded / info.total);
    };
    pdf.doc = await pdf.tugas.promise;
    terbuka = true;
    pdf.id = detail.id;
    pdf.total = pdf.doc.numPages;
    pdf.bab = await daftarBab(pdf.doc);
    isiBab();
  }

  /**
   * Daftar isi PDF menjadi pemilih bab. Katalog besar punya outline ribuan
   * titik, jadi diambil secukupnya supaya buku tetap cepat terbuka.
   */
  async function daftarBab(doc) {
    let outline = null;
    try {
      outline = await doc.getOutline();
    } catch {
      outline = null;
    }
    if (!outline || !outline.length) return [];
    const hasil = [];
    const antri = outline.slice(0, 150);
    while (antri.length && hasil.length < 150) {
      const item = antri.shift();
      const judul = String(item.title || '').trim().slice(0, 80);
      if (judul) {
        try {
          const rujukan = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
          if (rujukan && rujukan[0]) hasil.push({ judul, hal: (await doc.getPageIndex(rujukan[0])) + 1 });
        } catch {
          /* tujuan bab tidak terbaca; bab itu dilewati */
        }
      }
      for (const anak of (item.items || []).slice(0, 25)) antri.push(anak);
    }
    hasil.sort((a, b) => a.hal - b.hal);
    return hasil.filter((bab, i) => i === 0 || bab.hal !== hasil[i - 1].hal);
  }

  function isiBab() {
    if (!babEl) return;
    babEl.replaceChildren();
    if (!pdf.bab.length) {
      babEl.hidden = true;
      return;
    }
    for (const bab of pdf.bab) {
      const opsi = document.createElement('option');
      opsi.value = String(bab.hal);
      opsi.textContent = bab.judul;
      babEl.appendChild(opsi);
    }
    babEl.hidden = false;
  }

  const langkah = () => (panggungEl && panggungEl.clientWidth >= DUA_MIN ? 2 : 1);

  /**
   * Halaman digambar ke kanvas pada lebar daun yang aktif. Lukisan terakhir
   * disimpan sebentar supaya balik halaman terasa seketika.
   */
  async function kanvasHalaman(nomor, lebar) {
    const kunci = `${nomor}|${Math.round(lebar)}|${state.zoom}`;
    const tersimpan = pdf.kanvas.get(kunci);
    if (tersimpan) {
      pdf.kanvas.delete(kunci);
      pdf.kanvas.set(kunci, tersimpan);
      return tersimpan;
    }
    const halaman = await pdf.doc.getPage(nomor);
    const asal = halaman.getViewport({ scale: 1 });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const viewport = halaman.getViewport({
      scale: Math.max(0.1, (lebar / asal.width) * state.zoom) * dpr,
    });
    const kanvas = document.createElement('canvas');
    kanvas.width = Math.floor(viewport.width);
    kanvas.height = Math.floor(viewport.height);
    kanvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
    kanvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
    const tugas = halaman.render({ canvasContext: kanvas.getContext('2d', { alpha: false }), viewport });
    pdf.berjalan.push(tugas);
    try {
      await tugas.promise;
    } finally {
      const indeks = pdf.berjalan.indexOf(tugas);
      if (indeks >= 0) pdf.berjalan.splice(indeks, 1);
    }
    pdf.kanvas.set(kunci, kanvas);
    while (pdf.kanvas.size > KANVAS_SIMPAN) pdf.kanvas.delete(pdf.kanvas.keys().next().value);
    return kanvas;
  }

  let generasi = 0;

  /** Lebar satu daun baca pada tata letak yang sedang aktif. */
  function lebarDaun() {
    if (!panggungEl || !lembarEl) return 520;
    const dua = langkah() === 2;
    const gaya = getComputedStyle(panggungEl);
    const bingkai = getComputedStyle(lembarEl);
    const ruang = Math.max(
      240,
      panggungEl.clientWidth
        - parseFloat(gaya.paddingLeft) - parseFloat(gaya.paddingRight)
        - parseFloat(bingkai.paddingLeft) - parseFloat(bingkai.paddingRight),
    );
    return Math.floor(Math.min(dua ? 560 : 760, ruang / (dua ? 2 : 1)));
  }

  async function gambar() {
    if (!pdf.doc) return;
    const saya = ++generasi;
    for (const tugas of pdf.berjalan.slice()) {
      try {
        tugas.cancel();
      } catch {
        /* tugas sudah selesai sendiri */
      }
    }
    const dua = langkah() === 2;
    const daun = lebarDaun();
    if (lembarEl) lembarEl.dataset.letak = dua ? 'dua' : 'satu';

    const nomor = [pdf.hal];
    if (dua && pdf.hal + 1 <= pdf.total) nomor.push(pdf.hal + 1);

    pdf.sedangMuat = true;
    try {
      for (let indeks = 0; indeks < daunEl.length; indeks += 1) {
        const sisi = daunEl[indeks];
        if (!sisi) continue;
        sisi.style.flex = `0 0 ${daun}px`;
        sisi.replaceChildren();
        if (indeks < nomor.length) {
          const kanvas = await kanvasHalaman(nomor[indeks], daun);
          if (saya !== generasi) return;
          sisi.appendChild(kanvas);
        }
      }
    } catch {
      /* render dibatalkan karena halaman berganti; gambar() terbaru yang tampil */
    } finally {
      if (saya === generasi) {
        pdf.sedangMuat = false;
        window.setTimeout(() => pramuat(daun), 240);
      }
    }
  }

  /** Halaman berikutnya dilukis diam-diam agar tombol lanjut tidak menunggu. */
  async function pramuat(lebar) {
    if (!pdf.doc || pdf.sedangMuat) return;
    const saya = generasi;
    const mulai = pdf.hal + langkah();
    for (let i = 0; i < 2; i += 1) {
      const nomor = mulai + i;
      if (nomor > pdf.total || saya !== generasi) return;
      try {
        await kanvasHalaman(nomor, lebar);
      } catch {
        return;
      }
    }
  }

  async function ke(nomor) {
    if (!pdf.doc) return;
    pdf.hal = Math.min(pdf.total, Math.max(1, Math.round(nomor) || 1));
    if (panggungEl) {
      panggungEl.scrollTop = 0;
      panggungEl.scrollLeft = 0;
    }
    await gambar();
    catatPosisi();
    perbaruiInfo();
  }

  function aturKaki(asli) {
    if (sebelumEl) sebelumEl.hidden = !asli;
    if (berikutEl) berikutEl.hidden = !asli;
    if (nextEl && !asli) nextEl.hidden = true;
  }

  function aturMode(asli) {
    state.mode = asli ? 'asli' : 'teks';
    if (reader) reader.dataset.mode = state.mode;
    if (modeEl) {
      for (const tombol of modeEl.querySelectorAll('button')) {
        tombol.setAttribute('aria-pressed', String(tombol.dataset.mode === state.mode));
      }
    }
    if (babEl) babEl.hidden = !asli || !pdf.bab.length;
    if (sabarEl) sabarEl.classList.toggle('is-penuh', !asli);
    if (lompatEl) {
      lompatEl.hidden = true;
      if (infoEl) infoEl.hidden = false;
    }
    aturKaki(asli);
  }

  /** Buka berkas PDF apa adanya: tata letak, gambar, dan huruf asli buku. */
  async function bukaPdf(detail, mulai) {
    aturMode(true);
    if (berkasEl) berkasEl.hidden = true;
    state.bagian = [];
    state.hal = 1;
    bodyEl.replaceChildren();

    const tampilkan = async () => {
      if (pdf.id !== detail.id || !pdf.doc) await muatDokumen(detail);
      await ke(mulai || 1);
      // Bagian buku yang belum dibaca baru diambil saat halamannya dibuka,
      // jadi batang unduhan ditutup begitu halaman pertama tampil.
      unduhan(1);
      if (metaEl) {
        metaEl.textContent = `${detail.penulis || 'Penulis tidak tercatat'} · ${pdf.total} halaman asli`;
      }
    };

    let pesan = '';
    for (let percobaan = 1; percobaan <= 2; percobaan += 1) {
      try {
        await tampilkan();
        return;
      } catch (error) {
        const nama = error && error.name;
        if (nama === 'MissingPDFException' || nama === 'InvalidPDFException') {
          pesan = nama === 'MissingPDFException'
            ? 'Berkas buku ini sudah tidak ada di perpustakaan aslinya.'
            : 'Berkas buku ini tidak terbaca, jadi buku dibuka dalam mode teks.';
          break;
        }
        if (percobaan === 2) {
          pesan = 'Halaman asli gagal ditampilkan, jadi buku dibuka dalam mode teks.';
        } else {
          // Arsip sering tersendat sesaat, jadi satu percobaan ulang diberi jeda.
          await new Promise((tunda) => setTimeout(tunda, 1500));
        }
      }
    }
    await keTeks(pesan);
  }

  /** Mode teks tetap dipertahankan untuk buku yang hanya punya berkas teks. */
  async function keTeks(pesan) {
    aturMode(false);
    if (berkasEl) berkasEl.hidden = !state.buku || (state.buku.berkas || []).length < 2;
    if (!state.bagian.length) {
      const tersimpan = state.buku ? penanda()[state.buku.id] || {} : {};
      await muatBagian(Number(tersimpan.hal) || 1, { mulaiBaru: true });
    } else {
      perbaruiInfo();
    }
    if (pesan) bodyEl.prepend(baris(pesan, 'perp-warna'));
  }

  async function buka(buku, opsi = {}) {
    if (!reader) return;
    bodyEl.replaceChildren(baris('Membuka buku…', 'perp-petit'));
    reader.classList.add('is-open');
    reader.setAttribute('aria-hidden', 'false');
    document.body.classList.add('perp-membaca');
    if (judulEl) judulEl.textContent = buku.judul;
    if (metaEl) metaEl.textContent = 'Mengambil daftar berkas buku…';
    if (sumberEl) sumberEl.hidden = true;
    if (berkasEl) berkasEl.hidden = true;
    if (modeEl) modeEl.hidden = true;
    if (babEl) babEl.hidden = true;
    state.bagian = [];
    state.totalHal = 0;
    state.hal = 1;

    try {
      const detail = await minta(`${AKAR}/baca/${encodeURIComponent(buku.id)}`);
      state.buku = detail;
      const tersimpan = penanda()[buku.id] || {};
      state.berkas = opsi.berkas || tersimpan.berkas || detail.berkas[0].nama;

      if (berkasEl) {
        berkasEl.replaceChildren();
        for (const berkas of detail.berkas) {
          const pilihan = document.createElement('option');
          pilihan.value = berkas.nama;
          pilihan.textContent = berkas.label || 'Bagian buku';
          berkasEl.appendChild(pilihan);
        }
        berkasEl.value = state.berkas;
        berkasEl.hidden = detail.berkas.length < 2;
      }
      if (sumberEl) {
        sumberEl.href = detail.alamat;
        sumberEl.hidden = false;
      }

      const adaAsli = detail.cara === 'pdf' && !!detail.pdf;
      if (modeEl) modeEl.hidden = !adaAsli;
      // Halaman asli diunduh potong demi potong, jadi pengguna yang meminta
      // hemat kuota dibuka dalam mode teks lebih dulu dan tetap bisa beralih.
      const jalur = navigator.connection || {};
      const hemat = jalur.saveData === true || /^(slow-)?2g$/.test(String(jalur.effectiveType || ''));
      const mode = adaAsli ? opsi.mode || tersimpan.mode || (hemat ? 'teks' : 'asli') : 'teks';
      // Ditandai lebih dulu supaya A−/A+ selama berkas diunduh sudah
      // mengatur skala halaman, bukan ukuran huruf.
      state.mode = mode;
      if (mode === 'asli') {
        await bukaPdf(detail, Number(opsi.halaman) || Number(tersimpan.halaman) || 1);
      } else {
        await keTeks();
      }
    } catch (error) {
      state.buku = null;
      aturMode(false);
      bodyEl.replaceChildren(baris(error.message, 'perp-warna'));
      if (metaEl) metaEl.textContent = 'Buku tidak dapat dibuka';
      const alamat = error.alamat || `https://archive.org/details/${encodeURIComponent(buku.id)}`;
      if (sumberEl) {
        sumberEl.href = alamat;
        sumberEl.hidden = false;
      }
    }
  }

  function tutup() {
    if (!reader) return;
    catatPosisi();
    tutupPdf();
    aturMode(false);
    if (modeEl) modeEl.hidden = true;
    reader.classList.remove('is-open');
    reader.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('perp-membaca');
    state.buku = null;
    gambarRak();
  }

  // --------------------------------------------------------------------- events

  function pasangPencetus() {
    if (!bodyEl) return;
    let jeda = null;
    bodyEl.addEventListener('scroll', () => {
      if (jeda) return;
      jeda = setTimeout(() => {
        jeda = null;
        if (!state.buku || !state.bagian.length || state.sedangMuat) return;
        catatPosisi();
        perbaruiInfo();
        if (kunciScroll) return;
        const sisa = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight;
        if (sisa < 700 && palingBawah() < state.totalHal) muatBagian(palingBawah() + 1);
        else if (bodyEl.scrollTop < 700 && palingAtas() > 1) muatBagian(palingAtas() - 1, { atas: true });
      }, 140);
    }, { passive: true });
  }

  function mulai() {
    if (!switchEl || !reader) return;

    const temaTersimpan = muat(KUNCI.tema, 'siang');
    state.tema = TEMA.includes(temaTersimpan) ? temaTersimpan : 'siang';
    const ukuran = Number(muat(KUNCI.ukuran, 17.5));
    state.ukuran = ukuran >= 15 && ukuran <= 23 ? ukuran : 17.5;
    const zoom = Number(muat(KUNCI.zoom, 1));
    state.zoom = zoom >= 0.6 && zoom <= 1.8 ? zoom : 1;
    terapkanTema();

    for (const tombol of switchEl.querySelectorAll('button')) {
      tombol.addEventListener('click', () => tampilkan(tombol.dataset.perpView));
    }

    el('perpForm').addEventListener('submit', (event) => {
      event.preventDefault();
      state.q = inputEl.value.trim().replace(/[<>]/g, '');
      state.rak = state.q ? '' : state.rak;
      perbaruiChip();
      unduhRak(true);
    });
    inputEl.addEventListener('input', () => {
      clearEl.hidden = !inputEl.value;
    });
    clearEl.addEventListener('click', () => {
      inputEl.value = '';
      clearEl.hidden = true;
      state.q = '';
      inputEl.focus();
      unduhRak(true);
    });
    moreEl.addEventListener('click', () => {
      state.halaman += 1;
      unduhRak();
    });

    el('perpReaderClose').addEventListener('click', tutup);
    nextEl.addEventListener('click', () => muatBagian(palingBawah() + 1));
    if (berkasEl) {
      berkasEl.addEventListener('change', () => {
        state.berkas = berkasEl.value;
        muatBagian(1, { mulaiBaru: true });
      });
    }
    if (modeEl) {
      for (const tombol of modeEl.querySelectorAll('button')) {
        tombol.addEventListener('click', () => {
          if (!state.buku || tombol.dataset.mode === state.mode) return;
          if (tombol.dataset.mode === 'asli') bukaPdf(state.buku, pdf.hal || 1);
          else keTeks();
        });
      }
    }
    if (babEl) {
      babEl.addEventListener('change', () => ke(Number(babEl.value) || 1));
    }
    if (sebelumEl) {
      sebelumEl.addEventListener('click', () => ke(pdf.hal - langkah()));
    }
    if (berikutEl) {
      berikutEl.addEventListener('click', () => ke(pdf.hal + langkah()));
    }
    if (lompatEl && infoEl) {
      const tutupLompat = () => {
        lompatEl.hidden = true;
        infoEl.hidden = false;
      };
      // Buku tanpa penanda bab tetap harus bisa dilompati: ketuk keterangan
      // halaman, ketik nomornya, lalu Enter.
      infoEl.addEventListener('click', () => {
        if (state.mode !== 'asli' || !pdf.doc) return;
        lompatEl.max = String(pdf.total);
        lompatEl.value = String(pdf.hal);
        infoEl.hidden = true;
        lompatEl.hidden = false;
        lompatEl.focus();
        lompatEl.select();
      });
      lompatEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          const nomor = Number(lompatEl.value);
          lompatEl.blur();
          if (nomor >= 1) ke(nomor);
        } else if (event.key === 'Escape') {
          lompatEl.blur();
        }
      });
      lompatEl.addEventListener('blur', tutupLompat);
    }
    if (temaEl) {
      temaEl.addEventListener('click', () => {
        state.tema = TEMA[(TEMA.indexOf(state.tema) + 1) % TEMA.length];
        terapkanTema();
      });
    }
    el('perpReaderKecil').addEventListener('click', () => ubahUkuran(-1));
    el('perpReaderBesar').addEventListener('click', () => ubahUkuran(1));
    document.addEventListener('keydown', (event) => {
      if (!reader.classList.contains('is-open')) return;
      if (event.key === 'Escape') {
        tutup();
        return;
      }
      if (state.mode !== 'asli' || !pdf.doc) return;
      const target = event.target;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        ke(pdf.hal + langkah());
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        ke(pdf.hal - langkah());
      }
    });
    window.addEventListener('pagehide', catatPosisi);
    let tungguUkur = null;
    window.addEventListener('resize', () => {
      if (tungguUkur) clearTimeout(tungguUkur);
      tungguUkur = setTimeout(() => {
        tungguUkur = null;
        if (state.mode === 'asli' && pdf.doc) gambar();
      }, 240);
    });
    pasangPencetus();

    const parameter = new URLSearchParams(window.location.search);
    const sudahLogin = window.PBPIIAkun && window.PBPIIAkun.sessionToken && window.PBPIIAkun.sessionToken();
    const arahLama = parameter.get('doc') || parameter.get('hal');
    tampilkan(!sudahLogin && !arahLama ? 'perpustakaan' : 'berkas');

    if (window.PBPIIAkun && window.PBPIIAkun.onChange) {
      window.PBPIIAkun.onChange((akun) => {
        if (akun && akun.role !== 'tamu' && document.body.dataset.perpView === 'perpustakaan') {
          tampilkan('berkas');
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mulai, { once: true });
  } else {
    mulai();
  }
})();
