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
  const LOGO = '/assets/logo-pii.webp';
  const DURI = 6000;
  const BATAS_BERKAS = 3 * 1024 * 1024;
  const KAPASITAS = 1400;
  const KETERANGAN_MAX = 140;
  const KUNCI_LIHAT = 'pbpii_cerita_dilihat';
  /* Tablet portrait ikut pengalaman mobile; tablet landscape dan desktop memakai
     penonton lebar. Satu daftar Story dipakai kedua tampilan, jadi tidak ada
     backend atau state ganda. */
  const LAYAR_MOBIL = window.matchMedia('(max-width: 680px), (orientation: portrait) and (max-width: 1024px)');

  const tokenSaya = () => window.PBPIIAkun?.sessionToken?.() || window.PBPIIAkun?.token?.() || '';
  const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inisial = (nama) => String(nama || 'K').trim().charAt(0).toUpperCase() || 'K';
  const bersih = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, KETERANGAN_MAX);
  const angka = (nilai) => (Number(nilai) || 0).toLocaleString('id-ID');

  /** Data server selalu masuk lewat textContent, bukan innerHTML mentah. */
  function simpul(tag, kelas, teks) {
    const node = document.createElement(tag);
    if (kelas) node.className = kelas;
    if (teks !== undefined && teks !== null) node.textContent = String(teks);
    return node;
  }

  function waktuCerita(value) {
    const waktu = Date.parse(String(value || ''));
    if (!isFinite(waktu)) return '';
    const menit = Math.max(0, Math.round((Date.now() - waktu) / 60000));
    if (menit < 1) return 'baru saja';
    if (menit < 60) return `${menit} menit lalu`;
    const jam = Math.round(menit / 60);
    if (jam < 24) return `${jam} jam lalu`;
    return `${Math.round(jam / 24)} hari lalu`;
  }

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
  const gambarMentah = (value) => {
    const url = String(value || '').trim();
    if (!/^https:\/\//i.test(url)) return LOGO;
    const id = driveId(url);
    return id ? bentuk[0](id) : url;
  };
  const gambarSiap = (value) => escapeHTML(gambarMentah(value));
  /* Video tidak lewat proksi gambar (butuh rentang byte). Tautan Drive lama,
     Storage baru, dan URL lokal untuk pratayang unggahan diterima; selain itu ditolak. */
  const videoSiap = (value, lokal = false) => {
    const url = String(value || '').trim();
    if (lokal && /^(blob:https?:\/\/|data:video\/)/i.test(url)) return escapeHTML(url);
    if (!/^https:\/\//i.test(url)) return '';
    try {
      const parsed = new URL(url);
      const dasar = String(window.PBPII_CONFIG?.mediaBaseUrl || '').replace(/\/+$/, '');
      const boleh = ['drive.google.com', 'drive.usercontent.google.com'].includes(parsed.hostname)
        || /\/storage\/v1\/object\/public\/media\//.test(parsed.pathname)
        || (dasar && url.startsWith(dasar + '/'))
        || /\.(mp4|webm|ogg|mov|m4v)$/i.test(parsed.pathname);
      return boleh ? escapeHTML(parsed.href) : '';
    } catch {
      return '';
    }
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
        type="button" data-cerita="${index}" aria-label="Buka cerita ${escapeHTML(item.nama || 'Kader')}"
        title="${escapeHTML(item.nama || 'Kader')}">
        <span class="cerita-ring-isi">${wajah(item)}</span>
        ${item.sendiri && bisaUnggah ? '<span class="cerita-ring-plus" aria-hidden="true">+</span>' : ''}
        <span class="cerita-ring-nama">${escapeHTML(item.nama || 'Kader')}</span>
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
  let modeListener = false;

  function perbaruiTampilan() {
    if (!panggung) return;
    panggung.dataset.tampilan = LAYAR_MOBIL.matches ? 'mobile' : 'desktop';
    const tinggi = window.visualViewport ? Math.round(window.visualViewport.height) : 0;
    panggung.style.setProperty('--cerita-vv', tinggi ? tinggi + 'px' : '100dvh');
  }

  function pasangListenerTampilan() {
    if (modeListener) return;
    modeListener = true;
    if (LAYAR_MOBIL.addEventListener) LAYAR_MOBIL.addEventListener('change', perbaruiTampilan);
    else if (LAYAR_MOBIL.addListener) LAYAR_MOBIL.addListener(perbaruiTampilan);
    window.addEventListener('resize', perbaruiTampilan, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', perbaruiTampilan, { passive: true });
      window.visualViewport.addEventListener('scroll', perbaruiTampilan, { passive: true });
    }
  }

  let indeksGrup = 0;
  let indeksCerita = 0;
  let pemroses = null;
  let sisaJeda = DURI;
  let sejak = 0;
  let pratayang = '';
  let pratayangVideo = false;
  let sebelumCerita = null;
  let videoAktif = false;
  let notifPemroses = null;
  /* Detail cerita diingat selama halaman terbuka; tayang dicatat sekali per id. */
  let detailCache = new Map();
  let detailUrutan = 0;
  const tayangDicatat = new Set();
  let geserTerakhir = 0;

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
        <button class="cerita-kembali" type="button" data-kembali aria-label="Kembali ke daftar cerita">&#8249;</button>
        <span class="cerita-ava" data-ava></span>
        <span class="cerita-ident">
          <b data-nama></b>
          <small><span data-user></span><span data-sisa></span></small>
        </span>
        <button class="cerita-jeda" type="button" data-jeda aria-label="Jeda cerita">&#10073;&#10073;</button>
        <button class="cerita-suara" type="button" data-suara aria-label="Nyalakan suara video" hidden>&#128263;</button>
        <button class="cerita-menu" type="button" data-menu aria-label="Opsi cerita">&#8942;</button>
        <button class="cerita-tutup" type="button" data-tutup aria-label="Tutup cerita">&times;</button>
        <div class="cerita-menu-pop" data-menu-pop hidden>
          <button type="button" data-menu-tambah>+ Tambah cerita</button>
          <button type="button" data-menu-hapus>Hapus cerita ini</button>
          <button type="button" data-menu-turunkan>Turunkan cerita</button>
        </div>
      </header>
      <div class="cerita-badan" data-badan>
        <button class="cerita-sisi cerita-sisi-kiri" type="button" data-kiri aria-label="Cerita sebelumnya"></button>
        <img class="cerita-foto" data-foto alt="" referrerpolicy="no-referrer">
        <video class="cerita-video" data-video playsinline preload="metadata" hidden></video>
        <button class="cerita-sisi cerita-sisi-kanan" type="button" data-kanan aria-label="Cerita berikutnya"></button>
      </div>
      <footer class="cerita-bawah">
        <p class="cerita-ket" data-ket></p>
        <div class="cerita-cepat" data-cepat aria-label="Reaksi cepat">
          <button type="button" data-reaksi="&#10084;&#65039;" data-cepat-suka aria-label="Suka cerita">&#10084;&#65039;</button>
          <button type="button" data-reaksi="&#128514;" aria-label="Kirim reaksi tertawa">&#128514;</button>
          <button type="button" data-reaksi="&#128558;" aria-label="Kirim reaksi kagum">&#128558;</button>
          <button type="button" data-reaksi="&#128591;" aria-label="Kirim reaksi hormat">&#128591;</button>
        </div>
        <div class="cerita-interaksi" data-interaksi hidden>
          <button class="cerita-suka" type="button" data-suka aria-pressed="false" aria-label="Suka cerita ini">&#9825; <span data-suka-jumlah>0</span></button>
          <button class="cerita-balas-pintas" type="button" data-fokus-balas aria-label="Balas cerita ini">&#128172; <span data-balasan-jumlah>0</span></button>
          <button class="cerita-penonton-tombol" type="button" data-penonton hidden>Lihat penonton (<span data-penonton-jumlah>0</span>)</button>
        </div>
        <form class="cerita-balas-form" data-balas-form hidden>
          <button class="cerita-emoji" type="button" data-emoji aria-label="Pilih emoji">&#9786;</button>
          <input type="text" maxlength="140" placeholder="Balas cerita ini…" aria-label="Tulis balasan untuk cerita" data-balas-teks>
          <button class="cerita-hati" type="button" data-suka-cepat aria-pressed="false" aria-label="Suka cerita ini">&#9825;</button>
          <button class="cerita-kirim" type="submit" aria-label="Kirim balasan">&#10148;</button>
        </form>
        <div class="cerita-emoji-panel" data-emoji-panel hidden>
          <button type="button" data-emoji-pilih="&#128512;">&#128512;</button>
          <button type="button" data-emoji-pilih="&#128525;">&#128525;</button>
          <button type="button" data-emoji-pilih="&#128079;">&#128079;</button>
          <button type="button" data-emoji-pilih="&#128591;">&#128591;</button>
          <button type="button" data-emoji-pilih="&#10084;&#65039;">&#10084;&#65039;</button>
          <button type="button" data-emoji-pilih="&#127881;">&#127881;</button>
        </div>
        <p class="cerita-balas-note" data-balas-note hidden role="status"></p>
        <ul class="cerita-balasan" data-balasan-list hidden></ul>
        <div class="cerita-mundur" data-mundur hidden>
          <input type="text" maxlength="140" placeholder="Tulis catatan singkat… (opsional)" data-catatan>
          <button type="button" data-kirim>Bagikan</button>
        </div>
        <div class="cerita-kancing" data-kancing hidden>
          <button type="button" data-tambah>+ Tambah cerita</button>
          <button type="button" data-hapus>Hapus cerita ini</button>
          <button type="button" class="cerita-turunkan" data-turunkan hidden>Turunkan cerita</button>
        </div>
      </footer>
      <div class="cerita-penonton-panel" data-penonton-panel hidden role="dialog" aria-label="Penonton cerita">
        <div class="cerita-penonton-card">
          <header><b>Penonton cerita</b><button type="button" data-penonton-tutup aria-label="Tutup daftar penonton">&times;</button></header>
          <ul data-penonton-list></ul>
        </div>
      </div>
      <span class="cerita-toast" data-toast hidden role="status"></span>
      <div class="cerita-mod" data-mod hidden role="dialog" aria-modal="true" aria-label="Turunkan cerita">
        <div class="cerita-mod-card">
          <h3>Turunkan cerita ini</h3>
          <p>Cerita akan disembunyikan dari lingkaran kader. Barisnya tetap disimpan supaya dapat dipulihkan.</p>
          <label for="ceritaModAlasan">Alasan moderasi</label>
          <textarea id="ceritaModAlasan" data-mod-alasan rows="3" maxlength="240" placeholder="Tuliskan alasan agar tercatat di audit log."></textarea>
          <p class="cerita-mod-error" data-mod-error hidden role="alert"></p>
          <div class="cerita-mod-aksi">
            <button type="button" data-mod-batal>Batal</button>
            <button type="button" class="is-utama" data-mod-lanjut>Turunkan</button>
          </div>
        </div>
      </div>`;
    akar.querySelector('[data-balas-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      kirimBalasan();
    });
    document.body.appendChild(akar);
    panggung = akar;
    return akar;
  }

  const cari = (selektor) => panggungSiap().querySelector(selektor);

  function bukaPanggung() {
    panggungSiap().hidden = false;
    document.documentElement.classList.add('cerita-terkunci');
    document.body.classList.add('cerita-terkunci');
    pasangListenerTampilan();
    perbaruiTampilan();
  }

  function tutupPanggung({ muatUlang = true } = {}) {
    if (pemroses) clearTimeout(pemroses);
    pemroses = null;
    if (notifPemroses) clearTimeout(notifPemroses);
    notifPemroses = null;
    if (panggung) {
      hentikanVideo();
      panggung.hidden = true;
      panggung.classList.remove('is-pratayang', 'is-galat');
      cari('[data-foto]').removeAttribute('src');
      cari('[data-ket]').textContent = '';
      cari('[data-toast]').hidden = true;
      cari('[data-mod]').hidden = true;
      cari('[data-penonton-panel]').hidden = true;
      cari('[data-interaksi]').hidden = true;
      cari('[data-balas-form]').hidden = true;
      cari('[data-balasan-list]').hidden = true;
      cari('[data-balas-note]').hidden = true;
      cari('[data-balas-teks]').value = '';
      cari('[data-menu-pop]').hidden = true;
      cari('[data-emoji-panel]').hidden = true;
    }
    document.documentElement.classList.remove('cerita-terkunci');
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

  const videoNode = () => panggung?.querySelector('[data-video]') || null;
  const batangAktif = () => panggung?.querySelector('[data-batang] i.is-aktif b') || null;

  function siapBatang(grup) {
    cari('[data-batang]').innerHTML = batang(grup);
    const isi = batangAktif();
    if (isi) {
      isi.style.transition = 'none';
      isi.style.width = '0%';
    }
  }

  function hentikanVideo() {
    const video = videoNode();
    if (!video) return;
    video.pause();
    video.removeEventListener('loadedmetadata', videoMeta);
    video.removeEventListener('timeupdate', videoTime);
    video.removeEventListener('ended', videoEnded);
    video.removeEventListener('error', videoError);
    video.removeAttribute('src');
    video.load();
    videoAktif = false;
  }

  function videoMeta() {
    const isi = batangAktif();
    if (isi) {
      isi.style.transition = 'none';
      isi.style.width = '0%';
    }
  }

  function videoTime() {
    const video = videoNode();
    if (!video || !Number(video.duration) || !isFinite(video.duration)) return;
    const isi = batangAktif();
    if (!isi) return;
    isi.style.transition = 'none';
    isi.style.width = `${Math.min(100, (video.currentTime / video.duration) * 100)}%`;
  }

  function videoEnded() {
    if (videoAktif) mundur(1);
  }

  function videoError() {
    galat('Video tidak dapat diputar. Periksa koneksi, lalu buka cerita ini lagi.');
  }

  function pasangVideo(cerita, grup) {
    const video = cari('[data-video]');
    const foto = cari('[data-foto]');
    const suara = cari('[data-suara]');
    hentikanVideo();
    foto.removeAttribute('src');
    foto.hidden = true;
    video.hidden = false;
    video.muted = true;
    video.loop = false;
    suara.hidden = false;
    suara.textContent = '\u{1F507}';
    suara.setAttribute('aria-label', 'Nyalakan suara video');
    const jedaTombol = panggung?.querySelector('[data-jeda]');
    if (jedaTombol) {
      jedaTombol.textContent = '❚❚';
      jedaTombol.setAttribute('aria-label', 'Jeda cerita');
    }
    siapBatang(grup);
    const src = videoSiap(cerita.gambar);
    if (!src) {
      galat('Tautan video tidak dikenal. Cerita ini tidak dapat diputar.');
      return;
    }
    videoAktif = true;
    video.addEventListener('loadedmetadata', videoMeta);
    video.addEventListener('timeupdate', videoTime);
    video.addEventListener('ended', videoEnded);
    video.addEventListener('error', videoError);
    video.src = src;
    video.load();
    const janji = video.play();
    if (janji && typeof janji.catch === 'function') janji.catch(() => { /* ketuk layar untuk memutar */ });
  }

  function notifikasiCerita(pesan) {
    const node = cari('[data-toast]');
    if (!node) return;
    node.textContent = pesan;
    node.hidden = false;
    if (notifPemroses) clearTimeout(notifPemroses);
    notifPemroses = setTimeout(() => { node.hidden = true; }, 4500);
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
    if (videoAktif) {
      const video = videoNode();
      if (video) video.pause();
      const tombol = panggung?.querySelector('[data-jeda]');
      if (tombol) {
        tombol.textContent = '▶';
        tombol.setAttribute('aria-label', 'Lanjut cerita');
      }
      return;
    }
    if (!pemroses) return;
    clearTimeout(pemroses);
    pemroses = null;
    sisaJeda = Math.max(500, sisaJeda - (Date.now() - sejak));
    const isi = batangAktif();
    if (isi) {
      const lebar = getComputedStyle(isi).width;
      isi.style.transition = 'none';
      isi.style.width = lebar;
    }
  }

  function lanjut() {
    if (panggung?.hidden || panggung?.classList.contains('is-pratayang')) return;
    if (videoAktif) {
      const video = videoNode();
      if (!video) return;
      const janji = video.play();
      if (janji && typeof janji.catch === 'function') janji.catch(() => { /* ketuk layar untuk memutar */ });
      const tombol = panggung?.querySelector('[data-jeda]');
      if (tombol) {
        tombol.textContent = '❚❚';
        tombol.setAttribute('aria-label', 'Jeda cerita');
      }
      return;
    }
    if (pemroses) return;
    putar(sisaJeda);
  }

  /** Satu tombol untuk foto (memakai timer) dan video (memakai elemen video). */
  function jedaLanjut() {
    if (videoAktif) {
      const video = videoNode();
      if (video && video.paused) lanjut();
      else jeda();
      return;
    }
    if (pemroses) jeda();
    else lanjut();
  }

  async function pastiAkun(pesan) {
    const akun = window.PBPIIAkun?.account?.();
    if (akun && akun.role !== 'tamu') return akun;
    if (!window.PBPIIAkun?.requireAccount) return null;
    try {
      return await window.PBPIIAkun.requireAccount(pesan);
    } catch {
      return null;
    }
  }

  function catatTayang(id) {
    const kunci = String(id || '');
    if (!kunci || tayangDicatat.has(kunci)) return;
    tayangDicatat.add(kunci);
    /* Dihitung sekali per cerita per kunjungan halaman. Gagalnya tidak boleh
       mengganggu tayangan, dan tidak boleh memicu pbpii-cerita (profil tidak
       perlu dimuat ulang hanya karena Story dibuka). */
    api({ action: 'ceritaLihat', token: tokenSaya(), id }).catch(() => {});
  }

  function resetDetail() {
    cari('[data-suka]').classList.remove('is-on');
    cari('[data-suka]').setAttribute('aria-pressed', 'false');
    cari('[data-suka-jumlah]').textContent = '0';
    const cepat = cari('[data-suka-cepat]');
    if (cepat) {
      cepat.classList.remove('is-on');
      cepat.setAttribute('aria-pressed', 'false');
    }
    const reaksi = cari('[data-cepat-suka]');
    if (reaksi) reaksi.classList.remove('is-on');
    cari('[data-balasan-jumlah]').textContent = '0';
    cari('[data-balasan-list]').replaceChildren(
      simpul('li', 'cerita-balasan-kosong', 'Memuat balasan…')
    );
    cari('[data-balasan-list]').hidden = false;
    cari('[data-balas-note]').hidden = true;
    cari('[data-penonton]').hidden = true;
    cari('[data-penonton-panel]').hidden = true;
  }

  function avatarKecil(sumber, nama) {
    const bingkai = simpul('span', 'cerita-kecil-ava');
    const url = String(sumber || '').trim();
    if (!/^https:\/\//i.test(url)) {
      bingkai.textContent = inisial(nama);
      return bingkai;
    }
    const img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.src = gambarMentah(url);
    img.onerror = () => { img.onerror = null; img.src = LOGO; };
    bingkai.appendChild(img);
    return bingkai;
  }

  function barisBalasan(item) {
    const li = simpul('li', `cerita-balasan-item${item.mine ? ' is-mine' : ''}`);
    li.appendChild(avatarKecil(item.avatar, item.nama));
    const isi = simpul('span', 'cerita-balasan-isi');
    const kepala = simpul('span', 'cerita-balasan-kepala');
    kepala.appendChild(simpul('b', '', item.nama || 'Kader PII'));
    if (item.mine) kepala.appendChild(simpul('small', '', ' · Anda'));
    kepala.appendChild(simpul('small', 'cerita-balasan-waktu', waktuCerita(item.dibuat)));
    isi.appendChild(kepala);
    isi.appendChild(simpul('span', 'cerita-balasan-teks', item.teks || ''));
    li.appendChild(isi);
    return li;
  }

  function paintDetail(data) {
    if (!data) return;
    const suka = cari('[data-suka]');
    suka.classList.toggle('is-on', Boolean(data.liked));
    suka.setAttribute('aria-pressed', String(Boolean(data.liked)));
    cari('[data-suka-jumlah]').textContent = angka(data.likes);
    const cepat = cari('[data-suka-cepat]');
    if (cepat) {
      cepat.classList.toggle('is-on', Boolean(data.liked));
      cepat.setAttribute('aria-pressed', String(Boolean(data.liked)));
    }
    const reaksi = cari('[data-cepat-suka]');
    if (reaksi) reaksi.classList.toggle('is-on', Boolean(data.liked));
    const balasan = Array.isArray(data.balasan) ? data.balasan : [];
    const jumlah = isFinite(Number(data.jumlahBalasan)) ? Number(data.jumlahBalasan) : balasan.length;
    cari('[data-balasan-jumlah]').textContent = angka(jumlah);
    const daftarBalasan = cari('[data-balasan-list]');
    daftarBalasan.replaceChildren(...(balasan.length
      ? balasan.map(barisBalasan)
      : [simpul('li', 'cerita-balasan-kosong', 'Belum ada balasan. Jadilah yang pertama menyapa.')]));
    daftarBalasan.hidden = false;
    const penonton = Array.isArray(data.penonton) ? data.penonton : null;
    const tombol = cari('[data-penonton]');
    tombol.hidden = !penonton;
    if (penonton) {
      cari('[data-penonton-jumlah]').textContent = angka(data.jumlahPenonton ?? penonton.length);
    } else {
      cari('[data-penonton-panel]').hidden = true;
    }
  }

  async function muatDetail(id) {
    const kunci = String(id || '');
    if (!kunci) return;
    const nomor = ++detailUrutan;
    const tersimpan = detailCache.get(kunci);
    if (tersimpan) {
      paintDetail(tersimpan);
      return;
    }
    resetDetail();
    try {
      const data = await api({ action: 'ceritaDetail', token: tokenSaya(), id });
      if (nomor !== detailUrutan || panggung?.dataset.ceritaId !== kunci) return;
      detailCache.set(kunci, data || {});
      paintDetail(data || {});
    } catch {
      if (nomor === detailUrutan && panggung?.dataset.ceritaId === kunci) {
        cari('[data-suka-jumlah]').textContent = '—';
        const kosong = cari('[data-balasan-list]').querySelector('.cerita-balasan-kosong');
        if (kosong) kosong.textContent = 'Balasan belum dapat dimuat.';
      }
    }
  }

  async function toggleSuka() {
    const id = panggung?.dataset.ceritaId;
    const tombol = cari('[data-suka]');
    if (!id || tombol.disabled) return;
    if (!await pastiAkun('Masuk sebagai kader untuk menyukai cerita.')) return;
    const data = detailCache.get(String(id)) || { likes: 0, liked: false };
    const sebelum = { likes: Number(data.likes) || 0, liked: Boolean(data.liked) };
    data.liked = !sebelum.liked;
    data.likes = Math.max(0, sebelum.likes + (data.liked ? 1 : -1));
    detailCache.set(String(id), data);
    paintDetail(data);
    tombol.disabled = true;
    try {
      const hasil = await api({ action: 'ceritaSuka', token: tokenSaya(), id });
      data.liked = Boolean(hasil.liked);
      data.likes = Number(hasil.likes) || 0;
      detailCache.set(String(id), data);
      paintDetail(data);
    } catch (error) {
      data.likes = sebelum.likes;
      data.liked = sebelum.liked;
      detailCache.set(String(id), data);
      paintDetail(data);
      notifikasiCerita(error.message || 'Suka belum dapat dikirim.');
    } finally {
      tombol.disabled = false;
    }
  }

  async function kirimBalasan() {
    const id = panggung?.dataset.ceritaId;
    const input = cari('[data-balas-teks]');
    const catatan = cari('[data-balas-note]');
    const tombol = cari('[data-balas-form] button[type="submit"]');
    if (!id || !tombol || tombol.disabled) return;
    const teks = String(input.value || '').trim();
    if (teks.length < 3) {
      catatan.textContent = 'Tulis balasan minimal 3 karakter.';
      catatan.hidden = false;
      input.focus();
      return;
    }
    if (!await pastiAkun('Masuk sebagai kader untuk membalas cerita.')) return;
    catatan.hidden = true;
    tombol.disabled = true;
    try {
      const hasil = await api({ action: 'ceritaBalas', token: tokenSaya(), id, teks });
      const data = detailCache.get(String(id)) || { balasan: [] };
      const daftar = Array.isArray(data.balasan) ? data.balasan.slice() : [];
      if (hasil.balasan && !daftar.some((item) => String(item.id) === String(hasil.balasan.id))) {
        daftar.push(hasil.balasan);
      }
      data.balasan = daftar;
      data.jumlahBalasan = isFinite(Number(hasil.jumlah)) ? Number(hasil.jumlah) : daftar.length;
      detailCache.set(String(id), data);
      paintDetail(data);
      input.value = '';
      cari('[data-balasan-list]').scrollTop = cari('[data-balasan-list]').scrollHeight;
    } catch (error) {
      catatan.textContent = error.message || 'Balasan belum dapat dikirim.';
      catatan.hidden = false;
    } finally {
      tombol.disabled = false;
      input.focus();
    }
  }

  function bukaPenonton() {
    const data = detailCache.get(String(panggung?.dataset.ceritaId || ''));
    const penonton = Array.isArray(data?.penonton) ? data.penonton : [];
    const panel = cari('[data-penonton-panel]');
    cari('[data-penonton-list]').replaceChildren(...(penonton.length
      ? penonton.map((orang) => {
        const li = simpul('li', 'cerita-penonton-item');
        li.appendChild(avatarKecil(orang.avatar, orang.nama));
        const isi = simpul('span', 'cerita-penonton-isi');
        isi.appendChild(simpul('b', '', orang.nama || 'Kader PII'));
        isi.appendChild(simpul('small', '', waktuCerita(orang.dibuat)));
        li.appendChild(isi);
        return li;
      })
      : [simpul('li', 'cerita-balasan-kosong', 'Belum ada kader yang menonton cerita ini.')]));
    panel.hidden = false;
    cari('[data-penonton-tutup]').focus();
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
    panggung.classList.remove('is-pratayang', 'is-galat');
    cari('[data-mundur]').hidden = true;
    cari('[data-interaksi]').hidden = false;
    cari('[data-balas-form]').hidden = false;
    cari('[data-balas-note]').hidden = true;
    cari('[data-penonton-panel]').hidden = true;
    const video = Boolean(cerita.video) || /^video\//i.test(String(cerita.mime || ''));
    const foto = cari('[data-foto]');
    hentikanVideo();
    if (pemroses) {
      clearTimeout(pemroses);
      pemroses = null;
    }
    if (video) {
      pasangVideo(cerita, grup);
    } else {
      foto.hidden = false;
      cari('[data-video]').hidden = true;
      cari('[data-suara]').hidden = true;
      foto.dataset.drive = driveId(cerita.gambar);
      foto.dataset.coba = '1';
      foto.onerror = window.PBPIICeritaGagal;
      foto.src = gambarSiap(cerita.gambar);
      siapBatang(grup);
    }
    cari('[data-ava]').innerHTML = wajah(grup);
    cari('[data-nama]').textContent = grup.nama || 'Kader PII';
    cari('[data-user]').textContent = grup.username ? '@' + String(grup.username) : '';
    cari('[data-sisa]').textContent = sisaWaktu(cerita.kedaluarsa);
    cari('[data-ket]').textContent = cerita.keterangan || '';
    cari('[data-kancing]').hidden = !grup.sendiri && !hak.moderasi;
    cari('[data-tambah]').hidden = !grup.sendiri;
    cari('[data-hapus]').hidden = !grup.sendiri;
    cari('[data-turunkan]').hidden = !hak.moderasi;
    cari('[data-menu-pop]').hidden = true;
    cari('[data-menu-tambah]').hidden = !grup.sendiri;
    cari('[data-menu-hapus]').hidden = !grup.sendiri;
    cari('[data-menu-turunkan]').hidden = !hak.moderasi;
    cari('[data-menu]').hidden = !grup.sendiri && !hak.moderasi;
    panggung.dataset.ceritaId = String(cerita.id);
    panggung.dataset.kaderId = String(grup.kaderId);
    tandaiDibuka([cerita]);
    catatTayang(cerita.id);
    muatDetail(cerita.id);
    if (!video) putar(DURI);
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

  function posisiCerita(id) {
    const kunci = String(id || '');
    for (let g = 0; g < daftar.length; g += 1) {
      const cerita = (daftar[g].cerita || []).findIndex((item) => String(item.id) === kunci);
      if (cerita >= 0) return { grup: g, cerita };
    }
    return null;
  }

  /** Dipakai notifikasi: /app/feed?cerita=<id> harus membuka tayangan yang tepat. */
  async function bukaId(id) {
    const kunci = String(id || '');
    if (!kunci) return false;
    /* Penonton profil meminjam daftar satu kader; tautan langsung pakai daftar
       lengkap dari umpan, jadi pinjaman itu dilepaskan sebelum mencari. */
    sebelumCerita = null;
    let posisi = posisiCerita(kunci);
    if (!posisi) {
      await muatLingkaran();
      posisi = posisiCerita(kunci);
    }
    if (!posisi) return false;
    indeksGrup = posisi.grup;
    indeksCerita = posisi.cerita;
    bukaPanggung();
    tampilkan();
    return true;
  }

  /* -------------------------------------------------------------------- unggah */

  let berkas = null;

  function pembuatBerkas() {
    if (berkas) return berkas;
    berkas = document.createElement('input');
    berkas.type = 'file';
    berkas.accept = 'image/jpeg,image/png,image/webp,video/mp4,video/webm';
    berkas.hidden = true;
    document.body.appendChild(berkas);
    berkas.addEventListener('change', () => {
      const file = berkas.files?.[0];
      berkas.value = '';
      if (file) tataPratayang(file);
    });
    return berkas;
  }

  function bacaDataUrl(file, label = 'Berkas') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error(label + ' tidak dapat dibaca.'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Foto kamera hari ini 4–8 MB padahal proksi hanya menerima sekitar 3 MB, jadi
   * diperkecil di browser. Kalau tidak, cerita hanya bisa dibuka dari laptop.
   */
  async function perkecil(file) {
    const dataUrl = await bacaDataUrl(file, 'Foto');
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
    const videoFile = /^video\//i.test(file.type) || /\.(mp4|webm)$/i.test(file.name);
    const label = videoFile ? 'Video' : 'Foto';
    let dataUrl = '';
    try {
      dataUrl = videoFile ? await bacaDataUrl(file, label) : await perkecil(file);
    } catch (error) {
      return galat(error.message || label + ' belum dapat dibaca.');
    }
    if (dataUrl.length * 0.75 > BATAS_BERKAS) {
      return galat(videoFile
        ? 'Video masih terlalu besar. Cerita menerima video hingga 3 MB.'
        : 'Foto masih terlalu besar. Ambil ulang dari jarak lebih dekat.');
    }
    pratayang = dataUrl;
    pratayangVideo = videoFile;
    bukaPanggung();
    panggung.classList.add('is-pratayang');
    panggung.classList.remove('is-galat');
    if (pemroses) {
      clearTimeout(pemroses);
      pemroses = null;
    }
    hentikanVideo();
    const foto = cari('[data-foto]');
    const video = cari('[data-video]');
    foto.removeAttribute('data-drive');
    foto.removeAttribute('data-coba');
    foto.onerror = null;
    foto.hidden = videoFile;
    video.hidden = !videoFile;
    if (videoFile) {
      video.muted = true;
      video.src = videoSiap(dataUrl, true);
      video.load();
      const janji = video.play();
      if (janji && typeof janji.catch === 'function') janji.catch(() => { /* pratayang bisa ditekan manual */ });
      cari('[data-suara]').hidden = false;
    } else {
      foto.src = dataUrl;
      cari('[data-suara]').hidden = true;
    }
    cari('[data-batang]').innerHTML = '<i class="cerita-batang-satu"><b></b></i>';
    cari('[data-ava]').innerHTML = wajah(sayaKini());
    cari('[data-nama]').textContent = 'Cerita baru';
    cari('[data-sisa]').textContent = videoFile ? 'Video · hilang dalam 24 jam' : 'Hilang dalam 24 jam';
    cari('[data-ket]').textContent = '';
    cari('[data-user]').textContent = '';
    cari('[data-kancing]').hidden = true;
    cari('[data-menu]').hidden = true;
    cari('[data-menu-pop]').hidden = true;
    cari('[data-interaksi]').hidden = true;
    cari('[data-balas-form]').hidden = true;
    cari('[data-balasan-list]').hidden = true;
    cari('[data-mundur]').hidden = false;
    const catatan = cari('[data-catatan]');
    catatan.value = '';
    catatan.focus();
    return undefined;
  }

  function akhiriPratayang() {
    if (!panggung?.classList.contains('is-pratayang')) return;
    if (pratayangVideo) hentikanVideo();
    panggung.classList.remove('is-pratayang');
    cari('[data-mundur]').hidden = true;
    pratayang = '';
    pratayangVideo = false;
  }

  function galat(message) {
    bukaPanggung();
    if (panggung.classList.contains('is-pratayang')) akhiriPratayang();
    hentikanVideo();
    panggung.classList.add('is-galat');
    cari('[data-batang]').innerHTML = '<i class="cerita-batang-satu"><b></b></i>';
    cari('[data-video]').hidden = true;
    cari('[data-suara]').hidden = true;
    const foto = cari('[data-foto]');
    foto.hidden = false;
    foto.onerror = null;
    foto.src = LOGO;
    cari('[data-ava]').innerHTML = wajah(sayaKini());
    cari('[data-nama]').textContent = 'Cerita belum terkirim';
    cari('[data-user]').textContent = '';
    cari('[data-sisa]').textContent = '';
    cari('[data-ket]').textContent = message;
    cari('[data-kancing]').hidden = true;
    cari('[data-menu]').hidden = true;
    cari('[data-menu-pop]').hidden = true;
    cari('[data-interaksi]').hidden = true;
    cari('[data-balas-form]').hidden = true;
    cari('[data-balasan-list]').hidden = true;
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
      detailCache.delete(String(id));
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

  async function turunkanCerita() {
    const id = panggung?.dataset.ceritaId;
    if (!id || !hak.moderasi) return;
    const alasan = String(cari('[data-mod-alasan]').value || '').trim().slice(0, 240);
    const pesan = cari('[data-mod-error]');
    if (!alasan) {
      pesan.textContent = 'Alasan tindakan moderasi wajib diisi.';
      pesan.hidden = false;
      return;
    }
    const tombol = cari('[data-mod-lanjut]');
    tombol.disabled = true;
    pesan.hidden = true;
    try {
      await api({ action: 'ceritaTurunkan', token: tokenSaya(), id, alasan });
      detailCache.delete(String(id));
      cari('[data-mod]').hidden = true;
      const grup = daftar[indeksGrup];
      if (grup) {
        grup.cerita = (grup.cerita || []).filter((item) => String(item.id) !== String(id));
      }
      kabari('moderasi');
      notifikasiCerita('Cerita diturunkan dan tercatat di audit log.');
      if (!grup || !grup.cerita.length) {
        daftar = daftar.filter((item) => item !== grup);
        if (!daftar.length) return tutupPanggung();
        indeksGrup = Math.min(indeksGrup, daftar.length - 1);
        indeksCerita = 0;
        return tampilkan();
      }
      indeksCerita = Math.min(indeksCerita, grup.cerita.length - 1);
      return tampilkan();
    } catch (error) {
      pesan.textContent = error.message || 'Cerita belum dapat diturunkan.';
      pesan.hidden = false;
      return undefined;
    } finally {
      tombol.disabled = false;
    }
  }

  function gantiSuara() {
    const video = videoNode();
    if (!video || !videoAktif) return;
    video.muted = !video.muted;
    const suara = cari('[data-suara]');
    suara.textContent = video.muted ? '\u{1F507}' : '\u{1F50A}';
    suara.setAttribute('aria-label', video.muted ? 'Nyalakan suara video' : 'Matikan suara video');
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
    if (dekat('[data-menu]')) {
      const pop = cari('[data-menu-pop]');
      pop.hidden = !pop.hidden;
      return undefined;
    }
    if (dekat('[data-menu-tambah]')) {
      cari('[data-menu-pop]').hidden = true;
      return bukaUnggah();
    }
    if (dekat('[data-menu-hapus]')) {
      cari('[data-menu-pop]').hidden = true;
      return hapusCerita();
    }
    if (dekat('[data-menu-turunkan]')) {
      cari('[data-menu-pop]').hidden = true;
      cari('[data-mod-alasan]').value = '';
      cari('[data-mod-error]').hidden = true;
      cari('[data-mod]').hidden = false;
      cari('[data-mod-alasan]').focus();
      return undefined;
    }
    if (!cari('[data-menu-pop]').hidden && !dekat('[data-menu-pop]')) {
      cari('[data-menu-pop]').hidden = true;
    }
    if (dekat('[data-emoji]')) {
      const panel = cari('[data-emoji-panel]');
      panel.hidden = !panel.hidden;
      return undefined;
    }
    if (dekat('[data-emoji-pilih]')) {
      const input = cari('[data-balas-teks]');
      input.value = (input.value + dekat('[data-emoji-pilih]').dataset.emojiPilih).slice(0, 140);
      cari('[data-emoji-panel]').hidden = true;
      input.focus();
      return undefined;
    }
    if (dekat('[data-cepat-suka]')) return toggleSuka();
    if (dekat('[data-reaksi]')) {
      const input = cari('[data-balas-teks]');
      input.value = (input.value + dekat('[data-reaksi]').dataset.reaksi).slice(0, 140);
      input.focus();
      return undefined;
    }
    if (dekat('[data-mod]') && !dekat('.cerita-mod-card')) {
      cari('[data-mod]').hidden = true;
      return undefined;
    }
    if (dekat('[data-mod-batal]')) {
      cari('[data-mod]').hidden = true;
      return undefined;
    }
    if (dekat('[data-mod-lanjut]')) return turunkanCerita();
    if (dekat('[data-suara]')) return gantiSuara();
    if (dekat('[data-turunkan]')) {
      cari('[data-mod-alasan]').value = '';
      cari('[data-mod-error]').hidden = true;
      cari('[data-mod]').hidden = false;
      cari('[data-mod-alasan]').focus();
      return undefined;
    }
    if (!cari('[data-mod]').hidden) return undefined;
    if (dekat('[data-penonton-tutup]') || dekat('[data-penonton-panel]')) {
      if (!dekat('[data-penonton-tutup]')) return undefined;
      cari('[data-penonton-panel]').hidden = true;
      return undefined;
    }
    if (!cari('[data-penonton-panel]').hidden) return undefined;
    if (dekat('[data-tutup]') || dekat('[data-kembali]')) {
      if (panggung.classList.contains('is-pratayang')) akhiriPratayang();
      return tutupPanggung();
    }
    if (dekat('[data-suka]')) return toggleSuka();
    if (dekat('[data-fokus-balas]')) {
      cari('[data-balas-teks]').focus();
      return undefined;
    }
    if (dekat('[data-penonton]')) return bukaPenonton();
    if (dekat('[data-kiri]')) {
      if (Date.now() - geserTerakhir < 450) return undefined;
      jeda();
      return mundur(-1);
    }
    if (dekat('[data-kanan]')) {
      if (panggung.classList.contains('is-pratayang') || Date.now() - geserTerakhir < 450) return undefined;
      jeda();
      return mundur(1);
    }
    if (dekat('[data-jeda]')) {
      jedaLanjut();
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
      if (cari('[data-mod]') && !cari('[data-mod]').hidden) {
        cari('[data-mod]').hidden = true;
        return undefined;
      }
      if (cari('[data-penonton-panel]') && !cari('[data-penonton-panel]').hidden) {
        cari('[data-penonton-panel]').hidden = true;
        return undefined;
      }
      if (panggung.classList.contains('is-pratayang')) akhiriPratayang();
      return tutupPanggung();
    }
    if (cari('[data-mod]') && !cari('[data-mod]').hidden) return undefined;
    if (!cari('[data-penonton-panel]').hidden) return undefined;
    if (event.target?.matches?.('[data-catatan]')) {
      if (event.key === 'Enter') {
        event.preventDefault();
        kirimCerita();
      }
      return undefined;
    }
    if (event.target?.closest?.('input, textarea, button, a')) return undefined;
    if (panggung.classList.contains('is-pratayang')) return undefined;
    if (event.key === 'ArrowLeft') {
      jeda();
      mundur(-1);
    } else if (event.key === 'ArrowRight') {
      jeda();
      mundur(1);
    } else if (event.key === ' ') {
      event.preventDefault();
      jedaLanjut();
    }
    return undefined;
  });

  /* Tahan = jeda, lepas = jalan lagi. Geser horizontal mengganti cerita dan
     menimpa klik pada sisi yang datang setelahnya (pointer → click). */
  let sentuhAwal = null;
  panggungSiap().addEventListener('pointerdown', (event) => {
    if (panggung.hidden || panggung.classList.contains('is-pratayang')) return;
    if (!cari('[data-penonton-panel]').hidden) return;
    /* Sisi kiri/kanan juga menjadi titik awal geser: di ponsel area itu
       menutup sebagian besar gambar. */
    const sisi = event.target.closest?.('[data-kiri], [data-kanan]');
    if (!sisi && event.target.closest('button, input, textarea, a, [data-catatan]')) return;
    sentuhAwal = { x: event.clientX, y: event.clientY, saat: Date.now() };
    jeda();
  });
  panggungSiap().addEventListener('pointerup', (event) => {
    if (panggung.hidden || panggung.classList.contains('is-pratayang')) return;
    const awal = sentuhAwal;
    sentuhAwal = null;
    if (!awal) return;
    const dx = event.clientX - awal.x;
    const dy = event.clientY - awal.y;
    /* Geser cepat dan nyata lebih diutamakan daripada klik sisi. */
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2 && Date.now() - awal.saat < 1200) {
      geserTerakhir = Date.now();
      mundur(dx < 0 ? 1 : -1);
      return;
    }
    lanjut();
  });
  panggungSiap().addEventListener('pointercancel', () => { sentuhAwal = null; });

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
    bukaId,
    bukaSatu,
    unggah: bukaUnggah,
    tutup: () => tutupPanggung(),
    sisaWaktu,
    sedangTayang: () => Boolean(panggung && !panggung.hidden)
  };
})();
