// Tiruan SpreadsheetApp di atas PostgREST.
//
// Kode backend hasil pemindahan mencari baris lewat nomor baris sheet, jadi
// lapisan ini menjaga tiga hal: urutan baris stabil (kolom seq), nilai sel
// berbentuk sama seperti dari sheet (tanggal menjadi Date, jsonb menjadi teks),
// dan tulisan yang baru terjadi langsung terbaca di permintaan yang sama.
//
// Tulisan tidak dikirim satu per satu. Tiap perubahan dicatat di antrean dan
// digabung bila menimpa baris yang sama, lalu dijalankan sekaligus oleh
// simpanSesi() sebelum respons dikirim.
import { META } from './meta.mjs';
import { db } from './supa.mjs';

// Semua keluaran lewat selubung yang sama dengan lapisan berkas.
function rest(alur, opsi = {}) {
  return db(alur, opsi);
}

// ------------------------------------------------------------------ nilai sel

function jenis(tipe) {
  const s = String(tipe || '');
  if (/^(bigint|integer|smallint|numeric|double|real)/.test(s)) return 'angka';
  if (/^boolean/.test(s)) return 'logika';
  if (/^json/.test(s)) return 'json';
  if (/^timestamp/.test(s)) return 'waktu';
  if (/^date/.test(s)) return 'tanggal';
  return 'teks';
}

const wajib = (tipe) => /not null/.test(String(tipe || ''));

/** Nilai kolom database -> isi sel seperti yang diberikan sheet. */
function keSel(barisDb, meta, indeks) {
  const nilai = barisDb[meta.peta[indeks]];
  const tipe = meta.tipe[indeks];
  if (nilai === null || nilai === undefined) return '';
  switch (jenis(tipe)) {
    case 'waktu':
      return new Date(nilai);
    case 'json':
      return typeof nilai === 'string' ? nilai : JSON.stringify(nilai);
    case 'angka':
      return Number(nilai);
    case 'logika':
      return nilai === true || String(nilai) === 'true';
    default:
      if (typeof nilai !== 'string') return String(nilai);
      // Sheets membaca sel bertuliskan TRUE/FALSE sebagai nilai logika, bukan
      // teks. Tanpa ini String(sel) menghasilkan "TRUE" padahal backend lama
      // menghasilkan "true", dan pemeriksa di frontend jadi tidak cocok.
      if (/^true$/i.test(nilai)) return true;
      if (/^false$/i.test(nilai)) return false;
      return nilai;
  }
}

/** Isi sel -> nilai kolom database. */
function keKolom(nilai, tipe) {
  const j = jenis(tipe);
  if (nilai === undefined || nilai === null || nilai === '') {
    if (!wajib(tipe)) return null;
    if (j === 'angka') return 0;
    if (j === 'logika') return false;
    if (j === 'teks' || j === 'tanggal') return '';
    return null;
  }
  switch (j) {
    case 'waktu':
      return nilai instanceof Date ? nilai.toISOString() : String(nilai);
    case 'tanggal':
      return String(nilai).slice(0, 10);
    case 'angka': {
      const angka = Number(String(nilai).replace(/,/g, ''));
      return Number.isFinite(angka) ? angka : wajib(tipe) ? 0 : null;
    }
    case 'logika':
      return /^true|1|yes$/i.test(String(nilai));
    case 'json':
      if (typeof nilai === 'object') return nilai;
      try {
        return JSON.parse(String(nilai));
      } catch {
        return wajib(tipe) ? {} : null;
      }
    default:
      // Sel sheet yang berisi nilai logika tersimpan sebagai teks TRUE/FALSE;
      // tulis dengan bentuk yang sama supaya bacaan berikutnya kembali cocok.
      if (typeof nilai === 'boolean') return nilai ? 'TRUE' : 'FALSE';
      return nilai instanceof Date ? nilai.toISOString() : String(nilai);
  }
}

// -------------------------------------------------------------------- sesi

let aktif = null;

export function sesi() {
  if (!aktif) aktif = { memo: new Map(), antre: [] };
  return aktif;
}

/** Satu permintaan = satu sesi baca/tulis. */
export function bukaSesi() {
  aktif = { memo: new Map(), antre: [] };
  return aktif;
}

