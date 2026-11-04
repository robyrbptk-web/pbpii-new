(() => {
  const TYPES = [
    ['short', 'Jawaban singkat'],
    ['paragraph', 'Paragraf'],
    ['email', 'Email'],
    ['phone', 'Nomor telepon / WhatsApp'],
    ['number', 'Angka'],
    ['radio', 'Pilihan tunggal'],
    ['checkbox', 'Pilihan ganda'],
    ['select', 'Dropdown'],
    ['date', 'Tanggal'],
    ['consent', 'Persetujuan'],
    ['info', 'Informasi tanpa input']
  ];

  const DEFAULTS = [
    { id: 'name', type: 'short', label: 'Nama lengkap', help: '', required: true, options: [], maxLength: 120 },
    { id: 'institution', type: 'short', label: 'Asal sekolah / lembaga', help: '', required: false, options: [], maxLength: 160 },
    { id: 'phone', type: 'phone', label: 'Nomor WhatsApp', help: '', required: false, options: [], maxLength: 40 },
    { id: 'email', type: 'email', label: 'Email', help: '', required: false, options: [], maxLength: 160 },
    { id: 'note', type: 'paragraph', label: 'Catatan', help: 'Kebutuhan khusus, asal daerah, atau pertanyaan.', required: false, options: [], maxLength: 1000 }
  ];

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const copy = (fields) => fields.map((field) => ({ ...field, options: [...(field.options || [])] }));
  const defaults = () => copy(DEFAULTS);
  const typeLabel = (type) => (TYPES.find((item) => item[0] === type) || [])[1] || type;
  let sequence = 0;

  function newField(type) {
    sequence += 1;
    const field = {
      id: `field${Date.now().toString(36)}${sequence}`,
      type,
      label: typeLabel(type),
      help: '',
      required: false,
      options: ['radio', 'checkbox', 'select'].includes(type) ? ['Pilihan 1', 'Pilihan 2'] : [],
      maxLength: type === 'paragraph' ? 4000 : type === 'short' ? 300 : type === 'email' ? 160 : type === 'phone' ? 40 : 0
    };
    if (type === 'consent') field.label = 'Saya menyetujui ketentuan kegiatan';
    if (type === 'info') field.help = 'Tulis informasi untuk calon peserta.';
    return field;
  }

  function render(fields, options = {}) {
    const prefix = options.idPrefix || 'field';
    return fields.map((field, index) => {
      const inputId = `${prefix}-${field.id}-${index}`;
      const required = field.required ? '<span aria-hidden="true"> *</span>' : '';
      const hint = field.help ? `<p class="hint">${esc(field.help)}</p>` : '';
      const disabled = options.disabled ? ' disabled' : '';
      const common = `data-field-id="${esc(field.id)}" data-field-type="${esc(field.type)}"`;
      let control = '';
      if (field.type === 'info') {
        return `<div class="form-info"><strong>${esc(field.label)}</strong>${hint}</div>`;
      }
      if (['radio', 'checkbox'].includes(field.type)) {
        control = `<div class="choice-list" ${common}>${field.options.map((option, optionIndex) => {
          const id = `${inputId}-${optionIndex}`;
          return `<label class="choice" for="${esc(id)}"><input id="${esc(id)}" type="${field.type}" name="${esc(inputId)}" value="${esc(option)}"${field.required && field.type === 'radio' ? ' required' : ''}${disabled}><span>${esc(option)}</span></label>`;
        }).join('')}</div>`;
      } else if (field.type === 'select') {
        control = `<select id="${esc(inputId)}" ${common}${field.required ? ' required' : ''}${disabled}><option value="">Pilih jawaban</option>${field.options.map((option) => `<option value="${esc(option)}">${esc(option)}</option>`).join('')}</select>`;
      } else if (field.type === 'consent') {
        return `<div class="field consent-field"><label class="choice" for="${esc(inputId)}"><input id="${esc(inputId)}" type="checkbox" ${common}${field.required ? ' required' : ''}${disabled}><span>${esc(field.label)}${required}</span></label>${hint}</div>`;
      } else {
        const tag = field.type === 'paragraph' ? 'textarea' : 'input';
        const type = field.type === 'phone' ? 'tel' : ['email', 'number', 'date'].includes(field.type) ? field.type : 'text';
        const attributes = `${common}${field.required ? ' required' : ''}${field.maxLength ? ` maxlength="${field.maxLength}"` : ''}${field.type === 'phone' ? ' inputmode="tel"' : ''}${field.type === 'number' ? ' step="any"' : ''}${disabled}`;
        control = tag === 'textarea'
          ? `<textarea id="${esc(inputId)}" ${attributes}></textarea>`
          : `<input id="${esc(inputId)}" type="${type}" ${attributes}>`;
      }
      return `<div class="field"><label class="lbl" for="${esc(inputId)}">${esc(field.label)}${required}</label>${control}${hint}</div>`;
    }).join('');
  }

  function mount({ host, fields }) {
    if (!host) throw new Error('Wadah form builder tidak ditemukan.');
    let items = copy(Array.isArray(fields) && fields.length ? fields : defaults());
    host.classList.add('form-builder');
    host.innerHTML = `
      <div class="builder-list"></div>
      <div class="builder-add">
        <select aria-label="Jenis field baru">${TYPES.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>
        <button class="btn secondary" type="button" data-add-field>+ Tambah field</button>
      </div>
      <details class="builder-preview"><summary>Lihat pratinjau formulir peserta</summary><div class="builder-preview-body"></div></details>`;
    const list = host.querySelector('.builder-list');
    const preview = host.querySelector('.builder-preview-body');
    const typeSelect = host.querySelector('.builder-add select');

    function paintPreview() {
      preview.innerHTML = render(items, { disabled: true, idPrefix: `${host.id || 'builder'}-preview` });
    }

    function paint() {
      list.innerHTML = items.map((field, index) => {
        const options = ['radio', 'checkbox', 'select'].includes(field.type)
          ? `<div class="field full"><label class="lbl">Pilihan jawaban (satu per baris) *</label><textarea data-prop="options" rows="3">${esc(field.options.join('\n'))}</textarea></div>`
          : '';
        const length = ['short', 'paragraph', 'email', 'phone'].includes(field.type)
          ? `<div class="field"><label class="lbl">Batas karakter</label><input type="number" min="1" max="${field.type === 'paragraph' ? 4000 : 300}" data-prop="maxLength" value="${Number(field.maxLength) || 120}"></div>`
          : '';
        const locked = field.id === 'name';
        return `<article class="builder-field" data-index="${index}">
          <div class="builder-field-head"><div><span class="badge cat">${esc(typeLabel(field.type))}</span><strong>${esc(field.label || 'Tanpa label')}</strong></div>
            <div class="builder-order"><button class="btn ghost" type="button" data-move="-1" aria-label="Naikkan field"${index === 0 ? ' disabled' : ''}>↑</button><button class="btn ghost" type="button" data-move="1" aria-label="Turunkan field"${index === items.length - 1 ? ' disabled' : ''}>↓</button><button class="btn danger" type="button" data-remove-field${locked ? ' disabled' : ''}>Hapus</button></div>
          </div>
          <div class="grid2">
            <div class="field"><label class="lbl">Label field *</label><input data-prop="label" maxlength="160" value="${esc(field.label)}"></div>
            <div class="field"><label class="lbl">Jenis jawaban</label><select data-prop="type"${locked ? ' disabled' : ''}>${TYPES.map(([value, label]) => `<option value="${value}"${field.type === value ? ' selected' : ''}>${label}</option>`).join('')}</select></div>
            ${length}
            <div class="field builder-required"><label class="choice"><input type="checkbox" data-prop="required"${field.required ? ' checked' : ''}${locked || field.type === 'info' ? ' disabled' : ''}><span>Wajib diisi peserta</span></label></div>
            <div class="field full"><label class="lbl">${field.type === 'info' ? 'Isi informasi' : 'Petunjuk (opsional)'}</label><textarea data-prop="help" rows="2" maxlength="${field.type === 'info' ? 4000 : 500}">${esc(field.help || '')}</textarea></div>
            ${options}
          </div>
        </article>`;
      }).join('');
      paintPreview();
    }

    list.addEventListener('input', (event) => {
      const input = event.target.closest('[data-prop]');
      const card = event.target.closest('[data-index]');
      if (!input || !card) return;
      const field = items[Number(card.dataset.index)];
      const prop = input.dataset.prop;
      if (prop === 'options') field.options = input.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      else if (prop === 'maxLength') field.maxLength = Math.max(1, Number(input.value) || 120);
      else field[prop] = input.value;
      const title = card.querySelector('.builder-field-head strong');
      if (title && prop === 'label') title.textContent = input.value || 'Tanpa label';
      paintPreview();
    });

    list.addEventListener('change', (event) => {
      const input = event.target.closest('[data-prop]');
      const card = event.target.closest('[data-index]');
      if (!input || !card) return;
      const field = items[Number(card.dataset.index)];
      if (input.dataset.prop === 'required') field.required = input.checked;
      if (input.dataset.prop === 'type') {
        const previousType = field.type;
        field.type = input.value;
        if (['radio', 'checkbox', 'select'].includes(field.type) && !['radio', 'checkbox', 'select'].includes(previousType)) {
          field.options = ['Pilihan 1', 'Pilihan 2'];
        }
        if (field.type === 'info') field.required = false;
        paint();
      } else paintPreview();
    });

    host.addEventListener('click', (event) => {
      const add = event.target.closest('[data-add-field]');
      if (add) {
        if (items.length >= 40) return;
        items.push(newField(typeSelect.value));
        paint();
        list.lastElementChild?.querySelector('[data-prop="label"]')?.focus();
        return;
      }
      const card = event.target.closest('[data-index]');
      if (!card) return;
      const index = Number(card.dataset.index);
      const move = event.target.closest('[data-move]');
      if (move) {
        const target = index + Number(move.dataset.move);
        if (target < 0 || target >= items.length) return;
        [items[index], items[target]] = [items[target], items[index]];
        paint();
        return;
      }
      if (event.target.closest('[data-remove-field]') && items[index].id !== 'name') {
        items.splice(index, 1);
        paint();
      }
    });

    paint();
    return {
      getFields: () => copy(items),
      setFields: (next) => { items = copy(Array.isArray(next) && next.length ? next : defaults()); paint(); },
      validate: () => {
        for (const field of items) {
          if (!String(field.label || '').trim()) return 'Setiap field harus memiliki label.';
          if (['radio', 'checkbox', 'select'].includes(field.type) && !field.options.length) {
            return `Field “${field.label}” harus memiliki pilihan jawaban.`;
          }
        }
        return '';
      }
    };
  }

  window.PBPIIFormBuilder = { mount, render, defaults };
})();
