// Profile metadata and an OS-protected credential vault. No secrets cross IPC.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { randomUUID } = require('node:crypto');
const { browserUrl, clean } = require('./browser-policy');

const GOOGLE_LABELS = new Set(['google', 'googleapis', 'googleusercontent', 'googlevideo', 'googleadservices', 'googlesyndication', 'gmail', 'youtube', 'ytimg', 'youtu', 'gstatic', 'ggpht', 'android', 'chrome', 'chromium', 'doubleclick', 'blogger', 'googlecode', 'withgoogle', 'googlemail']);
function registrableLabel(host) {
  const parts = String(host || '').replace(/^\./, '').toLowerCase().split('.').filter(Boolean);
  if (parts.length >= 3 && ['co', 'com', 'org', 'net', 'ac', 'gov'].includes(parts[parts.length - 2])) return parts[parts.length - 3];
  return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] || '');
}
function isGoogleHost(host) {
  const h = String(host || '').replace(/^\./, '').toLowerCase();
  if (!h) return false;
  if (h === 'youtu.be' || h.endsWith('.youtu.be')) return true;
  return GOOGLE_LABELS.has(registrableLabel(h));
}
function filterImportableCookies(cookies = []) {
  const keep = []; let skippedGoogle = 0;
  for (const cookie of cookies) {
    if (isGoogleHost(cookie.host_key || cookie.domain || cookie.host)) skippedGoogle++;
    else keep.push(cookie);
  }
  return { keep, skippedGoogle };
}
function uniqueDownloadPath(dir, name, exists = fs.existsSync) {
  const safe = path.basename(String(name || 'download').replace(/[\x00-\x1f]/g, '')) || 'download';
  let dest = path.join(dir, safe), n = 0;
  const ext = path.extname(safe), stem = ext ? safe.slice(0, -ext.length) : safe;
  while (exists(dest)) dest = path.join(dir, `${stem} (${++n})${ext}`);
  return dest;
}
function popupDecision(target, policy = 'block') {
  let url;
  try { url = new URL(target); } catch { return { action: 'deny' }; }
  if (url.protocol === 'http:' || url.protocol === 'https:') return { action: 'deny', newTab: url.href };
  if (policy === 'oauth' && url.protocol === 'about:' && url.pathname === 'blank') return { action: 'allow' };
  return { action: 'deny' };
}
function permissionAllowed(stored, permission) {
  const key = permission === 'camera' || permission === 'microphone' || permission === 'media' ? 'media' : permission;
  return stored?.[key] === 'allow';
}
function cookieUrl(cookie) {
  const host = String(cookie.host_key || '').replace(/^\./, '');
  const pathName = cookie.path || '/';
  return `${cookie.is_secure ? 'https' : 'http'}://${host}${pathName.startsWith('/') ? pathName : '/' + pathName}`;
}
function chromeExpiryUnix(expiresUtc) {
  const value = Number(expiresUtc);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value / 1_000_000 - 11_644_473_600);
}
function deriveChromeKey(password) {
  return crypto.pbkdf2Sync(String(password), 'saltysalt', 1003, 16, 'sha1');
}
function decryptChromeCookie(encrypted, key) {
  if (!encrypted || encrypted.length < 4) return null;
  const buf = Buffer.isBuffer(encrypted) ? encrypted : Buffer.from(encrypted);
  const prefix = buf.subarray(0, 3).toString();
  if (prefix !== 'v10') return null;
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '));
    return Buffer.concat([decipher.update(buf.subarray(3)), decipher.final()]).toString('utf8');
  } catch { return null; }
}
function detectChromiumProfiles({ home = os.homedir(), platform = process.platform, exists = fs.existsSync, readFile = (file) => fs.readFileSync(file, 'utf8') } = {}) {
  const roots = platform === 'darwin' ? [
    [path.join(home, 'Library/Application Support/Google/Chrome'), 'Chrome'],
    [path.join(home, 'Library/Application Support/Microsoft Edge'), 'Edge'],
    [path.join(home, 'Library/Application Support/Chromium'), 'Chromium'],
  ] : platform === 'win32' ? [
    [path.join(home, 'AppData/Local/Google/Chrome/User Data'), 'Chrome'],
    [path.join(home, 'AppData/Local/Microsoft/Edge/User Data'), 'Edge'],
  ] : [
    [path.join(home, '.config/google-chrome'), 'Chrome'],
    [path.join(home, '.config/microsoft-edge'), 'Edge'],
  ];
  const found = [];
  for (const [root, browser] of roots) {
    if (!exists(root)) continue;
    let info = {};
    try { info = JSON.parse(readFile(path.join(root, 'Local State'))).profile?.info_cache || {}; } catch {}
    const dirs = Object.keys(info).length ? Object.keys(info) : ['Default'];
    for (const dir of dirs) {
      const directory = path.join(root, dir);
      const cookies = exists(path.join(directory, 'Network/Cookies')) ? path.join(directory, 'Network/Cookies')
        : exists(path.join(directory, 'Cookies')) ? path.join(directory, 'Cookies') : '';
      const logins = exists(path.join(directory, 'Login Data')) ? path.join(directory, 'Login Data') : '';
      const history = exists(path.join(directory, 'History')) ? path.join(directory, 'History') : '';
      if (!cookies && !logins && !history) continue;
      found.push({ browser, name: info[dir]?.name || dir, directory, cookies, logins, history });
    }
  }
  return found;
}
function readChromeCookieRows(file) {
  const { DatabaseSync } = require('node:sqlite');
  const tmp = file + '.nami-read-' + process.pid;
  fs.copyFileSync(file, tmp);
  try {
    const db = new DatabaseSync(tmp, { readOnly: true });
    let rows;
    try { rows = db.prepare('SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies').all(); }
    catch { rows = db.prepare('SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly FROM cookies').all(); }
    db.close();
    return rows;
  } finally { fs.rmSync(tmp, { force: true }); }
}
function cookieImportStatus(options) {
  const sources = detectChromiumProfiles(options);
  return { available: sources.length > 0, browsers: sources.map((s) => ({ browser: s.browser, name: s.name, cookies: !!s.cookies, passwords: !!s.logins, history: !!s.history })) };
}
function readSqliteRows(file, sql) {
  const { DatabaseSync } = require('node:sqlite');
  const tmp = file + '.nami-read-' + process.pid;
  fs.copyFileSync(file, tmp);
  try {
    const db = new DatabaseSync(tmp, { readOnly: true });
    const rows = db.prepare(sql).all();
    db.close();
    return rows;
  } finally { fs.rmSync(tmp, { force: true }); }
}
function chromeTimeToMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  return Math.floor(n / 1000 - 11_644_473_600_000);
}
function readChromeLogins(file, key) {
  let rows = [];
  try { rows = readSqliteRows(file, 'SELECT origin_url, username_value, password_value FROM logins'); }
  catch { return { entries: [], skipped: 0, locked: true }; }
  const entries = []; let skipped = 0;
  for (const row of rows) {
    const password = key ? decryptChromeCookie(row.password_value, key) : (typeof row.password_value === 'string' ? row.password_value : null);
    let origin = '';
    try { origin = new URL(browserUrl(row.origin_url)).origin; } catch { skipped++; continue; }
    if (!password || origin === 'null') { skipped++; continue; }
    entries.push({ origin, username: String(row.username_value || '').slice(0, 2000), password });
  }
  return { entries, skipped, locked: false };
}
function readChromeHistory(file) {
  let rows = [];
  try { rows = readSqliteRows(file, 'SELECT url, title, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 5000'); }
  catch { return { entries: [], locked: true }; }
  return {
    locked: false,
    entries: rows.flatMap((row) => {
      try {
        const url = browserUrl(row.url);
        return [{ url, title: String(row.title || '').slice(0, 200), at: chromeTimeToMs(row.last_visit_time) }];
      } catch { return []; }
    }),
  };
}
function chromeKeychainPassword(browser, execFileSync) {
  if (typeof execFileSync !== 'function') return null;
  const edge = browser === 'Edge';
  try {
    return String(execFileSync('security', ['find-generic-password', '-w', '-s', edge ? 'Microsoft Edge Safe Storage' : 'Chrome Safe Storage', '-a', edge ? 'Microsoft Edge' : 'Chrome'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] })).trim() || null;
  } catch { return null; }
}
async function importChromiumCookies({ session, sources, passwordFor, includeGoogle = true, log = () => {} }) {
  let imported = 0, skippedGoogle = 0, skippedEncrypted = 0, decryptUnavailable = false;
  for (const source of sources || []) {
    let rows = [];
    try { rows = readChromeCookieRows(source.cookies); }
    catch { decryptUnavailable = true; continue; }
    const password = passwordFor ? passwordFor(source) : null;
    const key = password ? deriveChromeKey(password) : null;
    const ready = [];
    for (const row of rows) {
      if (!includeGoogle && isGoogleHost(row.host_key)) { skippedGoogle++; continue; }
      const value = row.value || (key ? decryptChromeCookie(row.encrypted_value, key) : null);
      if (!value) { skippedEncrypted++; if (!row.value) decryptUnavailable = true; continue; }
      ready.push({ ...row, value });
    }
    for (const cookie of ready.slice(0, 5000)) {
      try {
        await session.cookies.set({
          url: cookieUrl(cookie), name: cookie.name, value: cookie.value, domain: cookie.host_key,
          path: cookie.path || '/', secure: !!cookie.is_secure, httpOnly: !!cookie.is_httponly,
          expirationDate: chromeExpiryUnix(cookie.expires_utc),
          sameSite: ({ 0: 'no_restriction', 1: 'lax', 2: 'strict' }[cookie.samesite] || 'unspecified'),
        });
        imported++;
      } catch { skippedEncrypted++; }
    }
  }
  log('Imported ' + imported + ' cookies, skipped ' + skippedGoogle + ' Google hosts.');
  return { imported, skippedGoogle, skippedEncrypted, decryptUnavailable };
}
function parsePasswordCsv(text) {
  if (Buffer.byteLength(text) > 5 * 1024 * 1024) throw new Error('Password file is too large (maximum 5 MB).');
  const rows = []; let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (ch === ',' && !quoted) { row.push(field); field = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (quoted) throw new Error('The password CSV has an unfinished quoted field.');
  row.push(field); if (row.some(Boolean)) rows.push(row);
  const headers = (rows.shift() || []).map((v) => v.trim().toLowerCase());
  const url = headers.indexOf('url'), username = headers.indexOf('username'), password = headers.indexOf('password');
  if ([url, username, password].includes(-1)) throw new Error('Choose a Chrome password export with url, username and password columns.');
  const entries = []; let skipped = 0;
  for (const row of rows) {
    try {
      const origin = new URL(browserUrl(row[url])).origin;
      if (origin === 'null' || !row[password] || row[password].length > 16000 || (row[username] || '').length > 2000) throw new Error();
      entries.push({ origin, username: row[username] || '', password: row[password] });
    } catch (_) { skipped++; }
  }
  if (entries.length > 5000) throw new Error('Import at most 5,000 passwords at a time.');
  return { entries, skipped };
}
function createProfileStore({ directory, safeStorage }) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const metadataFile = path.join(directory, 'profiles.json');
  let profiles;
  try { profiles = JSON.parse(fs.readFileSync(metadataFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Browser profiles could not be read.'); profiles = [{ id: 'default', name: 'Personal' }]; }
  if (!Array.isArray(profiles) || !profiles.length || profiles.some((p) => !/^[\w-]{1,80}$/.test(p.id) || typeof p.name !== 'string')) throw new Error('Browser profile metadata is invalid.');
  function write(file, value) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, value, { mode: 0o600 }); fs.renameSync(tmp, file); }
  const persist = () => write(metadataFile, JSON.stringify(profiles));
  const get = (id = 'default') => { const p = profiles.find((p) => p.id === id); if (!p) throw new Error('Browser profile is no longer available.'); return p; };
  const vaultPath = (id) => { get(id); return path.join(directory, id + '.vault'); };
  function available() { return safeStorage.isEncryptionAvailable(); }
  function readVault(id) {
    const file = vaultPath(id); if (!fs.existsSync(file)) return [];
    if (!available()) throw new Error('Unlock macOS Keychain to use saved passwords.');
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
  }
  function writeVault(id, entries) {
    if (!available()) throw new Error('macOS protected password storage is unavailable.');
    write(vaultPath(id), safeStorage.encryptString(JSON.stringify(entries)));
  }
  persist();
  function publicProfile(p) {
    return {
      id: p.id, name: p.name,
      downloadMode: p.downloadMode === 'auto' ? 'auto' : 'ask',
      popupMode: p.popupMode === 'oauth' ? 'oauth' : 'block',
      permissions: p.permissions && typeof p.permissions === 'object' ? p.permissions : {},
    };
  }
  function permissionKey(permission) {
    return permission === 'camera' || permission === 'microphone' || permission === 'media' ? 'media' : String(permission || 'media').slice(0, 40);
  }
  return {
    get, list: () => profiles.map(publicProfile), available, publicProfile,
    create(name) { name = clean(name, 80).replace(/\s+/g, ' ').trim(); if (!name) throw new Error('Name the browser profile.'); const p = { id: randomUUID(), name }; profiles.push(p); persist(); return p; },
    rename(id, name) { const p = get(id); name = clean(name, 80).replace(/\s+/g, ' ').trim(); if (!name) throw new Error('Name the browser profile.'); p.name = name; persist(); return { ...p }; },
    remove(id) { get(id); if (profiles.length === 1) throw new Error('Keep at least one browser profile.'); fs.rmSync(vaultPath(id), { force: true }); profiles = profiles.filter((p) => p.id !== id); persist(); },
    clearCredentials(id) { fs.rmSync(vaultPath(id), { force: true }); },
    importPasswords(id, text) { get(id); const parsed = parsePasswordCsv(text), entries = readVault(id); let imported = 0;
      for (const e of parsed.entries) { const old = entries.findIndex((v) => v.origin === e.origin && v.username === e.username); const value = { ...e, id: old < 0 ? randomUUID() : entries[old].id }; if (old < 0) entries.push(value); else entries[old] = value; imported++; }
      writeVault(id, entries); return { imported, skipped: parsed.skipped };
    },
    importLogins(id, incoming = []) {
      get(id); const entries = readVault(id); let imported = 0;
      for (const e of incoming.slice(0, 5000)) {
        if (!e?.origin || !e.password) continue;
        const old = entries.findIndex((v) => v.origin === e.origin && v.username === e.username);
        const value = { origin: e.origin, username: e.username || '', password: e.password, id: old < 0 ? randomUUID() : entries[old].id };
        if (old < 0) entries.push(value); else entries[old] = value; imported++;
      }
      writeVault(id, entries); return { imported };
    },
    setHistory(id, entries = []) {
      const p = get(id);
      p.history = (entries || []).slice(0, 5000).map((e) => ({ url: String(e.url || '').slice(0, 2000), title: String(e.title || '').slice(0, 200), at: Number(e.at) || Date.now() }));
      persist(); return { imported: p.history.length };
    },
    credentials(id, origin) { return readVault(id).filter((e) => !origin || e.origin === origin).map(({ id, origin, username }) => ({ id, origin, username })); },
    credential(id, entryId, origin) { const e = readVault(id).find((e) => e.id === entryId && e.origin === origin); if (!e) throw new Error('This password does not match the current website.'); return e; },
    deleteCredential(id, entryId) { writeVault(id, readVault(id).filter((e) => e.id !== entryId)); },
    configure(id, patch = {}) {
      const p = get(id);
      if (patch.downloadMode === 'ask' || patch.downloadMode === 'auto') p.downloadMode = patch.downloadMode;
      if (patch.popupMode === 'block' || patch.popupMode === 'oauth') p.popupMode = patch.popupMode;
      if (patch.origin && patch.permission) {
        let origin;
        try { origin = new URL(patch.origin).origin; } catch { throw new Error('Invalid site origin.'); }
        if (origin === 'null') throw new Error('Invalid site origin.');
        p.permissions ||= {};
        p.permissions[origin] ||= {};
        p.permissions[origin][permissionKey(patch.permission)] = patch.value === 'allow' ? 'allow' : 'deny';
      }
      persist();
      return publicProfile(p);
    },
    notePermissionRequest(id, origin, permission) {
      const p = get(id);
      if (!origin || origin === 'null') return publicProfile(p);
      p.permissions ||= {};
      p.permissions[origin] ||= {};
      const key = permissionKey(permission);
      if (!p.permissions[origin][key]) { p.permissions[origin][key] = 'asked'; persist(); }
      return publicProfile(p);
    },
  };
}
module.exports = {
  createProfileStore, parsePasswordCsv, isGoogleHost, filterImportableCookies, uniqueDownloadPath,
  popupDecision, permissionAllowed, cookieUrl, chromeExpiryUnix, deriveChromeKey, decryptChromeCookie,
  detectChromiumProfiles, readChromeCookieRows, cookieImportStatus, chromeKeychainPassword, importChromiumCookies,
  readChromeLogins, readChromeHistory, chromeTimeToMs,
};
