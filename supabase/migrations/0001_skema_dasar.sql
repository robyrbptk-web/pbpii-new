-- Skema dasar PB PII hasil pemindahan 24 sheet Apps Script.
-- Nama kolom sengaja mengikuti header sheet supaya adapter /api/pii cukup
-- menerjemahkan aksi, tidak perlu menata ulang kontrak response frontend.

create extension if not exists citext;
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ struktur

create table if not exists settings (
  key   text primary key,
  value text not null default ''
);

create table if not exists orgs (
  id            text primary key,
  jenjang       text not null check (jenjang in ('PB','PW','PD','PK')),
  name          text not null,
  province      text not null default '',
  district      text not null default '',
  subdistrict   text not null default '',
  parent_id     text references orgs(id) on delete set null,
  email         citext unique,
  password_hash text not null default '',
  password_salt text not null default '',
  phone         text not null default '',
  sk_url        text not null default '',
  status        text not null default 'pending',
  verified_by   text not null default '',
  verified_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  last_login_at timestamptz,
  note          text not null default ''
);
create index if not exists orgs_parent_idx on orgs(parent_id);
create index if not exists orgs_jenjang_idx on orgs(jenjang, status);

create table if not exists kader (
  id            text primary key,
  email         citext unique,
  name          text not null default '',
  picture       text not null default '',
  google_sub    text,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz,
  note          text not null default '',
  password_hash text not null default '',
  password_salt text not null default '',
  username      citext unique,
  bio           text not null default '',
  lokasi        text not null default '',
  jenjang       text not null default '',
  org_id        text references orgs(id) on delete set null,
  tautan        text not null default '',
  sampul        text not null default '',
  profil_on     timestamptz,
  auth_uid      uuid unique
);
create index if not exists kader_org_idx on kader(org_id);
create unique index if not exists kader_google_sub_idx on kader(google_sub)
  where google_sub is not null and google_sub <> '';

