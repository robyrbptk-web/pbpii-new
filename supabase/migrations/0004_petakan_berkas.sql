-- Berkas yang dulu hidup di folder Drive sekarang di Supabase Storage. Petanya
-- (siapa pemiliknya, jenisnya, keterangan yang dipakai surat untuk memeriksa
-- izin) tetap harus bisa dibaca ulang lewat satu id, jadi disimpan di tabel.

create table if not exists berkas (
  id         text primary key,
  emberas    text not null check (emberas in ('media', 'surat', 'pustaka')),
  nama       text not null default '',
  mime       text not null default 'application/octet-stream',
  keterangan text not null default '',
  publik     boolean not null default false,
  byte       bigint not null default 0,
  dibuat     timestamptz not null default now(),
  diubah     timestamptz not null default now(),
  sampah     boolean not null default false
);
create index if not exists berkas_emberas_idx on berkas(emberas, nama);
create index if not exists berkas_dibuat_idx on berkas(emberas, dibuat desc);

-- Sama seperti tabel lain: tidak ada akses anonim. service_role menembus RLS
-- tanpa policy, seperti relay Apps Script hari ini.
alter table berkas enable row level security;
revoke all on berkas from anon, authenticated;
grant all on berkas to service_role, postgres;

-- ------------------------------------------------------------- properties
-- Script Properties Apps Script punya taburan tempat penyimpanan sendiri.
-- Nilai yang sudah ditentukan saat pasang tetap lewat environment; nilai yang
-- ditulis setup() (id folder, kunci impor, tanggal korpus) masuk ke sini.

create table if not exists props (
  key   text primary key,
  value text not null default ''
);

alter table props enable row level security;
revoke all on props from anon, authenticated;
grant all on props to service_role, postgres;
