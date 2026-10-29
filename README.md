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
- Halaman depan menyediakan manifest PWA, ikon Android/iOS, navigasi bawah yang nyaman disentuh, serta cache app-shell dan halaman offline.
- Buka website lewat HTTPS. Di Android/Chrome gunakan tombol **Instal aplikasi** saat tersedia atau menu browser **Install app / Add to Home screen**. Di iPhone/iPad, gunakan **Share > Add to Home Screen**.
- Konten API dan perubahan dashboard tidak disimpan offline; cache hanya untuk kerangka halaman/aset statis.

Untuk preview lokal yang lengkap, pasang Vercel CLI lalu jalankan `npm install -g vercel` dan `vercel dev`. Halaman juga bisa dibuka langsung untuk melihat tata letak, tetapi panggilan API memerlukan proxy Vercel dan URL Apps Script yang sudah dikonfigurasi.

## C. Fitur yang ada
- Halaman depan responsif untuk desktop, tablet, dan HP; pada layar kecil memakai navigasi bawah bergaya aplikasi.
- Artikel: tambah, edit, hapus, draft/published, kategori, ringkasan, isi, URL gambar sampul.
- Pengaturan: judul dan teks hero, nama/jabatan/foto Ketua Umum, sambutan, tampil/sembunyikan sambutan, profil ringkas, footer, email, dan tautan media sosial.
- Galeri: tambah, edit, hapus, urutan, caption, tampil/sembunyikan.
- Login admin dengan token sesi sementara di CacheService.
- **Peta Global (PII Global View)** di `/peta.html`: globe interaktif berisi satelit, gunung berapi, sekolah, rumah sakit, halte Transjakarta, penerbangan, dan CCTV, ditambah ringkasan angka langsung di beranda.
- **Ruang Ibadah** di `/ibadah.html`: jadwal sholat Kemenag untuk 517 kabupaten/kota (bisa dicari dan disimpan di perangkat), hitung mundur waktu sholat berikutnya, pengingat adzan, arah kiblat, tanggal Hijriah, serta pembaca Al-Qur'an 114 surat dengan terjemahan, tafsir ringkas, dan murattal. Beranda menampilkan ringkasan jadwal hari ini.

## D. Peta Global (PII Global View)

Peta adalah fitur dari website ini, bukan aplikasi terpisah. Halaman `/peta.html`
memakai header dan navigasi PB PII, lalu menampilkan globe di dalam bingkai;
tombol **Layar penuh** membuka `/peta/` langsung.

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
- Pilihan kota, surat terakhir, dan status adzan disimpan di `localStorage`
  (`pbpii:ibadah-city`, `pbpii:ibadah-surah`, `pbpii:ibadah-adzan`).
- Berkas adzan berasal dari islamcan.com. Browser memblokir audio otomatis
  sebelum ada interaksi, jadi pengunjung perlu menekan **Putar adzan** sekali;
  setelah itu bunyi otomatis pada Subuh, Dzuhur, Ashar, Maghrib, dan Isya aktif
  selama tab terbuka.
- Arah kiblat bawaannya dihitung dari Sekretariat PB PII; tombol **Gunakan
  lokasi saya** memakai geolocation (perlu HTTPS atau `localhost`).


Untuk membuat atau mengganti akun admin, ikuti langkah A di atas. Formulir password memakai kolom tersembunyi dan menyimpan nilainya ke Script Properties tanpa menuliskannya ke source code.

## Penting untuk keamanan dan produksi
- Ini starter/MVP, belum audit keamanan produksi. Gunakan hanya akun admin tepercaya, password kuat, batasi akses editor, dan jangan bagikan URL deployment atau kredensial.
- Endpoint Apps Script harus dapat dipanggil oleh proxy Vercel. Jangan menaruh `ADMIN_PASSWORD` atau URL rahasia lain di frontend atau repository.
- Foto galeri dan sampul menggunakan URL gambar publik; upload file langsung belum tersedia.
- Token sesi disimpan di `sessionStorage` browser dan berlaku sementara; sesi dapat berakhir saat cache dibersihkan.
- Untuk penggunaan resmi, tambahkan backup spreadsheet, logging, rate limiting, perlindungan CSRF sesuai kebutuhan, validasi HTML artikel, dan tinjauan keamanan sebelum menerima banyak admin.
