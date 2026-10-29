# Website PB PII — starter

Fondasi website publik PB PII dengan artikel, sambutan Ketua Umum yang bisa diubah dari dashboard, serta galeri yang dapat dipilih admin. Frontend statis di Vercel, backend dan penyimpanan di Google Apps Script + Google Sheets.

## Catatan copywriting dan sumber

Naskah awal ditulis dengan merujuk profil dan tujuan PII yang dipublikasikan di situs resmi PB PII: https://pbpii.or.id/profil-organisasi/ dan https://pbpii.or.id/misi-dan-eksistensi-pii/. PII berdiri pada 4 Mei 1947 dan berfokus pada pendidikan serta kebudayaan sesuai Islam. Sambutan Ketua Umum pada starter ini adalah naskah editorial awal, bukan kutipan atau pernyataan resmi Ketua Umum. Admin perlu menyunting dan menyetujuinya sebelum dipublikasikan. Nama Ketua Umum, foto, dan teks sambutan dapat diubah dari dashboard.

## A. Buat Google Sheets dan Apps Script
Jika spreadsheet dan Apps Script sudah dibuat sebelumnya, mulai dari langkah 2. Jangan membuat spreadsheet baru untuk database yang sudah berisi data.

1. Buka Google Spreadsheet yang dipakai website PB PII.
2. Pilih **Extensions > Apps Script**.
3. Di panel Files, buka `Code.gs`, ganti isinya dengan file `gas/Code.gs` dari folder proyek, lalu klik **Save**.
4. Buat file HTML: klik tanda **+** di sebelah Files > **HTML**, beri nama persis `AdminSetup`, lalu salin isi file `gas/AdminSetup.html` ke dalamnya. Klik **Save**.
5. Di dropdown fungsi pada toolbar Apps Script, pilih `setup`, lalu klik **Run**. Berikan izin Google yang diminta. Fungsi ini membuat sheet yang belum ada dan menyiapkan username `admin`; tidak menghapus artikel atau data yang sudah tersimpan.
6. Kembali ke spreadsheet dan muat ulang halaman. Klik menu baru **PB PII > Atur akun admin**.
7. Masukkan password admin yang Anda inginkan dua kali di dialog, lalu klik **Simpan akun admin**. Password disimpan di Script Properties Google, bukan di file website.
8. Di Apps Script pilih **Deploy > Manage deployments**. Klik ikon pensil pada deployment Web App, pilih **New version**, lalu klik **Deploy**. Jika diminta, izinkan kembali akses yang diperlukan.
9. Gunakan URL deployment Web App yang berakhiran `/exec`. Proxy proyek sudah memiliki URL Apps Script yang diberikan sebelumnya sebagai nilai bawaan.

Jika menu **PB PII** belum terlihat, pastikan kedua file sudah disimpan dan muat ulang spreadsheet. Langkah membuat/menyimpan akun cukup diulang dari langkah 6 jika ingin mengganti password.

## B. Hubungkan ke Vercel
1. Import repository GitHub ke Vercel dan pilih branch `main`.
2. Pastikan **Root Directory** adalah root repository (`./`), bukan folder parent atau subfolder yang tidak memuat `index.html`.
3. Gunakan framework **Other** / tanpa framework, tanpa Build Command, dan jangan mengatur Output Directory ke `public`; halaman HTML berada di root repository. `vercel.json` memetakan `/` langsung ke `index.html` dan mempertahankan fungsi `api/pii.js`.
4. Proxy sudah memakai URL deployment yang diberikan sebagai nilai bawaan. Jika `GAS_WEB_APP_URL` sudah tersimpan di Vercel, nilainya harus sama dengan URL `/exec` terbaru; Environment Variable akan mengesampingkan URL bawaan.
5. Pilih **Deploy** atau **Redeploy** setelah commit terbaru berstatus tersedia. Tes `/`, `/login.html`, `/admin.html`, `/manifest.json`, dan login admin. Jika masih 404, periksa **Project Settings > Build and Deployment > Root Directory** menunjuk ke root repository dan tunggu deployment branch `main` selesai.
6. Fungsi di `api/` (proxy data untuk peta) ikut ter-deploy otomatis. Tambahkan `API_INDONESIA_KEY` di **Project Settings > Environment Variables** agar lapisan rumah sakit dan halte Transjakarta aktif; tanpa kunci, keduanya hanya menampilkan pesan belum diatur.

### Instal sebagai aplikasi
- `manifest.json` memakai mode `standalone`, ikon 192/512 biasa dan 512 `maskable`, plus pintasan ke Ruang Ibadah, Peta, dan Dashboard. Semua halaman memuat `site.js` yang mendaftarkan service worker dan menampilkan tombol **Instal aplikasi** ketika browser mendukung.
- `sw.js` menyimpan app-shell (halaman, `styles.css`, `app.js`, `ibadah.js`, `site.js`, ikon). Navigasi dan berkas JS/CSS selalu diambil dari jaringan lebih dulu agar pembaruan deploy langsung terpakai; gambar memakai cache lebih dulu. `/api/` dan `/peta/` tidak pernah di-cache. Jika jaringan putus, navigasi jatuh ke halaman `offline.html`.
- Buka website lewat HTTPS. Di Android/Chrome gunakan tombol **Instal aplikasi** saat tersedia atau menu browser **Install app / Add to Home screen**. Di iPhone/iPad, gunakan **Share > Add to Home Screen**.
- Konten API dan perubahan dashboard tidak disimpan offline; cache hanya untuk kerangka halaman/aset statis.
- Ikon dibuat dari `public/assets/logo-pii.png` dengan `node scripts/make-icons.mjs` (tanpa dependensi biner). Jalankan ulang setelah logo diganti, lalu naikkan `CACHE_NAME` di `sw.js` supaya pengunjung menerima versi baru.

