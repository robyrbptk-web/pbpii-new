/**
 * Local dev server that mirrors the Vercel routing of this repository: the same
 * `vercel.json` rewrites and headers, and every file under `api/` served at the
 * path Vercel exposes (`[id].js` → `/:id`, `[...slug].js` → a catch-all).
 *
 *   npm run dev:site      # then open http://127.0.0.1:4173
 *
 * `vercel dev` needs the Vercel CLI plus an interactive login; this needs
 * neither, so every page and every data layer can be clicked through offline
 * with the exact URLs the deployed site uses. Secrets come from `.env` when
 * present and are never printed.
 */
import http from 'node:http';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const PORT = Number(process.env.PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

/** Read optional keys from .env.local / .env without any dependency. */
function readDotenvFiles() {
  for (const name of ['.env.local', '.env']) {
    const file = join(ROOT, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (line.trimStart().startsWith('#')) continue;
      const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}
readDotenvFiles();

// -------------------------------------------------------------- vercel.json

const config = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));

/** Vercel source patterns (`/assets/:path*`, `/mic.svg`) → RegExp + named groups. */
function compileSource(source) {
  const escaped = source.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const body = escaped
    .replace(/:(\w+)\*/g, (_, name) => `(?<${name}>.*)`)
    .replace(/:(\w+)/g, (_, name) => `(?<${name}>[^/]+)`);
  // A path without a trailing slash also answers for the slash form, matching how
  // Vercel serves both /peta and /peta/. `/` itself must stay root-only.
  return new RegExp(`^${body.replace(/\/$/, '')}/?$`);
}

const rewrites = (config.rewrites || []).map((rule) => ({
  source: rule.source,
  pattern: compileSource(rule.source),
  destination: rule.destination,
}));

const headerRules = (config.headers || []).map((rule) => ({
  pattern: compileSource(rule.source),
  headers: rule.headers || [],
}));

function headerOverlay(pathname) {
  const overlay = {};
  for (const rule of headerRules) {
    if (!rule.pattern.test(pathname)) continue;
    for (const header of rule.headers) overlay[header.key] = header.value;
  }
  return overlay;
}

function fillParams(value, params) {
  return value.replace(/:(\w+)\*\*?|:(\w+)/g, (whole, wildcard, named) => {
    const name = wildcard || named;
    const value = params[name];
    return value === undefined ? '' : String(value).replace(/^\/+/, '');
  });
}

// ----------------------------------------------------------- api discovery

const routes = [];

function collectRoutes(directory, basePath) {
  // `:dir` carries the params already found in the parent directory names.
  const dirParams = collectDirectoryParams(basePath);
  for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      collectRoutes(`${directory}/${entry.name}`, `${basePath}/${entry.name}`);
      continue;
    }
    if (extname(entry.name) !== '.js') continue;
    const base = entry.name.replace(/\.js$/, '');
    const wildcard = /^\[\.\.\..+\]$/.test(base);
    const names = [...dirParams.names];
    const literal = wildcard
      ? dirParams.path
      : `${dirParams.path}/${base.replace(/\[(\w+)\]/g, (_, name) => {
          names.push(name);
          return `:${name}`;
        })}`;
    const source = wildcard
      ? `^${escapeForRegex(dirParams.path)}/(?<${/\[\.\.\.(\w+)\]/.exec(base)[1]}>.*)$`
      : `^${escapeForRegex(literal).replace(/:[a-z0-9_]+/gi, (segment) => `(?<${segment.slice(1)}>[^/]+)`)}$`;
    routes.push({
      file: `${directory}/${entry.name}`,
      display: wildcard ? `${dirParams.path}/*` : literal,
      pattern: new RegExp(source),
      names,
      specificity: wildcard ? 1000 : names.length,
    });
  }
}

/** Vercel names path params on directories too (`flow/[z]/[x]/[y]`), so decode every segment. */
function collectDirectoryParams(basePath) {
  const names = [];
  const path = basePath
    .split('/')
    .map((segment) => segment.replace(/^\[(\w+)\]$/, (_, name) => {
      names.push(name);
      return `:${name}`;
    }))
    .join('/');
  return { path, names };
}

function escapeForRegex(value) {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

collectRoutes('api', '/api');
routes.sort((a, b) => a.specificity - b.specificity);

const ROUTES_PATH = '/api/__routes';

// ------------------------------------------------------------ request shape

/** Handlers in this repo mix two Vercel styles: Node (`writeHead`) and Express (`status().json()`). */
function enhance(req, res, url, params) {
  req.query = { ...Object.fromEntries(url.searchParams), ...params };
  req.params = params;
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (value) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(value));
    return res;
  };
  res.send = (value) => (value && typeof value === 'object' ? res.json(value) : res.end(String(value)));
}

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  const type = String(req.headers['content-type'] || '');
  try {
    if (type.includes('application/json')) return JSON.parse(raw);
    if (type.includes('application/x-www-form-urlencoded')) {
      return Object.fromEntries(new URLSearchParams(raw));
    }
  } catch {
    /* the handler reads the raw stream itself (e.g. the Apps Script proxy) */
  }
  return { raw };
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// ------------------------------------------------------------------ static

function resolveStatic(pathname) {
  const decoded = decodeURIComponent(pathname);
  const target = resolve(ROOT, `.${normalizedPath(decoded)}`);
  return target === ROOT || target.startsWith(ROOT + sep) ? target : null;
}

function normalizedPath(value) {
  return value.replace(/\.\./g, '');
}

function sendFile(res, file, pathname) {
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    ...headerOverlay(pathname),
  });
  createReadStream(file).pipe(res);
}

/** Apply the first matching vercel.json rewrite, then fall back to files on disk. */
function serveStatic(req, res, pathname) {
  let target = pathname;
  for (const rewrite of rewrites) {
    const match = rewrite.pattern.exec(pathname);
    if (!match) continue;
    target = fillParams(rewrite.destination, match.groups || {});
    if (target.startsWith('/api/')) return false;
    break;
  }
  const file = resolveStatic(target);
  if (!file) return false;
  if (existsSync(file) && statSync(file).isFile()) {
    sendFile(res, file, pathname);
    return true;
  }
  const indexed = join(file, 'index.html');
  if (existsSync(indexed)) {
    sendFile(res, indexed, pathname);
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === ROUTES_PATH) {
    sendJson(res, 200, {
      routes: routes.map((route) => route.display),
      pages: readdirSync(ROOT).filter((name) => name.endsWith('.html')),
    });
    return;
  }

  for (const route of routes) {
    const match = route.pattern.exec(url.pathname);
    if (!match) continue;
    const params = match.groups || {};
    enhance(req, res, url, params);
    try {
      req.body = await readBody(req);
      const handler = (await import(pathToFileURL(join(ROOT, route.file)).href)).default;
      await handler(req, res);
    } catch (error) {
      console.error(`[dev] ${url.pathname}:`, error?.message || error);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'proxy failed' });
      else res.end();
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }

  if (!serveStatic(req, res, url.pathname)) {
    sendJson(res, 404, { ok: false, error: 'NOT_FOUND', path: url.pathname });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`PB PII + PII Global View  →  http://127.0.0.1:${PORT}`);
  console.log(`${routes.length} endpoint api/ · daftar lengkap di ${ROUTES_PATH}`);
});
