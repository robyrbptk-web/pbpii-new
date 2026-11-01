# Website PB PII — starter

Fondasi website publik PB PII dengan artikel, sambutan Ketua Umum yang bisa diubah dari dashboard, serta galeri yang dapat dipilih admin. Frontend statis di Vercel, backend dan penyimpanan di Google Apps Script + Google Sheets.

## Catatan copywriting dan sumber

Salinan utama halaman depan merujuk berkas PII yang tersedia di Pustaka:
**Buku Panduan Kelembagaan (PII)** (hlm. 1–5) untuk sejarah, falsafah gerakan,
dan khittah perjuangan; serta **Ebook Ta’dib PII** (hlm. 6–9) untuk kaderisasi
dan tujuan pendidikan-kebudayaan PII. Nama dokumen dan halaman sumber
ditampilkan dekat salinan yang merujuknya.

Sambutan Ketua Umum dan bagian kabar/galeri adalah konten editorial atau
dinamis, bukan kutipan dari dua berkas tersebut. Sambutan Ketua Umum pada
starter ini adalah naskah editorial awal, bukan pernyataan resmi Ketua Umum,
dan `chairmanName` masih placeholder. Admin perlu menyunting dan menyetujuinya
sebelum dipublikasikan.

Sambutan Ketua Umum pada starter ini adalah naskah editorial awal, bukan kutipan atau pernyataan resmi Ketua Umum, dan `chairmanName` masih placeholder. Admin perlu menyunting dan menyetujuinya sebelum dipublikasikan. Nama, foto, periode, dan teks sambutan diubah dari dashboard.

Teks bawaan disimpan di sheet `Settings`. Saat `setup()` dijalankan, salinan
hero dan tentang yang masih persis sama dengan teks starter lama diperbarui
otomatis; nilai yang pernah disunting redaksi tetap dipertahankan. Untuk
menyisipkan kunci copywriting baru ke spreadsheet yang sudah jalan tanpa
menimpa hasil suntingan redaksi, jalankan **PB PII > Segarkan teks resmi
website** di menu spreadsheet (atau `segarkanTeksResmi(true)` dari Apps Script
untuk memaksa semua nilai kembali ke salinan resmi).

## A. Buat Google Sheets dan Apps Script
Jika spreadsheet dan Apps Script sudah dibuat sebelumnya, mulai dari langkah 2. Jangan membuat spreadsheet baru untuk database yang sudah berisi data.

1. Buka Google Spreadsheet yang dipakai website PB PII.
2. Pilih **Extensions > Apps Script**.
3. Di panel Files, buka `Code.gs`, ganti isinya dengan file `gas/Code.gs` dari folder proyek, lalu klik **Save**.
4. Buat file HTML: klik tanda **+** di sebelah Files > **HTML**, beri nama persis `AdminSetup`, lalu salin isi file `gas/AdminSetup.html` ke dalamnya. Klik **Save**.
5. Di dropdown fungsi pada toolbar Apps Script, pilih `setup`, lalu klik **Run**. Berikan izin Google yang diminta, termasuk akses Drive untuk foto dan lampiran surat. Fungsi ini membuat sheet yang belum ada dan menyiapkan username `admin`; tidak menghapus artikel atau data yang sudah tersimpan.
6. Kembali ke spreadsheet dan muat ulang halaman. Klik menu baru **PB PII > Atur akun admin**.
7. Masukkan password admin yang Anda inginkan dua kali di dialog, lalu klik **Simpan akun admin**. Password disimpan di Script Properties Google, bukan di file website.
8. Di Apps Script pilih **Deploy > Manage deployments**. Klik ikon pensil pada deployment Web App, pilih **New version**, lalu klik **Deploy**. Jika diminta, izinkan kembali akses yang diperlukan.
9. Gunakan URL deployment Web App yang berakhiran `/exec`. Cara paling aman mengambilnya: di spreadsheet pilih **PB PII > Salin URL backend (/exec)** — menu itu membaca `ScriptApp.getService().getUrl()` milik project ini, jadi tidak mungkin tertukar dengan project lain. Proxy proyek sudah memiliki URL Apps Script yang diberikan sebelumnya sebagai nilai bawaan.

Jika menu **PB PII** belum terlihat, pastikan kedua file sudah disimpan dan muat ulang spreadsheet. Langkah membuat/menyimpan akun cukup diulang dari langkah 6 jika ingin mengganti password.

### Memastikan website membaca project Apps Script yang benar

Backend satu-satunya dibaca dari satu tempat: `api/pii.js` memakai
`process.env.GAS_WEB_APP_URL` dan jatuh ke konstanta bawaan bila environment
variable belum diisi. Karena itu, memindahkan situs ke project lain (misalnya
"PB PII APP V2") cukup dilakukan di satu titik:

1. Di Apps Script project tujuan, pilih **Deploy > Manage deployments** dan salin
   URL `/exec` deployment Web App aktif. Bila dialog deployment sulit dibuka,
   jalankan **PB PII > Salin URL backend (/exec)** dari menu spreadsheet —
   nilainya berasal dari project itu sendiri.
2. Isi URL itu sebagai `GAS_WEB_APP_URL` di **Vercel > Project Settings >
   Environment Variables**, lalu redeploy. Alternatifnya, ganti nilai bawaan di
   baris `DEFAULT_GAS_WEB_APP_URL` pada `api/pii.js`.
3. Uji dengan `POST` `{action:"public"}` ke URL `/exec` (Node `fetch`; `curl`
   perlu `-L --post301 --post302`). Balasan `{ok:true,data:{settings,articles,…}}`
   membuktikan backend hidup; bandingkan isi `settings` dengan dashboard untuk
   memastikan project yang benar — sheet milik tiap project berbeda.
4. Kalau URL sudah benar tetapi datanya masih salinan lama, project itu belum
   dijalankan: urutkan langkah 1–5 pada bagian "Menyinkronkan deployment lama".

### Menyinkronkan deployment lama dengan kode terbaru

Sheet dan Script Properties bertahan di tempat, jadi menyalin `gas/Code.gs` saja
tidak mengubah konten yang sudah tersimpan. Urutan yang benar untuk deployment
yang sudah jalan:

1. Editor Apps Script > tempel isi `gas/Code.gs` terbaru ke `Code.gs` > **Save**.
2. Jalankan `setup` dari dropdown fungsi. Sheet baru (Orgs, Activities, Forms,
   Participants, Letters) dibuat, kolom yang kurang ditambahkan, dan artikel serta
   pengaturan lama tidak disentuh. `setup()` berakhir dengan laporan: daftar sheet
   yang dibuat, kolom yang ditambal, dan sheet yang perlu ditinjau manual karena
   susunan kolomnya berbeda dari skema (tidak pernah diubah otomatis).
3. **Deploy > Manage deployments** > pensil > **New version** > **Deploy**. Langkah
   ini yang paling sering terlewat: tanpa versi baru, `/exec` masih menjalankan
   kode lama sehingga fitur lembaga (daftar PW/PD/PK) menjawab "Sesi berakhir".
4. Bukti bahwa versi baru benar-benar melayani: buka URL `/exec` di browser, atau
   kirim `POST` `{action:"health"}`. Balasan memuat `version` (stamp di `Code.gs`,
   sekarang `2026-11-01.3`), `spreadsheetId`, jumlah baris tiap sheet, dan daftar
   `masalah`. Versi yang lebih lama dari stamp berarti langkah 3 belum selesai.
   Endpoint ini sengaja tidak mengembalikan kata sandi, token, maupun isi data.
5. Teks kop website: jalankan **PB PII > Ganti teks dengan salinan resmi** pada
   spreadsheet, atau **Segarkan teks resmi website** bila tidak ingin menimpa
   suntingan redaksi. Bedanya: yang pertama memaksa semua kunci kembali ke
   `DEFAULT_SETTINGS`, yang kedua melewati nilai yang sudah pernah diubah lewat
   dashboard.
6. Lupa password admin: **PB PII > Setel ulang password admin** membuat username
   `admin` dengan kata sandi acak baru yang hanya ditampilkan satu kali di layar
   Apps Script. Catat nilainya, lalu segera ganti lewat **PB PII > Atur akun
   admin**; repository publik tidak menyimpan kata sandi apa pun.

