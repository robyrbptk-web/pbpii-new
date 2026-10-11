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
1. Unggah folder proyek ini ke repository GitHub.
2. Import repository tersebut ke Vercel.
3. Proxy sudah memakai URL deployment yang diberikan sebagai nilai bawaan. Jika `GAS_WEB_APP_URL` sudah tersimpan di Vercel, nilainya harus sama dengan URL `/exec` terbaru; Environment Variable akan mengesampingkan URL bawaan.
4. Redeploy. Pastikan fungsi serverless `api/pii.js` aktif.
5. Buka website dan tes halaman publik, login admin, simpan draft, terbitkan artikel, ubah sambutan, dan tampil/sembunyikan foto galeri.

Untuk preview lokal yang lengkap, pasang Vercel CLI lalu jalankan `npm install -g vercel` dan `vercel dev`. Halaman juga bisa dibuka langsung untuk melihat tata letak, tetapi panggilan API memerlukan proxy Vercel dan URL Apps Script yang sudah dikonfigurasi.

## C. Fitur yang ada
- Halaman depan responsif untuk desktop dan HP.
- Artikel: tambah, edit, hapus, draft/published, kategori, ringkasan, isi, URL gambar sampul.
- Pengaturan: judul dan teks hero, nama/jabatan/foto Ketua Umum, sambutan, tampil/sembunyikan sambutan, profil ringkas, footer, email, dan tautan media sosial.
- Galeri: tambah, edit, hapus, urutan, caption, tampil/sembunyikan.
- Login admin dengan token sesi sementara di CacheService.

Untuk membuat atau mengganti akun admin, ikuti langkah A di atas. Formulir password memakai kolom tersembunyi dan menyimpan nilainya ke Script Properties tanpa menuliskannya ke source code.

## Penting untuk keamanan dan produksi
- Ini starter/MVP, belum audit keamanan produksi. Gunakan hanya akun admin tepercaya, password kuat, batasi akses editor, dan jangan bagikan URL deployment atau kredensial.
- Endpoint Apps Script harus dapat dipanggil oleh proxy Vercel. Jangan menaruh `ADMIN_PASSWORD` atau URL rahasia lain di frontend atau repository.
- Foto galeri dan sampul menggunakan URL gambar publik; upload file langsung belum tersedia.
- Token sesi disimpan di `sessionStorage` browser dan berlaku sementara; sesi dapat berakhir saat cache dibersihkan.
- Untuk penggunaan resmi, tambahkan backup spreadsheet, logging, rate limiting, perlindungan CSRF sesuai kebutuhan, validasi HTML artikel, dan tinjauan keamanan sebelum menerima banyak admin.
