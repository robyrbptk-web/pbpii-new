/*
 * AppLayout — pemisah total antara wajah publik dan aplikasi internal PB PII.
 *
 * Dimuat menyumbat di <head>, sebelum akun.js/notifikasi.js/skrip halaman,
 * supaya urutan kerjanya begini:
 *   1. head dibaca   → tamu yang membuka /app* dikirim ke /, dan <html> diberi
 *     kelas `aplikasi-mencek` sehingga landing page tidak sempat berkedip di
 *     depan mata orang yang sudah login;
 *   2. readyState "interactive" (HTML selesai, skrip defer belum berjalan)
 *     → kerangka aplikasi dipasang: kop, navigasi sisi, bar bawah, dan
 *     `[data-account]` pindah rumah ke kop. Karena itu lonceng kabar
 *     (notifikasi.js) dan chip akun (akun.js) menempel di tempat yang benar
 *     tanpa satu baris pun dari keduanya diubah;
 *   3. `whoami` menjawab → mode dikunci, navigasi dibangun ulang menurut peran,
 *     atau kerangka dibongkar kembali bila token sudah tidak berlaku.
 *
 * Otoritas sesi tetap endpoint `whoami` milik akun.js; sistem login tidak
 * disentuh. Beranda hanya membaca aksi yang sudah ada: `public`, `feedList`,
 * `notifList` (+ `notifRead` untuk menandai sudah dibaca).
 */
