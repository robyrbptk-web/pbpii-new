/**
 * Cerita 24 jam kader.
 *
 * Satu modul dipakai feed.html dan profil.html: lingkaran di atas umpan, cincin
 * pada avatar profil, dan satu penonton layar penuh untuk foto yang sama.
 * Batas waktu dihitung server, jadi cerita benar-benar hilang dari semua
 * perangkat setelah sehari, bukan cuma tersembunyi di browser tertentu.
 */
(() => {
  'use strict';

  const API = window.PBPII_CONFIG?.apiEndpoint || '/api/pii';
  const LOGO = 'assets/logo-pii.webp';
  const DURI = 6000;
  const BATAS_BERKAS = 3 * 1024 * 1024;
  const KAPASITAS = 1400;
  const KETERANGAN_MAX = 140;
  const KUNCI_LIHAT = 'pbpii_cerita_dilihat';

  const tokenSaya = () => window.PBPIIAkun?.sessionToken?.() || window.PBPIIAkun?.token?.() || '';
  const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inisial = (nama) => String(nama || 'K').trim().charAt(0).toUpperCase() || 'K';
  const bersih = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, KETERANGAN_MAX);

  const driveId = (value) => {
    const url = String(value || '').trim();
    if (!/^https:\/\//i.test(url)) return '';
    try {
      const parsed = new URL(url);
      if (parsed.hostname === 'drive.google.com' || parsed.hostname === 'drive.usercontent.google.com') {
        return parsed.searchParams.get('id') || '';
      }
      if (parsed.hostname === 'lh3.googleusercontent.com') return parsed.pathname.match(/^\/d\/([A-Za-z0-9_-]+)/i)?.[1] || '';
      return '';
    } catch {
      return '';
    }
  };

  /* Gambar Drive diuji lewat beberapa bentuk URL: satu CDN bisa diblokir jaringan
     kampus, jadi penonton tidak boleh berhenti pada kegagalan pertama. */
  const bentuk = [
    (id) => `${API}?imageId=${encodeURIComponent(id)}`,
    (id) => `https://drive.usercontent.google.com/download?id=${id}&export=view&authuser=0`,
    (id) => `https://drive.google.com/thumbnail?id=${id}&sz=w1400`
  ];
  const gambarSiap = (value) => {
    const url = String(value || '').trim();
    if (!/^https:\/\//i.test(url)) return LOGO;
    const id = driveId(url);
    return id ? bentuk[0](id) : escapeHTML(url);
  };
  window.PBPIICeritaGagal = (node) => {
    const id = node.dataset.drive;
    const sudah = Number(node.dataset.coba || 1);
    if (id && sudah < bentuk.length) {
      node.dataset.coba = String(sudah + 1);
      node.src = bentuk[sudah](id);
      return;
    }
    node.onerror = null;
    node.src = LOGO;
  };

  async function api(body) {
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => null);
    if (!result || !result.ok) {
      const error = new Error(result?.error || 'Cerita belum dapat dihubungi. Coba lagi sebentar.');
      error.code = String(result?.code || '');
      error.retryAfter = Number(result?.retryAfter) || 0;
      throw error;
    }
    return result.data;
  }

  /* --------------------------------------------------------------- sudah dibuka */

  function petaDibuka() {
    try {
      return JSON.parse(localStorage.getItem(KUNCI_LIHAT) || '{}') || {};
    } catch {
      return {};
    }
  }

  function tandaiDibuka(cerita) {
    const sekarang = Date.now();
    const peta = Object.entries(petaDibuka())
      // Penanda cerita yang sudah mati dibuang supaya kuncinya tidak menumpuk
      // selamanya di perangkat kader.
      .filter(([, batas]) => Number(batas) > sekarang)
      .reduce((acc, [id, batas]) => {
        acc[id] = batas;
        return acc;
      }, {});
    cerita.forEach((item) => {
      peta[String(item.id)] = Math.max(sekarang, Number(item.kedaluarsa) || sekarang);
    });
    try {
      localStorage.setItem(KUNCI_LIHAT, JSON.stringify(peta));
    } catch {
      /* penyimpanan penuh: cincin boleh tetap tampil sebagai cerita baru */
    }
  }

  function belumDibuka(grup) {
    const peta = petaDibuka();
    return (grup.cerita || []).some((item) => !peta[String(item.id)]);
  }

  function sisaWaktu(kedaluarsa) {
    const menit = Math.round((Number(kedaluarsa || 0) - Date.now()) / 60000);
    if (menit <= 0) return 'sebentar lagi';
    if (menit < 60) return `${menit} menit lagi`;
    const jam = Math.round(menit / 60);
    if (jam < 24) return `${jam} jam lagi`;
    return 'sehari lagi';
  }

  /* ------------------------------------------------------------------ lingkaran */

  let host = null;
  let daftar = [];
  let hak = {};

  function wajah(item) {
    if (item.avatar) {
      return `<img src="${gambarSiap(item.avatar)}" alt="" referrerpolicy="no-referrer" data-drive="${escapeHTML(driveId(item.avatar))}" data-coba="1" onerror="PBPIICeritaGagal(this)">`;
    }
    return `<span class="cerita-inisial">${escapeHTML(inisial(item.nama))}</span>`;
  }

  function sayaKini() {
    const akun = window.PBPIIAkun?.account?.() || {};
    return { nama: akun.name || 'Kader PII', avatar: akun.picture || '' };
  }

  function catatLingkaran() {
    if (!host) return;
    const bisaUnggah = Boolean(hak.unggah);
    const punyaSendiri = daftar.some((item) => item.sendiri);
    host.hidden = !daftar.length && !(bisaUnggah && window.PBPIIAkun);
    if (host.hidden) {
      host.innerHTML = '';
      return;
    }

    const lingkaran = daftar.map((item, index) => `
      <button class="cerita-ring${belumDibuka(item) ? ' is-baru' : ''}${item.sendiri ? ' is-sendiri' : ''}"
        type="button" data-cerita="${index}" aria-label="Buka cerita ${escapeHTML(item.nama)}">
        <span class="cerita-ring-isi">${wajah(item)}</span>
        ${item.sendiri && bisaUnggah ? '<span class="cerita-ring-plus" aria-hidden="true">+</span>' : ''}
        <span class="cerita-ring-nama">${escapeHTML(String(item.nama || 'Kader').split(/\s+/)[0])}</span>
      </button>`).join('');

    const awal = bisaUnggah && !punyaSendiri
      ? `<button class="cerita-ring is-baru is-kosong" type="button" data-cerita-tambah aria-label="Tambah cerita">
           <span class="cerita-ring-isi">${wajah(sayaKini())}</span>
           <span class="cerita-ring-plus" aria-hidden="true">+</span>
           <span class="cerita-ring-nama">Cerita Anda</span>
         </button>`
      : '';

    host.innerHTML = awal + lingkaran;
  }

  function kabari(aksi) {
    /* Halaman yang memasang lingkaran boleh memuat ulang datanya sendiri lewat
       peristiwa ini; modul cerita tidak kenal profil maupun umpan. */
    document.dispatchEvent(new CustomEvent('pbpii-cerita', { detail: { aksi } }));
  }

  function rekam(data) {
    if (Array.isArray(data?.cerita)) daftar = data.cerita;
    const hakBaru = data?.ceritaHak || data?.kemampuan;
    if (hakBaru) hak = hakBaru;
    catatLingkaran();
    return daftar;
  }

  async function muatLingkaran() {
    try {
      rekam(await api({ action: 'ceritaList', token: tokenSaya() }));
    } catch {
      /* lingkaran hiasan umpan: gagal muat tidak boleh memecahkan halamannya */
    }
    return daftar;
  }

  /* -------------------------------------------------------------------- penonton */

  let panggung = null;
  let indeksGrup = 0;
  let indeksCerita = 0;
  let pemroses = null;
  let sisaJeda = DURI;
  let sejak = 0;
  let pratayang = '';
  let sebelumCerita = null;

  function panggungSiap() {
    if (panggung) return panggung;
    const akar = document.createElement('div');
    akar.className = 'cerita-panggung';
    akar.setAttribute('role', 'dialog');
    akar.setAttribute('aria-modal', 'true');
    akar.setAttribute('aria-label', 'Cerita kader');
    akar.hidden = true;
    akar.innerHTML = `
      <div class="cerita-batang" data-batang></div>
      <header class="cerita-atas">
        <span class="cerita-ava" data-ava></span>
        <span class="cerita-ident">
          <b data-nama></b>
          <small data-sisa></small>
        </span>
        <button class="cerita-jeda" type="button" data-jeda aria-label="Jeda cerita">&#10073;&#10073;</button>
        <button class="cerita-tutup" type="button" data-tutup aria-label="Tutup cerita">&times;</button>
      </header>
      <div class="cerita-badan" data-badan>
        <button class="cerita-sisi cerita-sisi-kiri" type="button" data-kiri aria-label="Cerita sebelumnya"></button>
        <img class="cerita-foto" data-foto alt="" referrerpolicy="no-referrer">
        <button class="cerita-sisi cerita-sisi-kanan" type="button" data-kanan aria-label="Cerita berikutnya"></button>
      </div>
      <footer class="cerita-bawah">
        <p class="cerita-ket" data-ket></p>
        <div class="cerita-mundur" data-mundur hidden>
          <input type="text" maxlength="140" placeholder="Tulis catatan singkat… (opsional)" data-catatan>
          <button type="button" data-kirim>Bagikan</button>
        </div>
        <div class="cerita-kancing" data-kancing hidden>
          <button type="button" data-tambah>+ Tambah cerita</button>
          <button type="button" data-hapus>Hapus cerita ini</button>
        </div>
      </footer>`;
    document.body.appendChild(akar);
    panggung = akar;
    return akar;
  }

  const cari = (selektor) => panggungSiap().querySelector(selektor);

  function bukaPanggung() {
    panggungSiap().hidden = false;
    document.body.classList.add('cerita-terkunci');
  }

  function tutupPanggung({ muatUlang = true } = {}) {
    if (pemroses) clearTimeout(pemroses);
    pemroses = null;
    if (panggung) {
      panggung.hidden = true;
      panggung.classList.remove('is-pratayang', 'is-galat');
      cari('[data-foto]').removeAttribute('src');
      cari('[data-ket]').textContent = '';
    }
    document.body.classList.remove('cerita-terkunci');
    pratayang = '';
    if (sebelumCerita) {
      daftar = sebelumCerita;
      sebelumCerita = null;
    }
    if (muatUlang) catatLingkaran();
  }

  function batang(grup) {
    const jumlah = (grup.cerita || []).length;
    return Array.from({ length: jumlah }, (_, index) => {
      const kelas = index < indeksCerita ? ' is-lewat' : index === indeksCerita ? ' is-aktif' : '';
      return `<i class="cerita-batang-satu${kelas}"><b></b></i>`;
    }).join('');
  }

  function putar(ms) {
    if (pemroses) clearTimeout(pemroses);
    sisaJeda = ms;
    sejak = Date.now();
    const isi = panggung?.querySelector('[data-batang] i.is-aktif b');
    if (isi) {
      isi.style.transition = 'none';
      isi.style.width = '0%';
      requestAnimationFrame(() => {
        isi.style.transition = `width ${ms}ms linear`;
        isi.style.width = '100%';
      });
    }
    pemroses = setTimeout(() => mundur(1), ms);
  }

  function jeda() {
    if (!pemroses) return;
    clearTimeout(pemroses);
    pemroses = null;
    sisaJeda = Math.max(500, sisaJeda - (Date.now() - sejak));
    const isi = panggung?.querySelector('[data-batang] i.is-aktif b');
    if (isi) {
      const lebar = getComputedStyle(isi).width;
      isi.style.transition = 'none';
      isi.style.width = lebar;
    }
  }

  function lanjut() {
    if (pemroses || panggung?.hidden || panggung?.classList.contains('is-pratayang')) return;
    putar(sisaJeda);
  }

  function tampilkan() {
    const grup = daftar[indeksGrup];
    if (!grup || !grup.cerita?.length) {
      if (indeksGrup < daftar.length - 1) {
        indeksGrup += 1;
        indeksCerita = 0;
        return tampilkan();
      }
      return tutupPanggung();
    }
    if (indeksCerita >= grup.cerita.length) {
      return mundur(1);
    }
    const cerita = grup.cerita[indeksCerita];
    const foto = cari('[data-foto]');
    foto.dataset.drive = driveId(cerita.gambar);
    foto.dataset.coba = '1';
    foto.src = gambarSiap(cerita.gambar);
    cari('[data-batang]').innerHTML = batang(grup);
    cari('[data-ava]').innerHTML = wajah(grup);
    cari('[data-nama]').textContent = grup.nama || 'Kader PII';
    cari('[data-sisa]').textContent = sisaWaktu(cerita.kedaluarsa);
    cari('[data-ket]').textContent = cerita.keterangan || '';
    cari('[data-kancing]').hidden = !grup.sendiri;
    panggung.dataset.ceritaId = String(cerita.id);
    panggung.dataset.kaderId = String(grup.kaderId);
    tandaiDibuka([cerita]);
    putar(DURI);
    return undefined;
  }

  function mundur(langkah) {
    const grup = daftar[indeksGrup];
    if (!grup) return tutupPanggung();
    const jumlah = (grup.cerita || []).length;
    const tujuan = indeksCerita + langkah;

    if (tujuan >= 0 && tujuan < jumlah) {
      indeksCerita = tujuan;
      return tampilkan();
    }
    if (langkah < 0 && indeksGrup > 0) {
      indeksGrup -= 1;
      indeksCerita = Math.max(0, (daftar[indeksGrup]?.cerita || []).length - 1);
      return tampilkan();
    }
    if (langkah > 0 && indeksGrup < daftar.length - 1) {
      indeksGrup += 1;
      indeksCerita = 0;
      return tampilkan();
    }
    return tutupPanggung();
  }

  function buka(index) {
    if (!daftar.length) return;
    indeksGrup = Math.max(0, Math.min(daftar.length - 1, Number(index) || 0));
    indeksCerita = 0;
    bukaPanggung();
    tampilkan();
  }

  /** Halaman profil hanya menampilkan satu kader, jadi daftarnya dipinjam dulu. */
  function bukaSatu(grup) {
    if (!grup?.cerita?.length) return;
    sebelumCerita = daftar;
    daftar = [grup];
    indeksGrup = 0;
    indeksCerita = 0;
    bukaPanggung();
    tampilkan();
  }

  /* -------------------------------------------------------------------- unggah */

  let berkas = null;

  function pembuatBerkas() {
    if (berkas) return berkas;
    berkas = document.createElement('input');
    berkas.type = 'file';
    berkas.accept = 'image/jpeg,image/png,image/webp';
    berkas.hidden = true;
    document.body.appendChild(berkas);
    berkas.addEventListener('change', () => {
      const file = berkas.files?.[0];
      berkas.value = '';
      if (file) tataPratayang(file);
    });
    return berkas;
  }

  function bacaDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Foto tidak dapat dibaca.'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Foto kamera hari ini 4–8 MB padahal proksi hanya menerima sekitar 3 MB, jadi
   * diperkecil di browser. Kalau tidak, cerita hanya bisa dibuka dari laptop.
   */
  async function perkecil(file) {
    const dataUrl = await bacaDataUrl(file);
    if (file.size <= BATAS_BERKAS && /^image\/(jpeg|webp)$/i.test(file.type)) return dataUrl;
    const image = await new Promise((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error('Foto tidak terbaca sebagai gambar.'));
      node.src = dataUrl;
    });
    const sisi = Math.max(image.naturalWidth || 0, image.naturalHeight || 0);
    const kali = sisi > KAPASITAS ? KAPASITAS / sisi : 1;
    const kanvas = document.createElement('canvas');
    kanvas.width = Math.max(1, Math.round((image.naturalWidth || KAPASITAS) * kali));
    kanvas.height = Math.max(1, Math.round((image.naturalHeight || KAPASITAS) * kali));
    kanvas.getContext('2d').drawImage(image, 0, 0, kanvas.width, kanvas.height);
    return kanvas.toDataURL('image/jpeg', 0.82);
  }

  function bukaUnggah() {
    if (!window.PBPIIAkun?.requireAccount) return;
    Promise.resolve(window.PBPIIAkun.requireAccount('Masuk sebagai kader untuk membagikan cerita.'))
      .then((akun) => {
        if (!akun) return;
        // Penonton sengaja tidak dibuka dulu: pemilih berkas dari tombol dialog
        // harus datang dari gestur pengguna, dan klik ini gesturnya.
        pembuatBerkas().click();
      })
      .catch(() => null);
  }

  async function tataPratayang(file) {
    let dataUrl = '';
    try {
      dataUrl = await perkecil(file);
    } catch (error) {
      return galat(error.message || 'Foto belum dapat dibaca.');
    }
    if (dataUrl.length * 0.75 > BATAS_BERKAS) {
      return galat('Foto masih terlalu besar. Ambil ulang dari jarak lebih dekat.');
    }
    pratayang = dataUrl;
    bukaPanggung();
    panggung.classList.add('is-pratayang');
    panggung.classList.remove('is-galat');
    if (pemroses) {
      clearTimeout(pemroses);
      pemroses = null;
    }
    const foto = cari('[data-foto]');
    foto.removeAttribute('data-drive');
    foto.removeAttribute('data-coba');
    foto.onerror = null;
    foto.src = dataUrl;
    cari('[data-batang]').innerHTML = '<i class="cerita-batang-satu"><b></b></i>';
    cari('[data-ava]').innerHTML = wajah(sayaKini());
    cari('[data-nama]').textContent = 'Cerita baru';
    cari('[data-sisa]').textContent = 'Hilang dalam 24 jam';
    cari('[data-ket]').textContent = '';
    cari('[data-kancing]').hidden = true;
    cari('[data-mundur]').hidden = false;
    const catatan = cari('[data-catatan]');
    catatan.value = '';
    catatan.focus();
    return undefined;
  }

  function akhiriPratayang() {
    if (!panggung?.classList.contains('is-pratayang')) return;
    panggung.classList.remove('is-pratayang');
    cari('[data-mundur]').hidden = true;
    pratayang = '';
  }

  function galat(message) {
    bukaPanggung();
    akhiriPratayang();
    panggung.classList.add('is-galat');
    cari('[data-batang]').innerHTML = '<i class="cerita-batang-satu"><b></b></i>';
    cari('[data-foto]').src = LOGO;
    cari('[data-ava]').innerHTML = wajah(sayaKini());
    cari('[data-nama]').textContent = 'Cerita belum terkirim';
    cari('[data-sisa]').textContent = '';
    cari('[data-ket]').textContent = message;
    cari('[data-kancing]').hidden = true;
    return undefined;
  }

  async function kirimCerita() {
    if (!pratayang) return;
    const tombol = cari('[data-kirim]');
    const catatan = bersih(cari('[data-catatan]').value);
    tombol.disabled = true;
    tombol.textContent = 'Mengirim…';
    try {
      await api({ action: 'ceritaUnggah', token: tokenSaya(), data: pratayang, keterangan: catatan });
      akhiriPratayang();
      kabari('unggah');
      await muatLingkaran();
      const index = daftar.findIndex((item) => item.sendiri);
      if (index >= 0) {
        buka(index);
      } else {
        tutupPanggung({ muatUlang: false });
      }
    } catch (error) {
      akhiriPratayang();
      galat(error.message || 'Cerita belum berhasil dibagikan.');
    } finally {
      tombol.disabled = false;
      tombol.textContent = 'Bagikan';
    }
  }

  async function hapusCerita() {
    const id = panggung?.dataset.ceritaId;
    const grup = daftar[indeksGrup];
    if (!id || !grup) return;
    const tombol = cari('[data-hapus]');
    tombol.disabled = true;
    try {
      await api({ action: 'ceritaHapus', token: tokenSaya(), id });
      grup.cerita = grup.cerita.filter((item) => String(item.id) !== String(id));
      kabari('hapus');
      if (!grup.cerita.length) {
        daftar = daftar.filter((item) => item !== grup);
        if (!daftar.length) return tutupPanggung();
        indeksGrup = Math.min(indeksGrup, daftar.length - 1);
        indeksCerita = 0;
        return tampilkan();
      }
      indeksCerita = Math.min(indeksCerita, grup.cerita.length - 1);
      return tampilkan();
    } catch (error) {
      galat(error.message || 'Cerita belum dapat dihapus.');
    } finally {
      tombol.disabled = false;
    }
  }

  /* ------------------------------------------------------------------ peristiwa */

  document.addEventListener('click', (event) => {
    const tambah = event.target.closest?.('[data-cerita-tambah]');
    if (tambah) {
      event.preventDefault();
      return bukaUnggah();
    }
    const cincin = event.target.closest?.('[data-cerita]');
    if (cincin && !panggung?.contains(cincin)) {
      event.preventDefault();
      if (event.target.closest?.('.cerita-ring-plus')) return bukaUnggah();
      return buka(Number(cincin.dataset.cerita) || 0);
    }
    if (panggung?.hidden) return undefined;

    const dekat = (selektor) => event.target.closest?.(selektor);
    if (dekat('[data-tutup]')) {
      if (panggung.classList.contains('is-pratayang')) akhiriPratayang();
      return tutupPanggung();
    }
    if (dekat('[data-kiri]')) {
      jeda();
      return mundur(-1);
    }
    if (dekat('[data-kanan]')) {
      if (panggung.classList.contains('is-pratayang')) return undefined;
      jeda();
      return mundur(1);
    }
    if (dekat('[data-jeda]')) {
      if (pemroses) jeda();
      else lanjut();
      return undefined;
    }
    if (dekat('[data-tambah]')) return bukaUnggah();
    if (dekat('[data-kirim]')) return kirimCerita();
    if (dekat('[data-hapus]')) return hapusCerita();
    return undefined;
  });

  document.addEventListener('keydown', (event) => {
    if (panggung?.hidden) return;
    if (event.key === 'Escape') {
      if (panggung.classList.contains('is-pratayang')) akhiriPratayang();
      return tutupPanggung();
    }
    if (event.target?.matches?.('[data-catatan]')) {
      if (event.key === 'Enter') {
        event.preventDefault();
        kirimCerita();
      }
      return undefined;
    }
    if (panggung.classList.contains('is-pratayang')) return undefined;
    if (event.key === 'ArrowLeft') {
      jeda();
      mundur(-1);
    } else if (event.key === 'ArrowRight') {
      jeda();
      mundur(1);
    } else if (event.key === ' ') {
      event.preventDefault();
      if (pemroses) jeda();
      else lanjut();
    }
    return undefined;
  });

  // Tahan sentuh = jeda, lepas = jalan lagi, seperti umpan sosial pada umumnya.
  panggungSiap().addEventListener('pointerdown', (event) => {
    if (panggung.hidden || panggung.classList.contains('is-pratayang')) return;
    if (event.target.closest('button, [data-catatan]')) return;
    jeda();
  });
  panggungSiap().addEventListener('pointerup', (event) => {
    if (panggung.hidden || panggung.classList.contains('is-pratayang')) return;
    if (event.target.closest('button, [data-catatan]')) return;
    lanjut();
  });

  /* ------------------------------------------------------------------ publik */

  function pasang(el, data) {
    const ganti = host !== (el || null);
    host = el || null;
    if (!host) return daftar;
    if (data) return rekam(data);
    // Halaman yang datangnya sendiri (umpan sudah membawa cerita) tidak perlu
    // permintaan kedua; hanya halaman yang belum punya data yang bertanya.
    return ganti ? muatLingkaran() : daftar;
  }

  window.PBPIICerita = {
    pasang,
    muat: muatLingkaran,
    catat: catatLingkaran,
    daftar: () => daftar.slice(),
    buka,
    bukaSatu,
    unggah: bukaUnggah,
    tutup: () => tutupPanggung(),
    sisaWaktu,
    sedangTayang: () => Boolean(panggung && !panggung.hidden)
  };
})();
