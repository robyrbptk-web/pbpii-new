// Peta lembar Apps Script -> tabel Supabase, satu-satunya tempat pemetaan itu
// ditulis. Generator meta dan importer sama-sama membaca berkas ini.
export const TABEL = {
  Articles: 'articles',
  Settings: 'settings',
  Gallery: 'gallery',
  Orgs: 'orgs',
  Activities: 'activities',
  Forms: 'forms',
  Participants: 'participants',
  Letters: 'letters',
  Sessions: 'sessions',
  Chat: 'chat_log',
  Standards: 'standards',
  Kaders: 'kader',
  Reactions: 'reactions',
  Comments: 'comments',
  PustakaBerkas: 'pustaka_berkas',
  PustakaPotongan: 'pustaka_potongan',
  Posts: 'posts',
  PostMedia: 'post_media',
  Follows: 'follows',
  Bookmarks: 'bookmarks',
  Stories: 'stories',
  Threads: 'threads',
  Fakta: 'fakta',
  Notifikasi: 'notifikasi',
};

// Kunci baris untuk menandai posisi, meniru "id" pada sheet.
export const KUNCI = {
  settings: 'key',
  sessions: 'token',
};

// Header sheet yang tidak berubah menjadi snake_case biasa.
export const GANTI = {
  date: 'tanggal_raw',
  location: 'lokasi',
  description: 'deskripsi',
  participants: 'peserta',
  startTime: 'jam_mulai',
  endTime: 'jam_selesai',
  registrationDeadline: 'batas_daftar',
  quota: 'kuota',
  additionalInfo: 'info_tambahan',
  endDate: 'tanggal_selesai',
  latitude: 'geolintar',
  longitude: 'geolongitur',
  eventId: 'target_id',
  profilPada: 'profil_on',
};

// Urutan penulisan: tabel induk lebih dulu supaya foreign key tidak menyalak.
export const URUT = [
  'settings',
  'orgs',
  'standards',
  'kader',
  'articles',
  'gallery',
  'activities',
  'forms',
  'participants',
  'letters',
  'sessions',
  'posts',
  'post_media',
  'reactions',
  'comments',
  'follows',
  'bookmarks',
  'stories',
  'threads',
  'pustaka_berkas',
  'pustaka_potongan',
  'fakta',
  'notifikasi',
  'chat_log',
];

export function keSnake(nama) {
  return String(nama)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}