Untuk preview lokal yang lengkap, pasang Vercel CLI lalu jalankan `npm install -g vercel` dan `vercel dev`. Halaman juga bisa dibuka langsung untuk melihat tata letak, tetapi panggilan API memerlukan proxy Vercel dan URL Apps Script yang sudah dikonfigurasi.

## C. Fitur yang ada
- Halaman depan responsif untuk desktop, tablet, dan HP; pada layar kecil memakai navigasi bawah bergaya aplikasi.
- Artikel: tambah, edit, hapus, draft/published, kategori, ringkasan, isi, URL gambar sampul.
- Pengaturan: judul dan teks hero, nama/jabatan/foto Ketua Umum, sambutan, tampil/sembunyikan sambutan, profil ringkas, footer, email, dan tautan media sosial.
- Galeri: tambah, edit, hapus, urutan, caption, tampil/sembunyikan.
- Login admin dengan token sesi sementara di CacheService.
- **Peta Global (PII Global View)** di `/peta.html`: globe interaktif berisi satelit, gunung berapi, sekolah, rumah sakit, halte Transjakarta, penerbangan, dan CCTV, ditambah ringkasan angka langsung di beranda.
- **Ruang Ibadah** di `/ibadah.html`: jadwal sholat Kemenag untuk 517 kabupaten/kota (bisa dicari dan disimpan di perangkat), deteksi lokasi otomatis untuk pengunjung dari daerah mana pun, hitung mundur waktu sholat berikutnya, pengingat adzan, arah kiblat, tanggal Hijriah, serta pembaca Al-Qur'an 114 surat dengan terjemahan, tafsir ringkas, dan murattal. Beranda menampilkan ringkasan jadwal hari ini.
- Dashboard admin: ringkasan angka, pencarian dan saringan artikel, penerbitan/penarikan artikel sekali klik, notifikasi ringkas, serta panel bantuan yang menjelaskan lokasi database dan cara memulihkan akun admin.
- **Akun lembaga** di `/daftar.html` dan `/lembaga.html`: pendaftaran PW/PD/PK dengan pilihan provinsi/kota/kecamatan resmi dari wilayah.id, verifikasi bertingkat (PB→PW→PD→PK) dengan override admin, kegiatan + Indeks Keaktifan, formulir peserta publik di `/formulir.html`, dan surat berkategori antarlebaga (lihat bagian G).

## D. Peta Global (PII Global View)

Peta adalah fitur dari website ini, bukan aplikasi terpisah. Halaman `/peta.html`
memakai header dan navigasi PB PII, lalu menampilkan globe di dalam bingkai;
tombol **Layar penuh** membuka `/peta/` langsung.

Bingkai globe memeriksa sendiri apakah aplikasi benar-benar termuat (ada canvas
Cesium). Bila pemuatan pertama gagal — misalnya server baru hidup atau koneksi
terputus saat mengunduh aset Cesium — halaman mencoba ulang sekali secara
otomatis, lalu menampilkan panel "Globe belum dapat dimuat" dengan tombol muat
ulang dan tautan layar penuh. Jadi kegagalan sementara tidak lagi menyisakan
bingkai kosong.

Struktur:

- `peta/` — hasil build aplikasi globe (Vite + CesiumJS). Semua aset memakai
  path relatif, jadi folder ini bisa disajikan dari subpath mana pun.
- `api/sekolah.js`, `api/volcanoes.js`, `api/indonesia/*.js`, `api/celestrak.js` —
  proxy serverless supaya lapisan peta bisa memanggil API data dari domain yang
  sama (tanpa CORS, tanpa kunci di browser).
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

Lapisan peta lain (FIRMS, Google Places, ringkasan AI, CCTV, penerbangan) tetap
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
**PB PII → Setel ulang password admin**): akun kembali ke username `admin` dan
password awal `tauhid12`, lalu segera ganti lewat menu. Username tetap `admin`
kecuali diubah manual di Script Properties. Halaman `/login.html` dan panel
bantuan dashboard memuat ringkasan langkah yang sama agar bisa dibuka tanpa
README.

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

### Catatan migrasi
Backend ini sengaja masih memakai Google Sheets + Apps Script sebagai langkah
sementara. Skema baru (`Orgs`, `Activities`, `Forms`, `Participants`, `Letters`)
memakai id acak, `parentId`, dan timestamp ISO agar bisa dipetakan langsung ke
tabel Supabase tanpa mengubah kontrak API frontend.

## Penting untuk keamanan dan produksi
- Ini starter/MVP, belum audit keamanan produksi. Gunakan hanya akun admin tepercaya, password kuat, batasi akses editor, dan jangan bagikan URL deployment atau kredensial.
- Endpoint Apps Script harus dapat dipanggil oleh proxy Vercel. Jangan menaruh `ADMIN_PASSWORD` atau URL rahasia lain di frontend atau repository.
- Foto galeri dan sampul menggunakan URL gambar publik; upload file langsung belum tersedia.
- Token sesi disimpan di `sessionStorage` browser dan berlaku sementara; sesi dapat berakhir saat cache dibersihkan.
- `saveAdminPassword` menyimpan password admin apa adanya di Script Properties (bukan hash). Gunakan password unik yang tidak dipakai di layanan lain, dan batasi siapa yang punya akses edit ke spreadsheet/Apps Script.
- Untuk penggunaan resmi, tambahkan backup spreadsheet, logging, rate limiting, perlindungan CSRF sesuai kebutuhan, validasi HTML artikel, dan tinjauan keamanan sebelum menerima banyak admin.