(() => {
  'use strict';

  const API = () => (window.PBPII_CONFIG && window.PBPII_CONFIG.apiEndpoint) || '/api/pii';
  const KUNCI_TOKEN = ['pbpii_kader_token', 'pbpii_admin_token', 'pbpii_org_token'];
  const KUNCI_CIUT = 'pbpii_sisi_ciut';
  const LOGO = '/assets/logo-pii.webp';
  const LOGO_CADANGAN = '/assets/logo-pii.png';

  const IKON = {
    beranda: '<path d="M4 10.5 12 4l8 6.5V20H4z"/><path d="M9.5 20v-5.5h5V20"/>',
    kabar: '<path d="M4.6 5.5h14.8v13H4.6z"/><path d="M7.4 9h9M7.4 12.2h9M7.4 15.4h5.4"/>',
    acara: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.2"/><path d="M4 10h16M8.5 3.5v3.4M15.5 3.5v3.4"/>',
    ibadah: '<path d="M15.6 4.6a7.4 7.4 0 1 0 0 14.8 6.1 6.1 0 0 1 0-14.8Z"/><path d="M18.6 8.1h.01"/>',
    tanya: '<path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.2V17a2.5 2.5 0 0 1-1-2V7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5Z"/><path d="M8.5 9h7M8.5 12h4.5"/>',
    pustaka: '<path d="M5 5.5h5.5A2.5 2.5 0 0 1 12 8v11a2 2 0 0 0-2-2H5zM19 5.5h-5.5A2.5 2.5 0 0 0 12 8v11a2 2 0 0 1 2-2h5z"/>',
    artikel: '<path d="M5 4.75h14v14.5H5zM8 8h8M8 11.5h8M8 15h5"/>',
    notifikasi: '<path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.2 7.5-2.2 7.5h16.4S18 14.5 18 8.5Z"/><path d="M13.7 19.5a2 2 0 0 1-3.4 0"/>',
    profil: '<circle cx="12" cy="8" r="3.4"/><path d="M5.4 19.2c.6-3.2 2.8-5.1 6.6-5.1s6 1.9 6.6 5.1"/>',
    situasi: '<path d="M12 20.5s6.4-5.3 6.4-10a6.4 6.4 0 1 0-12.8 0c0 4.7 6.4 10 6.4 10Z"/><circle cx="12" cy="10.3" r="2.3"/>',
    pengurus: '<path d="M4 13.5h7V4H4zM13 4v9.5h7V4zM4 20h7v-4.5H4zM13 15.5h7V20h-7z"/>',
    lembaga: '<path d="M4.5 20h15M7 20V9.5l5-4 5 4V20"/><path d="M10.5 12.5h3M10.5 16h3"/>',
    lainnya: '<circle cx="6" cy="7" r="2"/><circle cx="12" cy="7" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="6" cy="17" r="2"/><circle cx="12" cy="17" r="2"/><circle cx="18" cy="17" r="2"/>',
    keluar: '<path d="M14.5 8V6.2a2 2 0 0 0-2-2H6.2a2 2 0 0 0-2 2v11.6a2 2 0 0 0 2 2H12.5a2 2 0 0 0 2-2V16"/><path d="M10.5 12h9.5M17.5 9l3 3-3 3"/>',
    ciut: '<rect x="4" y="4.5" width="16" height="15" rx="2.4"/><path d="M9.5 4.5v15M15.5 9.5 13 12l2.5 2.5"/>'
  };

  const MENU = [
    { id: 'beranda', label: 'Beranda', href: '/app' },
    { id: 'kabar', label: 'Kabar', href: '/app/feed', kader: true },
    { id: 'acara', label: 'Acara', href: '/app/acara' },
    { id: 'ibadah', label: 'Ibadah', href: '/app/ibadah' },
    { id: 'tanya', label: 'Tanya PII', href: '/app/tanya' },
    { id: 'pustaka', label: 'Pustaka', href: '/app/pustaka' },
    { id: 'artikel', label: 'Artikel', href: '/app/artikel' },
    { id: 'notifikasi', label: 'Notifikasi', href: '/app/notifikasi', angka: true },
    { id: 'profil', label: 'Profil saya', href: '/app/profil', kader: true },
    { id: 'situasi', label: 'PII Situation Room', href: '/situasi.html' },
    { id: 'pengurus', label: 'Dasbor Pengurus', href: '/admin.html', pengurus: true },
    { id: 'lembaga', label: 'Dasbor Lembaga', href: '/lembaga.html', lembaga: true }
  ];

  const JUDUL = { beranda: 'Aplikasi PB PII', artikel: 'Artikel & gagasan', notifikasi: 'Notifikasi' };

  /* --------------------------------------------------------------- keadaan */

  const naskah = document.currentScript || document.querySelector('script[data-halaman]');
  const halaman = String((naskah && naskah.getAttribute('data-halaman')) || 'beranda');
  const jalur = (String(location.pathname || '/').replace(/\/+$/, '') || '/').toLowerCase();

  // Beranda, Artikel, dan Notifikasi hidup di dalam index.html.
  const tampilan = jalur === '/app/artikel' ? 'artikel'
    : jalur === '/app/notifikasi' ? 'notifikasi'
      : halaman;
  const diAplikasi = jalur === '/app' || jalur.startsWith('/app/');
  const diBeranda = halaman === 'beranda';
  // Hanya halaman arahan publik yang dilarang dilihat orang yang sudah login.
  // Alamat lama berbentuk /feed.html?kabar=… dan /acara.html?event=… dipakai
  // tautan notifikasi serta bagikan, jadi tidak boleh dilempar dari sana.
  const diLanding = diBeranda && (jalur === '/' || jalur === '/index.html');
  const tokenSaya = () => KUNCI_TOKEN.map((kunci) => localStorage.getItem(kunci) || '').find(Boolean) || '';

  function elemen(tag, kelas, teks) {
    const node = document.createElement(tag);
    if (kelas) node.className = kelas;
    if (teks !== undefined) node.textContent = teks;
    return node;
  }

  function ikon(nama) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    node.setAttribute('viewBox', '0 0 24 24');
    node.setAttribute('aria-hidden', 'true');
    node.innerHTML = IKON[nama] || IKON.lainnya;
    return node;
  }

  function relatif(stempel) {
    const waktu = Date.parse(String(stempel || ''));
    if (!Number.isFinite(waktu)) return '';
    const detik = Math.max(0, (Date.now() - waktu) / 1000);
    if (detik < 90) return 'baru saja';
    if (detik < 5400) return Math.round(detik / 60) + ' mnt';
    if (detik < 86400) return Math.round(detik / 3600) + ' jam';
    if (detik < 172800) return 'kemarin';
    return new Date(waktu).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  }

  async function json(badan) {
    const respons = await fetch(API(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ token: tokenSaya() }, badan))
    });
    const hasil = await respons.json().catch(() => null);
    if (!hasil || !hasil.ok) throw new Error((hasil && hasil.error) || 'Belum dapat dimuat.');
    return hasil.data;
  }

  /* --------------------------------------------------------- pintu di head */

  /**
   * Tamu yang masuk lewat chip akun di halaman publik belum sempat memasang
   * kerangka aplikasi karena skrip ini berjalan tanpa token. Beranda diantar ke
   * alamat aplikasi; halaman fitur tidak ditimpa supaya isian yang sedang
   * dikerjakan tidak hilang — di sana tautan navigasi yang mengarah ke aplikasi.
   */
  function jagaMasuk() {
    if (!diBeranda) return;
    const daftar = () => {
      if (!window.PBPIIAkun || !window.PBPIIAkun.onChange) return;
      window.PBPIIAkun.onChange((akun) => {
        if (!tokenSaya() || !akun || akun.role === 'tamu') return;
        location.replace('/app');
      });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', daftar, { once: true });
    } else {
      daftar();
    }
  }

  if (!tokenSaya()) {
    // Tamu tidak punya alasan berada di dalam aplikasi.
    if (diAplikasi) location.replace('/');
    else jagaMasuk();
    return;
  }
  document.documentElement.classList.add('aplikasi-mencek');

  let kepala = null;
  let sisi = null;
  let bar = null;
  let lembar = null;
  let tirai = null;
  let wadah = null;
  let kaki = null;
  let utama = null;
  let sumberAkun = null;
  let belum = 0;
  let sesi = null;

  /* ------------------------------------------------------------ navigasi */

  function menuBoleh(peran) {
    const staf = peran === 'admin' || peran === 'org';
    return MENU.filter((item) => {
      if (item.kader) return !staf;
      if (item.pengurus) return peran === 'admin';
      if (item.lembaga) return peran === 'org';
      return true;
    });
  }

  function penanda() {
    const angka = elemen('span', 'app-badge', belum > 99 ? '99+' : String(belum));
    angka.dataset.penanda = 'ya';
    return angka;
  }

  function gambarPenanda() {
    document.querySelectorAll('[data-angka] [data-penanda]').forEach((node) => node.remove());
    if (belum <= 0) return;
    document.querySelectorAll('[data-angka]').forEach((node) => node.append(penanda()));
  }

  function tautSisi(item) {
    const node = elemen('a', 'app-taut');
    node.href = item.href;
    node.title = item.label;
    node.append(ikon(item.id), elemen('span', null, item.label));
    if (item.angka) node.dataset.angka = 'ya';
    if (item.id === tampilan) {
      node.classList.add('is-active');
      node.setAttribute('aria-current', 'page');
    }
    return node;
  }

  function selBar(item) {
    const node = elemen('a', 'app-sel');
    node.href = item.href;
    node.append(ikon(item.id), elemen('span', null, item.label));
    if (item.angka) node.dataset.angka = 'ya';
    if (item.id === tampilan) {
      node.classList.add('is-active');
      node.setAttribute('aria-current', 'page');
    }
    return node;
  }

  function tombolLainnya() {
    const node = elemen('button', 'app-sel');
    node.type = 'button';
    node.dataset.lembar = 'ya';
    node.setAttribute('aria-expanded', 'false');
    node.append(ikon('lainnya'), elemen('span', null, 'Lainnya'));
    node.addEventListener('click', () => bukaLembar(node));
    return node;
  }

  function tombolLembar(item) {
    const node = elemen('button', 'app-sel');
    node.type = 'button';
    node.append(ikon(item.id), elemen('span', null, item.label));
    if (item.angka) node.dataset.angka = 'ya';
    if (item.id === tampilan) node.classList.add('is-active');
    node.addEventListener('click', () => { location.href = item.href; });
    return node;
  }

  function tombolKeluar() {
    const node = elemen('button', 'app-taut app-keluar');
    node.type = 'button';
    node.append(ikon('keluar'), elemen('span', null, 'Keluar'));
    node.addEventListener('click', () => {
      if (window.PBPIIAkun && window.PBPIIAkun.signOut) window.PBPIIAkun.signOut();
      location.replace('/');
    });
    return node;
  }

  function tutupLembar() {
    if (!lembar || lembar.hidden) return;
    lembar.hidden = true;
    lembar.inert = true;
    if (tirai) tirai.hidden = true;
    const pemicu = document.querySelector('.app-bar [data-lembar]');
    if (pemicu) pemicu.setAttribute('aria-expanded', 'false');
  }

  function bukaLembar(pemicu) {
    if (!lembar) return;
    lembar.textContent = '';
    const daftar = menuBoleh(peran());
    const diBar = namaDiBar();
    lembar.append(elemen('p', 'app-sisi-label', 'Menu aplikasi'));
    const isi = elemen('div', 'app-lembar-isi');
    daftar.filter((item) => !diBar.includes(item.id)).forEach((item) => isi.append(tombolLembar(item)));
    lembar.append(isi);
    if (diBeranda) lembar.append(tombolKeluar());
    lembar.hidden = false;
    lembar.inert = false;
    if (tirai) tirai.hidden = false;
    if (pemicu) pemicu.setAttribute('aria-expanded', 'true');
  }

  function peran() {
    return (sesi && sesi.role) || 'kader';
  }

  function namaDiBar() {
    return ['beranda', 'acara', 'ibadah', 'notifikasi'];
  }

  /** Navigasi sisi dan bar bawah dibangun ulang begitu peran diketahui. */
  function bangunNavigasi() {
    if (!sisi || !bar) return;
    const daftar = menuBoleh(peran());
    const kelompok = [
      { label: 'Menu utama', ids: ['beranda', 'kabar', 'acara', 'ibadah', 'tanya', 'pustaka', 'artikel', 'notifikasi'] },
      { label: 'Jelajah', ids: ['profil', 'situasi'] },
      { label: 'Kelola', ids: ['pengurus', 'lembaga'] }
    ];

    const merek = kepala && kepala.querySelector('.app-brand small');
    if (merek) merek.textContent = peran() === 'kader' ? 'Aplikasi Kader' : 'Aplikasi Pengurus';

    sisi.textContent = '';
    kelompok.forEach((grup) => {
      const isi = daftar.filter((item) => grup.ids.indexOf(item.id) >= 0);
      if (!isi.length) return;
      const bagian = elemen('div', 'app-sisi-grup');
      bagian.append(elemen('p', 'app-sisi-label', grup.label));
      isi.forEach((item) => bagian.append(tautSisi(item)));
      sisi.append(bagian);
    });
    const ujung = elemen('div', 'app-sisi-bawah');
    ujung.append(tombolCiut());
    ujung.append(tombolKeluar());
    sisi.append(ujung);

    bar.textContent = '';
    const diBar = namaDiBar();
    diBar.forEach((nama) => {
      const item = daftar.find((menu) => menu.id === nama);
      if (item) bar.append(selBar(item));
    });
    bar.append(tombolLainnya());
  }

  /** Rel samping bisa dipadatkan jadi ikon saja; pilihan diingat per perangkat. */
  function terapkanCiut(ciut) {
    document.body.classList.toggle('sisi-ciut', Boolean(ciut));
    const tombol = sisi && sisi.querySelector('.app-sisi-ciut');
    if (tombol) {
      tombol.setAttribute('aria-expanded', String(!ciut));
      tombol.setAttribute('aria-label', ciut ? 'Bentangkan menu' : 'Ciutkan menu');
      tombol.title = ciut ? 'Bentangkan menu' : 'Ciutkan menu';
    }
    try { localStorage.setItem(KUNCI_CIUT, ciut ? 'ya' : 'tidak'); } catch { /* mode privat */ }
  }

  function tombolCiut() {
    const node = elemen('button', 'app-taut app-sisi-ciut');
    node.type = 'button';
    node.setAttribute('aria-expanded', 'true');
    node.setAttribute('aria-label', 'Ciutkan menu');
    node.title = 'Ciutkan menu';
    node.append(ikon('ciut'), elemen('span', null, 'Ciutkan menu'));
    node.addEventListener('click', () => terapkanCiut(!document.body.classList.contains('sisi-ciut')));
    return node;
  }

  /* ------------------------------------------------------------ kerangka */

  function pasangKerangka() {
    if (kepala) return;

    utama = document.querySelector('main');
    kepala = elemen('header', 'app-header');

    const merek = elemen('a', 'app-brand');
    merek.href = '/app';
    const logo = elemen('img');
    logo.src = LOGO;
    logo.alt = 'Logo Pelajar Islam Indonesia';
    logo.addEventListener('error', () => { logo.src = LOGO_CADANGAN; }, { once: true });
    const label = elemen('span');
    label.append(elemen('b', null, 'PB PII'), elemen('small', null, peran() === 'kader' ? 'Aplikasi Kader' : 'Aplikasi Pengurus'));
    merek.append(logo, label);
    kepala.append(merek, elemen('div', 'app-header-spasi'), elemen('div', 'top-actions'));

    // Chip akun warisan akun.js dipakai apa adanya, hanya pindah rumah.
    const akun = document.querySelector('.site-header [data-account]');
    if (akun) {
      sumberAkun = { node: akun, induk: akun.parentNode, berikut: akun.nextSibling };
      kepala.append(akun);
    }

    sisi = elemen('nav', 'app-side');
    sisi.setAttribute('aria-label', 'Navigasi aplikasi');
    bar = elemen('nav', 'app-bar');
    bar.setAttribute('aria-label', 'Navigasi bawah');

    lembar = elemen('div', 'app-lainnya-sheet');
    lembar.hidden = true;
    lembar.inert = true;
    lembar.setAttribute('role', 'dialog');
    lembar.setAttribute('aria-label', 'Menu aplikasi');

    tirai = elemen('button', 'app-backdrop');
    tirai.type = 'button';
    tirai.hidden = true;
    tirai.setAttribute('aria-label', 'Tutup menu');
    tirai.addEventListener('click', tutupLembar);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') tutupLembar();
    });

    document.body.append(kepala, sisi, bar, lembar, tirai);
    bangunNavigasi();

    if (diBeranda) {
      wadah = elemen('div', 'app-wrap');
      wadah.id = 'appIsi';
      document.body.append(wadah);
      if (utama) utama.hidden = true;
      kaki = document.querySelector('body > footer');
      if (kaki) kaki.hidden = true;
      document.title = tampilan === 'beranda' ? 'Beranda · Aplikasi PB PII' : (JUDUL[tampilan] || 'Aplikasi PB PII');
    }

    document.documentElement.classList.add('aplikasi');
    document.body.classList.add('aplikasi');
  }

  /** Penanda cek sesi digambar CSS (body::after), jadi cukup kelasnya dilepas. */
  function hapusSplash() {
    document.documentElement.classList.remove('aplikasi-mencek');
  }

  /** Token ternyata sudah mati: kembalikan wajah publik seutuhnya. */
  function bongkar() {
    hapusSplash();
    document.documentElement.classList.remove('aplikasi');
    document.body.classList.remove('aplikasi');
    [kepala, sisi, bar, lembar, tirai, wadah].forEach((node) => node && node.remove());
    kepala = sisi = bar = lembar = tirai = wadah = null;
    if (sumberAkun && sumberAkun.induk) sumberAkun.induk.insertBefore(sumberAkun.node, sumberAkun.berikut);
    sumberAkun = null;
    if (utama) utama.hidden = false;
    if (kaki) kaki.hidden = false;
  }

  /* --------------------------------------------------------------- beranda */

  function kartu(judul, tautan, tautanLabel) {
    const node = elemen('section', 'app-card');
    const kepalaKartu = elemen('div', 'app-card-head');
    kepalaKartu.append(elemen('h2', null, judul));
    if (tautan) {
      const lebih = elemen('a', null, tautanLabel || 'Semua');
      lebih.href = tautan;
      kepalaKartu.append(lebih);
    }
    node.append(kepalaKartu);
    return node;
  }

  function baris({ judul, keterangan, waktu, taut, foto, tanggal }) {
    const node = taut ? elemen('a', 'app-baris') : elemen('div', 'app-baris');
    if (taut) node.href = taut;
    if (foto) {
      const gambar = elemen('img', 'app-ava');
      gambar.src = foto;
      gambar.alt = '';
      gambar.loading = 'lazy';
      node.append(gambar);
    }
    if (tanggal) {
      const chip = elemen('span', 'app-tanggal');
      chip.append(elemen('b', null, tanggal.hari), elemen('small', null, tanggal.bulan));
      node.append(chip);
    }
    const badan = elemen('span', 'app-baris-isi');
    badan.append(elemen('b', null, judul));
    if (keterangan) badan.append(elemen('p', null, keterangan));
    node.append(badan);
    if (waktu) node.append(elemen('time', null, waktu));
    return node;
  }

  function peringatan(host, pesan, ulangi) {
    const node = elemen('div', 'app-gagal');
    node.append(elemen('span', null, pesan));
    const tombol = elemen('button', 'app-pulihkan', 'Coba lagi');
    tombol.type = 'button';
    tombol.addEventListener('click', ulangi);
    node.append(tombol);
    host.append(node);
  }

  function sapa() {
    const jam = new Date().getHours();
    if (jam < 11) return 'Selamat pagi';
    if (jam < 15) return 'Selamat siang';
    if (jam < 18) return 'Selamat sore';
    return 'Selamat malam';
  }

  function labelPeran(akun) {
    if (!akun) return 'Kader Pelajar Islam Indonesia';
    if (akun.role === 'admin') return 'Pengurus Besar PII';
    if (akun.role === 'org') return (akun.jenjang ? String(akun.jenjang).toUpperCase() + ' · ' : '') + 'Lembaga PII';
    return 'Kader Pelajar Islam Indonesia';
  }

  const simpanan = {};

  function muat(kunci, badan, host, selesai, ulangi) {
    if (simpanan[kunci]) {
      selesai(simpanan[kunci]);
      return Promise.resolve();
    }
    const petunjuk = elemen('p', 'app-kosong', 'Memuat…');
    host.append(petunjuk);
    return json(badan).then((isi) => {
      simpanan[kunci] = isi;
      petunjuk.remove();
      selesai(isi);
    }).catch((error) => {
      petunjuk.remove();
      peringatan(host, 'Bagian ini belum dapat dimuat.', ulangi);
      console.warn(kunci + ':', error.message);
    });
  }

  function tanggalAcara(value) {
    const teks = String(value || '');
    const hari = teks.slice(8, 10);
    if (!/^\d{2}$/.test(hari)) return null;
    const bulan = new Date(teks.slice(0, 10) + 'T00:00:00').toLocaleDateString('id-ID', { month: 'short' });
    return { hari, bulan };
  }

  async function isiBeranda() {
    if (!wadah) return;
    wadah.textContent = '';

    const teguran = elemen('div', 'app-sapa');
    const isiTeguran = elemen('div');
    isiTeguran.append(
      elemen('b', null, 'Assalamu’alaikum, ' + String((sesi && sesi.name) || 'Kader PII')),
      elemen('p', null, sapa() + ' · ' + new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })),
      elemen('i', null, labelPeran(sesi))
    );
    teguran.append(isiTeguran);
    wadah.append(teguran);

    // Sidebar sudah memuat seluruh menu, jadi beranda tidak mengulanginya lagi
    // dengan kartu jalan pintas. Isi beranda fokus pada ringkasan yang berubah:
    // kabar, aktivitas, agenda, dan artikel.
    const kabar = kartu('Kabar organisasi', '/app/notifikasi', 'Semua kabar');
    wadah.append(kabar);
    muat('notifList', { action: 'notifList' }, kabar, (isi) => {
      belum = Number(isi.belumDibaca) || 0;
      gambarPenanda();
      const daftar = Array.isArray(isi.notifikasi) ? isi.notifikasi : [];
      if (!daftar.length) {
        kabar.append(elemen('p', 'app-kosong', 'Belum ada kabar untuk Anda hari ini.'));
        return;
      }
      daftar.slice(0, 3).forEach((item) => kabar.append(baris({
        judul: item.judul || 'Kabar',
        keterangan: item.isi ? String(item.isi).slice(0, 150) : '',
        waktu: relatif(item.dibuat),
        taut: item.tautan || '/app/notifikasi'
      })));
    }, () => { delete simpanan.notifList; isiBeranda(); });

    const aktivitas = kartu('Aktivitas terbaru', '/app/feed', 'Buka Kabar');
    wadah.append(aktivitas);
    muat('feedList', { action: 'feedList', tab: 'terbaru', mulai: 0, batas: 3 }, aktivitas, (isi) => {
      const daftar = Array.isArray(isi.items) ? isi.items : [];
      if (!daftar.length) {
        aktivitas.append(elemen('p', 'app-kosong', 'Belum ada kabar kader di Feed.'));
        return;
      }
      daftar.slice(0, 3).forEach((item) => aktivitas.append(baris({
        judul: (item.author && item.author.name) || 'Kader PII',
        keterangan: String(item.text || '').slice(0, 150) || 'Membagikan kabar kegiatan.',
        waktu: relatif(item.createdAt),
        foto: item.author && item.author.picture ? URLku(item.author.picture) : '',
        taut: '/app/feed?kabar=' + encodeURIComponent(item.id)
      })));
    }, () => { delete simpanan.feedList; isiBeranda(); });

    const publik = await muatPublik();
    if (publik) {
      const agenda = kartu('Agenda kegiatan', '/app/acara', 'Semua agenda');
      wadah.append(agenda);
      const mendatang = (Array.isArray(publik.events) ? publik.events : []).slice(0, 3);
      if (!mendatang.length) agenda.append(elemen('p', 'app-kosong', 'Belum ada agenda terbit.'));
      mendatang.forEach((event) => agenda.append(baris({
        judul: event.title || 'Kegiatan PII',
        keterangan: event.location || 'Kegiatan PB PII dan lembaga.',
        tanggal: tanggalAcara(event.date),
        taut: event.id ? '/app/acara?event=' + encodeURIComponent(event.id) : '/app/acara'
      })));

      const artikel = kartu('Artikel terbaru', '/app/artikel', 'Semua artikel');
      wadah.append(artikel);
      const daftar = Array.isArray(publik.articles) ? publik.articles : [];
      if (!daftar.length) artikel.append(elemen('p', 'app-kosong', 'Artikel baru segera terbit.'));
      daftar.slice(0, 3).forEach((item) => artikel.append(baris({
        judul: item.title || 'Artikel PII',
        keterangan: String(item.excerpt || '').slice(0, 130),
        waktu: item.createdAt ? new Date(item.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '',
        taut: item.slug ? '/app/artikel?artikel=' + encodeURIComponent(item.slug) : ''
      })));
    }

    wadah.append(elemen('p', 'app-kredit', 'Badan Khusus Inovasi Digital PB PII'));
  }

  /** Gambar Drive hanya bisa diambil lewat proxy; avatar Google boleh langsung. */
  function URLku(url) {
    const teks = String(url || '');
    if (/^https:\/\/lh3\.googleusercontent\.com/i.test(teks)) return teks;
    return '';
  }

  let janjiPublik = null;

  function muatPublik() {
    if (!janjiPublik) {
      janjiPublik = json({ action: 'public' }).catch((error) => {
        console.warn('public:', error.message);
        return null;
      });
    }
    return janjiPublik;
  }

  /* ------------------------------------------------ artikel & notifikasi */

  function isiArtikel() {
    if (!wadah) return;
    wadah.textContent = '';
    wadah.append(elemen('h1', 'app-judul', 'Artikel & gagasan'));
    const host = elemen('section', 'app-card');
    wadah.append(host);
    muat('public', { action: 'public' }, host, (isi) => {
      const daftar = Array.isArray(isi.articles) ? isi.articles : [];
      if (!daftar.length) {
        host.append(elemen('p', 'app-kosong', 'Belum ada artikel terbit.'));
        return;
      }
      daftar.forEach((item) => host.append(baris({
        judul: item.title || 'Artikel PII',
        keterangan: String(item.excerpt || item.category || 'Kabar Pelajar Islam Indonesia.').slice(0, 180),
        waktu: item.createdAt ? new Date(item.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
        taut: item.slug ? '?artikel=' + encodeURIComponent(item.slug) : ''
      })));
    }, () => { delete simpanan.public; isiArtikel(); });
  }

  function isiNotifikasi() {
    if (!wadah) return;
    wadah.textContent = '';
    wadah.append(elemen('h1', 'app-judul', 'Notifikasi'));
    const host = elemen('section', 'app-card');
    wadah.append(host);
    muat('notifList', { action: 'notifList' }, host, (isi) => {
      const daftar = Array.isArray(isi.notifikasi) ? isi.notifikasi : [];
      belum = Number(isi.belumDibaca) || 0;
      gambarPenanda();

      if (belum > 0) {
        const tombol = elemen('button', 'app-pulihkan', 'Tandai semua dibaca');
        tombol.type = 'button';
        tombol.addEventListener('click', () => {
          tombol.disabled = true;
          json({ action: 'notifRead' }).then(() => {
            delete simpanan.notifList;
            isiNotifikasi();
          }).catch(() => {
            tombol.disabled = false;
            host.append(elemen('p', 'app-kosong', 'Status kabar belum dapat diperbarui.'));
          });
        });
        host.append(tombol);
      }

      if (!daftar.length) {
        host.append(elemen('p', 'app-kosong', 'Belum ada kabar untuk Anda.'));
        return;
      }

      daftar.forEach((item) => {
        const node = elemen('button', 'app-baris');
        node.type = 'button';
        if (!item.dibaca) node.append(elemen('span', 'app-unread'));
        const badan = elemen('span', 'app-baris-isi');
        badan.append(elemen('b', null, item.judul || 'Kabar'));
        if (item.isi) badan.append(elemen('p', null, String(item.isi)));
        node.append(badan, elemen('time', null, relatif(item.dibuat)));
        node.addEventListener('click', () => {
          json({ action: 'notifRead', id: item.id }).catch(() => {}).then(() => {
            if (item.tautan) {
              location.href = item.tautan;
              return;
            }
            delete simpanan.notifList;
            isiNotifikasi();
          });
        });
        host.append(node);
      });
    }, () => { delete simpanan.notifList; isiNotifikasi(); });
  }

  /* ------------------------------------------------------------- pengunci */

  /** Label peran menempel di chip akun, supaya nama tidak tampil tanpa konteks. */
  function hiasAkun() {
    if (!sesi) return;
    document.querySelectorAll('.app-header .account-slot').forEach((slot) => {
      slot.querySelector('.app-header-role')?.remove();
      const label = elemen('small', 'app-header-role',
        sesi.role === 'admin' ? 'Pengurus' : sesi.role === 'org' ? 'Lembaga' : 'Kader');
      const menu = slot.querySelector('.account-menu');
      if (menu) slot.insertBefore(label, menu);
      else slot.append(label);
    });
  }

  function mulai() {
    pasangKerangka();
    bangunNavigasi();
    hiasAkun();
    document.body.classList.remove('app-peran-kader', 'app-peran-admin', 'app-peran-org');
    document.body.classList.add('app-peran-' + (['kader', 'admin', 'org'].indexOf(sesi && sesi.role) >= 0 ? sesi.role : 'kader'));
    try {
      terapkanCiut(localStorage.getItem(KUNCI_CIUT) === 'ya');
    } catch {
      terapkanCiut(false);
    }
    hapusSplash();
    if (tampilan === 'artikel') isiArtikel();
    else if (tampilan === 'notifikasi') isiNotifikasi();
    else if (diBeranda) isiBeranda();

    // Keluar dari chip akun = token hilang = wajah publik kembali dipakai.
    if (window.PBPIIAkun && window.PBPIIAkun.onChange) {
      window.PBPIIAkun.onChange(() => {
        if (!tokenSaya()) location.replace('/');
        hiasAkun();
      });
    }
  }

  async function pastikan() {
    const token = tokenSaya();
    if (!token) {
      if (diAplikasi) location.replace('/');
      else hapusSplash();
      return;
    }
    let data = null;
    try {
      const respons = await fetch(API(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'whoami', token })
      });
      const hasil = await respons.json().catch(() => null);
      data = hasil && hasil.ok ? hasil.data : null;
    } catch {
      data = null;
    }

    if (data && data.role === 'tamu') {
      // Token lama dibersihkan akun.js; sementara itu wajah publik dikembalikan.
      if (diAplikasi) location.replace('/');
      else bongkar();
      return;
    }

    // Server tidak menjawab (offline/versi lama): jangan tendang orang keluar
    // dari aplikasinya sendiri, biarkan fitur halaman yang membuktikan sesi.
    sesi = data || { role: 'kader', name: '' };

    if (diLanding) {
      // / dan /index.html adalah landing page: pengguna login tidak boleh
      // melihatnya, jadi dibawa ke beranda aplikasi.
      location.replace('/app');
      return;
    }
    mulai();
  }

  if (diBeranda && !diAplikasi) {
    // Landing page dengan token: splash bertahan sampai whoami menjawab,
    // supaya hero/navbar publik tidak pernah sempat tampil.
    pastikan();
  } else if (document.readyState === 'loading') {
    document.addEventListener('readystatechange', function siap() {
      if (document.readyState === 'loading') return;
      document.removeEventListener('readystatechange', siap);
      pasangKerangka();
      hapusSplash();
      pastikan();
    });
  } else {
    pasangKerangka();
    hapusSplash();
    pastikan();
  }

  // Tautan masuk mana pun membawa orang kembali ke halaman yang memanggilnya,
  // jadi kader yang terkunci di Pustaka atau Kabar tidak mendarat di beranda.
  function tautanMasuk() {
    const tujuan = (location.pathname || '/') + (location.search || '');
    document.querySelectorAll('a[href$="sso.html"]').forEach((tautan) => {
      const alamat = tautan.getAttribute('href') || '';
      if (/[?&]next=/.test(alamat)) return;
      tautan.href = 'sso.html?next=' + encodeURIComponent(tujuan);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tautanMasuk, { once: true });
  } else {
    tautanMasuk();
  }
})();
