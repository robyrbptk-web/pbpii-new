/*
 * office.js — ekspor jawaban Tanya PII menjadi berkas Office asli.
 *
 * Hasil AI disimpan sebagai .docx dan .pptx OOXML, bukan HTML berkedok:
 * arsip ZIP-nya ditulis di sini tanpa pustaka eksternal supaya halaman
 * tetap jalan luring dan tidak menambah unduhan ke bundel aplikasi.
 * Entri ZIP disimpan tanpa kompresi (method 0) — Word dan PowerPoint
 * menerimanya, dan jawabannya terlalu kecil untuk terasa di ukuran berkas.
 */
(function (global) {
  'use strict';

  // ------------------------------------------------------------------- ZIP

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const encoder = new TextEncoder();

  function u16(value) { return [(value >>> 0) & 0xFF, (value >>> 8) & 0xFF]; }
  function u32(value) { return [(value >>> 0) & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF, (value >>> 24) & 0xFF]; }

  /** Entri bermetode 0: cukup untuk Word/PowerPoint dan tanpa dependensi. */
  function zipBerkas(entri) {
    const isi = entri.map((item) => ({
      nama: encoder.encode(item.name),
      data: typeof item.data === 'string' ? encoder.encode(item.data) : item.data,
    }));
    const cekWaktu = ((new Date().getHours() << 6) | (new Date().getMinutes() << 3) | Math.floor(new Date().getSeconds() / 2)) & 0xFFFF;
    const tanggal = (((new Date().getFullYear() - 1980) << 9) | ((new Date().getMonth() + 1) << 5) | new Date().getDate()) & 0xFFFF;

    const bagian = [];
    const pusat = [];
    let offset = 0;

    isi.forEach((item) => {
      const crc = crc32(item.data);
      const kepala = [
        0x50, 0x4B, 0x03, 0x04, 20, 0, 0, 0,
        ...u16(0), ...u16(cekWaktu), ...u16(tanggal),
        ...u32(crc), ...u32(item.data.length), ...u32(item.data.length),
        ...u16(item.nama.length), ...u16(0),
      ];
      bagian.push(Uint8Array.from(kepala), item.nama, item.data);
      pusat.push(Uint8Array.from([
        0x50, 0x4B, 0x01, 0x02,
        20, 0,                       // dibuat oleh DOS, versi 2.0
        20, 0,                       // versi minimum untuk membaca
        ...u16(0),                   // bendera
        ...u16(0),                   // metode 0 = disimpan apa adanya
        ...u16(cekWaktu), ...u16(tanggal),
        ...u32(crc), ...u32(item.data.length), ...u32(item.data.length),
        ...u16(item.nama.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ]), item.nama);
      offset += kepala.length + item.nama.length + item.data.length;
    });

    const isiSentral = [];
    let ukuranSentral = 0;
    pusat.forEach((potongan) => { isiSentral.push(potongan); ukuranSentral += potongan.length; });
    const akhir = [
      0x50, 0x4B, 0x05, 0x06, 0, 0, 0, 0,
      ...u16(isi.length), ...u16(isi.length),
      ...u32(ukuranSentral), ...u32(offset), ...u16(0),
    ];

    const semua = [...bagian, ...isiSentral, Uint8Array.from(akhir)];
    const total = semua.reduce((jumlah, potongan) => jumlah + potongan.length, 0);
    const keluaran = new Uint8Array(total);
    let posisi = 0;
    semua.forEach((potongan) => { keluaran.set(potongan, posisi); posisi += potongan.length; });
    return keluaran;
  }

  // ------------------------------------------------------------------ XML

  function lepasNilai(teks) {
    return String(teks ?? '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  /*
   * markdown.js membungkus seluruh jawaban di dalam <div class="tanya-tulis">
   * dan menaruh blok kode dalam wadah berhias kepala + tombol. Berkas Office
   * tidak boleh menyalin kulit itu — atau kehilangan isinya karena semuanya
   * tampak satu elemen — jadi susunan blok diluruskan lebih dulu.
   */
  const BLOK_SAH = /^(H[1-6]|P|UL|OL|TABLE|BLOCKQUOTE|PRE|HR)$/;
  const PERALATAN = /(^|\s)(tanya-sorot-kepala|tanya-sorot_tombol|tanya-sorot-bentang|tanya-terminal-kepala|tanya-kode-nomor|tanya-act)(\s|$)/;

  function paragrafTeks(teks) {
    const par = document.createElement('p');
    par.textContent = teks;
    return par;
  }

  function blokDari(induk) {
    const keluaran = [];
    const jalan = (node) => {
      if (node.nodeType === 3) {
        const teks = (node.textContent || '').trim();
        if (teks) keluaran.push(paragrafTeks(teks));
        return;
      }
      if (node.nodeType !== 1) return;
      if (/^(BUTTON|SVG|SCRIPT|STYLE|NOSCRIPT|IFRAME)$/u.test(node.tagName)) return;
      if (PERALATAN.test(node.getAttribute('class') || '')) return;
      if (BLOK_SAH.test(node.tagName)) { keluaran.push(node); return; }
      const anak = [...node.children];
      if (!anak.length) {
        const teks = (node.textContent || '').trim();
        if (teks) keluaran.push(paragrafTeks(teks));
        return;
      }
      anak.forEach(jalan);
    };
    [...induk.childNodes].forEach(jalan);
    return keluaran;
  }

  // ------------------------------------------------------------------ DOCX

  const DOC_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

  function jalanDoc(el, link) {
    const keluaran = [];
    const jalankan = (node, gaya) => {
      if (node.nodeType === 3) {
        const teks = node.textContent;
        if (teks) keluaran.push(docRun(teks, gaya));
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (tag === 'BR') { keluaran.push('<w:r><w:br/></w:r>'); return; }
      const next = { ...gaya };
      if (tag === 'STRONG' || tag === 'B') next.b = true;
      if (tag === 'EM' || tag === 'I') next.i = true;
      if (tag === 'CODE') next.mono = true;
      if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') next.strike = true;
      if (tag === 'A') {
        const href = node.getAttribute('href') || '';
        if (/^https?:/i.test(href)) {
          const id = link.add(href);
          keluaran.push(`<w:hyperlink r:id="${id}" w:history="1">`);
          [...node.childNodes].forEach((anak) => jalankan(anak, { ...next, hyperlink: true }));
          keluaran.push('</w:hyperlink>');
          return;
        }
      }
      [...node.childNodes].forEach((anak) => jalankan(anak, next));
    };
    [...el.childNodes].forEach((anak) => jalankan(anak, {}));
    return keluaran.join('');
  }

  function docRun(teks, gaya) {
    const props = [];
    if (gaya.mono) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F1F3F5"/>');
    if (gaya.b) props.push('<w:b/>');
    if (gaya.i) props.push('<w:i/>');
    if (gaya.strike) props.push('<w:strike/>');
    if (gaya.hyperlink) props.push('<w:color w:val="1B6CA2"/><w:u w:val="single"/>');
    return `<w:r>${props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''}<w:t xml:space="preserve">${lepasNilai(teks)}</w:t></w:r>`;
  }

  function paragrafDoc(isi, tambahan = '') {
    return `<w:p>${tambahan ? `<w:pPr>${tambahan}</w:pPr>` : ''}${isi}</w:p>`;
  }

  /** Blok Markdown → WordprocessingML; daftar memakai indentasi nyata, bukan nomor palsu. */
  function blokDoc(root, link, judulAsli) {
    const bagian = [];
    // Word menolak tabel berdempetan atau sebagai elemen terakhir badan dokumen,
    // jadi tiap tabel diikuti paragraf kosong berukuran kecil.
    const paragrafSetelahTabel = () => bagian.push('<w:p><w:pPr><w:spacing w:after="0"/><w:rPr><w:sz w:val="8"/></w:rPr></w:pPr></w:p>');

    const daftarItem = (ol, idx) => {
      [...ol.children].filter((li) => li.tagName === 'LI').forEach((li, i) => {
        const penanda = ol.tagName === 'OL' ? `${i + 1}. ` : '• ';
        const isi = `${docRun(penanda, {})}${jalanDoc({ childNodes: itemNodeList(li) }, link)}`;
        bagian.push(paragrafDoc(isi, `<w:ind w:left="${(idx + 1) * 360 + 360}" w:hanging="360"/>`));
        [...li.children].filter((anak) => /^(UL|OL)$/.test(anak.tagName))
          .forEach((anak) => daftarItem(anak, idx + 1));
      });
    };

    const ketik = (node) => {
      const tag = node.tagName;
      if (/^H[1-6]$/.test(tag)) {
        const tingkat = Math.min(3, Number(tag.slice(1)));
        bagian.push(paragrafDoc(jalanDoc(node, link), `<w:pStyle w:val="Heading${tingkat}"/>`));
        return;
      }
      if (tag === 'P') { bagian.push(paragrafDoc(jalanDoc(node, link))); return; }
      if (tag === 'UL' || tag === 'OL') { daftarItem(node, 0); return; }
      if (tag === 'BLOCKQUOTE') {
        bagian.push(paragrafDoc(jalanDoc(node, link),
          '<w:pStyle w:val="BlockText"/><w:ind w:left="360"/><w:bdr w:val="left" w:space="8" w:color="1B6CA2" w:sz="12"/>'));
        return;
      }
      if (tag === 'PRE') {
        const baris = (node.textContent || '').replace(/\n$/, '').split('\n');
        bagian.push(paragrafDoc(baris.map((t, i) => `${i ? '<w:r><w:br/></w:r>' : ''}${docRun(t, { mono: true })}`).join(''),
          '<w:shd w:val="clear" w:color="auto" w:fill="F1F3F5"/><w:ind w:left="180" w:right="180"/>'));
        return;
      }
      if (tag === 'TABLE') {
        const tbl = tabelDoc(node, link);
        if (tbl) { bagian.push(tbl); paragrafSetelahTabel(); }
        return;
      }
      if (tag === 'HR') {
        bagian.push(paragrafDoc('', '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D6E2EE"/></w:pBdr>'));
        return;
      }
      const teks = (node.textContent || '').trim();
      if (teks) bagian.push(paragrafDoc(docRun(teks, {})));
    };

    const blok = blokDari(root.body);
    /*
     * Judul sudah ditulis sebagai paragraf Title di puncak dokumen. Markdown
     * jawaban hampir selalu membuka dengan judul yang sama, jadi heading pertama
     * yang identik dilewati supaya Word tidak menampilkannya dua kali.
     */
    const samaJudul = (node) => /^H[1-6]$/.test(node.tagName)
      && (node.textContent || '').trim().toLowerCase() === String(judulAsli || '').trim().toLowerCase();
    blok.forEach((node, i) => { if (!(i === 0 && samaJudul(node))) ketik(node); });
    return bagian.join('');
  }

  function itemNodeList(li) {
    const kosong = document.createElement('span');
    [...li.childNodes].forEach((anak) => {
      if (anak.nodeType === 3) kosong.appendChild(document.createTextNode(anak.textContent));
      else if (!/^(UL|OL)$/.test(anak.tagName)) kosong.appendChild(anak.cloneNode(true));
    });
    return kosong.childNodes;
  }

  function tabelDoc(table, link) {
    const baris = [...table.querySelectorAll('tr')];
    if (!baris.length) return '';
    const kolom = Math.max(...baris.map((r) => r.children.length), 1);
    const lebar = Math.floor(9360 / kolom);
    const isi = baris.map((tr, i) => {
      const sel = [...tr.children].map((td) => {
        const tebal = td.tagName === 'TH' || (i === 0 && !tr.closest('tbody'));
        const isiSel = tebal ? docRun((td.textContent || '').trim(), { b: true })
          : (jalanDoc(td, link) || docRun((td.textContent || '').trim(), {}));
        return `<w:tc><w:tcPr><w:tcW w:w="${lebar}" w:type="dxa"/>${tebal ? '<w:shd w:val="clear" w:color="auto" w:fill="EDF3F8"/>' : ''}</w:tcPr>${paragrafDoc(isiSel)}</w:tc>`;
      }).join('');
      return `<w:tr>${i === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${sel}</w:tr>`;
    }).join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>`
      + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
        .map((sisi) => `<w:${sisi} w:val="single" w:sz="4" w:space="0" w:color="BFD0DE"/>`).join('')
      + '</w:tblBorders></w:tblPr>'
      + `<w:tblGrid>${Array.from({ length: kolom }, () => `<w:gridCol w:w="${lebar}"/>`).join('')}</w:tblGrid>${isi}</w:tbl>`;
  }

  const DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${DOC_NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="id-ID"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="120"/><w:jc w:val="left"/></w:pPr><w:rPr><w:b/><w:color w:val="0B2037"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/><w:spacing w:before="280" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="0C4A2F"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="1"/><w:spacing w:before="240" w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="145486"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="2"/><w:spacing w:before="200" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="1B6CA2"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="BlockText"><w:name w:val="Block Text"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="3C4A57"/></w:rPr></w:style>
</w:styles>`;

  function docxBerkas({ judul, markdown }) {
    const html = global.PBPIIMarkdown?.render(markdown) || `<p>${lepasNilai(markdown)}</p>`;
    const root = new DOMParser().parseFromString(html.replace(/^(?!<)(.)/s, '<div>$1</div>'), 'text/html');
    const link = linkBagi();
    const isi = blokDoc({ body: root.body }, link, judul);
    const badan = `<w:body>${paragrafDoc(docRun(judul || 'Jawaban Tanya PII', {}), '<w:pStyle w:val="Title"/>')}${isi}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body>`;

    return zipBerkas([
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
      { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${DOC_NS}>${badan}</w:document>` },
      { name: 'word/styles.xml', data: DOCX_STYLES },
      { name: 'word/_rels/document.xml.rels', data: relsXml(link.list) },
    ]);
  }

  function linkBagi() {
    const list = [];
    return {
      list,
      add(href) {
        let item = list.find((x) => x.href === href);
        if (!item) { item = { id: `rIdH${list.length + 1}`, href }; list.push(item); }
        return item.id;
      },
    };
  }

  /* styles.xml wajib ditautkan dari rels dokumen, bukan hanya dari [Content_Types].xml. */
  function relsXml(list) {
    const gaya = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + gaya
      + list.map((item, i) => `<Relationship Id="${item.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${lepasNilai(item.href)}" TargetMode="External"/>`).join('')
      + '</Relationships>';
  }

  // ------------------------------------------------------------------ PPTX

  const P_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

  function teksPpt(node) {
    const runs = [];
    const jalan = (n, gaya) => {
      if (n.nodeType === 3) { if (n.textContent.trim()) runs.push(pRun(n.textContent, gaya)); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName;
      const next = { ...gaya };
      if (tag === 'STRONG' || tag === 'B') next.b = true;
      if (tag === 'EM' || tag === 'I') next.i = true;
      if (tag === 'CODE') next.mono = true;
      [...n.childNodes].forEach((anak) => jalan(anak, next));
    };
    [...node.childNodes].forEach((anak) => jalan(anak, {}));
    return runs.join('') || pRun((node.textContent || '').trim(), {});
  }

  /** rPr DrawingML: atribut lalu anak sesuai urutan skema (solidFill, latin). */
  function pRun(teks, gaya = {}) {
    const atr = [
      'lang="id-ID"',
      `sz="${gaya.sz || 1800}"`,
      gaya.b ? 'b="1"' : '',
      gaya.i ? 'i="1"' : '',
      'dirty="0"',
    ].filter(Boolean).join(' ');
    const rPr = `<a:rPr ${atr}><a:solidFill><a:srgbClr val="${gaya.color || '0B2037'}"/></a:solidFill>`
      + `<a:latin typeface="${gaya.mono ? 'Consolas' : 'Calibri'}"/></a:rPr>`;
    return `<a:r>${rPr}<a:t>${lepasNilai(teks)}</a:t></a:r>`;
  }

  function paragrafPpt(isi, lvl = 0) {
    return `<a:p><a:pPr lvl="${lvl}"${lvl ? '' : ' marL="228600" indent="-228600"'}><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>${isi || '<a:endParaRPr lang="id-ID"/>'}</a:p>`;
  }

  /** Satu slide: judul + maximal enam butir, sisanya lanjut di slide baru. */
  function slidePpt(judul, butir, catatan) {
    const isi = butir.length
      ? butir.map((item) => paragrafPpt(item.teks, item.lvl || 0)).join('')
      : paragrafPpt(pRun(catatan || 'Tidak ada butir untuk slide ini.', { sz: 1600, color: '5A6C63' }));
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${P_NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Judul"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title" idx="0"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p>${pRun(judul, { sz: 3200, b: true, color: '0C4A2F' })}</a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Isi"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${isi}</p:txBody></p:sp>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  }

  function slideJudulPpt(judul, subjudul) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${P_NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Judul"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p>${pRun(judul, { sz: 4400, b: true, color: '0C4A2F' })}</a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Subjudul"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="subTitle" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p>${pRun(subjudul, { sz: 2000, color: '145486' })}</a:p></p:txBody></p:sp>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  }

  /** Kerangka pptx minimal yang sah: master, layout judul+isi, dan tema. */
  const PPTX_MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${P_NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4000"><a:solidFill><a:srgbClr val="0C4A2F"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:srgbClr val="0B2037"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;

  const PPTX_LAYOUT_TITLE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${P_NS} type="title" preserve="1"><p:cSld name="Judul"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Judul"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1460500"/><a:ext cx="7772400" cy="1470025"/></a:xfrm></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:endParaRPr lang="id-ID"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Subjudul"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="subTitle" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="1330950" y="3085528"/><a:ext cx="6416625" cy="1655028"/></a:xfrm></p:spPr><p:txBody><a:bodyPr anchor="t"/><a:lstStyle/><a:p><a:endParaRPr lang="id-ID"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

  const PPTX_LAYOUT_BODY = PPTX_LAYOUT_TITLE
    .replace(' type="title"', ' type="obj"')
    .replace('name="Judul"', 'name="Judul dan Isi"')
    .replace('<p:ph type="ctrTitle"/>', '<p:ph type="title"/>')
    .replace('<p:ph type="subTitle" idx="1"/>', '<p:ph type="body" idx="1"/>')
    .replace('<a:off x="685800" y="1460500"/><a:ext cx="7772400" cy="1470025"/>', '<a:off x="685800" y="457200"/><a:ext cx="7841593" cy="1143000"/>')
    .replace('<a:off x="1330950" y="3085528"/><a:ext cx="6416625" cy="1655028"/>', '<a:off x="685800" y="1750000"/><a:ext cx="7841593" cy="4464000"/>');

  function pptxTema(nama) {
    const warna = (accent) => `<a:${accent}><a:srgbClr val="${{ dk1: '000000', lt1: 'FFFFFF', dk2: '0B2037', lt2: 'F7FAFD', accent1: '0C4A2F', accent2: '1B6CA2', accent3: 'F2C14E', accent4: '145486', accent5: 'A9DCC3', accent6: 'E79A35', hlink: '1B6CA2', folHlink: '5A6C63' }[accent]}"/></a:${accent}>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${lepasNilai(nama)}"><a:themeElements><a:clrScheme name="PII">${['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map(warna).join('')}</a:clrScheme><a:fontScheme name="PII"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="PII"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  }

  /** Bagi jawaban menjadi slide: tiap judul jadi slide baru, sisanya digulung per 6 butir. */
  function slideDariMarkdown(markdown) {
    const html = global.PBPIIMarkdown?.render(markdown) || `<p>${lepasNilai(markdown)}</p>`;
    const root = new DOMParser().parseFromString(html, 'text/html');
    const slide = [];
    let kini = { judul: '', butir: [] };

    const dorong = () => { if (kini.butir.length || kini.judul) slide.push(kini); };

    blokDari(root.body).forEach((node) => {
      const tag = node.tagName;
      if (/^H[1-3]$/.test(tag)) {
        dorong();
        kini = { judul: (node.textContent || '').trim(), butir: [] };
        return;
      }
      if (/^H[4-6]$/.test(tag)) {
        kini.butir.push({ teks: pRun((node.textContent || '').trim(), { sz: 2000, b: true, color: '145486' }), lvl: 0 });
        return;
      }
      const ambil = (el, lvl) => {
        const teks = teksPpt(el);
        if (teks && el.textContent.trim()) kini.butir.push({ teks, lvl });
        [...el.children].filter((anak) => /^(UL|OL)$/.test(anak.tagName)).forEach((anak) => [...anak.children].forEach((li) => ambil(li, Math.min(4, lvl + 1))));
      };
      if (tag === 'P') ambil(node, 0);
      else if (tag === 'UL' || tag === 'OL') [...node.children].forEach((li) => ambil(li, 0));
      else if (tag === 'BLOCKQUOTE') ambil(node, 0);
      else if (tag === 'PRE') kini.butir.push({ teks: pRun((node.textContent || '').trim().slice(0, 300), { mono: true, sz: 1400, color: '145486' }), lvl: 0 });
      else if (tag === 'TABLE') {
        [...node.querySelectorAll('tr')].forEach((tr) => {
          const sel = [...tr.children].map((td) => (td.textContent || '').trim()).filter(Boolean).join(' — ');
          if (sel) kini.butir.push({ teks: pRun(sel.slice(0, 220), { sz: 1600 }), lvl: 0 });
        });
      }
    });
    dorong();
    return slide;
  }

  function pptxBerkas({ judul, markdown, subjudul }) {
    const bagian = slideDariMarkdown(markdown);
    const semua = [];
    const judulSlide = bagian[0]?.judul || judul || 'Jawaban Tanya PII';
    semua.push({ file: slideJudulPpt(judulSlide, subjudul || 'Tanya PII — buatan Badan Khusus Inovasi Digital PB PII'), layout: 'title' });

    bagian.forEach((bagian2) => {
      const daftar = bagian2.butir;
      if (!daftar.length) { semua.push({ file: slidePpt(bagian2.judul || judulSlide, [], ''), layout: 'body' }); return; }
      for (let i = 0; i < daftar.length; i += 6) {
        const potong = daftar.slice(i, i + 6);
        const kepala = i === 0 ? (bagian2.judul || judulSlide) : `${bagian2.judul || judulSlide} (lanjutan)`;
        semua.push({ file: slidePpt(kepala, potong), layout: 'body' });
      }
    });

    const relsSlide = (idx) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/${semua[idx].layout === 'title' ? 'slideLayout1' : 'slideLayout2'}.xml"/></Relationships>`;

    const entri = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${semua.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideLayouts/slideLayout2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>` },
      { name: 'ppt/presentation.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${P_NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${semua.map((_, i) => `<p:sldId id="${256 + i}" r:id="rIdS${i + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>` },
      { name: 'ppt/_rels/presentation.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${semua.map((_, i) => `<Relationship Id="rIdS${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}<Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>` },
      { name: 'ppt/slideMasters/slideMaster1.xml', data: PPTX_MASTER },
      { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>` },
      { name: 'ppt/slideLayouts/slideLayout1.xml', data: PPTX_LAYOUT_TITLE },
      { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>` },
      { name: 'ppt/slideLayouts/slideLayout2.xml', data: PPTX_LAYOUT_BODY },
      { name: 'ppt/slideLayouts/_rels/slideLayout2.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>` },
      { name: 'ppt/theme/theme1.xml', data: pptxTema(judul || 'Tanya PII') },
    ];
    semua.forEach((item, i) => {
      entri.push({ name: `ppt/slides/slide${i + 1}.xml`, data: item.file });
      entri.push({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: relsSlide(i) });
    });
    return zipBerkas(entri);
  }

  global.PBPIIOffice = { docxBerkas, pptxBerkas, zipBerkas };
}(typeof window !== 'undefined' ? window : globalThis));
