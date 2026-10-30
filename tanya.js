/**
 * "Tanya PII" — asisten AI yang hanya terbuka bagi kader yang sudah login.
 *
 * Token sesi dibaca dari sessionStorage (login.html menyimpan pbpii_admin_token,
 * lembaga.html menyimpan pbpii_org_token). Permintaan dikirim ke /api/chat yang
 * meneruskannya ke Apps Script; kunci AI dan pencacah kuota ada di server, jadi
 * browser tidak pernah memegang kredensial apa pun.
 */
(() => {
  'use strict';

  const ENDPOINT = window.PBPII_CONFIG?.chatEndpoint || '/api/chat';
  const ADMIN_TOKEN_KEY = 'pbpii_admin_token';
  const ORG_TOKEN_KEY = 'pbpii_org_token';

  const sessionToken = () =>
    sessionStorage.getItem(ADMIN_TOKEN_KEY) || sessionStorage.getItem(ORG_TOKEN_KEY) || '';

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  const fab = el('button', 'tanya-fab');
  fab.type = 'button';
  fab.setAttribute('aria-expanded', 'false');
  fab.setAttribute('aria-controls', 'tanyaPanel');
  fab.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.2V17a2.5 2.5 0 0 1-1-2V7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5Z"/><path d="M8.5 9h7M8.5 12h4.5"/></svg>' +
    '<span>Tanya PII</span>';

  const panel = el('div', 'tanya-panel');
  panel.id = 'tanyaPanel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Tanya PII');
  panel.hidden = true;

  const quota = el('span', 'tanya-quota');
  const close = el('button', 'tanya-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Tutup Tanya PII');

  const head = el('header', 'tanya-head');
  head.append(el('strong', '', 'Tanya PII'), quota, close);

  const log = el('div', 'tanya-log');
  log.setAttribute('aria-live', 'polite');

  const input = el('input');
  input.name = 'q';
  input.maxLength = 900;
  input.autocomplete = 'off';
  input.placeholder = 'Tanya tentang PII…';
  input.setAttribute('aria-label', 'Pertanyaan Anda');

  const send = el('button', 'tanya-send', 'Kirim');
  send.type = 'submit';
  const form = el('form', 'tanya-form');
  form.append(input, send);

  const note = el('p', 'tanya-note',
    'Jawaban dihasilkan AI dan bisa keliru. Untuk keputusan resmi, konfirmasi ke pengurus.');

  panel.append(head, log, form, note);
  document.body.append(fab, panel);

  const say = (role, text) => {
    const bubble = el('div', 'tanya-bubble is-' + role, text);
    log.append(bubble);
    log.scrollTop = log.scrollHeight;
    return bubble;
  };

  const setBusy = (busy) => {
    send.disabled = busy;
    input.disabled = busy;
    fab.classList.toggle('is-busy', busy);
  };

  const askServer = async (payload) => {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => null);
    if (!result || !result.ok) {
      throw new Error((result && result.error) || 'Backend tidak dapat dihubungi.');
    }
    return result.data;
  };

  const showQuota = (status) => {
    quota.textContent = status && typeof status.sisa === 'number'
      ? 'Sisa ' + status.sisa + ' dari ' + status.batas + ' pertanyaan hari ini'
      : '';
  };

  const lockScreen = () => {
    log.replaceChildren();
    say('system', 'Fitur ini khusus kader yang sudah login. Silakan masuk lewat menu Admin atau daftar akun lembaga.');
    const links = el('div', 'tanya-links');
    const admin = el('a', 'text-link', 'Masuk admin →');
    admin.href = 'login.html';
    const daftar = el('a', 'text-link', 'Daftar lembaga →');
    daftar.href = 'daftar.html';
    links.append(admin, daftar);
    log.append(links);
    form.hidden = true;
    note.hidden = true;
    quota.textContent = '';
  };

  const unlockScreen = () => {
    form.hidden = false;
    note.hidden = false;
  };

  const setOpen = async (open) => {
    panel.hidden = !open;
    fab.setAttribute('aria-expanded', String(open));
    fab.classList.toggle('is-open', open);
    if (!open) return;

    const token = sessionToken();
    if (!token) {
      lockScreen();
      input.blur();
      return;
    }
    unlockScreen();
    if (!log.childElementCount) {
      say('system', 'Tanyakan apa saja seputar PII: sejarah, kaderisasi, kepengurusan PW/PD/PK, atau cara memakai website ini.');
    }
    try {
      showQuota(await askServer({ action: 'chatStatus', token }));
    } catch (error) {
      quota.textContent = error.message;
    }
    input.focus();
  };

  fab.addEventListener('click', () => setOpen(panel.hidden));
  close.addEventListener('click', () => {
    setOpen(false);
    fab.focus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    const token = sessionToken();
    if (!question || !token) return;

    input.value = '';
    say('user', question);
    setBusy(true);
    const pending = say('system', 'Sedang menuliskan jawaban…');
    pending.classList.add('is-pending');

    try {
      const data = await askServer({ action: 'chat', token, message: question });
      pending.replaceChildren(document.createTextNode(data.reply));
      pending.classList.remove('is-pending');
      showQuota(data);
    } catch (error) {
      pending.classList.remove('is-pending');
      pending.classList.add('is-error');
      pending.textContent = error.message;
    } finally {
      setBusy(false);
      input.focus();
    }
  });
})();