export function tutupSesi() {
  aktif = null;
}

function dorong(ubah) {
  const s = sesi();
  if (ubah.op === 'ubah') {
    const lama = s.antre.find((x) => x.op === 'ubah' && x.tabel === ubah.tabel && x.pk === ubah.pk);
    if (lama) {
      Object.assign(lama.nilai, ubah.nilai);
      return;
    }
  }
  s.antre.push(ubah);
}

const MAKS_WAKIL = 200;

/** Jalankan seluruh tulisan yang tertunda, urut seperti kejadian aslinya. */
export function simpanSesi() {
  if (!aktif) return { ditulis: 0 };
  const s = aktif;
  const antre = s.antre.slice();
  s.antre.length = 0;
  let ditulis = 0;
  for (const ubah of antre) {
    const alamat = `${encodeURIComponent(ubah.kunci)}=eq.${encodeURIComponent(ubah.pk)}`;
    if (ubah.op === 'ubah') {
      rest(ubah.tabel, { metode: 'PATCH', kueri: alamat, badan: ubah.nilai });
      ditulis++;
    } else if (ubah.op === 'hapus') {
      rest(ubah.tabel, { metode: 'DELETE', kueri: alamat });
      ditulis++;
    } else if (ubah.op === 'tambah' && ubah.baris.length) {
      const perluWakil = ubah.olehPk && ubah.baris.length <= MAKS_WAKIL;
      const hasil = rest(ubah.tabel, {
        metode: 'POST',
        badan: ubah.baris,
        kepala: { Prefer: `return=${perluWakil ? 'representation' : 'minimal'}` },
      });
      if (perluWakil) {
        const baru = JSON.parse(hasil.teks || '[]');
        ubah.sasaran.forEach((row, i) => {
          if (baru[i]) row.pk = baru[i][ubah.kunci];
        });
      }
      ditulis += ubah.baris.length;
    }
  }
  return { ditulis };
}

/** Buang hasil baca supaya permintaan berikutnya tidak memakai data usang. */
export function resetMemo() {
  if (aktif) aktif.memo = new Map();
}

// ------------------------------------------------------------------- rentang

function hurufKeKolom(huruf) {
  return [...String(huruf).toUpperCase()].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);
}

class Rentang {
  constructor(lembar, baris, kolom, jumlahBaris, jumlahKolom) {
    this.lembar = lembar;
    this.baris = baris;
    this.kolom = kolom;
    this.jumlahBaris = jumlahBaris;
    this.jumlahKolom = jumlahKolom;
  }

  getRow() { return this.baris; }
  getColumn() { return this.kolom; }
  getNumRows() { return this.jumlahBaris; }
  getNumColumns() { return this.jumlahKolom; }
  getSheet() { return this.lembar; }

  nilai(tampil) {
    const keluaran = [];
    for (let i = 0; i < this.jumlahBaris; i++) {
      const absolut = this.baris + i;
      if (absolut === 1) {
        keluaran.push(
          Array.from({ length: this.jumlahKolom }, (_, k) => this.lembar.meta.headers[this.kolom - 1 + k]),
        );
        continue;
      }
      const barisData = this.lembar.isi()[absolut - 2];
      keluaran.push(
        Array.from({ length: this.jumlahKolom }, (_, k) => {
          const isi = barisData ? barisData.sel[this.kolom - 1 + k] : '';
          const aman = isi === undefined ? '' : isi;
          if (!tampil) return aman;
          if (aman instanceof Date) return aman.toISOString();
          return aman === null ? '' : String(aman);
        }),
      );
    }
    return keluaran;
  }

  getValues() { return this.nilai(false); }
  getDisplayValues() { return this.nilai(true); }
  getValue() { return this.nilai(false)[0][0]; }
  getDisplayValue() { return this.nilai(true)[0][0]; }

  setValues(baris) {
    this.lembar.tulisBlok(this.baris, this.kolom, baris);
    return this;
  }

  setValue(nilai) { return this.setValues([[nilai]]); }

