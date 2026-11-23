-- Moderasi Feed/Story. Postingan dan cerita yang diturunkan sengaja tetap
-- disimpan (soft delete) supaya bisa dipulihkan dan jejaknya terbaca. Kolom
-- status membedakan "diturunkan moderator" dari "dihapus penulis".

alter table posts add column if not exists status text not null default 'published';
alter table posts add column if not exists moderasi_oleh text not null default '';
alter table posts add column if not exists moderasi_alasan text not null default '';
alter table stories add column if not exists status text not null default 'published';

create table if not exists moderasi_log (
  id         text primary key,
  jenis      text not null default '',
  target_id  text not null default '',
  actor_key  text not null default '',
  actor_name text not null default '',
  admin_role text not null default '',
  alasan     text not null default '',
  dibuat     timestamptz not null default now(),
  detail     text not null default '',
  seq        bigint
);
create index if not exists moderasi_log_dibuat_idx on moderasi_log(dibuat desc);
create sequence if not exists moderasi_log_seq_seq owned by moderasi_log.seq;
alter table moderasi_log alter column seq set default nextval('moderasi_log_seq_seq'::regclass);
create index if not exists moderasi_log_seq_idx on moderasi_log (seq);

-- Tabel baru dibuat setelah 0002, jadi kunci dan RLS harus dipasang sendiri
-- seperti yang dilakukan 0004 untuk berkas dan props.
alter table moderasi_log enable row level security;
revoke all on moderasi_log from anon, authenticated;
grant all on moderasi_log to service_role, postgres;
