-- Urutan baris sheet harus ikut pindah, bukan hanya isinya. Kode backend yang
-- dipindahkan mencari baris lewat nomor (findRow_ + deleteRow(nomor)), jadi
-- daftar tanpa urutan tetap bisa salah alamat setelah ada update atau vacuum.
-- Kolom seq diisi saat impor sesuai urutan sheet; baris baru mengambil nilai
-- berikutnya dari sequence tabel itu.

do $$
declare
  tabel text;
  daftar text[] := array[
    'settings', 'orgs', 'standards', 'kader', 'articles', 'gallery',
    'activities', 'forms', 'participants', 'letters', 'sessions', 'posts',
    'post_media', 'reactions', 'comments', 'follows', 'bookmarks', 'stories',
    'threads', 'pustaka_berkas', 'pustaka_potongan', 'fakta', 'notifikasi',
    'chat_log'
  ];
begin
  foreach tabel in array daftar loop
    execute format('alter table %I add column if not exists seq bigint', tabel);
    execute format('create sequence if not exists %s_seq_seq owned by %I.seq', tabel, tabel);
    execute format('alter table %I alter column seq set default nextval(%L::regclass)', tabel, tabel || '_seq_seq');
    execute format('create index if not exists %s_seq_idx on %I (seq)', tabel, tabel);
  end loop;
end $$;

-- Layanan lembar hanya boleh memakai satu jalur akses, jadi kunci pencarian
-- tiap tabel diberitahukan ke PostgREST lewat komentar dan dibaca generator.
comment on column settings.seq is 'kunci: key';
comment on column sessions.seq is 'kunci: token';