  clearContents() {
    return this.setValues(
      Array.from({ length: this.jumlahBaris }, () => Array.from({ length: this.jumlahKolom }, () => '')),
    );
  }

  clear() { return this.clearContents(); }

  // Gaya sel hanya berarti di sheet; di database tidak ada yang perlu diubah.
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setVerticalAlignment() { return this; }
}

// -------------------------------------------------------------------- lembar

class Lembar {
  constructor(nama) {
    const meta = META[nama];
    if (!meta) throw new Error(`Lembar ${nama} tidak terdaftar di server/meta.mjs.`);
    this.nama = nama;
    this.meta = meta;
  }

  getName() { return this.nama; }

  /** Isi grid: daftar baris data, masing-masing selurut header sheet. */
  isi() {
    const s = sesi();
    const sudah = s.memo.get(this.meta.tabel);
    if (sudah) return sudah;
    const hasil = rest(this.meta.tabel, {
      kueri: `select=${this.meta.ambil.join(',')}&order=seq.asc.nullslast`,
    });
    const baris = JSON.parse(hasil.teks || '[]').map((row) => ({
      pk: row[this.meta.pk],
      sel: this.meta.headers.map((_, i) => keSel(row, this.meta, i)),
    }));
    s.memo.set(this.meta.tabel, baris);
    return baris;
  }

  getLastRow() { return this.isi().length + 1; }
  getLastColumn() { return this.meta.headers.length; }
  getRowCount() { return this.isi().length + 1; }
  getMaxRows() { return 10000000; }
  getMaxColumns() { return 18278; }

  getRange(...argumen) {
    if (typeof argumen[0] === 'string') return this.rangeA1(argumen[0]);
    const baris = Number(argumen[0]) || 1;
    const kolom = Number(argumen[1]) || 1;
    const jumlahBaris = argumen.length >= 3 ? Number(argumen[2]) || 1 : 1;
    const jumlahKolom = argumen.length >= 4 ? Number(argumen[3]) || 1 : 1;
    return new Rentang(this, baris, kolom, jumlahBaris, jumlahKolom);
  }

  rangeA1(a1) {
    const cocok = /^([A-Za-z]+)(\d+)?(?::([A-Za-z]+)(\d+)?)?$/.exec(String(a1).trim());
    if (!cocok) throw new Error(`Rentang tidak dikenali: ${a1}`);
    const kolomAwal = hurufKeKolom(cocok[1]);
    const barisAwal = Number(cocok[2] || 1);
    const kolomAkhir = cocok[3] ? hurufKeKolom(cocok[3]) : kolomAwal;
    const barisAkhir = cocok[4] ? Number(cocok[4]) : this.getLastRow();
    return new Rentang(
      this,
      barisAwal,
      kolomAwal,
      Math.max(1, barisAkhir - barisAwal + 1),
      Math.max(1, kolomAkhir - kolomAwal + 1),
    );
  }

  getDataRange() {
    return new Rentang(this, 1, 1, this.getLastRow(), this.getLastColumn());
  }

  /**
   * Tulis blok nilai pada posisi grid. Baris di bawah baris terakhir dianggap
   * tambahan baru; baris satu ditinggalkan karena skema kolom sudah tetap.
   */
  tulisBlok(barisMulai, kolomMulai, baris) {
    for (let i = 0; i < baris.length; i++) {
      const absolut = barisMulai + i;
      if (absolut === 1) continue;
      const isiBaris = Array.isArray(baris[i]) ? baris[i] : [baris[i]];
      if (absolut - 2 >= this.isi().length) this.tambahBaris(isiBaris, kolomMulai);
      else this.tulisSel(absolut - 2, kolomMulai, isiBaris);
    }
  }

  /** Salin baris grid ke baris data yang sudah ada lewat kunci utamanya. */
  tulisSel(indeks, kolomMulai, nilai) {
    if (this.isi()[indeks] && this.isi()[indeks].pk === null) this.selesaikanTambahan();
    const baris = this.isi()[indeks];
    if (!baris) return;
    const perubahan = {};
    nilai.forEach((isi, k) => {
      const i = kolomMulai - 1 + k;
      const kolom = this.meta.peta[i];
      if (!kolom) return;
      baris.sel[i] = isi === undefined ? '' : isi;
      perubahan[kolom] = keKolom(isi, this.meta.tipe[i]);
    });
    if (Object.keys(perubahan).length) {
      dorong({ op: 'ubah', tabel: this.meta.tabel, kunci: this.meta.pk, pk: baris.pk, nilai: perubahan });
    }
  }

