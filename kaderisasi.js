/**
 * Peta Kaderisasi — daftar kegiatan berkoordinat di samping globe.
 *
 * Kader dan pengunjung hanya melihat: di mana kegiatan berlangsung dan sampai
 * hari berapa. Yang menulis data ini hanyalah pengurus lewat dasbor lembaga,
 * jadi daftar dibaca dari aksi `public` yang sama dengan halaman acara.
 */
(() => {
  const tombol = document.getElementById('kaderToggle');
  const panel = document.getElementById('kaderPanel');
  const tutup = document.getElementById('kaderClose');
  const daftar = document.getElementById('kaderList');
  const chips = document.getElementById('kaderChips');
  const cari = document.getElementById('kaderSearch');
  const akanDatang = document.getElementById('kaderUpcoming');
  if (!tombol || !panel || !daftar) return;

  const API = (window.PBPII_CONFIG && window.PBPII_CONFIG.apiEndpoint) || '/api/pii';
  const CACHE = 'pbpii_kaderisasi_feed';
  const KETINGGIAN = 35000;
  const state = { events: [], jenjang: [], filter: '', query: '', aktif: '' };
  let siap = false;

  const lepas = (nilai = '') => String(nilai).replace(/[&<>"']/g, (c) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
  const tanggalSah = (nilai) => /^\d{4}-\d{2}-\d{2}$/.test(String(nilai || ''));
  const hari = (nilai) => {
    const date = new Date(`${String(nilai).slice(0, 10)}T00:00:00`);
    return isNaN(date.getTime()) ? '' : date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  /* Jawaban untuk pertanyaan kader: kegiatan ini sampai tanggal berapa. */
  const rentang = (event) => {
    const mulai = hari(event.date);
    const akhir = tanggalSah(event.endDate) && event.endDate > event.date ? hari(event.endDate) : '';
    return akhir ? `${mulai} — ${akhir}` : mulai;
  };
  const titik = (event) => {
    const lat = Number(event.latitude);
    const lon = Number(event.longitude);
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
      ? { lat, lon, alt: KETINGGIAN } : null;
  };

  function bacaCache() {
    try {
      const isi = JSON.parse(localStorage.getItem(CACHE) || 'null');
      if (isi && Array.isArray(isi.events)) {
        terisi({ events: isi.events, settings: { kaderJenjang: (isi.jenjang || []).join('|') } });
      }
    } catch (error) { /* penyimpanan privat */ }
  }
  function tulisCache() {
    try { localStorage.setItem(CACHE, JSON.stringify({ events: state.events, jenjang: state.jenjang })); } catch (error) { /* penuh */ }
  }
  function terisi(payload) {
    state.events = (payload.events || []).filter(titik);
    state.jenjang = String((payload.settings && payload.settings.kaderJenjang) || 'BATRA|INTRA|ADVAN')
      .split(/[,|]/).map((nilai) => nilai.trim()).filter(Boolean);
    siap = true;
    renderChips();
    render();
    tulisCache();
  }

  async function muat() {
    if (panel.dataset.muat === '1') return;
    panel.dataset.muat = '1';
    try {
      const response = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'public' })
      });
      const hasil = await response.json();
      if (hasil && hasil.ok && hasil.data) {
        terisi({ events: hasil.data.events, settings: hasil.data.settings });
        panel.dataset.muat = '0';
        return;
      }
    } catch (error) { /* jaringan: biarkan salinan tersimpan yang tampil */ }
    panel.dataset.muat = '0';
    if (!siap) daftar.innerHTML = '<p class="kader-note">Daftar kegiatan belum dapat diambil. Periksa koneksi lalu buka lagi.</p>';
  }

  function renderChips() {
    chips.innerHTML = ['', ...state.jenjang].map((nilai) => {
      const label = nilai || 'Semua jenjang';
      return `<button type="button" class="kader-chip${state.filter === nilai ? ' is-on' : ''}" data-jenjang="${lepas(nilai)}">${lepas(label)}</button>`;
    }).join('');
  }

  function cocok(event) {
    if (akanDatang.checked && !event.upcoming) return false;
    if (state.filter && String(event.jenjangKaderisasi).toLowerCase() !== state.filter.toLowerCase()) return false;
    if (!state.query) return true;
    const gabungan = `${event.title} ${event.location} ${event.category} ${(event.host && event.host.name) || ''} ${event.jenjangKaderisasi}`.toLowerCase();
    return gabungan.indexOf(state.query) >= 0;
  }

  function kartu(event) {
    const penyelenggara = (event.host && event.host.name) || 'Lembaga PII';
    const jenjang = event.jenjangKaderisasi ? `<span class="kader-badge">${lepas(event.jenjangKaderisasi)}</span>` : '';
    const tempat = [event.location, penyelenggara].filter(Boolean).join(' · ');
    const aktif = state.aktif === event.id ? ' is-aktif' : '';
    return `
      <article class="kader-item${aktif}" data-titik="${lepas(event.id)}">
        <header>
          <b>${lepas(event.title)}</b>
          ${jenjang}
        </header>
        <p class="kader-when">${lepas(rentang(event))}</p>
        <p class="kader-where">${lepas(tempat)}</p>
        <button type="button" class="kader-go" data-fly="${lepas(event.id)}">Lihat di globe</button>
      </article>`;
  }

  function render() {
    if (!siap) return;
    const terlihat = state.events
      .filter(cocok)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!terlihat.length) {
      /* Dua keadaan berbeda: memang belum ada titiknya, atau saringannya yang
         menyisakan nol. Pesan pertama menjelaskan siapa yang mengisinya. */
      daftar.innerHTML = state.events.length
        ? '<p class="kader-note">Belum ada kegiatan pada penyaringan ini. Coba jenjang lain atau matikan "hanya yang akan datang".</p>'
        : '<p class="kader-note">Belum ada kegiatan yang titiknya diisi panitia. Pengurus lembaga menambahkan titik kegiatannya, sesudah itu daftarnya muncul di sini.</p>';
      return;
    }
    daftar.innerHTML = terlihat.map(kartu).join('');
  }

  /* Di ponsel daftar duduk di bawah petanya, jadi buka berarti ikut menggulung
     layar; kalau tidak, kader mengira daftarnya kosong. */
  function ke() {
    if (!document.body.classList.contains('globe-compact')) return;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function buka() {
    panel.hidden = false;
    tombol.setAttribute('aria-expanded', 'true');
    tombol.classList.add('is-on');
    muat();
    ke();
  }
  function tutupPanel() {
    panel.hidden = true;
    tombol.setAttribute('aria-expanded', 'false');
    tombol.classList.remove('is-on');
  }

  window.PBPIIKader = { buka: buka, ke: ke };

  tombol.addEventListener('click', () => { (panel.hidden ? buka : tutupPanel)(); });
  tutup.addEventListener('click', tutupPanel);
  cari.addEventListener('input', () => { state.query = cari.value.trim().toLowerCase(); render(); });
  akanDatang.addEventListener('change', render);
  chips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-jenjang]');
    if (!chip) return;
    state.filter = chip.dataset.jenjang;
    renderChips();
    render();
  });
  daftar.addEventListener('click', (event) => {
    const tombolFly = event.target.closest('[data-fly]');
    if (!tombolFly) return;
    const found = state.events.find((item) => String(item.id) === tombolFly.dataset.fly);
    const sasaran = found && titik(found);
    if (!sasaran) return;
    state.aktif = found.id;
    render();
    if (window.PBPIIGlobeBridge) window.PBPIIGlobeBridge.fly(sasaran);
  });

  bacaCache();
  const awal = window.PBPIIGlobeBridge && window.PBPIIGlobeBridge.kameraAwal;
  if (/kader=1/.test(String(location.hash || '')) || awal) buka();

  /* Tautan "Peta Kaderisasi" yang diklik saat sudah berada di halaman ini
     hanya mengubah hash, jadi panel dibuka dari peristiwa itu. Lompatan titik
     memakai replaceState sehingga tidak masuk ke jalur ini. */
  window.addEventListener('hashchange', () => {
    if (/kader=1/.test(String(location.hash || ''))) buka();
  });
})();
