/**
 * Profil kader PB PII.
 *
 * Satu halaman melayani tiga keadaan: /profil.html terbuka sendiri memakai sesi
 * yang sudah ada, /profil.html?u=nama-akun terbuka untuk siapa pun seperti kartu
 * nama, dan ?kader=id dipakai tautan dari feed. Semua data datang dari Apps
 * Script lewat /api/pii yang sama, jadi tidak ada akun kedua.
 */
(() => {
  'use strict';

  const API = window.PBPII_CONFIG?.apiEndpoint || '/api/pii';
  const LOGO = 'assets/logo-pii.webp';
  const MEDIA_MAX = 4;
  const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
  const MAX_SAMPUL_BYTES = 3 * 1024 * 1024;

  const board = document.querySelector('#profil');
  if (!board) return;

  const el = {
    cariForm: document.querySelector('#profilCariForm'),
    cari: document.querySelector('#profilCari'),
    temuan: document.querySelector('#profilTemuan'),
    state: document.querySelector('#profilState'),
    kartu: document.querySelector('#profilKartu'),
    sampul: document.querySelector('#profilSampul'),
    sampulGambar: document.querySelector('#profilSampulGambar'),
    avatar: document.querySelector('#profilAvatar'),
    avatarGambar: document.querySelector('#profilAvatarGambar'),
    inisial: document.querySelector('#profilInisial'),
    ikuti: document.querySelector('#profilIkuti'),
    ubah: document.querySelector('#profilUbah'),
    nama: document.querySelector('#profilNama'),
    akun: document.querySelector('#profilAkun'),
    bio: document.querySelector('#profilBio'),
    atribut: document.querySelector('#profilAtribut'),
    jaring: document.querySelector('#profilJaring'),
    jumlahKabar: document.querySelector('#profilJumlahKabar'),
    jumlahPengikut: document.querySelector('#profilJumlahPengikut'),
    jumlahMengikuti: document.querySelector('#profilJumlahMengikuti'),
    tabPengikut: document.querySelector('#profilTabPengikut'),
    tabMengikuti: document.querySelector('#profilTabMengikuti'),
    tabs: document.querySelector('#profilTabs'),
    masuk: document.querySelector('#profilMasuk'),
    masukBuka: document.querySelector('#profilMasukBuka'),
    daftar: document.querySelector('#profilDaftar'),
    kosong: document.querySelector('#profilKosong'),
    dialog: document.querySelector('#profilDialog'),
    form: document.querySelector('#profilForm'),
    catatan: document.querySelector('#dialogCatatan'),
    avatarBesar: document.querySelector('#dialogAvatar'),
    inisialDialog: document.querySelector('#dialogInisial'),
    sampulDialog: document.querySelector('#dialogSampul'),
    sampulTeks: document.querySelector('#dialogSampulTeks'),
    berkasAvatar: document.querySelector('#dialogBerkasAvatar'),
    berkasSampul: document.querySelector('#dialogBerkasSampul'),
    ambilAvatar: document.querySelector('#dialogAmbilAvatar'),
    ambilSampul: document.querySelector('#dialogAmbilSampul'),
    hapusAvatar: document.querySelector('#dialogHapusAvatar'),
    hapusSampul: document.querySelector('#dialogHapusSampul'),
    namaInput: document.querySelector('#dialogNama'),
    username: document.querySelector('#dialogUsername'),
    bioInput: document.querySelector('#dialogBio'),
    bioHitung: document.querySelector('#dialogBioHitung'),
    lokasi: document.querySelector('#dialogLokasi'),
    jenjang: document.querySelector('#dialogJenjang'),
    lembaga: document.querySelector('#dialogLembaga'),
    simpan: document.querySelector('#dialogSimpan'),
    batal: document.querySelector('#dialogBatal'),
    tutup: document.querySelector('#profilDialogTutup')
  };

  const TAUTAN = [
    { key: 'instagram', input: document.querySelector('#dialogInstagram'), label: 'Instagram' },
    { key: 'youtube', input: document.querySelector('#dialogYoutube'), label: 'YouTube' },
    { key: 'tiktok', input: document.querySelector('#dialogTiktok'), label: 'TikTok' },
    { key: 'facebook', input: document.querySelector('#dialogFacebook'), label: 'Facebook' },
    { key: 'x', input: document.querySelector('#dialogX'), label: 'X' },
    { key: 'linkedin', input: document.querySelector('#dialogLinkedin'), label: 'LinkedIn' },
    { key: 'website', input: document.querySelector('#dialogWebsite'), label: 'Situs' }
  ];

  const state = {
    data: null,
    tab: 'kabar',
    jaringan: {},
    muatJaringan: {},
    avatar: '',
    sampul: '',
    sedangMuat: false,
    sesiTerakhir: ''
  };

  const tokenSaya = () => window.PBPIIAkun?.sessionToken?.() || window.PBPIIAkun?.token?.() || '';
  const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (nama) => String(nama || 'K').trim().charAt(0).toUpperCase() || 'K';
  const angka = (nilai) => (Number(nilai) || 0).toLocaleString('id-ID');

  async function api(body) {
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => null);
    if (!result || !result.ok) {
      const error = new Error(result?.error || 'Profil belum dapat dihubungi. Coba lagi sebentar.');
      error.code = String(result?.code || '');
      error.retryAfter = Number(result?.retryAfter) || 0;
      throw error;
    }
    return result.data;
  }

  /* ------------------------------------------------------------------ gambar */

  const driveId = (value) => {
    const url = String(value || '').trim();
    if (!/^https:\/\//i.test(url)) return '';
    try {
      const parsed = new URL(url);
      if (['drive.google.com', 'drive.usercontent.google.com'].includes(parsed.hostname)) {
        return parsed.searchParams.get('id') || '';
      }
      if (parsed.hostname === 'lh3.googleusercontent.com') return parsed.pathname.match(/^\/d\/([A-Za-z0-9_-]+)/i)?.[1] || '';
      return '';
    } catch {
      return '';
    }
  };

  const gambarBentuk = [
    (id) => '/api/pii?imageId=' + encodeURIComponent(id),
    (id) => 'https://drive.usercontent.google.com/download?id=' + id + '&export=view&authuser=0',
    (id) => 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1200'
  ];

  const tautanGambar = (value) => {
    const url = String(value || '').trim();
    if (!/^https:\/\//i.test(url)) return LOGO;
    const id = driveId(url);
    if (id) return '/api/pii?imageId=' + encodeURIComponent(id);
    try {
      return escapeHTML(new URL(url).href);
    } catch {
      return LOGO;
    }
  };

  const atributGambar = (value) => {
    const id = driveId(value);
    return id ? ` data-drive="${id}" data-coba="0"` : '';
  };

  window.profilGambarGagal = (img) => {
    const id = img.dataset.drive;
    const sudah = Number(img.dataset.coba || 0);
    if (id && sudah < gambarBentuk.length) {
      img.dataset.coba = String(sudah + 1);
      img.src = gambarBentuk[sudah](id);
      return;
    }
    img.onerror = null;
    img.src = LOGO;
  };

  /** Mengisi satu bingkai gambar: foto bila ada, inisial nama bila tidak. */
  function pasangFoto(sumber, bingkai, inisialEl, nama, url) {
    const ada = String(url || '').trim();
    if (inisialEl) inisialEl.textContent = initials(nama);
    if (!ada) {
      sumber.hidden = true;
      sumber.removeAttribute('src');
      bingkai.classList.remove('ada-foto');
      return;
    }
    sumber.src = tautanGambar(ada);
    sumber.alt = `Foto ${nama || 'kader'}`;
    sumber.dataset.drive = driveId(ada);
    sumber.dataset.coba = '0';
    sumber.hidden = false;
    bingkai.classList.add('ada-foto');
  }

  function waktuLalu(value) {
    const time = Date.parse(String(value || ''));
    if (!isFinite(time)) return '';
    const menit = Math.round((Date.now() - time) / 60000);
    if (menit < 1) return 'baru saja';
    if (menit < 60) return `${menit} menit lalu`;
    const jam = Math.round(menit / 60);
    if (jam < 24) return `${jam} jam lalu`;
    const hari = Math.round(jam / 24);
    if (hari < 30) return `${hari} hari lalu`;
    return tanggalPanjang(value);
  }

  const tanggalPanjang = (value) => {
    const time = Date.parse(String(value || ''));
    if (!isFinite(time)) return '';
    return new Date(time).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const labelJenis = {
    teks: 'Kabar', foto: 'Foto', video: 'Video', pengumuman: 'Pengumuman', acara: 'Kegiatan', berbagi: 'Dibagikan'
  };

  /* ------------------------------------------------------------------ tampilan */

  function tampilkanKeadaan(pesan) {
    el.state.hidden = !pesan;
    el.state.innerHTML = pesan
      ? `<p class="profil-pesan">${pesan}</p>`
      : '<div class="profil-skeleton" aria-hidden="true"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>';
  }

  function barisOrang(kader) {
    const foto = kader.avatar
      ? `<img src="${tautanGambar(kader.avatar)}" alt="" referrerpolicy="no-referrer"${atributGambar(kader.avatar)} onerror="profilGambarGagal(this)">`
      : '';
    const alamat = kader.username
      ? `/profil.html?u=${encodeURIComponent(kader.username)}`
      : `/profil.html?id=${encodeURIComponent(kader.id || '')}`;
    const pegangan = kader.username ? `@${escapeHTML(kader.username)}` : '';
    const keterangan = [pegangan, kader.jenjang ? escapeHTML(kader.jenjang) : '']
      .filter(Boolean).join(' · ');
    return `<a class="profil-orang" href="${alamat}">
      <span class="profil-orang-ava">${escapeHTML(initials(kader.nama))}${foto}</span>
      <span class="profil-orang-copy">
        <b>${escapeHTML(kader.nama || 'Kader PII')}</b>
        ${keterangan ? `<small>${keterangan}</small>` : ''}
        ${kader.lokasi ? `<small class="profil-orang-lokasi">${escapeHTML(kader.lokasi)}</small>` : ''}
      </span>
      <span class="profil-orang-angka">${angka(kader.pengikut)} pengikut</span>
    </a>`;
  }

  function kartuKabar(card) {
    const media = (card.media || []).slice(0, MEDIA_MAX);
    const mediaHtml = media.length
      ? `<div class="profil-media" data-count="${media.length}">
          ${media.map((item) => (String(item.mime || '').indexOf('video') === 0
            ? `<video src="${escapeHTML(String(item.url || ''))}" controls playsinline preload="metadata" poster="${LOGO}"></video>`
            : `<img src="${tautanGambar(item.url)}" alt="Foto pada kabar ini" loading="lazy"${atributGambar(item.url)} onerror="profilGambarGagal(this)">`)).join('')}
        </div>`
      : '';
    return `<article class="profil-kabar">
      <p class="profil-kabar-top">${escapeHTML(labelJenis[card.jenis] || 'Kabar')} · ${escapeHTML(waktuLalu(card.createdAt))}</p>
      ${card.isi ? `<p class="profil-kabar-isi">${escapeHTML(card.isi)}</p>` : ''}
      ${mediaHtml}
      <p class="profil-kabar-angka">
        <span>${angka(card.likes)} suka</span>
        <span>${angka(card.commentCount)} komentar</span>
        ${Number(card.reposts) ? `<span>${angka(card.reposts)} sebaran</span>` : ''}
        <a class="profil-kabar-taut" href="/feed.html">Buka feed</a>
      </p>
    </article>`;
  }

  function catatTautan(profil) {
    const tautan = profil.tautan || {};
    const chip = TAUTAN.filter((item) => tautan[item.key]);
    el.jaring.hidden = chip.length === 0;
    el.jaring.innerHTML = chip.map((item) => `<a class="profil-jaring-chip" href="${escapeHTML(tautan[item.key])}" rel="me nofollow noopener" target="_blank">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 13.4a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7l-1.5 1.5"/><path d="M13.4 10.6a4 4 0 0 0-5.7 0L4.9 13.4a4 4 0 1 0 5.7 5.7l1.5-1.5"/></svg>
      <span>${escapeHTML(item.label)}</span>
    </a>`).join('');
  }

  function catatProfil() {
    const data = state.data;
    if (!data) return;
    const profil = data.profil || {};
    const statistik = data.statistik || {};
    const punyaSesi = Boolean(tokenSaya());

    el.kartu.hidden = false;
    el.tabs.hidden = false;
    el.state.hidden = true;
    el.cariForm.hidden = !punyaSesi;

    document.title = `${profil.nama || 'Kader PII'} (@${profil.username || 'kader'}) — Profil Kader PB PII`;

    pasangFoto(el.avatarGambar, el.avatar, el.inisial, profil.nama, profil.avatar);
    pasangFoto(el.sampulGambar, el.sampul, null, profil.nama, profil.sampul);
    el.sampulGambar.alt = profil.sampul ? `Sampul profil ${profil.nama}` : '';

    el.nama.textContent = profil.nama || 'Kader PII';
    el.akun.hidden = !profil.username;
    el.akun.textContent = profil.username ? '@' + profil.username : '';
    el.bio.hidden = !profil.bio;
    el.bio.textContent = profil.bio || '';

    const jalur = profil.lembaga?.jalur || [];
    const atribut = [];
    if (profil.jenjang) {
      atribut.push(`<li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5 20 9l-8 4.5L4 9z"/><path d="M6.5 12v4.4c0 1.2 2.5 2.6 5.5 2.6s5.5-1.4 5.5-2.6V12"/></svg><span>${escapeHTML(profil.jenjang)}</span></li>`);
    }
    if (profil.lokasi) {
      atribut.push(`<li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s6.4-5.5 6.4-10.1A6.4 6.4 0 0 0 5.6 10.4C5.6 15 12 20.5 12 20.5Z"/><circle cx="12" cy="10.2" r="2.3"/></svg><span>${escapeHTML(profil.lokasi)}</span></li>`);
    }
    if (profil.lembaga?.nama) {
      atribut.push(`<li${jalur.length > 1 ? ` title="${escapeHTML(jalur.join(' › '))}"` : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 20V7.5h8V20M12.5 20v-8H20v8M7 10.5h1.6M7 14h1.6M15.5 14h1.6"/></svg>
        <span>${escapeHTML(profil.lembaga.nama)}</span></li>`);
    }
    if (profil.bergabung) {
      atribut.push(`<li><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="2.2"/><path d="M4 10h16M8.5 3.5v3.4M15.5 3.5v3.4"/></svg><span>Bergabung ${escapeHTML(tanggalPanjang(profil.bergabung))}</span></li>`);
    }
    el.atribut.innerHTML = atribut.join('');
    el.atribut.hidden = atribut.length === 0;

    catatTautan(profil);

    el.jumlahKabar.textContent = angka(statistik.kabar);
    el.jumlahPengikut.textContent = angka(statistik.pengikut);
    el.jumlahMengikuti.textContent = angka(statistik.mengikuti);

    const bolehIkuti = Boolean(data.kemampuan?.mengikuti) && Boolean(profil.username !== undefined);
    el.ikuti.hidden = !bolehIkuti;
    el.ikuti.textContent = data.hubungan?.diikuti ? 'Mengikuti' : 'Ikuti';
    el.ikuti.classList.toggle('is-on', Boolean(data.hubungan?.diikuti));
    el.ubah.hidden = !data.kemampuan?.mengelola;
    el.masuk.hidden = punyaSesi || Boolean(data.kemampuan?.mengelola);

    catatIsi();
  }

  function catatIsi() {
    if (state.tab === 'kabar') {
      const kabar = state.data?.kabar || [];
      el.daftar.innerHTML = kabar.map(kartuKabar).join('');
      el.kosong.hidden = kabar.length > 0;
      el.kosong.textContent = 'Kader ini belum menulis kabar apa pun di feed.';
      return;
    }
    const daftar = state.jaringan[state.tab];
    if (!daftar) {
      el.daftar.innerHTML = '<p class="profil-pesan">Memuat daftar…</p>';
      el.kosong.hidden = true;
      muatJaringan(state.tab);
      return;
    }
    el.daftar.innerHTML = daftar.map(barisOrang).join('');
    el.kosong.hidden = daftar.length > 0;
    el.kosong.textContent = state.tab === 'pengikut'
      ? 'Belum ada kader yang mengikuti profil ini.'
      : 'Kader ini belum mengikuti siapa pun.';
  }

  async function muatJaringan(jenis) {
    const profil = state.data?.profil;
    if (!profil) return;
    try {
      const data = await api({
        action: 'kaderJaringan',
        token: tokenSaya(),
        kaderId: profil.id,
        jenis
      });
      if (state.tab !== jenis) {
        state.jaringan[jenis] = data.hasil || [];
        return;
      }
      state.jaringan[jenis] = data.hasil || [];
      catatIsi();
    } catch (error) {
      state.jaringan[jenis] = null;
      el.daftar.innerHTML = `<p class="profil-pesan">${escapeHTML(error.message)}</p>`;
      el.kosong.hidden = true;
    }
  }

  /* ------------------------------------------------------------------ muat */

  function targetMuat() {
    const params = new URLSearchParams(location.search);
    const username = String(params.get('u') || params.get('username') || '').trim().toLowerCase().slice(0, 40);
    const id = String(params.get('kader') || params.get('id') || '').trim().slice(0, 64);
    if (id) return { kaderId: id };
    if (username) return { username };
    return {};
  }

  async function muat() {
    if (state.sedangMuat) return;
    state.sedangMuat = true;
    tampilkanKeadaan('');
    try {
      const data = await api({ action: 'kaderProfil', token: tokenSaya(), ...targetMuat() });
      state.data = data;
      state.jaringan = {};
      state.temuan = [];
      el.temuan.hidden = true;
      el.temuan.innerHTML = '';
      if (data.kemampuan?.mengelola) history.replaceState(null, '', '/profil.html');
      catatProfil();
    } catch (error) {
      el.kartu.hidden = true;
      el.tabs.hidden = true;
      el.daftar.innerHTML = '';
      el.kosong.hidden = true;
      el.cariForm.hidden = !tokenSaya();
      const hilang = /tidak ditemukan/i.test(String(error.message));
      tampilkanKeadaan(hilang
        ? 'Profil yang dicari belum ada. Coba cari kader lewat namanya di bawah ini.'
        : escapeHTML(error.message));
    } finally {
      state.sedangMuat = false;
    }
  }

  /* ------------------------------------------------------------------ tab */

  function aturTab(tab) {
    if (!['kabar', 'pengikut', 'mengikuti'].includes(tab)) tab = 'kabar';
    if (tab === state.tab) return;
    state.tab = tab;
    el.tabs.querySelectorAll('[data-tab]').forEach((button) => {
      const aktif = button.dataset.tab === tab;
      button.classList.toggle('is-active', aktif);
      button.setAttribute('aria-selected', String(aktif));
    });
    catatIsi();
  }

  el.tabs?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (button) aturTab(button.dataset.tab);
  });
  el.tabPengikut?.addEventListener('click', () => aturTab('pengikut'));
  el.tabMengikuti?.addEventListener('click', () => aturTab('mengikuti'));

  /* ------------------------------------------------------------------ ikuti */

  function pesanSementara(anchor, message) {
    const lama = document.querySelector('.profil-toast');
    lama?.remove();
    const box = document.createElement('span');
    box.className = 'profil-toast';
    box.setAttribute('role', 'status');
    box.textContent = message;
    anchor.insertAdjacentElement('afterend', box);
    setTimeout(() => box.remove(), 5200);
  }

  el.ikuti?.addEventListener('click', async () => {
    const kader = state.data?.profil;
    if (!kader) return;
    let akun;
    try {
      akun = await window.PBPIIAkun.requireAccount('Masuk sebagai kader untuk mengikuti kawan.');
    } catch {
      return;
    }
    if (!akun) return;
    el.ikuti.disabled = true;
    try {
      const data = await api({ action: 'feedFollow', token: akun.token || tokenSaya(), kaderId: kader.id });
      state.data.hubungan.diikuti = Boolean(data.mengikuti);
      const jumlah = Number(data.pengikut);
      state.data.statistik.pengikut = isFinite(jumlah) && jumlah >= 0
        ? jumlah
        : Math.max(0, (Number(state.data.statistik.pengikut) || 0) + (data.mengikuti ? 1 : -1));
      el.jumlahPengikut.textContent = angka(state.data.statistik.pengikut);
      el.ikuti.textContent = data.mengikuti ? 'Mengikuti' : 'Ikuti';
      el.ikuti.classList.toggle('is-on', Boolean(data.mengikuti));
      if (state.jaringan.pengikut) state.jaringan.pengikut = null;
    } catch (error) {
      pesanSementara(el.ikuti, error.message);
    } finally {
      el.ikuti.disabled = false;
    }
  });

  el.masukBuka?.addEventListener('click', () => window.PBPIIAkun?.openPanel?.());

  /* ------------------------------------------------------------------ cari */

  el.cariForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const kata = (el.cari.value || '').trim();
    if (kata.length < 2) {
      state.temuan = [];
      el.temuan.hidden = true;
      el.temuan.innerHTML = '';
      return;
    }
    el.temuan.hidden = false;
    el.temuan.innerHTML = '<p class="profil-pesan">Mencari kader…</p>';
    try {
      const data = await api({ action: 'kaderCari', token: tokenSaya(), kata: kata.slice(0, 40) });
      if (!data.kemampuan?.mencari) {
        el.temuan.innerHTML = '<p class="profil-pesan">Masuk sebagai kader untuk mencari kawan.</p>';
        return;
      }
      const hasil = data.hasil || [];
      el.temuan.innerHTML = hasil.length
        ? `<p class="profil-temuan-judul">Hasil pencarian</p>` + hasil.map(barisOrang).join('')
        : '<p class="profil-pesan">Belum ada kader dengan nama itu.</p>';
    } catch (error) {
      el.temuan.innerHTML = `<p class="profil-pesan">${escapeHTML(error.message)}</p>`;
    }
  });

  /* ------------------------------------------------------------------ edit */

  function catatan(message, ok) {
    el.catatan.textContent = message || '';
    el.catatan.hidden = !message;
    el.catatan.classList.toggle('is-ok', Boolean(ok));
  }

  function isiDialog() {
    const profil = state.data?.profil || {};
    state.avatar = profil.avatar || '';
    state.sampul = profil.sampul || '';
    el.namaInput.value = profil.nama || '';
    el.username.value = profil.username || '';
    el.bioInput.value = profil.bio || '';
    el.bioHitung.textContent = `${(profil.bio || '').length}/240`;
    el.lokasi.value = profil.lokasi || '';

    const jenjangList = state.data?.jenjang || [];
    el.jenjang.innerHTML = '<option value="">Belum dipilih</option>' + jenjangList
      .map((nilai) => `<option value="${escapeHTML(nilai)}">${escapeHTML(nilai)}</option>`).join('');
    el.jenjang.value = jenjangList.includes(profil.jenjang) ? profil.jenjang : '';

    const lembagaList = state.data?.lembaga_pilihan || [];
    el.lembaga.innerHTML = '<option value="">Belum terhubung</option>' + lembagaList
      .map((org) => `<option value="${escapeHTML(org.id)}">${escapeHTML(org.jalur || org.nama)}</option>`).join('');
    el.lembaga.value = lembagaList.some((org) => org.id === profil.lembaga?.id) ? profil.lembaga.id : '';

    TAUTAN.forEach((item) => { item.input.value = profil.tautan?.[item.key] || ''; });

    pasangFoto(el.avatarBesar, el.avatarBesar.parentElement, el.inisialDialog, profil.nama, state.avatar);
    el.hapusAvatar.hidden = !state.avatar;
    el.sampulTeks.hidden = Boolean(state.sampul);
    el.hapusSampul.hidden = !state.sampul;
    catatan('');
  }

  el.ubah?.addEventListener('click', () => {
    if (!state.data?.kemampuan?.mengelola) return;
    isiDialog();
    if (typeof el.dialog.showModal === 'function') el.dialog.showModal();
    else el.dialog.setAttribute('open', '');
  });

  function tutupDialog() {
    if (typeof el.dialog.close === 'function' && el.dialog.open) el.dialog.close();
    else el.dialog.removeAttribute('open');
  }
  el.tutup?.addEventListener('click', tutupDialog);
  el.batal?.addEventListener('click', tutupDialog);
  el.dialog?.addEventListener('click', (event) => { if (event.target === el.dialog) tutupDialog(); });

  el.bioInput?.addEventListener('input', () => {
    el.bioHitung.textContent = `${el.bioInput.value.length}/240`;
  });

  function bacaBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = () => reject(new Error('Berkas tidak dapat dibaca.'));
      reader.readAsDataURL(file);
    });
  }

  async function unggahGambar(file, bagian) {
    const batas = bagian === 'sampul' ? MAX_SAMPUL_BYTES : MAX_AVATAR_BYTES;
    if (file.size > batas) {
      catatan(`Foto terlalu besar. Kecilkan hingga di bawah ${Math.round(batas / 1024 / 1024)} MB.`);
      return;
    }
    const tombol = bagian === 'sampul' ? el.ambilSampul : el.ambilAvatar;
    tombol.disabled = true;
    catatan(bagian === 'sampul' ? 'Mengunggah sampul…' : 'Mengunggah foto…');
    try {
      const data = await bacaBase64(file);
      const hasil = await api({ action: 'kaderUnggah', token: tokenSaya(), bagian, name: file.name, data });
      if (bagian === 'sampul') {
        state.sampul = hasil.url;
        pasangFoto(el.sampulDialog, el.sampulDialog.parentElement, null, '', hasil.url);
        el.sampulTeks.hidden = true;
        el.hapusSampul.hidden = false;
      } else {
        state.avatar = hasil.url;
        pasangFoto(el.avatarBesar, el.avatarBesar.parentElement, el.inisialDialog, el.namaInput.value, hasil.url);
        el.hapusAvatar.hidden = false;
      }
      catatan('Foto siap disimpan. Tekan Simpan profil.', true);
    } catch (error) {
      catatan(error.message);
    } finally {
      tombol.disabled = false;
    }
  }

  el.ambilAvatar?.addEventListener('click', () => el.berkasAvatar.click());
  el.ambilSampul?.addEventListener('click', () => el.berkasSampul.click());
  el.berkasAvatar?.addEventListener('change', () => {
    const file = (el.berkasAvatar.files || [])[0];
    if (file) unggahGambar(file, 'avatar');
    el.berkasAvatar.value = '';
  });
  el.berkasSampul?.addEventListener('change', () => {
    const file = (el.berkasSampul.files || [])[0];
    if (file) unggahGambar(file, 'sampul');
    el.berkasSampul.value = '';
  });
  el.hapusAvatar?.addEventListener('click', () => {
    state.avatar = '';
    el.avatarBesar.hidden = true;
    el.avatarBesar.parentElement.classList.remove('ada-foto');
    el.hapusAvatar.hidden = true;
    catatan('Foto profil akan dihapus setelah Anda menyimpan.');
  });
  el.hapusSampul?.addEventListener('click', () => {
    state.sampul = '';
    el.sampulDialog.hidden = true;
    el.sampulDialog.parentElement.classList.remove('ada-foto');
    el.sampulTeks.hidden = false;
    el.hapusSampul.hidden = true;
    catatan('Sampul akan dihapus setelah Anda menyimpan.');
  });

  el.form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.data?.kemampuan?.mengelola) return;
    const tautan = {};
    TAUTAN.forEach((item) => {
      const nilai = (item.input.value || '').trim();
      if (nilai) tautan[item.key] = nilai;
    });
    const badan = {
      action: 'kaderProfilSimpan',
      token: tokenSaya(),
      nama: (el.namaInput.value || '').trim().slice(0, 90),
      username: (el.username.value || '').trim(),
      bio: (el.bioInput.value || '').trim().slice(0, 240),
      lokasi: (el.lokasi.value || '').trim().slice(0, 60),
      jenjang: el.jenjang.value || '',
      orgId: el.lembaga.value || '',
      tautan,
      avatar: state.avatar,
      sampul: state.sampul
    };

    el.simpan.disabled = true;
    el.simpan.textContent = 'Menyimpan…';
    catatan('');
    try {
      const data = await api(badan);
      state.data.profil = data.profil;
      state.data.statistik = { ...state.data.statistik, ...(data.statistik || {}) };
      catatProfil();
      window.PBPIIAkun?.refresh?.();
      tutupDialog();
    } catch (error) {
      catatan(error.message);
    } finally {
      el.simpan.disabled = false;
      el.simpan.textContent = 'Simpan profil';
    }
  });

  /* ------------------------------------------------------------------ mulai */

  function mulai() {
    const sesi = tokenSaya();
    if (sesi === state.sesiTerakhir && state.data) { catatProfil(); return; }
    state.sesiTerakhir = sesi;
    state.data = null;
    state.tab = 'kabar';
    state.jaringan = {};
    el.tabs?.querySelectorAll('[data-tab]').forEach((button) => {
      const aktif = button.dataset.tab === 'kabar';
      button.classList.toggle('is-active', aktif);
      button.setAttribute('aria-selected', String(aktif));
    });
    muat();
  }

  if (window.PBPIIAkun?.onChange) {
    window.PBPIIAkun.onChange(mulai);
  } else {
    mulai();
  }
})();