  /** Susun satu baris grid menjadi baris baru dan antre sebagai POST. */
  tambahBaris(nilai, kolomMulai = 1) {
    const s = sesi();
    const kolom = {};
    const sel = this.meta.headers.map(() => '');
    nilai.forEach((isi, k) => {
      const i = kolomMulai - 1 + k;
      const nama = this.meta.peta[i];
      if (!nama) return;
      sel[i] = isi === undefined ? '' : isi;
      const ubah = keKolom(isi, this.meta.tipe[i]);
      if (ubah === null && !wajib(this.meta.tipe[i])) return;
      kolom[nama] = ubah;
    });
    const pkHeader = this.meta.peta.indexOf(this.meta.pk);
    const barisBaru = {
      pk: pkHeader >= 0 && kolom[this.meta.pk] !== undefined ? kolom[this.meta.pk] : null,
      sel,
    };
    this.isi().push(barisBaru);
    const terakhir = s.antre[s.antre.length - 1];
    if (terakhir && terakhir.op === 'tambah' && terakhir.tabel === this.meta.tabel) {
      terakhir.baris.push(kolom);
      terakhir.sasaran.push(barisBaru);
    } else {
      s.antre.push({
        op: 'tambah',
        tabel: this.meta.tabel,
        kunci: this.meta.pk,
        olehPk: pkHeader < 0,
        baris: [kolom],
        sasaran: [barisBaru],
      });
    }
    return barisBaru;
  }

  appendRow(nilai) {
    this.tambahBaris(Array.isArray(nilai) ? nilai : [nilai]);
    return this;
  }

  /**
   * Kunci database baris yang baru ditambahkan sesi ini baru diketahui setelah
   * POST jalan. Panggilan ini menuntaskan antrean lalu membaca ulang.
   */
  selesaikanTambahan() {
    simpanSesi();
    sesi().memo.delete(this.meta.tabel);
    this.isi();
  }

  deleteRow(nomor) {
    if (this.isi().some((x) => x.pk === null)) this.selesaikanTambahan();
    const baris = this.isi()[Number(nomor) - 2];
    if (!baris || baris.pk === null) return this;
    this.isi().splice(Number(nomor) - 2, 1);
    dorong({ op: 'hapus', tabel: this.meta.tabel, kunci: this.meta.pk, pk: baris.pk });
    return this;
  }

  deleteRows(nomor, jumlah = 1) {
    for (let i = 0; i < jumlah; i++) this.deleteRow(nomor);
    return this;
  }

  clearContents() {
    if (this.isi().some((x) => x.pk === null)) this.selesaikanTambahan();
    const semua = this.isi().filter((x) => x.pk !== null);
    this.isi().length = 0;
    for (const baris of semua) {
      dorong({ op: 'hapus', tabel: this.meta.tabel, kunci: this.meta.pk, pk: baris.pk });
    }
    return this;
  }

  clear() { return this.clearContents(); }

  insertRowsAfter() { return this; }
  insertColumnsAfter() { return this; }
  insertRowBefore() { return this; }
  setFrozenRows() { return this; }
  hideGridlines() { return this; }
}

export function lembarObjek(nama) {
  return new Lembar(nama);
}

export class Buku {
  constructor(id) { this.id = String(id || ''); }

  getName() { return 'PB PII APP V2'; }
  getId() { return this.id; }

  getSheetByName(nama) {
    return META[nama] ? new Lembar(nama) : null;
  }

  getSheets() { return Object.keys(META).map((nama) => new Lembar(nama)); }

  insertSheet(nama) {
    if (!META[nama]) throw new Error(`Lembar ${nama} tidak terdaftar di server/meta.mjs.`);
    const s = sesi();
    if (!s.memo.has(META[nama].tabel)) s.memo.set(META[nama].tabel, []);
    return new Lembar(nama);
  }
}
