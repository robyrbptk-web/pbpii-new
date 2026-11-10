-- Peta Kaderisasi (#192). Titik di peta dan jenjang latihan sudah disediakan
-- migrasi pertama tetapi belum terpakai; yang belum ada hanyalah tanggal
-- selesai, supaya kader dapat melihat kegiatan berjalan sampai hari berapa,
-- bukan hanya hari mulainya.
alter table activities add column if not exists tanggal_selesai date;
