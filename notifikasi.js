/**
 * Lonceng kabar internal untuk kader, pengurus lembaga, dan admin.
 *
 * Satu berkas dipakai semua dasbor: ia menempel di header, memakai sesi yang
 * sudah ada di localStorage, dan hanya boleh membuka kotak milik sesi itu.
 * Seluruh teks kabar ditulis lewat textContent, jadi isian pengguna tidak pernah
 * dibaca sebagai markup.
 */
(() => {
  'use strict';

  const API = () => (window.PBPII_CONFIG && window.PBPII_CONFIG.apiEndpoint) || '/api/pii';
  const KUNCI_TOKEN = ['pbpii_kader_token', 'pbpii_admin_token', 'pbpii_org_token'];
  const JEDA = 300000;

  let tombol = null;
  let panel = null;
  let penanda = null;
  let titik = null;
  let isi = [];
  let belum = 0;
  let terbuka = false;
  let dipasang = false;
  let terakhirTarik = 0;

  const sesi = () => KUNCI_TOKEN.map((key) => localStorage.getItem(key) || '').find(Boolean) || '';

  async function kirim(badan) {
    const respons = await fetch(API(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ token: sesi() }, badan))
    });
    const hasil = await respons.json().catch(() => null);
    if (!hasil || !hasil.ok) {
      const error = new Error((hasil && hasil.error) || 'Kabar belum dapat dimuat.');
      error.code = String((hasil && hasil.code) || '');
      throw error;
    }
    return hasil.data;
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
      '.pbpii-kotak{position:absolute;top:calc(100% + 10px);right:0;z-index:60;width:min(360px,calc(100vw - 26px));',
      'max-height:min(440px,70vh);overflow:auto;background:#fff;border:1px solid #dbe5ef;border-radius:14px;',
      'box-shadow:0 18px 44px rgba(16,43,73,.16);padding:8px;text-align:left}',
      '.pbpii-kotak .kepala{display:flex;align-items:center;justify-content:space-between;gap:8px;',
      'padding:4px 8px 8px;border-bottom:1px solid #edf1f6;margin-bottom:4px}',
      '.pbpii-kotak .kepala b{font-size:13px;color:#16324c}',
      '.pbpii-kotak .kepala button{border:0;background:none;color:#1d6fa8;font-size:12px;font-weight:700;',
      'cursor:pointer;padding:4px 6px;border-radius:8px}',
      '.pbpii-kotak .kepala button:hover{background:#eef3f9}',
      '.pbpii-kotak .kosong{padding:18px 12px;text-align:center;color:#64748b;font-size:12.5px}',
      '.pbpii-item{display:grid;grid-template-columns:10px 1fr;gap:8px;width:100%;text-align:left;border:0;',
      'background:none;padding:9px 8px;border-radius:10px;cursor:pointer;align-items:start}',
      '.pbpii-item:hover{background:#f2f6fb}',
      '.pbpii-item .is{width:7px;height:7px;border-radius:99px;margin-top:6px;background:transparent}',
      '.pbpii-item.belum .is{background:#c0392b}',
      '.pbpii-item h4{margin:0;font-size:12.8px;color:#16324c;line-height:1.35;font-weight:750}',
      '.pbpii-item p{margin:3px 0 0;font-size:12px;color:#5a6b7f;line-height:1.45;overflow-wrap:anywhere}',
      '.pbpii-item time{display:block;margin-top:4px;font-size:11px;color:#8a99a9;font-weight:700}',
      '@media (max-width:640px){.pbpii-kotak{position:fixed;left:12px;right:12px;top:64px;width:auto;max-height:62vh}}'
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

  function sorot() {
    penanda.textContent = belum > 99 ? '99+' : String(belum);
    penanda.classList.toggle('tersembunyi', belum === 0);
    titik.classList.toggle('tersembunyi', belum !== 0);
    tombol.setAttribute('aria-label', belum
      ? 'Kabar internal PB PII, ' + belum + ' belum dibaca'
      : 'Kabar internal PB PII');
  }

  function baris(item) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'pbpii-item' + (item.dibaca ? '' : ' belum');

    const is = document.createElement('span');
    is.className = 'is';
    is.setAttribute('aria-hidden', 'true');

    const badan = document.createElement('span');
    const judul = document.createElement('h4');
    judul.textContent = item.judul || 'Kabar';
    badan.appendChild(judul);

    if (item.isi) {
      const ringsan = document.createElement('p');
      ringsan.textContent = item.isi;
      badan.appendChild(ringsan);
    }

    const waktu = document.createElement('time');
    waktu.textContent = relatif(item.dibuat);
    badan.appendChild(waktu);

    el.appendChild(is);
    el.appendChild(badan);
    el.addEventListener('click', () => buka(item));
    return el;
  }

  function gambar() {
    panel.textContent = '';

    const kepala = document.createElement('div');
    kepala.className = 'kepala';
    const judul = document.createElement('b');
    judul.textContent = 'Kabar untuk Anda';
    kepala.appendChild(judul);
    if (belum > 0) {
      const semua = document.createElement('button');
      semua.type = 'button';
      semua.textContent = 'Tandai semua dibaca';
      semua.addEventListener('click', (event) => {
        event.stopPropagation();
        tandaiSemua();
      });
      kepala.appendChild(semua);
    }
    panel.appendChild(kepala);

    if (!isi.length) {
      const kosong = document.createElement('p');
      kosong.className = 'kosong';
      kosong.textContent = 'Belum ada kabar baru.';
      panel.appendChild(kosong);
      return;
    }
    isi.forEach((item) => panel.appendChild(baris(item)));
  }

  async function muat() {
    if (!sesi()) {
      sembunyikan();
      return;
    }
    try {
      const data = await kirim({ action: 'notifList' });
      isi = Array.isArray(data.notifikasi) ? data.notifikasi : [];
      belum = Number(data.belumDibaca) || 0;
      terakhirTarik = Date.now();
      tampilkan();
      sorot();
      if (terbuka) gambar();
    } catch (error) {
      // Sesi mati atau kotak belum tersedia: jangan pamer lonceng yang error.
      if (/masuk|sesi|token/i.test(String(error && error.message))) sembunyikan();
    }
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

    tombol.appendChild(penanda);
    tombol.appendChild(titik);
    root.appendChild(tombol);
    root.appendChild(panel);

    if (letak.patok) {
      wadah.insertBefore(root, letak.patok);
    } else if (wadah.classList.contains('site-header')) {
      wadah.appendChild(root);
    } else {
      wadah.insertBefore(root, wadah.firstElementChild);
    }

    dipasang = true;
    tombol.addEventListener('click', (event) => {
      event.stopPropagation();
      if (terbuka) {
        tutup();
        return;
      }
      terbuka = true;
      panel.hidden = false;
      tombol.setAttribute('aria-expanded', 'true');
      gambar();
      // Kotak yang hanya disegarkan tiap lima menit akan menampilkan kabar basi
      // tepat setelah pemicunya berjalan, jadi tarik ulang bila datanya tua.
      if (Date.now() - terakhirTarik > 20000) muat();
    });
    document.addEventListener('click', (event) => {
      if (terbuka && !root.contains(event.target)) tutup();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') tutup();
    });
  }

  async function buka(item) {
    const id = String(item.id || '');
    if (id && !item.dibaca) {
      try {
        const data = await kirim({ action: 'notifRead', id: id });
        belum = Number(data.belumDibaca) || 0;
        item.dibaca = new Date().toISOString();
        sorot();
      } catch {
        // Kabar tetap dibuka; status baca menyusul saat kotak dimuat ulang.
      }
    }
    const tautan = String(item.tautan || '');
    if (tautan) window.location.href = tautan;
    else tutup();
  }

  async function tandaiSemua() {
    try {
      await kirim({ action: 'notifRead' });
      isi.forEach((item) => { item.dibaca = item.dibaca || new Date().toISOString(); });
      belum = 0;
      sorot();
      gambar();
    } catch {
      /* Biarkan daftar apa adanya; kabar akan disegarkan pada muat berikutnya. */
    }
  }

  function mulai() {
    pasang();
    muat();
    window.setInterval(() => { if (!terbuka) muat(); }, JEDA);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) muat();
    });
    if (window.PBPIIAkun && window.PBPIIAkun.onChange) {
      window.PBPIIAkun.onChange(() => muat());
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mulai);
  } else {
    mulai();
  }
})();