## B. Hubungkan ke Vercel
1. Import repository GitHub ke Vercel dan pilih branch `main`.
2. Pastikan **Root Directory** adalah root repository (`./`), bukan folder parent atau subfolder yang tidak memuat `index.html`.
3. Gunakan framework **Other** / tanpa framework, tanpa Build Command, dan jangan mengatur Output Directory ke `public`; halaman HTML berada di root repository. `vercel.json` memetakan `/` langsung ke `index.html` dan mempertahankan fungsi `api/pii.js`.
4. Proxy sudah memakai URL deployment yang diberikan sebagai nilai bawaan. Jika `GAS_WEB_APP_URL` sudah tersimpan di Vercel, nilainya harus sama dengan URL `/exec` terbaru; Environment Variable akan mengesampingkan URL bawaan.
5. Pilih **Deploy** atau **Redeploy** setelah commit terbaru berstatus tersedia. Tes `/`, `/login.html`, `/admin.html`, `/manifest.json`, dan login admin. Jika masih 404, periksa **Project Settings > Build and Deployment > Root Directory** menunjuk ke root repository dan tunggu deployment branch `main` selesai.
6. Fungsi di `api/` (proxy data untuk peta) ikut ter-deploy otomatis. Tambahkan `API_INDONESIA_KEY` di **Project Settings > Environment Variables** agar lapisan rumah sakit dan halte Transjakarta aktif; tanpa kunci, keduanya hanya menampilkan pesan belum diatur.

### Struktur proxy dan batas 12 fungsi Vercel Hobby

Paket Hobby menolak deployment dengan lebih dari 12 Serverless Functions, sementara
proyek ini punya 39 proxy. Karena itu hanya tiga berkas yang boleh berada di `api/`
— `[...path].js`, `pii.js`, `chat.js` — dan seluruh proxy data tinggal di
`proxies/`. `api/[...path].js` mengimpor semuanya secara statis (Vercel menelusuri
dependensi dari pernyataan `import`, jadi `import()` dinamis akan berujung
"Cannot find module" saat runtime) lalu mencocokkan path terhadap tabel `ROUTES`.

Menambah proxy baru: taruh berkasnya di `proxies/<path>`, tambahkan satu baris
`import` dan satu entri `['<path>/:nama', handler]` di `api/[...path].js`, lalu —
karena Vercel mengompilasi `[...path]` sebagai **satu segmen** — tambahkan rewrite
penurunan di `vercel.json`:

```json
{ "source": "/api/cctv/sources", "destination": "/api/_gw?r=cctv/sources" }
```

Router membaca `r` dan menyusun ulang `req.url` + `req.query` sehingga proxy yang
mengambil parameter sendiri dari URL tetap bekerja. Rute satu segmen
(`/api/sekolah`, `/api/opensky`) tidak perlu rewrite; `scripts/dev-server.mjs`
mengabaikan rewrite yang menuju `/api/`, jadi secara lokal kedua bentuk — path
langsung dan `/api/_gw?r=...` — dijamin memberi hasil yang sama.

### Instal sebagai aplikasi
- `manifest.json` memakai mode `standalone`, ikon 192/512 biasa dan 512 `maskable`, plus pintasan ke Ruang Ibadah, Peta, dan Dashboard. Semua halaman memuat `site.js` yang mendaftarkan service worker dan menampilkan tombol **Instal aplikasi** ketika browser mendukung.
- `sw.js` menyimpan app-shell (halaman, `styles.css`, `app.js`, `ibadah.js`, `site.js`, ikon, plus `assets/quran-surah.json` dan `assets/ibadah-kota.json`). Navigasi dan berkas JS/CSS selalu diambil dari jaringan lebih dulu agar pembaruan deploy langsung terpakai; gambar memakai cache lebih dulu. `/api/` dan `/peta/` tidak pernah di-cache. Jika jaringan putus, navigasi jatuh ke halaman `offline.html`.
- Buka website lewat HTTPS. Di Android/Chrome gunakan tombol **Instal aplikasi** saat tersedia atau menu browser **Install app / Add to Home screen**. Di iPhone/iPad, gunakan **Share > Add to Home Screen**.
- Konten API dan perubahan dashboard tidak disimpan offline; cache hanya untuk kerangka halaman/aset statis.
- Ikon dibuat dari `assets/logo-pii.png` dengan `node scripts/make-icons.mjs` (tanpa dependensi biner). Jalankan ulang setelah logo diganti, lalu naikkan `CACHE_NAME` di `sw.js` supaya pengunjung menerima versi baru.

### Mat tampilan mobile

Ukuran-ukuran ini sudah diukur pada lebar 390, 360, dan 320 px (bukan hanya
dilihat sekilas), dan harus tetap begitu saat ada fitur baru:

- Tidak ada gulir horizontal: `document.scrollWidth` sama dengan lebar viewport di
  ketiga lebar itu. Satu-satunya baris yang boleh melebar adalah kartu statistik
  beranda, yang memang sengaja bisa digeser (`scroll-snap`).
- Target sentuhan minimal 44 px: navigasi bawah (67 px + *safe area*), tombol
  **Baca selengkapnya**, tombol ✕/⤢ di pembaca artikel, **Putar adzan**, **Putar**
  murattal, kolom cari kota, dan tiap tautan section. Pengecualian: tautan yang
  menyatu dalam kalimat (`.office-address`) tetap inline supaya paragraf tidak
  bolong.
- Navigasi bawah tidak menutupi konten: `body` menyisakan 76 px dan bar memakai
  `env(safe-area-inset-bottom)`; pada layar kecil `backdrop-filter` hanya dipakai di
  dalam header yang tidak lagi menjadi containing block elemen tetap.
- Pembaca artikel memakai `100dvh` (tinggi visual yang sebenarnya, jadi tidak
  terpotong saat bar alamat HP hilang saat menggulir), isi bergulir sendiri dengan
  `overscroll-behavior: contain` sehingga halaman di belakangnya tidak ikut goyang,
  dan sampul dibatasi 32vh di HP agar judul tetap terlihat tanpa menggulir.
- Pemutar murattal **Al-Qur'an**: tombol surat penuh ada di bar pembaca layar penuh
  (`#quranSheetAudio`, 44 px) dan di kepala pembaca inline, bukan hanya per ayat.
  Satu objek `Audio` dipakai bersama, jadi memurattal surat tidak pernah bertabrakan
  dengan audio ayat; `audio.load()` sengaja tidak dipanggil karena di iOS pemanggilan
  ulang sumber di dalam rantai gestur membatalkan `play()` itu sendiri (gejalanya:
  tombol berkedip lalu kembali ke "Putar"). Bar pemutar menampilkan judul, posisi,
  durasi, dan geser posisi; ia berhenti sendiri saat surat ditutup atau diganti.
- Dashboard: tab bawah 5 kolom `minmax(0,1fr)` (label pendek, tidak pernah terpotong),
  form satu kolom, panel selebar kartu, dan input 16 px supaya Safari tidak
  melakukan zoom otomatis.
- Halaman ber-*style* sendiri (`admin.html`, `lembaga.html`, `daftar.html`,
  `login.html`, `formulir.html`) ikut diamati — tidak cukup hanya `styles.css`.
  Di sana: `input/select/textarea` 16 px pada ponsel, `.pass-toggle`/`.toggle`
  jadi 44 × 52 px, `.auth-links a`/`.foot a` 44 px, `.btn` 44 px, `.brand` 44 px,
  dan grid dua kolom ditulis `minmax(0,1fr)` supaya `<option>` nama provinsi yang
  panjang tidak pernah mendorong halaman ke gulir horizontal.
- `#jenjangSeg` di `daftar.html`: radio tersembunyi sekarang `inset:0` di dalam
  label yang `position:relative`. Sebelum ini, `width:100%` warisan dari aturan
  global membuat radio absolut menjulur keluar layar (+55 px gulir horizontal).
- **Tanya PII** tidak lagi memakai tombol melayang. Halaman utamanya
  (`index/acara/ibadah/tanya/peta.html`) memuat tab **Tanya** permanen di bar
  navigasi — di ponsel menjadi salah satu tab bawah, di layar lebar menjadi
  bagian menu atas — sehingga tidak ada lagi elemen tetap yang menutupi menu.
  Di `/tanya.html` komposer menempel di bawah dengan kolom input 16 px/48 px
  dan tombol kirim ≥44 px, serta naik setinggi papan ketik lewat
  `--tanya-keyboard`. Semua elemen `position:fixed` diuji: nol yang menutupi
  bar navigasi.
