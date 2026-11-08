-- Barisan keamanan kedua. Frontend PB PII tidak pernah bicara langsung ke
-- Supabase: semua lewat /api/pii yang memakai kunci rahasia. Karena itu tabel
-- dikunci rapat (RLS aktif tanpa policy) supaya kunci publishable di browser
-- tidak bisa membaca satu baris pun walau disalahgunakan.

-- RLS aktif tanpa policy. Sengaja tanpa FORCE: pemilik tabel (peran postgres
-- yang dipakai skrip migrasi dan impor) harus tetap bisa menulis, sementara
-- anon dan authenticated tertutup rapat.
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename <> 'spatial_ref_sys'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

revoke all on schema public from anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- service_role (kunci rahasia di proxy) sengaja tidak diberi policy: perannya
-- memang menembus RLS, seperti akses admin sheet hari ini.

-- ------------------------------------------------------------------ buckets

insert into storage.buckets (id, name, public)
values
  ('media',   'media',   true),
  ('pustaka', 'pustaka', false),
  ('surat',   'surat',   false)
on conflict (id) do nothing;

-- Foto kabar, cerita, sampul artikel, dan galeri tampil lewat <img> biasa, jadi
-- hanya bucket 'media' yang boleh dibaca publik. Pustaka dan surat tetap
-- di-relay lewat backend seperti sekarang.
drop policy if exists "media baca publik" on storage.objects;
create policy "media baca publik" on storage.objects for select
  to public using (bucket_id = 'media');

drop policy if exists "hanya relay yang menulis" on storage.objects;
create policy "hanya relay yang menulis" on storage.objects for all
  to service_role using (true) with check (true);
