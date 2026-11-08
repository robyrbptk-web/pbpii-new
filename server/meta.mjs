// Dibangkitkan oleh scripts/bikin-meta.mjs - jangan sunting manual.
export const META = {
  "Articles": {
    "tabel": "articles",
    "headers": [
      "id",
      "title",
      "slug",
      "category",
      "excerpt",
      "content",
      "coverImage",
      "author",
      "status",
      "createdAt",
      "updatedAt",
      "seoTitle",
      "seoDescription",
      "seoKeywords",
      "orgId"
    ],
    "peta": [
      "id",
      "title",
      "slug",
      "category",
      "excerpt",
      "content",
      "cover_image",
      "author",
      "status",
      "created_at",
      "updated_at",
      "seo_title",
      "seo_description",
      "seo_keywords",
      "org_id"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "text not null",
      "text unique",
      "text not null default 'berita'",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "text not null default 'draft'",
      "timestamptz",
      "timestamptz",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "text references orgs(id) on delete set null"
    ],
    "ambil": [
      "id",
      "title",
      "slug",
      "category",
      "excerpt",
      "content",
      "cover_image",
      "author",
      "status",
      "created_at",
      "updated_at",
      "seo_title",
      "seo_description",
      "seo_keywords",
      "org_id",
      "seq"
    ]
  },
  "Settings": {
    "tabel": "settings",
    "headers": [
      "key",
      "value"
    ],
    "peta": [
      "key",
      "value"
    ],
    "pk": "key",
    "tipe": [
      "text primary key",
      "text not null default ''"
    ],
    "ambil": [
      "key",
      "value",
      "seq"
    ]
  },
  "Gallery": {
    "tabel": "gallery",
    "headers": [
      "id",
      "title",
      "imageUrl",
      "caption",
      "featured",
      "sortOrder",
      "createdAt"
    ],
    "peta": [
      "id",
      "title",
      "image_url",
      "caption",
      "featured",
      "sort_order",
      "created_at"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "boolean not null default false",
      "integer not null default 0",
      "timestamptz not null default now()"
    ],
    "ambil": [
      "id",
      "title",
      "image_url",
      "caption",
      "featured",
      "sort_order",
      "created_at",
      "seq"
    ]
  },
  "Orgs": {
    "tabel": "orgs",
    "headers": [
      "id",
      "jenjang",
      "name",
      "province",
      "district",
      "subdistrict",
      "parentId",
      "email",
      "passwordHash",
      "passwordSalt",
      "phone",
      "skUrl",
      "status",
      "verifiedBy",
      "verifiedAt",
      "createdAt",
      "updatedAt",
      "lastLoginAt",
      "note"
    ],
    "peta": [
      "id",
      "jenjang",
      "name",
      "province",
      "district",
      "subdistrict",
      "parent_id",
      "email",
      "password_hash",
      "password_salt",
      "phone",
      "sk_url",
      "status",
      "verified_by",
      "verified_at",
      "created_at",
      "updated_at",
      "last_login_at",
      "note"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "text not null check (jenjang in ('pb','pw','pd','pk'))",
      "text not null",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "text references orgs(id) on delete set null",
      "citext unique",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "text not null default 'pending'",
      "text not null default ''",
      "timestamptz",
      "timestamptz not null default now()",
      "timestamptz",
      "timestamptz",
      "text not null default ''"
    ],
    "ambil": [
      "id",
      "jenjang",
      "name",
      "province",
      "district",
      "subdistrict",
      "parent_id",
      "email",
      "password_hash",
      "password_salt",
      "phone",
      "sk_url",
      "status",
      "verified_by",
      "verified_at",
      "created_at",
      "updated_at",
      "last_login_at",
      "note",
      "seq"
    ]
  },
  "Activities": {
    "tabel": "activities",
    "headers": [
      "id",
      "orgId",
      "title",
      "category",
      "date",
      "location",
      "description",
      "participants",
      "coverImage",
      "status",
      "createdAt",
      "updatedAt",
      "startTime",
      "endTime",
      "registrationDeadline",
      "quota",
      "additionalInfo"
    ],
    "peta": [
      "id",
      "org_id",
      "title",
      "category",
      "tanggal_raw",
      "lokasi",
      "deskripsi",
      "peserta",
      "cover_image",
      "status",
      "created_at",
      "updated_at",
      "jam_mulai",
      "jam_selesai",
      "batas_daftar",
      "kuota",
      "info_tambahan"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "text references orgs(id) on delete cascade",
      "text not null",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "integer not null default 0",
      "text not null default ''",
      "text not null default 'published'",
      "timestamptz not null default now()",
      "timestamptz",
      "text not null default ''",
      "text not null default ''",
      "timestamptz",
      "integer not null default 0",
      "text not null default ''"
    ],
    "ambil": [
      "id",
      "org_id",
      "title",
      "category",
      "tanggal_raw",
      "lokasi",
      "deskripsi",
      "peserta",
      "cover_image",
      "status",
      "created_at",
      "updated_at",
      "jam_mulai",
      "jam_selesai",
      "batas_daftar",
      "kuota",
      "info_tambahan",
      "seq"
    ]
  },
  "Forms": {
    "tabel": "forms",
    "headers": [
      "id",
      "orgId",
      "activityId",
      "title",
      "description",
      "status",
      "createdAt",
      "updatedAt",
      "fields"
    ],
    "peta": [
      "id",
      "org_id",
      "activity_id",
      "title",
      "description",
      "status",
      "created_at",
      "updated_at",
      "fields"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "text references orgs(id) on delete cascade",
      "text references activities(id) on delete cascade",
      "text not null default ''",
      "text not null default ''",
      "text not null default 'draft'",
      "timestamptz not null default now()",
      "timestamptz",
      "jsonb not null default '[]'::jsonb"
    ],
    "ambil": [
      "id",
      "org_id",
      "activity_id",
      "title",
      "description",
      "status",
      "created_at",
      "updated_at",
      "fields",
      "seq"
    ]
  },
  "Participants": {
    "tabel": "participants",
    "headers": [
      "id",
      "formId",
      "orgId",
      "name",
      "institution",
      "phone",
      "email",
      "note",
      "createdAt",
      "answers",
      "status",
      "updatedAt",
      "registrationKey"
    ],
    "peta": [
      "id",
      "form_id",
      "org_id",
      "name",
      "institution",
      "phone",
      "email",
      "note",
      "created_at",
      "answers",
      "status",
      "updated_at",
      "registration_key"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "text references forms(id) on delete cascade",
      "text references orgs(id) on delete cascade",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "citext",
      "text not null default ''",
      "timestamptz not null default now()",
      "jsonb not null default '{}'::jsonb",
      "text not null default 'terdaftar'",
      "timestamptz",
      "text unique"
    ],
    "ambil": [
      "id",
      "form_id",
      "org_id",
      "name",
      "institution",
      "phone",
      "email",
      "note",
      "created_at",
      "answers",
      "status",
      "updated_at",
      "registration_key",
      "seq"
    ]
  },
  "Letters": {
    "tabel": "letters",
    "headers": [
      "id",
      "fromOrgId",
      "toOrgId",
      "category",
      "subject",
      "body",
      "status",
      "createdAt",
      "readAt",
      "replyToId",
      "threadId",
      "attachmentId",
      "attachmentName"
    ],
    "peta": [
      "id",
      "from_org_id",
      "to_org_id",
      "category",
      "subject",
      "body",
      "status",
      "created_at",
      "read_at",
      "reply_to_id",
      "thread_id",
      "attachment_id",
      "attachment_name"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "text references orgs(id) on delete cascade",
      "text references orgs(id) on delete cascade",
      "text not null default 'kesekretariatan'",
      "text not null default ''",
      "text not null default ''",
      "text not null default 'unread'",
      "timestamptz not null default now()",
      "timestamptz",
      "text",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''"
    ],
    "ambil": [
      "id",
      "from_org_id",
      "to_org_id",
      "category",
      "subject",
      "body",
      "status",
      "created_at",
      "read_at",
      "reply_to_id",
      "thread_id",
      "attachment_id",
      "attachment_name",
      "seq"
    ]
  },
  "Sessions": {
    "tabel": "sessions",
    "headers": [
      "token",
      "kind",
      "subject",
      "createdAt",
      "expiresAt"
    ],
    "peta": [
      "token",
      "kind",
      "subject",
      "created_at",
      "expires_at"
    ],
    "pk": "token",
    "tipe": [
      "text primary key",
      "text not null",
      "text not null",
      "timestamptz not null default now()",
      "timestamptz not null"
    ],
    "ambil": [
      "token",
      "kind",
      "subject",
      "created_at",
      "expires_at",
      "seq"
    ]
  },
  "Chat": {
    "tabel": "chat_log",
    "headers": [
      "createdAt",
      "kind",
      "subject",
      "question",
      "answer",
      "provider",
      "status"
    ],
    "peta": [
      "created_at",
      "kind",
      "subject",
      "question",
      "answer",
      "provider",
      "status"
    ],
    "pk": "id",
    "tipe": [
      "timestamptz not null default now()",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "text not null default 'ok'"
    ],
    "ambil": [
      "id",
      "created_at",
      "kind",
      "subject",
      "question",
      "answer",
      "provider",
      "status",
      "seq"
    ]
  },
  "Standards": {
    "tabel": "standards",
    "headers": [
      "id",
      "orgId",
      "minPerMonth",
      "setByOrgId",
      "setByName",
      "note",
      "updatedAt"
    ],
    "peta": [
      "id",
      "org_id",
      "min_per_month",
      "set_by_org_id",
      "set_by_name",
      "note",
      "updated_at"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "text references orgs(id) on delete cascade",
      "integer not null default 1",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "timestamptz not null default now()"
    ],
    "ambil": [
      "id",
      "org_id",
      "min_per_month",
      "set_by_org_id",
      "set_by_name",
      "note",
      "updated_at",
      "seq"
    ]
  },
  "Kaders": {
    "tabel": "kader",
    "headers": [
      "id",
      "email",
      "name",
      "picture",
      "googleSub",
      "createdAt",
      "lastLoginAt",
      "note",
      "passwordHash",
      "passwordSalt",
      "username",
      "bio",
      "lokasi",
      "jenjang",
      "orgId",
      "tautan",
      "sampul",
      "profilPada"
    ],
    "peta": [
      "id",
      "email",
      "name",
      "picture",
      "google_sub",
      "created_at",
      "last_login_at",
      "note",
      "password_hash",
      "password_salt",
      "username",
      "bio",
      "lokasi",
      "jenjang",
      "org_id",
      "tautan",
      "sampul",
      "profil_on"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "citext unique",
      "text not null default ''",
      "text not null default ''",
      "text",
      "timestamptz not null default now()",
      "timestamptz",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "citext unique",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "text references orgs(id) on delete set null",
      "text not null default ''",
      "text not null default ''",
      "timestamptz"
    ],
    "ambil": [
      "id",
      "email",
      "name",
      "picture",
      "google_sub",
      "created_at",
      "last_login_at",
      "note",
      "password_hash",
      "password_salt",
      "username",
      "bio",
      "lokasi",
      "jenjang",
      "org_id",
      "tautan",
      "sampul",
      "profil_on",
      "seq"
    ]
  },
  "Reactions": {
    "tabel": "reactions",
    "headers": [
      "id",
      "eventId",
      "actorKey",
      "actorName",
      "kind",
      "createdAt",
      "targetType"
    ],
    "peta": [
      "id",
      "target_id",
      "actor_key",
      "actor_name",
      "kind",
      "created_at",
      "target_type"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "text not null",
      "text not null",
      "text not null default ''",
      "text not null default 'like'",
      "timestamptz not null default now()",
      "text not null default 'acara'"
    ],
    "ambil": [
      "id",
      "target_id",
      "actor_key",
      "actor_name",
      "kind",
      "created_at",
      "target_type",
      "seq"
    ]
  },
  "Comments": {
    "tabel": "comments",
    "headers": [
      "id",
      "eventId",
      "actorKey",
      "actorName",
      "actorPicture",
      "text",
      "status",
      "createdAt",
      "updatedAt",
      "targetType",
      "parentId"
    ],
    "peta": [
      "id",
      "target_id",
      "actor_key",
      "actor_name",
      "actor_picture",
      "text",
      "status",
      "created_at",
      "updated_at",
      "target_type",
      "parent_id"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "text not null",
      "text not null",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "text not null default 'visible'",
      "timestamptz not null default now()",
      "timestamptz",
      "text not null default 'acara'",
      "text not null default ''"
    ],
    "ambil": [
      "id",
      "target_id",
      "actor_key",
      "actor_name",
      "actor_picture",
      "text",
      "status",
      "created_at",
      "updated_at",
      "target_type",
      "parent_id",
      "seq"
    ]
  },
  "PustakaBerkas": {
    "tabel": "pustaka_berkas",
    "headers": [
      "id",
      "judul",
      "kategori",
      "ringkas",
      "halaman",
      "potong",
      "byte",
      "berkas",
      "versi",
      "tanggal",
      "visibel"
    ],
    "peta": [
      "id",
      "judul",
      "kategori",
      "ringkas",
      "halaman",
      "potong",
      "byte",
      "berkas",
      "versi",
      "tanggal",
      "visibel"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "integer not null default 0",
      "integer not null default 0",
      "bigint not null default 0",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "boolean not null default true"
    ],
    "ambil": [
      "id",
      "judul",
      "kategori",
      "ringkas",
      "halaman",
      "potong",
      "byte",
      "berkas",
      "versi",
      "tanggal",
      "visibel",
      "seq"
    ]
  },
  "PustakaPotongan": {
    "tabel": "pustaka_potongan",
    "headers": [
      "doc",
      "halaman",
      "teks",
      "halamanAkhir",
      "bab"
    ],
    "peta": [
      "doc",
      "halaman",
      "teks",
      "halaman_akhir",
      "bab"
    ],
    "pk": "id",
    "tipe": [
      "text references pustaka_berkas(id) on delete cascade",
      "integer not null default 0",
      "text not null default ''",
      "integer not null default 0",
      "text not null default ''"
    ],
    "ambil": [
      "id",
      "doc",
      "halaman",
      "teks",
      "halaman_akhir",
      "bab",
      "seq"
    ]
  },
  "Posts": {
    "tabel": "posts",
    "headers": [
      "id",
      "authorKey",
      "authorId",
      "authorName",
      "authorPicture",
      "jenis",
      "isi",
      "eventId",
      "repostOf",
      "visibel",
      "createdAt",
      "updatedAt"
    ],
    "peta": [
      "id",
      "author_key",
      "author_id",
      "author_name",
      "author_picture",
      "jenis",
      "isi",
      "event_id",
      "repost_of",
      "visibel",
      "created_at",
      "updated_at"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "text not null",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "text not null default 'teks'",
      "text not null default ''",
      "text not null default ''",
      "text references posts(id) on delete set null",
      "boolean not null default true",
      "timestamptz not null default now()",
      "timestamptz"
    ],
    "ambil": [
      "id",
      "author_key",
      "author_id",
      "author_name",
      "author_picture",
      "jenis",
      "isi",
      "event_id",
      "repost_of",
      "visibel",
      "created_at",
      "updated_at",
      "seq"
    ]
  },
  "PostMedia": {
    "tabel": "post_media",
    "headers": [
      "id",
      "postId",
      "url",
      "mime",
      "urut",
      "createdAt"
    ],
    "peta": [
      "id",
      "post_id",
      "url",
      "mime",
      "urut",
      "created_at"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "text references posts(id) on delete cascade",
      "text not null default ''",
      "text not null default ''",
      "integer not null default 0",
      "timestamptz not null default now()"
    ],
    "ambil": [
      "id",
      "post_id",
      "url",
      "mime",
      "urut",
      "created_at",
      "seq"
    ]
  },
  "Follows": {
    "tabel": "follows",
    "headers": [
      "id",
      "actorKey",
      "actorId",
      "targetId",
      "createdAt"
    ],
    "peta": [
      "id",
      "actor_key",
      "actor_id",
      "target_id",
      "created_at"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "text not null",
      "text not null default ''",
      "text not null",
      "timestamptz not null default now()"
    ],
    "ambil": [
      "id",
      "actor_key",
      "actor_id",
      "target_id",
      "created_at",
      "seq"
    ]
  },
  "Bookmarks": {
    "tabel": "bookmarks",
    "headers": [
      "id",
      "actorKey",
      "postId",
      "createdAt"
    ],
    "peta": [
      "id",
      "actor_key",
      "post_id",
      "created_at"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "text not null",
      "text references posts(id) on delete cascade",
      "timestamptz not null default now()"
    ],
    "ambil": [
      "id",
      "actor_key",
      "post_id",
      "created_at",
      "seq"
    ]
  },
  "Stories": {
    "tabel": "stories",
    "headers": [
      "id",
      "kaderId",
      "actorKey",
      "url",
      "mime",
      "caption",
      "createdAt",
      "kedaluarsa"
    ],
    "peta": [
      "id",
      "kader_id",
      "actor_key",
      "url",
      "mime",
      "caption",
      "created_at",
      "kedaluarsa"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "text not null",
      "text not null",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "timestamptz not null default now()",
      "timestamptz not null"
    ],
    "ambil": [
      "id",
      "kader_id",
      "actor_key",
      "url",
      "mime",
      "caption",
      "created_at",
      "kedaluarsa",
      "seq"
    ]
  },
  "Threads": {
    "tabel": "threads",
    "headers": [
      "id",
      "actor",
      "thread",
      "judul",
      "dibuat",
      "diubah",
      "isi",
      "jumlah",
      "status"
    ],
    "peta": [
      "id",
      "actor",
      "thread",
      "judul",
      "dibuat",
      "diubah",
      "isi",
      "jumlah",
      "status"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "text not null",
      "text not null",
      "text not null default ''",
      "timestamptz not null default now()",
      "timestamptz not null default now()",
      "jsonb not null default '[]'::jsonb",
      "integer not null default 0",
      "text not null default 'aktif'"
    ],
    "ambil": [
      "id",
      "actor",
      "thread",
      "judul",
      "dibuat",
      "diubah",
      "isi",
      "jumlah",
      "status",
      "seq"
    ]
  },
  "Fakta": {
    "tabel": "fakta",
    "headers": [
      "id",
      "topik",
      "pernyataan",
      "sumber",
      "tautan",
      "terbit",
      "berlakuSejak",
      "berlakuSampai",
      "status",
      "diperbarui",
      "peran"
    ],
    "peta": [
      "id",
      "topik",
      "pernyataan",
      "sumber",
      "tautan",
      "terbit",
      "berlaku_sejak",
      "berlaku_sampai",
      "status",
      "diperbarui",
      "peran"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "date",
      "date",
      "date",
      "text not null default 'menunggu' check (status in ('terkonfirmasi','usang','menunggu'))",
      "timestamptz not null default now()",
      "text not null default ''"
    ],
    "ambil": [
      "id",
      "topik",
      "pernyataan",
      "sumber",
      "tautan",
      "terbit",
      "berlaku_sejak",
      "berlaku_sampai",
      "status",
      "diperbarui",
      "peran",
      "seq"
    ]
  },
  "Notifikasi": {
    "tabel": "notifikasi",
    "headers": [
      "id",
      "untuk",
      "jenis",
      "judul",
      "isi",
      "tautan",
      "dibuat",
      "dibaca"
    ],
    "peta": [
      "id",
      "untuk",
      "jenis",
      "judul",
      "isi",
      "tautan",
      "dibuat",
      "dibaca"
    ],
    "pk": "id",
    "tipe": [
      "text primary key",
      "text not null",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "text not null default ''",
      "timestamptz not null default now()",
      "timestamptz"
    ],
    "ambil": [
      "id",
      "untuk",
      "jenis",
      "judul",
      "isi",
      "tautan",
      "dibuat",
      "dibaca",
      "seq"
    ]
  }
};

export const TABEL_KE_SHEET = Object.fromEntries(
  Object.entries(META).map(([sheet, m]) => [m.tabel, sheet]),
);

export function lembar(namaSheet) {
  const m = META[namaSheet];
  if (!m) throw new Error('Lembar tidak dikenal: ' + namaSheet);
  return m;
}