- 114 ringkasan "Tafsir" per ayat di `/ibadah.html`, tombol halaman di pembaca,
  dan tombol ikon di atas globe dinaikkan ke ≥44 px.
- Lantai huruf: tidak ada teks yang lebih kecil dari 11 px di ponsel, dan nyaris
  semuanya ≥11,5 px. Yang ikut dinaikkan: `tagline` header/footer (.74 rem),
  kapel "Menuju waktu sholat" (.72 rem), `.stats span`, `.install-app`, label
  `.eyebrow`/`.foot`/`.help code` di `login.html` (11→11,5 px), `.badge`/`.tab .count`
  dan `.side-label` di `lembaga.html` (10/9,5→11 px), `.seg small` + `.brand small`
  di `daftar.html`, serta `.hint`/`.chip`/`.stat span` di `admin.html`.
  Satu-satunya yang sengaja lebih kecil: nama sholat di strip beranda saat lebar
  ≤380 px (10,88 px, huruf kecil bukan kapital) — itu batas agar lima kolom tetap
  muat di 320 px tanpa terpotong.
- Aturan 380 px ditaruh paling akhir di `styles.css`. Blok `@media (max-width:680px)`
  berada setelahnya di file, jadi kalau blok kecil diletakkan sebelum, label waktu
  justru kembali membesar dan merusak lebar 320 px.
- Globe (`/peta/index.html`, source di repo `gods-eye-view`) punya blok
  `@media (max-width:720px)` sendiri: chip `OFF` lapisan 19→38 px, `.scene-btn`
  25→40, tombol ciutkan panel 22→38, tombol ikon atas 36→44, dan label teks di
  dalam dock (chip kota, nama lapisan, judul panel, mini-readout, UI suara)
  6–9→9–10,5 px. Angka pada gauge kokpit sengaja dibiarkan kecil karena
  geometrinya tetap. Ubah di `style.css` sana lalu `npm run build` dan salin
  `dist/` ke `peta/` — jangan mengedit berkas ber-hash di `peta/assets/`.
- Cara mengukur: `<iframe>` *same-origin* selebar 320/360/390 px dengan
  `scrolling="no"`. Tanpa `scrolling="no"`, scrollbar iframe 15 px membuat
  `clientWidth` lebih kecil daripada lebar CSS sehingga `body{min-width:320px}`
  terbaca sebagai overflow, padahal tidak.
- Pada perangkat sentuh, panel unggah foto menulis ulang petunjuknya menjadi
  "Ketuk untuk memilih dari galeri atau kamera" (`@media (hover:none) and (pointer:coarse)`).

Perlu diingat: perbesaran layar penuh browser (`requestFullscreen`) dipanggil pada
`document.documentElement`, bukan pada elemen `<dialog>` — Chrome menolak dialog
sebagai target layar penuh.

### Menjalankan semuanya secara lokal

`npm run dev:site` menjalankan `scripts/dev-server.mjs`: server Node tanpa dependensi yang
memakai aturan rute yang sama dengan `vercel.json` (rewrite dan header), menyajikan setiap
berkas di `api/` dan `proxies/` pada path yang sama seperti saat ter-deploy (`[id].js` → `/:id`), dan
membaca kunci dari `.env` / `.env.local` bila ada.

```bash
npm run dev:site      # http://127.0.0.1:4173
curl http://127.0.0.1:4173/api/__routes   # daftar rute yang sedang aktif
```

`vercel dev` (memerlukan Vercel CLI + login) tetap bisa dipakai; hasilnya harus sama.
Server statis biasa (Live Preview/http-server) TIDAK cukup untuk menguji fitur: tanpa
runtunan fungsi, semua `/api/*` akan membalas `Cannot GET`.

### Membuka project ini di VSCode

Buka **folder `pbpii-web` ini** sebagai workspace (File ▸ Open Folder), bukan
`pbpii-website-starter` dan bukan `pbpii-app`. Alasannya teknis: semua halaman
memakai path absolut (`/assets/logo-pii.png`, `/styles.css`), sedangkan Live
Server menjadikan *akar workspace* sebagai akar dokumen. Kalau yang dibuka folder
induk, `/assets/logo-pii.png` dicari di luar project, logo dan CSS 404, dan
halaman tampak kosong meskipun kodenya baik. Isi `.vscode/` sudah menyesuaikan
itu, dan folder `pbpii-app` ikut diberi `.vscode` penyelamat untuk kasus terlanjur
dibuka.

Setelah folder yang benar terbuka, tidak perlu mengetik apa pun:

| Tekan | Hasil |
| --- | --- |
| `Ctrl`+`Shift`+`B` | menjalankan `npm run dev:site` (task default) di `http://127.0.0.1:4173` dan biarkan berjalan di panel Terminal |
| `F5` | menjalankan task itu lebih dulu, lalu membuka Chrome/Edge dengan dev server; debugger melekat ke `app.js`, `ibadah.js`, `tanya.js` |
| `Ctrl`+`Shift`+`P` ▸ Run Task ▸ **Cek backend Apps Script** | `npm run check:backend` |

Tombol **Open with Live Server** tetap ada dan tidak merusak apa pun, tapi hanya
cocok untuk melihat tampilan statis: ia tidak menjalankan `api/*.js`, jadi berita,
pengaturan, login, dan Tanya PII tidak akan pernah terisi.

`scripts/check-backend.mjs` membandingkan `BACKEND_VERSION` di `gas/Code.gs`
dengan versi yang benar-benar dijawab `/exec` (lewat Apps Script langsung dan
lewat proxy lokal). Balasan `"Sesi berakhir atau token tidak valid."` untuk aksi
`health` adalah sidik jari deployment lama: aksi itu belum ada sehingga `doPost`
jatuh ke `requireAuth_`. Keluaran prosesnya `1` selama belum ada backend yang
cocok, jadi checker ini bisa dipakai sebagai gerbang sebelum klaim "sudah deploy".

**Jangan pernah commit/push dari folder `pbpii-app`.** Folder itu diam-diam juga
repository Git dengan `origin` yang sama (`pbpii-new`) tetapi hanya melacak
`pbpii-website-starter.zip` dan `pbpii-web` sebagai *gitlink* (entri `160000`),
bukan sebagai isi project. Mendorongnya ke `main` akan membuat Vercel meng-clone
repository yang folder `pbpii-web`-nya kosong — situs hidup tanpa satu berkas pun.
Yang benar adalah repository di dalam `pbpii-web` (`.git` milik sendiri);
`git rev-parse --show-toplevel` dari folder itu harus mengembalikan
`…/pbpii-website-starter/pbpii-web`. Pengaturan `git.autoRepositoryDetection` di
`.vscode` membuat panel Source Control memakai repository dalam `pbpii-web` saja.

## C. Fitur yang ada
- Halaman depan responsif untuk desktop, tablet, dan HP; pada layar kecil memakai navigasi bawah bergaya aplikasi.
- Artikel: tambah, edit, hapus, draft/published, kategori, ringkasan, isi rich-text (tautan, heading, daftar, kutipan, jenis/ukuran huruf, dan gambar inline), sampul, serta metadata SEO dan pratinjau hasil pencarian. HTML disaring di browser dan backend sebelum ditampilkan. Pembaca mendukung tautan artikel yang dapat dibagikan dan tetap aman untuk konten lama berbentuk teks biasa.
- Pengaturan: judul dan teks hero, nama/jabatan/foto Ketua Umum (foto bisa diunggah), sambutan, tampil/sembunyikan sambutan, profil ringkas, footer, email, dan tautan media sosial.
- Galeri: tambah, edit, hapus, urutan, caption, tampil/sembunyikan, dengan unggah foto langsung.
- Login admin dan lembaga dengan token sesi persisten di sheet `Sessions` (bukan lagi `CacheService`, yang diam-diam memotong umur token menjadi 10 menit).
- **Peta Global (PII Global View)** di `/peta.html`: globe interaktif berisi satelit, gunung berapi, sekolah, rumah sakit, halte Transjakarta, penerbangan, dan kamera CCTV Dishub Jakarta, Bandung, Tasikmalaya, serta Kabupaten Bandung, ditambah ringkasan angka langsung di beranda.
- **Ruang Ibadah** di `/ibadah.html`: jadwal sholat Kemenag untuk 517 kabupaten/kota (bisa dicari dan disimpan di perangkat), deteksi lokasi otomatis untuk pengunjung dari daerah mana pun, hitung mundur waktu sholat berikutnya, **adzan otomatis** (berbunyi sendiri saat waktunya tiba tanpa menekan apa pun; ada sakelar untuk mematikannya di halaman itu dan pilihannya tersimpan di perangkat), arah kiblat, tanggal Hijriah, serta pembaca Al-Qur'an 114 surat dengan terjemahan, tafsir ringkas, dan murattal. Beranda menampilkan ringkasan jadwal hari ini dan ikut memutar adzan selama halaman terbuka. **Semuanya tampil sejak halaman baru dibuka**: jadwal terakhir hari itu dibaca dari penyimpanan perangkat, daftar surat dan daftar kota ikut terbundel di aplikasi, dan jaringan hanya dipakai memperbarui di latar belakang (lihat bagian E).
- Dashboard admin: ringkasan angka, pencarian dan saringan artikel, penerbitan/penarikan artikel sekali klik, notifikasi ringkas, serta panel bantuan yang menjelaskan lokasi database dan cara memulihkan akun admin.