-- Sesi transisi: token lama (bukan JWT Supabase) masih harus bisa diverifikasi
-- supaya pengguna yang sedang masuk tidak kehilangan sesi saat cutover.
create table if not exists sessions (
  token      text primary key,
  kind       text not null,
  subject    text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_subject_idx on sessions(kind, subject);

create table if not exists articles (
  id              text primary key,
  title           text not null,
  slug            text unique,
  category        text not null default 'Berita',
  excerpt         text not null default '',
  content         text not null default '',
  cover_image     text not null default '',
  author          text not null default '',
  status          text not null default 'draft',
  created_at      timestamptz,
  updated_at      timestamptz,
  seo_title       text not null default '',
  seo_description text not null default '',
  seo_keywords    text not null default '',
  org_id          text references orgs(id) on delete set null
);
create index if not exists articles_status_tanggal_idx on articles(status, created_at desc nulls last);

create table if not exists gallery (
  id         text primary key,
  title      text not null default '',
  image_url  text not null default '',
  caption    text not null default '',
  featured   boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists activities (
  id                     text primary key,
  org_id                 text references orgs(id) on delete cascade,
  title                  text not null,
  category               text not null default '',
  tanggal                date,
  tanggal_raw            text not null default '',
  lokasi                 text not null default '',
  deskripsi              text not null default '',
  peserta                integer not null default 0,
  cover_image            text not null default '',
  status                 text not null default 'published',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz,
  jam_mulai              text not null default '',
  jam_selesai            text not null default '',
  batas_daftar           timestamptz,
  kuota                  integer not null default 0,
  info_tambahan          text not null default '',
-- Peta kaderisasi (#192) dan status keaktifan butuh kolom ini sejak awal.
  jenjang_kaderisasi     text not null default '',
  peserta_aktual         integer not null default 0,
  geolintar              numeric(9,6),
  geolongitur            numeric(9,6)
);
create index if not exists activities_org_idx on activities(org_id);
create index if not exists activities_tanggal_idx on activities(tanggal desc nulls last);

create table if not exists forms (
  id          text primary key,
  org_id      text references orgs(id) on delete cascade,
  activity_id text references activities(id) on delete cascade,
  title       text not null default '',
  description text not null default '',
  status      text not null default 'draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  fields      jsonb not null default '[]'::jsonb
);

create table if not exists participants (
  id              text primary key,
  form_id         text references forms(id) on delete cascade,
  org_id          text references orgs(id) on delete cascade,
  name            text not null default '',
  institution     text not null default '',
  phone           text not null default '',
  email           citext,
  note            text not null default '',
  created_at      timestamptz not null default now(),
  answers         jsonb not null default '{}'::jsonb,
  status          text not null default 'terdaftar',
  updated_at      timestamptz,
  registration_key text unique,
  kader_id        text references kader(id) on delete set null
);
create index if not exists participants_form_idx on participants(form_id, status);

create table if not exists letters (
  id              text primary key,
  from_org_id     text references orgs(id) on delete cascade,
  to_org_id       text references orgs(id) on delete cascade,
  category        text not null default 'Kesekretariatan',
  subject         text not null default '',
  body            text not null default '',
  status          text not null default 'unread',
  created_at      timestamptz not null default now(),
  read_at         timestamptz,
  reply_to_id     text,
  thread_id       text not null default '',
  attachment_id   text not null default '',
  attachment_name text not null default ''
);
create index if not exists letters_to_idx on letters(to_org_id, status, created_at desc);

create table if not exists standards (
  id          text primary key,
  org_id      text references orgs(id) on delete cascade,
  min_per_month integer not null default 1,
  set_by_org_id text not null default '',
  set_by_name   text not null default '',
  note          text not null default '',
  updated_at    timestamptz not null default now()
);

-- ------------------------------------------------------------------- sosial

create table if not exists reactions (
  id          text primary key,
  target_id   text not null,
  actor_key   text not null,
  actor_name  text not null default '',
  kind        text not null default 'like',
  created_at  timestamptz not null default now(),
  target_type text not null default 'acara',
  unique (target_type, target_id, actor_key, kind)
);
create index if not exists reactions_target_idx on reactions(target_type, target_id);

create table if not exists comments (
  id            text primary key,
  target_id     text not null,
  actor_key     text not null,
  actor_name    text not null default '',
  actor_picture text not null default '',
  text          text not null default '',
  status        text not null default 'visible',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  target_type   text not null default 'acara',
  parent_id     text not null default ''
);
create index if not exists comments_target_idx on comments(target_type, target_id, created_at);

create table if not exists posts (
  id             text primary key,
  author_key     text not null,
  author_id      text not null default '',
  author_name    text not null default '',
  author_picture text not null default '',
  jenis          text not null default 'teks',
  isi            text not null default '',
  event_id       text not null default '',
  repost_of      text references posts(id) on delete set null,
  visibel        boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,
  reply_of       text references posts(id) on delete cascade,
  check (jenis in ('teks','foto','video','pengumuman','acara','berbagi'))
);
create index if not exists posts_visibel_idx on posts(visibel, created_at desc);
create index if not exists posts_author_idx on posts(author_id, created_at desc);
create index if not exists posts_repost_idx on posts(repost_of);
create index if not exists posts_reply_idx on posts(reply_of);

create table if not exists post_media (
  id         text primary key,
  post_id    text references posts(id) on delete cascade,
  url        text not null default '',
  mime       text not null default '',
  urut       integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists post_media_post_idx on post_media(post_id, urut);

create table if not exists follows (
  id         text primary key,
  actor_key  text not null,
  actor_id   text not null default '',
  target_id  text not null,
  created_at timestamptz not null default now(),
  unique (actor_key, target_id)
);
create index if not exists follows_target_idx on follows(target_id);

create table if not exists bookmarks (
  id         text primary key,
  actor_key  text not null,
  post_id    text references posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (actor_key, post_id)
);

create table if not exists stories (
  id         text primary key,
  kader_id   text not null,
  actor_key  text not null,
  url        text not null default '',
  mime       text not null default '',
  caption    text not null default '',
  created_at timestamptz not null default now(),
  kedaluarsa timestamptz not null
);
create index if not exists stories_aktif_idx on stories(kader_id, kedaluarsa desc);

-- ------------------------------------------------------------------- pustaka

create table if not exists pustaka_berkas (
  id       text primary key,
  judul    text not null default '',
  kategori text not null default '',
  ringkas  text not null default '',
  halaman  integer not null default 0,
  potong   integer not null default 0,
  byte     bigint  not null default 0,
  berkas   text not null default '',
  versi    text not null default '',
  tanggal  text not null default '',
  visibel  boolean not null default true
);

create table if not exists pustaka_potongan (
  id            bigserial primary key,
  doc           text references pustaka_berkas(id) on delete cascade,
  halaman       integer not null default 0,
  teks          text not null default '',
  halaman_akhir integer not null default 0,
  bab           text not null default '',
  cari          tsvector generated always as (to_tsvector('indonesian', teks)) stored
);
create index if not exists pustaka_potongan_doc_idx on pustaka_potongan(doc, halaman);
create index if not exists pustaka_potongan_trgm_idx on pustaka_potongan using gin (teks gin_trgm_ops);
create index if not exists pustaka_potongan_cari_idx on pustaka_potongan using gin (cari);

-- ---------------------------------------------------------------- Tanya PII

create table if not exists chat_log (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  kind       text not null default '',
  subject    text not null default '',
  question   text not null default '',
  answer     text not null default '',
  provider   text not null default '',
  status     text not null default 'ok'
);
create index if not exists chat_log_subject_idx on chat_log(subject, created_at desc);

create table if not exists threads (
  id      text primary key,
  actor   text not null,
  thread  text not null,
  judul   text not null default '',
  dibuat  timestamptz not null default now(),
  diubah  timestamptz not null default now(),
  isi     jsonb not null default '[]'::jsonb,
  jumlah  integer not null default 0,
  status  text not null default 'aktif',
  unique (actor, thread)
);

-- ------------------------------------------------------------------- fakta

create table if not exists fakta (
  id              text primary key,
  topik           text not null default '',
  pernyataan      text not null default '',
  sumber          text not null default '',
  tautan          text not null default '',
  terbit          date,
  berlaku_sejak   date,
  berlaku_sampai  date,
  status          text not null default 'menunggu' check (status in ('terkonfirmasi','usang','menunggu')),
  diperbarui      timestamptz not null default now(),
  peran           text not null default ''
);
create index if not exists fakta_aktif_idx on fakta(status, berlaku_sejak, berlaku_sampai);

-- ------------------------------------------------------------- notifikasi

create table if not exists notifikasi (
  id      text primary key,
  untuk   text not null,
  jenis   text not null default '',
  judul   text not null default '',
  isi     text not null default '',
  tautan  text not null default '',
  dibuat  timestamptz not null default now(),
  dibaca  timestamptz
);
create index if not exists notifikasi_kotak_idx on notifikasi(untuk, dibuat desc);
create index if not exists notifikasi_belum_idx on notifikasi(untuk) where dibaca is null;
