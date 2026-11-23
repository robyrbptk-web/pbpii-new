-- Interaksi sosial Feed/Story dan notifikasi sosial.
-- Suka Story memakai tabel reactions yang sudah ada dengan target_type='story';
-- balasan Story memakai comments dengan target_type='story'. Tidak ada tabel
-- duplikat untuk dua fungsi itu. Satu-satunya tabel baru adalah story_views,
-- karena daftar penonton butuh dedupe per akun dan hak baca pemilik Story.

-- Kotak kabar yang sudah ada tetap dipakai; kolom baru hanya melengkapi identitas pengirim,
-- target, dan kunci pengelompokan agar UI bisa menampilkan notifikasi bergaya
-- aplikasi pesan tanpa menebak dari judul/isi.
alter table notifikasi add column if not exists actor_key text not null default '';
alter table notifikasi add column if not exists actor_name text not null default '';
alter table notifikasi add column if not exists actor_picture text not null default '';
alter table notifikasi add column if not exists target_type text not null default '';
alter table notifikasi add column if not exists target_id text not null default '';
alter table notifikasi add column if not exists grup_kunci text not null default '';
create index if not exists notifikasi_grup_idx on notifikasi(untuk, grup_kunci, dibuat desc);

create table if not exists story_views (
  id         text primary key,
  story_id   text not null,
  actor_key  text not null default '',
  ip         text not null default '',
  dibuat     timestamptz not null default now(),
  seq        bigint,
  unique (story_id, actor_key, ip)
);
create sequence if not exists story_views_seq_seq owned by story_views.seq;
alter table story_views alter column seq set default nextval('story_views_seq_seq'::regclass);
create index if not exists story_views_story_idx on story_views(story_id, dibuat desc);
create index if not exists story_views_seq_idx on story_views (seq);

-- Indeks untuk jalur baca yang sudah ada: pencarian following dan cleanup Story.
create index if not exists follows_actor_idx on follows(actor_key, target_id);
create index if not exists stories_kedaluwarsa_idx on stories(kedaluarsa);

-- Tabel baru dibuat setelah 0002, jadi kunci dan RLS dipasang sendiri seperti
-- yang dilakukan 0006 untuk moderasi_log.
alter table story_views enable row level security;
revoke all on story_views from anon, authenticated;
grant all on story_views to service_role, postgres;