### Unggah foto dari dashboard (tanpa link)

Sampul artikel, foto Ketua Umum, dan foto galeri bisa langsung diunggah dari
`/admin.html` — tidak perlu menyalin link dari Google Drive lagi. Alurnya:

1. Foto dipilih atau diseret ke panel unggah, lalu **dikecilkan di browser**
   (sisi terpanjang 1600 px, JPEG kualitas 0,82, latar putih untuk PNG transparan),
   sehingga kiriman hanya ±150–300 KB dan aman untuk koneksi HP.
2. Berkas dikirim dengan aksi `uploadImage` ke Apps Script melalui `/api/pii`.
3. Apps Script menyimpannya di folder Drive **PB PII Media** (dibuat otomatis saat
   `setup()`, ID-nya tersimpan di Script Properties sebagai `MEDIA_FOLDER_ID`),
   membagikannya *anyone with link*, dan mengembalikan
   `https://lh3.googleusercontent.com/d/<id>=w1600`.
4. URL itu masuk ke kolom `coverImage` / `imageUrl` yang sudah ada — jadi **tidak
   ada perubahan struktur sheet** dan artikel lama tetap jalan.

Butuh backend dengan aksi `uploadImage`. Berkas gambar yang didukung browser
diperkecil dan dikonversi ke JPEG sebelum dikirim; ukuran berkas asli maksimal
25 MB dan hasil konversi maksimal 2,5 MB. Backend memeriksa tanda tangan byte
JPEG/PNG/WebP, bukan nama berkas.

Lampiran surat memakai folder Drive **PB PII Surat** yang tidak dibagikan lewat
tautan publik. Akses melalui `orgReadLetterAttachment` memeriksa bahwa sesi
lembaga adalah pengirim atau penerima surat terkait; jangan mengubah folder ini
menjadi *anyone with link*.
- **Tanya PII** — halaman chat penuh di `/tanya.html`, dengan tombol mengambang di beranda, Ruang Ibadah, Acara, dashboard admin, dashboard lembaga, dan formulir sebagai pintunya. Bisa dipakai tanpa login (jatah 5 pertanyaan per alamat IP per hari); kader yang masuk mendapat 20. Lihat bagian H.
- **Akun kader** — dialog **Masuk kader** di kop semua halaman menawarkan tiga jalur: Google (kalau `googleClientId` diisi), email + kata sandi, dan pendaftaran baru dengan captcha. Lihat bagian I.
- **Akun lembaga** di `/daftar.html` dan `/lembaga.html`: pendaftaran PW/PD/PK dengan pilihan provinsi/kota/kecamatan resmi dari wilayah.id, verifikasi bertingkat (PB→PW→PD→PK) dengan override admin, kegiatan + Indeks Keaktifan, formulir peserta publik di `/formulir.html`, dan surat berkategori antarlebaga (lihat bagian G).

### Surat lembaga dan lampiran PDF

Surat lembaga mendukung percakapan berutas: penerima dapat membalas pengirim
surat yang sama, dengan tujuan dan kategori dikunci mengikuti surat asal.
Isi surat dapat diformat, diberi tautan dan gambar inline; gambar disimpan
privat bersama lampiran, bukan memakai URL foto publik. Lampiran PDF dibatasi
2,5 MB, divalidasi di backend, dan hanya dapat dibuka oleh pengirim atau
penerima setelah sesi lembaga terautentikasi. Dashboard menampilkan pratinjau
PDF di dalam aplikasi serta tautan unduh Blob sementara; tidak ada tautan Drive
publik yang dibagikan. Menjalankan `setup()` dan menerbitkan versi Apps Script
baru diperlukan agar izin Drive serta endpoint surat terbaru aktif.

## D. Peta Global (PII Global View)

Peta adalah fitur dari website ini, bukan aplikasi terpisah. Halaman `/peta.html`
memakai header dan navigasi PB PII, lalu menampilkan globe di dalam bingkai yang
sudah dapat dipakai penuh tanpa menekan layar penuh: bar judul hanya setinggi
satu baris (ikon `⛶` membuka `/peta/index.html` di tab baru untuk yang
benar-benar ingin layar penuh), branding ganda di dalam iframe disembunyikan, dan pada layar kecil
bingkai melebar sampai ±660 px serta halaman bisa digulir, sehingga panel CCTV,
pemilih kamera, dan ringkasan tetap terjangkau. Tombol **?** di bar judul
menampilkan kartu pendek cara memakai lapisan peta.

Bingkai globe memeriksa sendiri apakah aplikasi benar-benar termuat (ada canvas
Cesium). Bila pemuatan gagal, panel "Globe belum dapat dimuat" muncul dengan
tombol muat ulang dan tautan layar penuh; selama aset masih diunduh panel itu
tidak muncul lebih dulu, jadi kegagalan sementara tidak menyisakan bingkai kosong.

Di ponsel (pointer kasar dan sisi terpendek < 620 px) halaman menampilkan
pemberitahuan bahwa PII Global View dirancang untuk PC/laptop — citra satelit,
penerbangan, dan CCTV memberatkan layar dan kuota ponsel. Pengunjung tetap bisa
memilih **Tetap buka globe**; pilihan itu disimpan di perangkat (`localStorage`)
sehingga tidak ditanyakan lagi.

Struktur:

- `peta/` — hasil build aplikasi globe (Vite + CesiumJS). Semua aset memakai
  path relatif, jadi folder ini bisa disajikan dari subpath mana pun.
- `proxies/**.js` — proxy serverless (sekolah, gunung api, `indonesia/*`, celestrak,
  muslim, cctv, dan seterusnya), dilayani `api/[...path].js` supaya paket Hobby
  tidak kehabisan jatah fungsi. Semua lapisan peta memanggil API data dari domain
  yang sama lewat sana (tanpa CORS, tanpa kunci di browser).
- `lib/` — cache TTL dan helper yang dipakai proxy tersebut.

Proxy yang tersedia:

