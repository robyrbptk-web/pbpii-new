/**
 * Lonceng kabar internal untuk kader, pengurus lembaga, dan admin.
 *
 * Satu berkas dipakai semua dasbor: ia menempel di header, memakai sesi yang
 * sudah ada di localStorage, dan hanya boleh membuka kotak milik sesi itu.
 * Seluruh teks kabar ditulis lewat textContent, jadi isian pengguna tidak pernah
 * dibaca sebagai markup. Tautan kabar juga tidak pernah dipakai apa adanya:
 * resolver `tautan` memetakan alamat warisan ke rute aplikasi dan menolak
 * segala bentuk URL asing atau protokol berbahaya.
 */
(() => {
  'use strict';

  const API = () => (window.PBPII_CONFIG && window.PBPII_CONFIG.apiEndpoint) || '/api/pii';
  const KUNCI_TOKEN = { kader: 'pbpii_kader_token', admin: 'pbpii_admin_token', lembaga: 'pbpii_org_token' };
  const KUNCI_SUARA = 'pbpii_notif_suara';
  const JEDA_TAMPIL = 15000;
  const JEDA_SEMBUNYI = 60000;
  const BATAS = 30;
  const FALLBACK = '/app/notifikasi';
  const JENIS_SUARA = ['chime', 'tap', 'bell'];

  /** Alamat lama yang masih tersimpan di kabar kiriman server. */
  const LEGACY = {
    '/feed.html': '/app/feed',
    '/app/feed.html': '/app/feed',
    '/profil.html': '/app/profil',
    '/app/profil.html': '/app/profil',
    '/admin.html': '/admin',
    '/app/admin.html': '/admin',
    '/lembaga.html': '/lembaga',
    '/app/lembaga.html': '/lembaga',
    '/acara.html': '/app/acara',
    '/app/acara.html': '/app/acara',
    '/artikel.html': '/app/artikel',
    '/app/artikel.html': '/app/artikel',
    '/tanya.html': '/app/tanya',
    '/app/tanya.html': '/app/tanya',
    '/pustaka.html': '/app/pustaka',
    '/app/pustaka.html': '/app/pustaka',
    '/ibadah.html': '/app/ibadah',
    '/app/ibadah.html': '/app/ibadah',
    '/notifikasi.html': FALLBACK,
    '/app/notifikasi.html': FALLBACK
  };

  /** Rute yang memang dikenal aplikasi; sisanya ditolak. */
  const DIIZINKAN = new Set([
    '/app', '/app/feed', '/app/acara', '/app/ibadah', '/app/tanya',
    '/app/pustaka', '/app/artikel', '/app/notifikasi', '/app/profil',
    '/admin', '/lembaga', '/situasi.html'
  ]);

  const LABEL_JENIS = {
    like: 'Menyukai', suka: 'Menyukai', comment: 'Mengomentari', komentar: 'Mengomentari',
    reply: 'Membalas', balasan: 'Membalas', follow: 'Mengikuti', teman: 'Berteman',
    ikuti: 'Mengikuti', bagikan: 'Membagikan',
    mention: 'Menyebut', tag: 'Menyebut', kabar: 'Kabar baru', feed: 'Kabar baru',
    cerita: 'Cerita baru', story: 'Cerita baru', acara: 'Acara baru', event: 'Acara baru',
    thread: 'Diskusi', tanya: 'Pertanyaan'
  };

  const LABEL_GRUP = {
    like: 'Suka', suka: 'Suka', comment: 'Komentar', komentar: 'Komentar',
    follow: 'Teman', teman: 'Teman', ikuti: 'Mengikuti', bagikan: 'Bagikan',
    reply: 'Balasan', balasan: 'Balasan',
    mention: 'Sebutan', tag: 'Sebutan',
    kabar: 'Kabar', feed: 'Kabar', cerita: 'Cerita', acara: 'Acara', event: 'Acara',
    thread: 'Diskusi'
  };

  let tombol = null;
  let panel = null;
  let penanda = null;
  let titik = null;
  let panelTampilan = null;
  let tampilanHalaman = [];
  let isi = [];
  let belum = 0;
  let offset = 0;
  let punyaLebih = false;
  let terbuka = false;
  let dipasang = false;
  let pernahMuat = false;
  let terakhirTarik = 0;
  let sedangMuat = false;
  let sedangBaca = false;
  let penunda = null;
  let saluran = null;
  let konteks = null;
  const idDikenal = new Set();
  const idBersuara = new Set();
  let idDikenalDimulai = false;
  const kurangGerak = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /** Lihat komentar di `peranHalaman()` mengenai urutan peran pada satu peramban. */
  let kunciHalaman = null;

  function peranHalaman() {
    if (kunciHalaman !== null) return kunciHalaman;
    const tag = document.querySelector('script[src*="notifikasi.js"]');
    const peran = String((tag && tag.getAttribute('data-sesi')) || '').trim();
    kunciHalaman = KUNCI_TOKEN[peran] ? peran : '';
    return kunciHalaman;
  }

  function sesi() {
    const peran = peranHalaman();
    // Halaman menyatakan perannya. Memakai token peran lain yang kebetulan
    // tersimpan di perambang yang sama akan membuka kotak orang lain.
    if (peran) return localStorage.getItem(KUNCI_TOKEN[peran]) || '';
    return Object.keys(KUNCI_TOKEN).map((nama) => localStorage.getItem(KUNCI_TOKEN[nama]) || '')
      .find(Boolean) || '';
  }

  async function kirim(badan, opsi) {
    const token = sesi();
    if (!token) {
      const error = new Error('Sesi tidak tersedia.');
      error.code = 'sesi';
      throw error;
    }
    const respons = await fetch(API(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ token }, badan)),
      // Tandai baca boleh menyusul meski halaman segera berpindah.
      keepalive: Boolean(opsi && opsi.keepalive)
    });
    const hasil = await respons.json().catch(() => null);
    if (!hasil || !hasil.ok) {
      const error = new Error((hasil && hasil.error) || 'Kabar belum dapat dimuat.');
      error.code = String((hasil && hasil.code) || '');
      throw error;
    }
    return hasil.data;
  }

  /* ---------------------------------------------------------- tautan aman */

  /**
   * Terima path relatif/root-relative atau URL same-origin saja. Path relatif
   * selalu diurai dari akar domain: kalau tidak, `feed.html?…` di halaman
   * /app/notifikasi akan berubah jadi /app/feed.html dan berujung 404.
   */
  function tautan(nilai) {
    const teks = String(nilai == null ? '' : nilai).trim();
    if (!teks || /[\u0000-\u001f\u007f\\]/.test(teks)) return FALLBACK;
    let url;
    try {
      if (/^[a-z][a-z\d+.-]*:/i.test(teks)) {
        url = new URL(teks);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return FALLBACK;
        if (url.origin !== location.origin) return FALLBACK;
      } else if (teks.slice(0, 2) === '//') {
        url = new URL(teks, location.href);
        if (url.origin !== location.origin) return FALLBACK;
      } else {
        url = new URL(teks, location.origin + '/');
        if (url.origin !== location.origin) return FALLBACK;
      }
    } catch (_) {
      return FALLBACK;
    }
    const path = String(url.pathname || '/').replace(/\/+$/, '') || '/';
    const kanonik = Object.prototype.hasOwnProperty.call(LEGACY, path) ? LEGACY[path] : path;
    if (!DIIZINKAN.has(kanonik)) return FALLBACK;
    return kanonik + (url.search || '') + (url.hash || '');
  }

  /** Gambar pengirim juga tidak boleh sembarangan protokol/asal. */
  function fotoAman(nilai) {
    const teks = String(nilai || '').trim();
    if (!teks || /[\u0000-\u001f\u007f]/.test(teks)) return '';
    try {
      const url = new URL(teks, location.href);
      if (url.protocol === 'https:' && url.hostname === 'lh3.googleusercontent.com') return url.href;
      if (url.origin === location.origin && (url.protocol === 'https:' || url.protocol === 'http:')) return url.href;
      return '';
    } catch (_) {
      return '';
    }
  }

  function tujuan(item) {
    const tipe = String(item.targetType || '').toLowerCase();
    if (item.targetHilang) {
      const target = String(item.targetId || '').replace(/^k:/, '');
      return tipe === 'kader' && target
        ? '/app/profil?kader=' + encodeURIComponent(target)
        : FALLBACK;
    }
    if (item.tautan) {
      const aman = tautan(item.tautan);
      if (aman !== FALLBACK) return aman;
    }
    if (tipe === 'kader' && String(item.targetId || '')) {
      return '/app/profil?kader=' + encodeURIComponent(String(item.targetId).replace(/^k:/, ''));
    }
    return FALLBACK;
  }

  /* ----------------------------------------------------------------- suara */

  function pengaturanSuara() {
    try {
      const nilai = JSON.parse(localStorage.getItem(KUNCI_SUARA) || 'null');
      const aktif = nilai && typeof nilai === 'object' && typeof nilai.aktif === 'boolean'
        ? nilai.aktif : true;
      const jenis = nilai && JENIS_SUARA.indexOf(nilai.jenis) >= 0 ? nilai.jenis : 'chime';
      return { aktif, jenis };
    } catch (_) {
      return { aktif: true, jenis: 'chime' };
    }
  }

  function simpanSuara(perubahan) {
    const nilai = Object.assign(pengaturanSuara(), perubahan || {});
    const aman = {
      aktif: Boolean(nilai.aktif),
      jenis: JENIS_SUARA.indexOf(nilai.jenis) >= 0 ? nilai.jenis : 'chime'
    };
    try { localStorage.setItem(KUNCI_SUARA, JSON.stringify(aman)); } catch (_) { /* mode privat */ }
    return aman;
  }

  /** AudioContext hanya boleh lahir dari gesture pengguna, bukan dari polling. */
  function aktifkanAudio() {
    try {
      if (!konteks) {
        const Ac = window.AudioContext || window.webkitAudioContext;
        if (!Ac) return Promise.resolve(null);
        konteks = new Ac();
      }
      if (konteks.state === 'suspended') {
        return konteks.resume().then(() => konteks).catch(() => null);
      }
      return Promise.resolve(konteks);
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function nada(frekuensi, mulai, durasi, bentuk, volume) {
    const os = konteks.createOscillator();
    const gain = konteks.createGain();
    os.type = bentuk;
    os.frequency.setValueAtTime(frekuensi, mulai);
    gain.gain.setValueAtTime(0.0001, mulai);
    gain.gain.exponentialRampToValueAtTime(volume, mulai + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, mulai + durasi);
    os.connect(gain);
    gain.connect(konteks.destination);
    os.start(mulai);
    os.stop(mulai + durasi + 0.02);
  }

  function putarNada(jenis, uji, id) {
    if (!konteks || konteks.state !== 'running') return false;
    if (!uji) {
      if (id) {
        if (idBersuara.has(String(id))) return false;
        idBersuara.add(String(id));
        if (idBersuara.size > 200) idBersuara.clear();
      }
    }
    const saat = konteks.currentTime + 0.01;
    const keras = 0.045;
    if (jenis === 'tap') {
      nada(520, saat, 0.09, 'sine', keras);
    } else if (jenis === 'bell') {
      nada(784, saat, 0.28, 'triangle', keras * 0.8);
      nada(1176, saat + 0.03, 0.2, 'sine', keras * 0.35);
    } else {
      nada(660, saat, 0.14, 'sine', keras);
      nada(880, saat + 0.09, 0.2, 'sine', keras * 0.7);
    }
    return true;
  }

  const suara = {
    info: pengaturanSuara,
    atur(perubahan) { return simpanSuara(perubahan); },
    uji() {
      return aktifkanAudio().then((siap) => siap ? putarNada(pengaturanSuara().jenis, true, '') : false);
    },
    putar(id) {
      const aturan = pengaturanSuara();
      if (!aturan.aktif || kurangGerak) return false;
      return putarNada(aturan.jenis, false, id);
    }
  };

  function kontrolSuara() {
    const aturan = pengaturanSuara();
    const node = elemen('div', 'pbpii-suara');
    const label = elemen('label', 'pbpii-suara-pilih');
    const kotak = document.createElement('input');
    kotak.type = 'checkbox';
    kotak.checked = Boolean(aturan.aktif);
    kotak.addEventListener('change', () => {
      simpanSuara({ aktif: kotak.checked });
      if (kotak.checked) void aktifkanAudio();
    });
    label.append(kotak, elemen('span', null, 'Suara'));
    const pilih = document.createElement('select');
    pilih.setAttribute('aria-label', 'Jenis suara notifikasi');
    [['chime', 'Chime'], ['tap', 'Ketuk'], ['bell', 'Lonceng']].forEach((pasangan) => {
      const opsi = document.createElement('option');
      opsi.value = pasangan[0];
      opsi.textContent = pasangan[1];
      opsi.selected = aturan.jenis === pasangan[0];
      pilih.append(opsi);
    });
    pilih.addEventListener('change', () => {
      simpanSuara({ jenis: pilih.value });
      void aktifkanAudio();
    });
    const uji = elemen('button', 'pbpii-suara-uji', 'Uji');
    uji.type = 'button';
    uji.addEventListener('click', (event) => {
      event.stopPropagation();
      void suara.uji();
    });
    node.append(label, pilih, uji);
    return node;
  }

  /* -------------------------------------------------------------- tampilan */

  function elemen(tag, kelas, teks) {
    const node = document.createElement(tag);
    if (kelas) node.className = kelas;
    if (teks !== undefined) node.textContent = teks;
    return node;
  }

  function relatif(stempel) {
    const waktu = Date.parse(String(stempel || ''));
    if (!Number.isFinite(waktu)) return '';
    const detik = Math.max(0, (Date.now() - waktu) / 1000);
    if (detik < 90) return 'baru saja';
    if (detik < 5400) return Math.round(detik / 60) + ' menit lalu';
    if (detik < 86400) return Math.round(detik / 3600) + ' jam lalu';
    if (detik < 172800) return 'kemarin';
    return new Date(waktu).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: '2-digit' });
  }

  function rentang(stempel) {
    const waktu = Date.parse(String(stempel || ''));
    if (!Number.isFinite(waktu)) return 'Sebelumnya';
    const hariIni = new Date();
    hariIni.setHours(0, 0, 0, 0);
    const kemarin = new Date(hariIni);
    kemarin.setDate(kemarin.getDate() - 1);
    if (waktu >= hariIni.getTime()) return 'Hari ini';
    if (waktu >= kemarin.getTime()) return 'Kemarin';
    return 'Sebelumnya';
  }

  /* `grupKunci` ber bentuk "jenis:targetType:id" (mis. "suka:post:<uuid>").
     Label grup HARUS diambil dari segmen pertama (jenis), bukan segmen
     terakhir: segmen terakhir adalah id target sehingga yang tampil di kepala
     tanggal justru UUID mentah. */
  function jenisGrup(nilai) {
    const teks = String(nilai || '').trim();
    if (!teks) return '';
    const jenis = teks.split(':')[0].trim().toLowerCase();
    if (!jenis || /^[0-9a-f-]{16,}$/i.test(jenis)) return '';
    return jenis;
  }

  function labelKunci(nilai) {
    const jenis = jenisGrup(nilai);
    if (!jenis) return '';
    return LABEL_GRUP[jenis] || jenis.replace(/[_-]+/g, ' ').slice(0, 40);
  }

  function labelJenis(nilai) {
    const teks = String(nilai || '').trim();
    if (!teks) return '';
    return LABEL_JENIS[teks.toLowerCase()] || teks.replace(/[_-]+/g, ' ').slice(0, 40);
  }

  function inisial(nilai) {
    const kata = String(nilai || '').trim().split(/\s+/).filter(Boolean);
    if (!kata.length) return 'P';
    return (kata[0].charAt(0) + (kata[1] ? kata[1].charAt(0) : '')).toUpperCase();
  }

  function avatar(item) {
    const wadah = elemen('span', 'pbpii-ava');
    const foto = fotoAman(item.actorPicture);
    if (!foto) {
      wadah.textContent = inisial(item.actorName);
      return wadah;
    }
    const gambar = document.createElement('img');
    gambar.src = foto;
    gambar.alt = '';
    gambar.loading = 'lazy';
    gambar.decoding = 'async';
    gambar.addEventListener('error', () => {
      gambar.remove();
      wadah.textContent = inisial(item.actorName);
    }, { once: true });
    wadah.append(gambar);
    return wadah;
  }

  function baris(item) {
    const node = elemen('div', 'pbpii-item' + (item.dibaca ? '' : ' belum'));
    const buka = elemen('button', 'pbpii-buka');
    buka.type = 'button';
    buka.setAttribute('aria-label', 'Buka kabar: ' + String(item.judul || 'Kabar'));
    const titikKecil = elemen('span', 'is');
    titikKecil.setAttribute('aria-hidden', 'true');

    const badan = elemen('span', 'pbpii-item-isi');
    const meta = elemen('span', 'pbpii-meta');
    meta.append(elemen('span', 'pbpii-actor', item.actorName || 'Kader PII'));
    const jenis = labelJenis(item.jenis);
    if (jenis) meta.append(elemen('span', 'pbpii-jenis', jenis));
    badan.append(meta, elemen('span', 'pbpii-judul', item.judul || 'Kabar'));
    if (item.isi) badan.append(elemen('span', 'pbpii-ringsan', String(item.isi).slice(0, 180)));
    if (item.targetHilang) badan.append(elemen('span', 'pbpii-hilang', 'Konten sudah dihapus'));
    const waktu = document.createElement('time');
    if (item.dibuat) waktu.dateTime = String(item.dibuat);
    waktu.textContent = relatif(item.dibuat);
    badan.append(waktu);

    buka.append(titikKecil, avatar(item), badan);
    buka.addEventListener('click', () => bukaItem(item));
    node.append(buka);

    if (!item.dibaca && item.id) {
      const tandai = elemen('button', 'pbpii-tandai', '✓');
      tandai.type = 'button';
      tandai.title = 'Tandai sudah dibaca';
      tandai.setAttribute('aria-label', 'Tandai sudah dibaca');
      tandai.addEventListener('click', (event) => {
        event.stopPropagation();
        void tandaiSatu(item);
      });
      node.append(tandai);
    }
    return node;
  }

  function daftarItem(host) {
    host.textContent = '';
    if (!isi.length) {
      host.append(elemen('p', 'pbpii-kosong', pernahMuat ? 'Belum ada kabar baru.' : 'Memuat kabar…'));
      return;
    }
    let kunciSebelum = null;
    isi.forEach((item) => {
      const waktu = rentang(item.dibuat);
      // Kelompokkan per hari + jenis, bukan per id target, agar kepala tanggal
      // tidak berulang untuk setiap kabar.
      const kunci = waktu + '|' + jenisGrup(item.grupKunci);
      if (kunci !== kunciSebelum) {
        const grup = elemen('div', 'pbpii-grup');
        grup.append(elemen('b', null, waktu));
        const kecil = labelKunci(item.grupKunci);
        if (kecil) grup.append(elemen('small', null, kecil));
        host.append(grup);
        kunciSebelum = kunci;
      }
      host.append(baris(item));
    });
  }

  function bangunTampilan(kelas) {
    const node = elemen('div', kelas);
    const kepala = elemen('div', 'pbpii-notif-kepala');
    const semua = elemen('button', 'pbpii-notif-semua', 'Tandai semua dibaca');
    semua.type = 'button';
    semua.addEventListener('click', (event) => {
      event.stopPropagation();
      void tandaiSemua();
    });
    kepala.append(elemen('b', 'pbpii-notif-judul', 'Kabar untuk Anda'), semua);
    const suaraHost = elemen('div', 'pbpii-suara-host');
    const daftarHost = elemen('div', 'pbpii-notif-daftar');
    const muatTombol = elemen('button', 'pbpii-notif-muat', 'Muat lebih banyak');
    muatTombol.type = 'button';
    muatTombol.hidden = true;
    muatTombol.addEventListener('click', (event) => {
      event.stopPropagation();
      void muatLebih();
    });
    node.append(kepala, suaraHost, daftarHost, muatTombol);
    return { node, semua, suaraHost, daftarHost, muatTombol, suaraTerpasang: false };
  }

  function segarkanTampilan(tampilan) {
    if (!tampilan) return;
    tampilan.semua.hidden = belum <= 0 || !isi.some((item) => !item.dibaca);
    if (!tampilan.suaraTerpasang) {
      tampilan.suaraHost.append(kontrolSuara());
      tampilan.suaraTerpasang = true;
    }
    daftarItem(tampilan.daftarHost);
    tampilan.muatTombol.hidden = !punyaLebih;
    tampilan.muatTombol.disabled = sedangMuat;
  }

  function sajikan() {
    if (terbuka && panelTampilan) segarkanTampilan(panelTampilan);
    tampilanHalaman = tampilanHalaman.filter((tampilan) => tampilan.node.isConnected);
    tampilanHalaman.forEach(segarkanTampilan);
  }

  function sorot() {
    if (!penanda || !titik || !tombol) return;
    penanda.textContent = belum > 99 ? '99+' : String(belum);
    penanda.classList.toggle('tersembunyi', belum === 0);
    titik.classList.toggle('tersembunyi', belum !== 0);
    tombol.setAttribute('aria-label', belum
      ? 'Kabar internal PB PII, ' + belum + ' belum dibaca'
      : 'Kabar internal PB PII');
    // appshell memasang badge menu; hanya jumlah yang dikirim, bukan isi kabar.
    window.dispatchEvent(new CustomEvent('pbpii-notif-belum', { detail: { belum } }));
  }

  function gaya() {
    if (document.getElementById('pbpii-notif-gaya')) return;
    const css = document.createElement('style');
    css.id = 'pbpii-notif-gaya';
    css.textContent = [
      '.pbpii-notif{position:relative;display:inline-flex;align-items:center}',
      '.pbpii-notif>button{display:grid;place-items:center;width:38px;height:38px;border:1px solid transparent;',
      'border-radius:11px;background:transparent;color:#33475e;cursor:pointer;padding:0}',
      '.pbpii-notif>button:hover{background:#eef3f9;border-color:#dbe5ef}',
      '.pbpii-notif>button svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;',
      'stroke-linecap:round;stroke-linejoin:round}',
      '.pbpii-notif .menor{position:absolute;top:1px;right:1px;min-width:17px;height:17px;padding:0 4px;',
      'border-radius:99px;background:#c0392b;color:#fff;font-size:10.5px;font-weight:800;line-height:17px;',
      'text-align:center;box-shadow:0 0 0 2px #fff}',
      '.pbpii-notif .titik{position:absolute;top:6px;right:7px;width:9px;height:9px;border-radius:99px;',
      'background:#c0392b;box-shadow:0 0 0 2px #fff}',
      '.pbpii-notif .tersembunyi{display:none}',
      '.pbpii-kotak{position:absolute;top:calc(100% + 10px);right:0;z-index:60;width:min(380px,calc(100vw - 24px));',
      'max-height:min(70vh,560px);overflow:auto;background:#fff;border:1px solid #dbe5ef;border-radius:14px;',
      'box-shadow:0 18px 44px rgba(16,43,73,.16);padding:8px;text-align:left}',
      '.pbpii-notif-panel{display:grid;gap:4px}',
      '.pbpii-notif-kepala{display:flex;align-items:center;justify-content:space-between;gap:8px;',
      'padding:4px 6px 8px;border-bottom:1px solid #edf1f6}',
      '.pbpii-notif-judul{color:#16324c;font-size:13px}',
      '.pbpii-notif-semua{border:0;background:none;color:#1d6fa8;font-size:12px;font-weight:700;',
      'cursor:pointer;padding:4px 6px;border-radius:8px}',
      '.pbpii-notif-semua:hover{background:#eef3f9}',
      '.pbpii-suara{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:6px;',
      'border-radius:9px;background:#f5f8fb;color:#496075;font-size:11.5px}',
      '.pbpii-suara-pilih{display:inline-flex;align-items:center;gap:5px;cursor:pointer}',
      '.pbpii-suara select,.pbpii-suara button{font:inherit;font-size:11.5px;padding:3px 6px;',
      'border:1px solid #dbe5ef;border-radius:7px;background:#fff;color:#33475e;cursor:pointer}',
      '.pbpii-grup{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px;margin:8px 6px 2px;',
      'color:#8494a4;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}',
      '.pbpii-grup small{font-weight:650;letter-spacing:0;text-transform:none}',
      '.pbpii-item{position:relative;min-width:0}',
      '.pbpii-buka{display:grid;grid-template-columns:8px 32px minmax(0,1fr);gap:7px;align-items:start;',
      'width:100%;border:0;border-radius:10px;background:none;color:inherit;font:inherit;text-align:left;',
      'cursor:pointer;padding:8px 6px}',
      '.pbpii-item.belum .pbpii-buka{padding-right:36px}',
      '.pbpii-buka:hover{background:#f2f6fb}',
      '.pbpii-item .is{width:7px;height:7px;border-radius:99px;margin-top:6px;background:transparent}',
      '.pbpii-item.belum .is{background:#c0392b}',
      '.pbpii-ava{width:32px;height:32px;display:grid;place-items:center;overflow:hidden;',
      'border-radius:50%;background:#e6eff7;color:#1d5b86;font-size:11px;font-weight:800}',
      '.pbpii-ava img{width:100%;height:100%;object-fit:cover}',
      '.pbpii-item-isi{display:grid;gap:2px;min-width:0}',
      '.pbpii-meta{display:flex;align-items:baseline;flex-wrap:wrap;gap:5px;min-width:0}',
      '.pbpii-actor{color:#16324c;font-size:12px;font-weight:800;overflow-wrap:anywhere}',
      '.pbpii-jenis{color:#176da8;font-size:10.5px;font-weight:750}',
      '.pbpii-judul{color:#16324c;font-size:12.5px;font-weight:650;overflow-wrap:anywhere}',
      '.pbpii-ringsan{color:#5a6b7f;font-size:11.5px;line-height:1.4;overflow-wrap:anywhere}',
      '.pbpii-item time{color:#8a99a9;font-size:10.5px;font-weight:700}',
      '.pbpii-hilang{color:#a3323b;font-size:10.5px;font-weight:700}',
      '.pbpii-tandai{position:absolute;top:8px;right:6px;width:24px;height:24px;padding:0;',
      'border:1px solid #dbe5ef;border-radius:8px;background:#fff;color:#14763f;font-size:12px;',
      'font-weight:800;cursor:pointer}',
      '.pbpii-tandai:hover{background:#eaf5ee}',
      '.pbpii-kosong{padding:18px 12px;margin:0;text-align:center;color:#64748b;font-size:12.5px}',
      '.pbpii-notif-muat{display:block;width:calc(100% - 12px);margin:8px 6px 4px;padding:8px 10px;',
      'border:1px solid #dbe5ef;border-radius:9px;background:#f5f8fb;color:#1d6fa8;',
      'font-size:12px;font-weight:750;cursor:pointer}',
      '.pbpii-notif-muat:hover{background:#eaf2f8}',
      '@media (max-width:640px){.pbpii-kotak{position:fixed;left:12px;right:12px;top:64px;',
      'width:auto;max-height:62vh}}'
    ].join('');
    document.head.appendChild(css);
  }

  /**
   * Lonceng tidak boleh dipasang di dalam elemen ber-`data-account`: akun.js
   * menggambar ulang isinya lewat innerHTML setiap kali sesi berubah, jadi
   * lonceng akan ikut terhapus. Ia dititipkan di sebelahnya.
   */
  function induk() {
    const dalam = document.querySelector('.top-actions');
    if (dalam) return { wadah: dalam, patok: null };
    const kepala = document.querySelector('.site-header');
    if (!kepala) return null;
    const akun = kepala.querySelector('[data-account]');
    return { wadah: kepala, patok: akun && akun.parentNode === kepala ? akun : null };
  }

  function tutup() {
    if (!terbuka) return;
    terbuka = false;
    panel.hidden = true;
    tombol.setAttribute('aria-expanded', 'false');
  }

  function tampilkan() {
    if (!dipasang) pasang();
    if (tombol) tombol.hidden = false;
  }

  function sembunyikan() {
    if (tombol) tombol.hidden = true;
    tutup();
  }

  function pasang() {
    if (dipasang) return;
    const letak = induk();
    if (!letak) return;
    const wadah = letak.wadah;
    gaya();

    const root = document.createElement('div');
    root.className = 'pbpii-notif';

    tombol = document.createElement('button');
    tombol.type = 'button';
    tombol.setAttribute('aria-haspopup', 'true');
    tombol.setAttribute('aria-expanded', 'false');
    tombol.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.2 7.5-2.2 7.5h16.4S18 14.5 18 8.5Z"/>' +
      '<path d="M13.7 19.5a2 2 0 0 1-3.4 0"/></svg>';

    penanda = document.createElement('span');
    penanda.className = 'menor tersembunyi';
    titik = document.createElement('span');
    titik.className = 'titik tersembunyi';
    panel = document.createElement('div');
    panel.className = 'pbpii-kotak';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Daftar kabar internal');
    panelTampilan = bangunTampilan('pbpii-notif-panel');
    panel.append(panelTampilan.node);

    tombol.append(penanda, titik);
    root.append(tombol, panel);

    if (letak.patok) {
      wadah.insertBefore(root, letak.patok);
    } else if (wadah.classList.contains('site-header')) {
      wadah.append(root);
    } else {
      wadah.insertBefore(root, wadah.firstElementChild);
    }

    dipasang = true;
    sorot();
    tombol.addEventListener('click', (event) => {
      event.stopPropagation();
      if (terbuka) {
        tutup();
        return;
      }
      terbuka = true;
      panel.hidden = false;
      tombol.setAttribute('aria-expanded', 'true');
      segarkanTampilan(panelTampilan);
      // Kotak yang hanya disegarkan tiap lima menit akan menampilkan kabar basi
      // tepat setelah pemicunya berjalan, jadi tarik ulang bila datanya tua.
      if (Date.now() - terakhirTarik > 20000) void muat();
    });
    document.addEventListener('click', (event) => {
      if (terbuka && !root.contains(event.target)) tutup();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') tutup();
    });
  }

  /* ------------------------------------------------------------ permintaan */

  function gabung(daftar) {
    const dilihat = new Set();
    return daftar.filter((item) => {
      if (!item) return false;
      const kunci = String(item.id || (String(item.judul || '') + '|' + String(item.dibuat || '')));
      if (dilihat.has(kunci)) return false;
      dilihat.add(kunci);
      return true;
    });
  }

  function perhatikanSuara(daftar, dariSiaran) {
    const masuk = daftar.filter((item) => item && item.id && !idDikenal.has(String(item.id)));
    daftar.forEach((item) => {
      if (item && item.id && idDikenal.size < 500) idDikenal.add(String(item.id));
    });
    if (!idDikenalDimulai) {
      // Muat pertama bukan kabar baru: jangan bunyikan seluruh isi kotak.
      idDikenalDimulai = true;
      return;
    }
    if (dariSiaran || !masuk.length) return;
    masuk.slice(0, 2).forEach((item) => suara.putar(String(item.id)));
  }

  function kunciTombol(keadaan) {
    if (panelTampilan) panelTampilan.muatTombol.disabled = keadaan;
    tampilanHalaman.forEach((tampilan) => { tampilan.muatTombol.disabled = keadaan; });
  }

  async function muat(opsi) {
    if (sedangMuat) return;
    if (!sesi()) {
      isi = [];
      belum = 0;
      offset = 0;
      punyaLebih = false;
      pernahMuat = true;
      terakhirTarik = Date.now();
      sembunyikan();
      sajikan();
      sorot();
      return;
    }
    const pilihan = opsi || {};
    sedangMuat = true;
    kunciTombol(true);
    try {
      const data = await kirim({
        action: 'notifList',
        offset: pilihan.tambah ? offset : 0,
        batas: BATAS
      });
      const daftar = Array.isArray(data.notifikasi) ? data.notifikasi : [];
      isi = gabung(pilihan.tambah ? isi.concat(daftar) : daftar);
      // Server mengembalikan offset yang diminta; halaman berikutnya harus
      // maju sepanjang baris yang benar-benar diterima, bukan tetap di offset
      // lama (kalau tidak, "Muat lebih banyak" mengulang halaman yang sama).
      const offsetBaru = Number(data.offset);
      offset = (Number.isFinite(offsetBaru) ? offsetBaru : (pilihan.tambah ? offset : 0))
        + daftar.length;
      punyaLebih = Boolean(data.punyaLebih);
      belum = Math.max(0, Number(data.belumDibaca) || 0);
      terakhirTarik = Date.now();
      pernahMuat = true;
      if (!pilihan.tambah) perhatikanSuara(daftar, Boolean(pilihan.dariSiaran));
      tampilkan();
      sajikan();
      sorot();
    } catch (error) {
      // Sesi mati atau kotak belum tersedia: jangan pamer lonceng yang error.
      if (/masuk|sesi|token/i.test(String(error && error.message))) sembunyikan();
    } finally {
      sedangMuat = false;
      kunciTombol(false);
    }
  }

  async function muatLebih() {
    if (sedangMuat || !punyaLebih) return;
    await muat({ tambah: true });
  }

  function siarkan() {
    try { if (saluran) saluran.postMessage({ type: 'pbpii-notif-refresh' }); } catch (_) { /* abaikan */ }
  }

  function segarkan(opsi) {
    if (sedangMuat || Date.now() - terakhirTarik < 1500) return;
    void muat(opsi);
  }

  async function tandaiSatu(item, opsi) {
    const id = String(item.id || '');
    if (!id || item.dibaca || sedangBaca) return;
    sedangBaca = true;
    try {
      const data = await kirim({ action: 'notifRead', id }, { keepalive: true });
      item.dibaca = new Date().toISOString();
      const sisa = Number(data && data.belumDibaca);
      belum = Number.isFinite(sisa) ? Math.max(0, sisa) : Math.max(0, belum - 1);
      if (!opsi || !opsi.diam) sajikan();
      sorot();
      siarkan();
    } catch (_) {
      // Kabar tetap dibuka; status baca menyusul saat kotak dimuat ulang.
    } finally {
      sedangBaca = false;
    }
  }

  async function tandaiSemua() {
    if (sedangBaca) return;
    const ids = isi.filter((item) => !item.dibaca && item.id).map((item) => String(item.id));
    if (!ids.length) return;
    sedangBaca = true;
    try {
      // Kabar di luar halaman pertama belum ada di `isi`: bila jumlah belum
      // dibaca lebih besar, pakai bentuk lama "tandai semua" dan jatuh ke
      // daftar id bila server tidak mengenalnya lagi.
      let badan = belum > ids.length ? { action: 'notifRead' } : { action: 'notifRead', ids };
      let data;
      try {
        data = await kirim(badan, { keepalive: true });
      } catch (error) {
        if (!badan.ids) {
          badan = { action: 'notifRead', ids };
          data = await kirim(badan, { keepalive: true });
        } else {
          throw error;
        }
      }
      isi.forEach((item) => { if (!item.dibaca) item.dibaca = new Date().toISOString(); });
      const sisa = Number(data && data.belumDibaca);
      belum = Number.isFinite(sisa) ? Math.max(0, sisa) : 0;
      sajikan();
      sorot();
      siarkan();
    } catch (_) {
      /* Biarkan daftar apa adanya; kabar akan disegarkan pada muat berikutnya. */
    } finally {
      sedangBaca = false;
    }
  }

  async function bukaItem(item) {
    const tujuanAkhir = tujuan(item);
    // Tunggu server mencatat status baca sebelum halaman berpindah. keepalive
    // saja tidak cukup: sebagian peramban membatalkan fetch saat navigasi,
    // sehingga notifikasi tetap terlihat belum dibaca setelah diklik.
    if (!item.dibaca && item.id) {
      try { await tandaiSatu(item, { diam: true }); } catch (_) { /* tetap buka kabar */ }
    }
    tutup();
    window.location.assign(tujuanAkhir);
  }

  /** Halaman penuh /app/notifikasi memakai perender yang sama dengan panel. */
  function halaman(wadah) {
    if (!wadah) return false;
    const lama = tampilanHalaman.findIndex((tampilan) => tampilan.wadah === wadah);
    if (lama >= 0) tampilanHalaman.splice(lama, 1);
    wadah.textContent = '';
    wadah.append(elemen('h1', 'app-judul', 'Notifikasi'));
    const kartu = elemen('section', 'app-card pbpii-notif-halaman');
    wadah.append(kartu);
    const tampilan = bangunTampilan('pbpii-notif-dalam');
    tampilan.wadah = wadah;
    kartu.append(tampilan.node);
    tampilanHalaman.push(tampilan);
    segarkanTampilan(tampilan);
    if (!pernahMuat || Date.now() - terakhirTarik > 20000) void muat();
    return true;
  }

  function jadwalkan() {
    if (penunda) window.clearTimeout(penunda);
    penunda = window.setTimeout(() => {
      void muat().finally(jadwalkan);
    }, document.hidden ? JEDA_SEMBUNYI : JEDA_TAMPIL);
  }

  function mulai() {
    pasang();
    void muat();
    jadwalkan();
    document.addEventListener('visibilitychange', () => {
      segarkan({ paksa: true });
      jadwalkan();
    });
    window.addEventListener('focus', () => segarkan({ paksa: true }));

    // Sinyal antar tab sengaja tanpa isi: tidak ada kabar/token yang dibocorkan
    // ke tab lain yang kebetulan menyimpan akun berbeda.
    try {
      if (typeof BroadcastChannel === 'function') {
        saluran = new BroadcastChannel('pbpii-notif');
        saluran.addEventListener('message', (event) => {
          if (event.data && event.data.type === 'pbpii-notif-refresh') {
            segarkan({ dariSiaran: true });
          }
        });
      }
    } catch (_) {
      saluran = null;
    }

    ['pointerdown', 'keydown', 'touchend'].forEach((nama) => {
      document.addEventListener(nama, () => { void aktifkanAudio(); }, { passive: true, once: true });
    });

    if (window.PBPIIAkun && window.PBPIIAkun.onChange) {
      window.PBPIIAkun.onChange(() => {
        idDikenal.clear();
        idBersuara.clear();
        idDikenalDimulai = false;
        void muat();
      });
    }
  }

  window.PBPIINotifikasi = { tautan, halaman, muat, suara };
  // Beri tahu appshell yang mungkin lebih dulu tiba dari whoami, supaya
  // halaman penuh bisa beralih dari implementasi cadangan ke perender ini.
  window.dispatchEvent(new Event('pbpii-notif-siap'));

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mulai);
  } else {
    mulai();
  }
})();