| Endpoint | Sumber | Kunci |
| --- | --- | --- |
| `/api/sekolah` | api-sekolah (sampel 38 provinsi) | tidak perlu |
| `/api/volcanoes` | indonesia-public-static-api | tidak perlu |
| `/api/celestrak/:group` | CelesTrak TLE | tidak perlu |
| `/api/indonesia/hospitals` | API Indonesia | `API_INDONESIA_KEY` |
| `/api/indonesia/transjakarta` | API Indonesia | `API_INDONESIA_KEY` |
| `/api/muslim/jadwal?id=` | API Muslim (Kemenag RI) | tidak perlu |
| `/api/muslim/kota?q=` | API Muslim (517 kab/kota) | tidak perlu |
| `/api/muslim/quran?nomor=&page=&limit=` | API Muslim (114 surat) | tidak perlu |
| `/api/muslim/qibla?lat=&lon=` | API Muslim | tidak perlu |
| `/api/muslim/kalender` | API Muslim (Hijriah) | tidak perlu |
| `/api/cctv/sources` | Dishub DKI Jakarta + ATCS Bandung/Tasikmalaya/Kab. Bandung | tidak perlu |
| `/api/cctv/health` | hasil pencocokan registry di `/api/cctv/sources` | tidak perlu |
| `/api/cctv/frame/:id` | citra statis kamera yang memilikinya | tidak perlu |
| `/api/cctv/media/:id` (bisa `?seg=`) | HLS playlist + segmen ATCS | tidak perlu |
| `/api/opensky` (bisa `?bbox=`) + `/api/opensky-track?icao24=` | OpenSky Network | tidak perlu; `OPENSKY_*` hanya memperbesar kuota harian |
| `/api/adsblol/mil` + `/api/adsblol/trace?hex=` | adsbd.io (pesawat militer) | tidak perlu |
| `/api/adsbdb/route/:callsign` + `/api/adsbdb/type/:icao24` | adsBDB (rute & tipe pesawat) | tidak perlu |
| `/api/terrain/heights?points=lon,lat;...` | Open Elevation | tidak perlu |
| `/api/overpass` (POST `data=`) | mirror Overpass API dengan giliran otomatis | tidak perlu |
| `/api/geocode/json?address=` atau `?latlng=` | Open-Meteo Geocoding + Nominatim, dibentuk seperti respons Google | tidak perlu |
| `/api/route?profile=&coords=` | OSRM publik (FOSSGIS) | tidak perlu |
| `/api/weather-effects?latitude=&longitude=` | Open-Meteo | tidak perlu |
| `/api/regional-brief?latitude=&longitude=` | cuaca + geocoding + ringkasan berita untuk satu titik | tidak perlu |
| `/api/radio/stations` + `/api/radio/click/:uuid` | direktori Radio Browser | tidak perlu |
| `/api/gbfs/:urlFeedTersandi` | umpan GBFS sepeda sharing (daftar host dibatasi) | tidak perlu |
| `/api/firms` | NASA FIRMS (titik api) | `FIRMS_MAP_KEY` — tanpa kunci mengembalikan 503 `no_key` dan lapisan menampilkan peringatan |
| `/api/tomtom/status` + `/api/tomtom/flow/:z/:x/:y.pbf` | TomTom Traffic (ubin vektor) | `TOMTOM_API_KEY` — tanpa kunci 501 dengan pesan jelas |
| `/api/openai/hud-summary` (POST) | ringkasan HUD berbasis model | `OPENAI_API_KEY` |
| `/api/launches` | The Space Dev (peluncuran roket) | tidak perlu |
| `/api/military-installations?bbox=` | daftar instalasi militer publik | tidak perlu |
| `/api/celestrak/:group` | juga tersedia sebagai jalur, bukan hanya `?group=` | tidak perlu |
| `/api/setup/status` | daftar kunci provider yang dikenal | tidak perlu |

Dua hal yang sengaja tidak bisa disajikan sebagai fungsi serverless dan karena
itu dijawab **501 JSON** (bukan halaman "Cannot GET" dari platform), sehingga
panel globe menulis alasannya alih-alih tampak kosong:

- `/api/ais-live` dan `/api/ais-live/track` — layer kapal berjalan lewat
  WebSocket AISStream, yang menuntut koneksi panjang dan `AISSTREAM_TOKEN`.
- `/api/google/*` dan `/api/realtime*` — Google Places berbayar, dan lapisan
  realtime butuh layanan WebSocket/Redis sendiri.

### Kamera pengawas (CCTV)

Registry dibangun di `lib/cctv.js` dan dipakai keempat route `/api/cctv/*`.
Sumber diambil dari empat packs publik, digabung lalu dibatasi per pack
(dekat anchor kota masing-masing) supaya payload awal tetap terkendali:

| Pack | Sumber | Isi | Jangkauan |
| --- | --- | --- | --- |
| `jakarta-dishub` | dataset [lakuapik/cctv-jakarta](https://github.com/lakuapik/cctv-jakarta) | ±746 titik kamera Dishub DKI Jakarta, disajikan 400 | lokasi saja |
| `bandung-city-cctv` | `pelindung.bandung.go.id:8443/api/cek` | ±425 stream HLS, disajikan 250 | video (host stream `:3443`) |
| `tasikmalaya-atcs` | `atcs.tasikmalayakota.go.id` | 29 stream HLS | video |
| `bandungkab-dishub` | `dishub.bandungkab.go.id/cctv/` | baris HLS bertoken | video |

- **Pack Jakarta sengaja tidak punya URL stream.** Dataset hanya memuat halaman
  embed di `cctv.balitower.co.id` yang tidak menjawab dari luar jaringan Dishub,
  jadi kamera didaftarkan sebagai lokasi (`url: ''`). Peta menampilkan pin dan
  menuliskan "Tanpa stream" daripada berpura-pura ada siaran. `/api/cctv/health`
  melaporkan status ini apa adanya.
- Koordinat divalidasi dalam box Indonesia dan 11 baris dataset yang tertukar
  lat/lon-nya dibetulkan sebelum dipakai.
- Nama kamera dibuat dari slug stream (`Bambu-Apus-001-MP-601170_2` →
  "Bambu Apus"), dan tiap stream dihitung satu kamera.
- `/api/cctv/media/:id` hanya mengambil dua URL: playlist yang tersimpan di
  registry, dan referensi `?seg=` yang asalnya dari playlist itu serta tetap di
  origin yang sama. Host tidak pernah diambil dari request, jadi route ini bukan
  open proxy. Playlist ditulis ulang agar HLS.js selalu lewat proxy.
- Batas per pack bisa diubah lewat Environment Variables Vercel
  `CCTV_JAKARTA_MAX_SOURCES`, `CCTV_BANDUNG_CITY_MAX_SOURCES`,
  `CCTV_TASIK_MAX_SOURCES`, `CCTV_BANDUNGKAB_MAX_SOURCES` (8–600).
- Lapisan CCTV tidak aktif saat globe pertama dibuka; nyalakan lewat tombol
  **CCTV** pada panel peta. Registry di-cache enam jam per instance fungsi.

Lapisan peta lain (FIRMS, Google Places, ringkasan AI, penerbangan) tetap
membutuhkan proxy dan kunci dari aplikasi globe aslinya; bila kunci belum ada,
lapisan itu menampilkan pesan tidak tersedia dan sisa peta tetap berjalan.

Globe membuka kamera ke Sekretariat PB PII (Jl. Menteng Raya No. 58, Kebon
Sirih, Menteng, Jakarta Pusat) saat pertama dimuat. Penanda lokasi memakai
koordinat `-6.1844917, 106.8344897`; klik penanda atau kartunya membuka Google
Maps. Sekolah dan gunung berapi aktif secara bawaan karena tidak butuh kunci.

### Memperbarui peta

```bash
# di repo gods-eye-view
npm run build
# salin dist/ menjadi peta/ di repo ini
rm -rf peta && cp -r dist peta
```

Kunci `API_INDONESIA_KEY` diisi di Environment Variables Vercel (atau `.env`
untuk `vercel dev`). Kunci tidak pernah dikirim ke browser; proxy menambahkannya
di sisi server. Lihat `.env.example`.

## E. Ruang Ibadah

`/ibadah.html` memakai API Muslim (api.myquran.com/v3) yang tidak memerlukan
kunci. Proxy di `api/muslim/` menyimpan hasilnya di cache: jadwal sholat 1 jam,
daftar kabupaten/kota 7 hari, daftar surat dan ayat 30 hari, arah kiblat 30 hari,
tanggal Hijriah 1 jam. Dengan begitu satu instance hangat melayani banyak
pengunjung tanpa membanjiri API publik.

**Tampil instan sejak halaman dibuka.** Di samping cache server, halaman memakai
tiga lapisan di sisi pengunjung:

- `assets/quran-surah.json` (114 surat) dan `assets/ibadah-kota.json` (517 kota)
  ikut terbundel dalam aplikasi dan ikut di-*precache* service worker, jadi daftar
  surat dan pencarian kota tidak menunggu jaringan sama sekali. Regenerasi bila
  data resmi berubah: jalankan `npm run dev`, lalu
  `node scripts/make-ibadah-static.mjs`.
- Jadwal terakhir hari itu disimpan di `localStorage`
  (`pbpii:ibadah-cache:v1:jadwal:<id kota>`). Saat halaman dibuka, jadwal itu yang
  dilukis lebih dulu sehingga hitung mundur langsung berjalan; permintaan jaringan
  berikutnya hanya menyegarkan angka. Cache dibuang kalau `dayKey`-nya sudah bukan
  hari ini di zona kota tersebut.
- Ayat yang pernah dibuka disimpan per surat+halaman
  (`pbpii:ibadah-cache:v1:quran:<surah>:<halaman>`, indeks LRU maksimal 30 entri
  dan otomatis membersihkan yang terlama kalau kuota penyimpanan penuh). Membuka
  kembali Al-Kahf, misalnya, tidak lagi memanggil API sama sekali.

Berkas audio adzan disiapkan begitu halaman dibuka (bukan saat waktunya tiba),
dan sentuhan pertama di halaman dipakai untuk membuka izin suara, jadi adzan bisa
berbunyi sendiri tanpa tombol yang perlu ditekan.

- Jadwal yang dikirim API sudah berupa waktu setempat untuk kota tersebut; zona
  WIB/WITA/WIT di layar diturunkan dari nama provinsi, dan hitung mundur dihitung
  memakai jam kota itu, bukan jam perangkat.
- **Lokasi otomatis:** bawaan template adalah Kota Jakarta. Saat pengunjung
  pertama kali membuka halaman, alamat IP-nya dipetakan ke kabupaten/kota lewat
  BigDataCloud (`api.bigdatacloud.net`) dengan cadangan `ipwho.is` — keduanya
  tanpa kunci. Nama kota/kecamatan dicocokkan ke daftar 517 kab/kota, lalu
  jadwal dimuat untuk kota itu. Bila nama tidak dikenali, dipakai ibu kota
  provinsi; bila provinsi juga tidak dikenali, kembali ke Jakarta. Tombol
  **Deteksi lokasi saya** meminta izin geolocation untuk hasil yang lebih tepat.
- Pilihan kota, sumber lokasi (`manual`/`auto`/`device`), waktu deteksi, surat
  terakhir, dan status adzan disimpan di `localStorage`
  (`pbpii:ibadah-city`, `pbpii:ibadah-city-source`, `pbpii:ibadah-city-at`,
  `pbpii:ibadah-surah`, `pbpii:ibadah-adzan`). Pilihan manual selalu menang dan
  tidak ditimpa; deteksi otomatis diperbarui paling sering sekali per 7 hari.
  Tidak ada koordinat yang dikirim ke server PB PII — pencarian lokasi terjadi
  di browser dan ke layanan geolokasi publik tadi.
- Berkas adzan berasal dari islamcan.com. Browser memblokir audio otomatis
  sebelum ada interaksi, jadi pengunjung perlu menekan **Putar adzan** sekali;
  setelah itu bunyi otomatis pada Subuh, Dzuhur, Ashar, Maghrib, dan Isya aktif
  selama tab terbuka.
- Arah kiblat bawaannya dihitung dari Sekretariat PB PII; tombol **Gunakan
  lokasi saya** memakai geolocation (perlu HTTPS atau `localhost`).


## F. Lokasi database dan pemulihan akun admin

Semua konten website tidak disimpan di repository ini dan tidak di Vercel. Data
berada di **satu Google Spreadsheet** yang terhubung ke Apps Script:

| Yang dicari | Di mana |
| --- | --- |
| Artikel | Spreadsheet → sheet `Articles` |
| Sambutan, hero, kontak, footer | Spreadsheet → sheet `Settings` |
| Foto galeri | Spreadsheet → sheet `Gallery` |
| Akun lembaga PW/PD/PK | Spreadsheet → sheet `Orgs` |
| Kegiatan lembaga | Spreadsheet → sheet `Activities` |
| Formulir pendaftaran | Spreadsheet → sheet `Forms` |
| Data peserta | Spreadsheet → sheet `Participants` |
| Surat antarlebaga | Spreadsheet → sheet `Letters` |
| ID spreadsheet | Apps Script → **Project Settings → Script Properties → `SPREADSHEET_ID`** |
| Username admin | Script Properties → `ADMIN_USERNAME` (bawaan `admin`) |
| Password admin | Script Properties → `ADMIN_PASSWORD` (tersimpan di akun Google, bukan di repo) |
| URL backend | Environment Variable `GAS_WEB_APP_URL` di Vercel (opsional; ada nilai bawaan di `api/pii.js`) |

Jika lupa spreadsheet-nya: buka Google Drive dan cari berkas dengan nama yang
dipakai saat membuat database, atau buka Apps Script yang pernah dipakai lalu
lihat properti `SPREADSHEET_ID`. Membuka URL itu (`docs.google.com/spreadsheets/d/<ID>/edit`)
langsung menuju database. Jangan membuat spreadsheet baru, karena website akan
membaca berkas lama.

Jika lupa password: buka spreadsheet → menu **PB PII → Atur akun admin** → isi
password baru dua kali. Bila menu belum muncul, jalankan `setup()` pada editor
Apps Script lalu muat ulang spreadsheet. Bila password benar-benar tidak
diketahui, jalankan `aturUlangPasswordAdmin()` di editor Apps Script (atau menu
**PB PII → Setel ulang password admin**): server membuat kata sandi acak baru dan
menampilkannya satu kali di editor — catat, lalu segera ganti lewat menu. Tidak ada
kata sandi yang tertulis di repository. Username tetap `admin` kecuali diubah manual
di Script Properties. Halaman `/login.html` hanya memuat ringkasan singkat untuk
pengurus; langkah operasional lengkapnya ada di README ini, bukan di situs publik.

Tombol **Periksa koneksi data** pada dashboard memanggil endpoint publik dan
menampilkan jumlah artikel terbit/galeri, sehingga bisa dipakai memastikan
frontend masih tersambung ke Apps Script sebelum menyalahkan akun.

## G. Akun lembaga, verifikasi bertingkat, KPI, formulir, dan surat

Selain akun admin website, setiap jenjang organisasi punya **satu akun resmi**
(email + kata sandi per lembaga) yang dipakai untuk mengunggah kegiatan,
membuat formulir peserta, dan berkirim surat.

### Jenjang dan induk otomatis
| Jenjang | Wilayah | Induk (parentId) |
| --- | --- | --- |
| PB | Nasional | — (akar, dibuat `setup()`) |
| PW | Provinsi | PB PII |
| PD | Kota/Kabupaten | PW provinsi yang sama dan sudah terverifikasi |
| PK | Kecamatan | PD kota/kabupaten yang sama dan sudah terverifikasi |

Jalankan ulang `setup()` di Apps Script setelah memperbarui kode untuk membuat
sheet `Orgs`, `Activities`, `Forms`, `Participants`, `Letters`, dan baris akar PB.

Pendaftaran terbuka di `/daftar.html`. Induk ditentukan otomatis dari provinsi
dan kota/kabupaten; pendaftaran PD/PK ditolak bila induknya belum terverifikasi,
dengan pesan yang menjelaskan langkah berikutnya. Data disimpan sebagai baris
datar `id` + `parentId` di sheet `Orgs` supaya mudah dipindahkan ke Supabase
nanti (tanpa mengubah bentuk relasi).

### Data wilayah resmi
Pilihan provinsi → kota/kabupaten → kecamatan diambil dari **wilayah.id**
(`https://wilayah.id/api/provinces.json`, `regencies/<kode provinsi>.json`,
`districts/<kode kota>.json`). Data ini tidak mengirim header CORS, jadi browser
memanggil proxy serverless [`api/wilayah.js`](api/wilayah.js) —
`/api/wilayah?level=provinces|regencies|districts&parent=<kode>`. Proxy
memvalidasi format kode (`11`, `32.73`), men-cache respons sehari di CDN, dan
mengembalikan `{ ok, level, parent, data: [{ code, name }] }`.

- Nama provinsi di data resmi sedikit berbeda dari daftar bawaan backend
  (`Daerah Istimewa Yogyakarta` vs `DI Yogyakarta`, `Kepulauan Bangka Belitung`
  vs `Bangka Belitung`). Keduanya dipetakan lewat `PROVINCE_ALIASES` di
  `gas/Code.gs` dan `PROVINCE_ALIAS` di `daftar.html`, sehingga induk tetap
  ditemukan dengan benar.
- Kode wilayah dipakai hanya untuk mengambil daftar; yang dikirim ke backend
  tetap nama wilayah, jadi tidak ada perubahan skema sheet.
- Bila wilayah.id tidak dapat dihubungi, halaman otomatis memakai daftar
  provinsi dari `orgLookup` dan mengganti pilihan kota/kecamatan menjadi kolom
  teks, dengan petunjuk di bawah formulir. Pendaftaran tetap dapat dikirim.
- Daftar kecamatan baru dimuat setelah kota/kabupaten dipilih; pilihan PD pada
  mode PK berasal dari PD terverifikasi di provinsi tersebut.

### Verifikasi bertingkat + override PB
- PB memverifikasi PW, PW memverifikasi PD, PD memverifikasi PK.
- Dashboard admin (`/admin.html` → tab **Lembaga**) dapat memverifikasi atau
  menolak semua jenjang sebagai override, serta mengatur email/kata sandi akun PB.
- Verifikasi bisa dicabut (status kembali `pending`); akun tetap bisa masuk
  tetapi tidak dihitung sebagai lembaga resmi.
- Kata sandi lembaga di-hash SHA-256 dengan salt unik dan 250 iterasi; token sesi
  (6 jam) disimpan di `CacheService`, bukan di spreadsheet.

### Kegiatan dan Indeks Keaktifan (KPI)
Kegiatan yang berstatus **terbit** menjadi dasar KPI:

```
skor = bulat(100 × (0.5 × min(1, kegiatan30/4)
                  + 0.3 × min(1, peserta90/100)
                  + 0.2 × min(1, formulir90/2)))
```

Label: **Sangat Aktif** ≥ 75, **Aktif** ≥ 50, **Cukup** ≥ 25, selebihnya
**Perlu Pembinaan**. Setiap PW melihat KPI PD dan PK di bawahnya, PB melihat
seluruh jejaring, dan kegiatan bawahan muncul di umpan aktivitas atasan.

### Formulir dan data peserta
Lembaga membuat formulir di `/lembaga.html` → **Formulir**, lalu membagikan
tautan publik `/formulir.html?id=<formId>`. Peserta mengisi nama, asal
sekolah/lembaga, WhatsApp, email, dan catatan. Atasan (PW/PD) dan PB dapat
membuka data peserta kegiatan lembaga di bawahnya dan mengunduhnya sebagai CSV.
Formulir dapat ditutup agar tidak menerima pendaftaran baru.

### Surat berkategori
Surat hanya dapat dikirim dalam jejaring sendiri (atasan/bawahan) atau ke/dari
PB. Kategori tetap: **Kesekretariatan**, **Kebendaharaan**, **Kelembagaan**,
**Eksternal** — tiap bidang di jenjang mana pun dapat menyaring kotak masuk
sesuai kategorinya, menandai dibaca, dan menandai selesai.

### Umpan acara publik dan standar keaktifan berjenjang
`/acara.html` menampilkan kegiatan berstatus **terbit** dari semua jenjang, dengan
pendaftaran yang mengarah ke formulir panitia milik lembaga penyelenggara. Kartu
acara punya tombol suka, komentar, dan bagikan; komentar dan suka hanya untuk akun
kader yang sudah masuk Google. Contoh judul yang dipakai bersama: Leadership Basic
Training (LBT), Leadership Intermediate Training (LIT), Leadership Advance Training
(LAT), Ta'lim Awal, Ta'lim Wusthom, Ta'lim Ali.

Target minimal kegiatan per bulan dapat disetel berjenjang:

- PB menentukan bawaan lewat **Admin → Pengaturan → Acara, keaktifan, dan keamanan**
  (kunci `keaktifanMinPerMonth`).
- Lembaga induk menimpa untuk bawahannya lewat `/lembaga.html` → **Jejaring**
  (aksi `orgSetStandard`, tersimpan di sheet `Standards`).
- Dashboard lembaga menunjukkan pencapaian bulan berjalan terhadap standar yang
  berlaku untuk jenjangnya (`keaktifanFor_`, sumber nilai ditampilkan sebagai
  `standar PB bawaan` / `standar <induk>`).

Kunci pengaturan lain: `kaderCommentDailyLimit` (kuota komentar kader per hari),
`eventCommentsOpen` (kolom komentar dibuka/tutup), `googleClientId` (masuk kader),
`turnstileSiteKey` + `turnstileSecret` (opsional). `turnstileSecret` tidak pernah
dikirim ke browser.

### Proteksi spam berlapis
Dua lapisan, keduanya aktif bersamaan:

1. `api/pii.js` (Vercel) — jendela geser per pasangan `aksi|IP`. Baca 240/60s,
   captcha 30/600s, **semua jalur login (`login`, `orgLogin`, `kaderLogin`,
   `kaderEmailLogin`) 10/600s**, tulis (termasuk `kaderRegister`) 25/600s,
   sisanya 90/600s. Penolakan mengembalikan HTTP 429
   dengan `code: 'rate_limited'` dan header `Retry-After`; proxy juga menyuntikkan
   `ip` ke body sehingga Apps Script ikut melihat alamat asli pengunjung.
2. `gas/Code.gs` `throttle_()` — jendela tetap di `CacheService` (TTL maksimum
   600s) per aturan di `RATE_RULES`: login admin 8/600s, login lembaga 10/600s,
   pendaftaran lembaga 5/1800s, pendaftaran peserta 12/600s, captcha 18/600s,
   login kader 12/600s (Google dan email sama), pendaftaran akun kader 5/1800s,
   suka 20/60s, komentar 4/180s per akun, komentar 20/600s
   per IP, unggah foto 10/600s, chat 6/60s.

Captcha memakai soal hitung yang dibuat server (`captcha.js` + `captchaIssue_`),
jadi tanpa kunci dan tanpa biaya; ia hanya dipakai di **formulir pendaftaran publik,
pendaftaran lembaga, dan pendaftaran akun kader**. Kolom komentar acara tidak memakai captcha karena
penulisnya sudah terikat akun (Google atau email), dan dibatasi oleh kuota harian + kedua
lapis pembatas laju di atas. Bila `turnstileSiteKey` dan `turnstileSecret` diisi,
`captchaIssue_` otomatis mengembalikan mode Turnstile dan frontend beralih tanpa
perubahan kode.

### Catatan migrasi
Backend ini sengaja masih memakai Google Sheets + Apps Script sebagai langkah
sementara. Skema baru (`Orgs`, `Activities`, `Forms`, `Participants`, `Letters`)
memakai id acak, `parentId`, dan timestamp ISO agar bisa dipetakan langsung ke
tabel Supabase tanpa mengubah kontrak API frontend.

## H. Tanya PII (asisten AI satu halaman penuh)

`/tanya.html` adalah halaman chat satu kolom ala aplikasi percakapan: intro +
chip contoh pertanyaan, utas jawaban, dan komposer yang menempel di bawah.
Tombol **Tanya PII** mengambang di pojok kanan bawah `/index.html`,
`/ibadah.html`, `/acara.html`, `/admin.html`, `/lembaga.html`, dan
`/formulir.html` hanya sebagai pintu ke halaman itu. Tinggi halaman memakai
`calc(100dvh - var(--tanya-keyboard))` supaya komposer tidak tertutup papan
ketik di HP.

**Akses sumber memerlukan akun.** Tanya PII hanya menjawab jika sesi pengguna
memiliki akses ke Pustaka organisasi dan pencarian menemukan kutipan yang cukup
relevan. Tanpa sesi, korpus, atau kecocokan, model AI tidak dipanggil; pengguna
mendapat penjelasan bahwa jawaban belum tersedia. Batas akses Pustaka tetap
mengikuti `Settings.pustakaMinRole`.

Kader yang masuk mendapat `APP.CHAT_DAILY_LIMIT` (bawaan **20**) pertanyaan per
hari. Pembatasnya ada di server (proxy `/api/chat` + Apps Script), jadi
menghapus tombol atau script di halaman lain tidak membuka kuota.

**Kuota dicatat di sheet `Chat`.** Proxy memanggil aksi `chatStatus` untuk
membaca sisa kuota lalu `chatRecord` untuk mencatat pertanyaan-jawaban yang
berhasil; perhitungan memakai tanggal lokal `Session.getScriptTimeZone()` sehingga
reset sendiri setiap tengah malam. Panjang pertanyaan dipotong ke
`APP.CHAT_MAX_CHARS` (900). Kalau deployment Apps Script belum mendukung aksi
tersebut, proxy jatuh ke pembatas lunak di memori instance (20/hari berakun,
maksimal 4 pertanyaan per menit) agar fitur tetap hidup. Sisa kuota akun muncul
di meter komposer (`Sisa 17 dari 20 pertanyaan hari ini`).

**Kunci AI tidak pernah sampai ke browser.** Alurnya
`tanya.js` → `/api/chat` (proxy Vercel, `maxDuration` 60 dtk karena model gratis
jauh lebih lambat daripada CMS) → penyedia AI, dan pencatatan kuota ke Apps
Script. Proxy hanya meloloskan aksi `chat` dan `chatStatus`. Kunci dibaca dari
**environment variable Vercel** (`AI_CHAT_URL`, `AI_MODEL`, `AI_API_KEY`, atau
`GROQ_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`) dan diperiksa berurutan;
kalau tidak ada kunci, Pollinations dipakai tanpa konfigurasi kunci AI
tambahan. Deployment Apps Script memakai properti proyek dengan nama yang sama
(**Project Settings ▸ Properties**):

| Properti | Isi | Bawaan bila kosong |
| --- | --- | --- |
| `AI_CHAT_URL` | URL chat-completions yang kompatibel OpenAI | `https://text.pollinations.ai/openai` |
| `AI_MODEL` | nama model di penyedia itu | `openai` tanpa kunci, `gpt-4o-mini` dengan kunci |
| `AI_API_KEY` | kunci penyedia (opsional) | panggilan tanpa header `Authorization` |

Contoh penyedia gratis lain:

- Groq — `AI_CHAT_URL` `https://api.groq.com/openai/v1/chat/completions`, `AI_MODEL` `llama-3.1-8b-instant`.
- Google Gemini — `AI_CHAT_URL` `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, `AI_MODEL` `gemini-flash-latest`.

Setiap pemanggilan model wajib menyertakan kutipan Pustaka yang relevan sebagai
satu-satunya sumber fakta. Fakta dari Settings, riwayat percakapan, dan ingatan
model tidak dipakai sebagai sumber; tanpa kutipan, request berhenti sebelum
layanan AI dipanggil. Jawaban menyebut nama berkas dan halaman, maksimal 160
kata, serta tidak boleh menebak saat kutipan tidak cukup. Frontend juga menolak
menampilkan jawaban AI tanpa rujukan.

**Dua sheet baru** dibuat otomatis oleh `setup()`: `Sessions`
(`token, kind, subject, createdAt, expiresAt`) dan `Chat`
(`createdAt, kind, subject, question, answer, provider, status`). Baris
`Sessions` yang sudah kedaluwarsa dibersihkan setiap kali sesi baru dibuat.
`Sessions` inilah yang membuat login bertahan 6 jam; sebelumnya token ditaruh di
`CacheService` yang diam-diam memotong umur cache menjadi 10 menit. Untuk
mematikan fitur AI sepenuhnya, hapus baris `<script src="tanya.js" defer></script>`
dari halaman terkait atau turunkan `CHAT_DAILY_LIMIT` dan `CHAT_GUEST_DAILY_LIMIT`
menjadi `0`.

## I. Akun kader: Google, email + kata sandi, atau daftar baru

Dialog **Masuk kader** (kop semua halaman, dibangun `akun.js`) menawarkan tiga tab.
Semuanya menghasilkan sesi dengan `role: 'kader'` — hak yang sama: suka, komentar,
bagikan acara, dan jatah Tanya PII 20 pertanyaan per hari. Dasbor pengurus,
`/lembaga.html`, `/admin.html`, dan PII Global View tetap tertutup untuk kader
(`sessionSubject_` memisahkan tipe sesi, jadi token kader tidak bisa dipakai aksi
pengurus).

| Tab | Aksi backend | Catatan |
| --- | --- | --- |
| Google | `kaderLogin` dengan `idToken` | token divalidasi server di `googleClaims_` (issuer, audience, kedaluwarsa) |
| Email | `kaderEmailLogin` (`email`, `password`) | kata sandi dibandingkan dengan hash; pesan salah bersifat umum: "Email atau kata sandi salah." |
| Daftar | `kaderRegister` (`name`, `email`, `password`, captcha) | minimal 8 karakter; email ganda ditolak dengan ajakan login |

Kolom sheet `Kaders` bertambah menjadi `id, email, name, picture, googleSub,
createdAt, lastLoginAt, note, passwordHash, passwordSalt`. Dua kolom terakhir diisi
oleh pendaftaran email; `setup()` menambahkannya otomatis pada spreadsheet lama.
Hash memakai SHA-256 bersalt acak dengan 250 iterasi (`hashPassword_`) dan
gagalannya (`passwordHash`) tidak pernah keluar dari Apps Script — `whoami` hanya
mengembalikan `id, name, email, picture`.

Satu orang boleh masuk lewat dua jalur. Kalau suatu saat akun email login dengan
Google dan alamat emailnya sama, `kaderLogin_` menautkan `googleSub` ke baris yang
sudah ada sehingga tidak muncul akun ganda.

Captcha wajib hanya pada tab **Daftar**. Jawaban verifikasi sekali pakai dan
kedaluwarsa, jadi dialog selalu meminta soal baru setelah satu pengiriman sukses
ataupun gagal — formulir dibersihkan dan widget captcha dipasang ulang.

Google tetap opsional. Buat **OAuth client ID ▸ Web application**, tambahkan domain
produksi dan `http://127.0.0.1:4173` ke *Authorized JavaScript origins*, lalu isi
nilainya di Settings lewat dashboard admin (kolom `googleClientId`). Selama kolom
itu kosong, tab Google disembunyikan dan kader memakai jalur email; dialog tetap
tampil sehingga fitur tidak terlihat mati.

## Penting untuk keamanan dan produksi
- Ini starter/MVP, belum audit keamanan produksi. Gunakan hanya akun admin tepercaya, password kuat, batasi akses editor, dan jangan bagikan URL deployment atau kredensial.
- Endpoint Apps Script harus dapat dipanggil oleh proxy Vercel. Jangan menaruh `ADMIN_PASSWORD` atau URL rahasia lain di frontend atau repository.
- Foto galeri, sampul artikel, dan sampul kegiatan dapat diunggah langsung dari
  dashboard (`uploadImage` untuk admin, `orgUploadImage` untuk lembaga). Berkas
  diperkecil dan dikonversi ke JPEG di browser (format gambar yang bisa dibaca browser),
  lalu jenis hasilnya diperiksa dari tanda tangan byte (JPEG/PNG/WebP),
  disimpan ke folder "PB PII Media" di Drive akun Apps Script, dan disajikan sebagai
  URL `lh3.googleusercontent.com`. Unggah memerlukan sesi pengurus yang sudah
  terverifikasi — token kader ditolak.
- Token sesi disimpan di `sessionStorage` browser dan berlaku sementara; sesi dapat berakhir saat cache dibersihkan.
- `saveAdminPassword` hanya menyimpan hash SHA-256 bersalt (250 iterasi) di Script Properties, bukan teks kata sandi. Nilai lama yang masih berupa teks polos tetap bisa login dan otomatis dinaikkan menjadi hash pada login berikutnya. Gunakan tetap password unik yang tidak dipakai di layanan lain, dan batasi siapa yang punya akses edit ke spreadsheet/Apps Script.
- Kunci AI (`AI_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`) hanya boleh hidup di sisi server: **Script Properties** di Apps Script dan/atau **Environment Variables** di Vercel (dibaca `api/chat.js`). Jangan pernah memindahkannya ke file frontend, `akun.js`, `tanya.js`, atau repository mana pun: browser yang membuka DevTools bisa membaca apa pun yang dikirim ke sana. Tanpa kunci apa pun, `api/chat.js` memakai Pollinations gratis — itu memang bawaannya, dan kuota tamu diikat 5 pertanyaan per alamat IP per hari supaya jatah gratis tidak habis.
- Masuk kader tidak bergantung pada Google: tersedia juga email + kata sandi dan pendaftaran ber-captcha (lihat bagian I). Client ID Google tetap opsional dan ditaruh di Settings lewat dashboard admin (kolom `googleClientId`) — bukan di kode, karena browser hanya memakai Client ID publik dan server yang memverifikasi token di `googleClaims_` (issuer, audience, kedaluwarsa). Selama kolom itu kosong, tab Google disembunyikan dan dialog menampilkan Email/Daftar.
- Untuk penggunaan resmi, siapkan backup spreadsheet, logging operasional, tinjauan keamanan, serta pengelolaan izin Apps Script/Drive sebelum menambah banyak admin. Artikel dan surat sudah memakai sanitasi HTML allowlist; tetap tinjau perubahan format baru sebelum dipakai di produksi.
- Halaman publik tidak boleh memuat instruksi teknis (menempel `Code.gs`, menjalankan `setup`, alur *Deploy ▸ New version*, atau "sampaikan ke admin"). Pesan kesalahan untuk pengunjung dibuat netral; langkah operasional semacam itu hanya boleh muncul di README dan perkakas internal Apps Script.
