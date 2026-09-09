// Profile metadata and an OS-protected credential vault. No secrets cross IPC.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { browserUrl, clean } = require('./browser-policy');
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
  return {
    get, list: () => profiles.map((p) => ({ ...p })), available,
    create(name) { name = clean(name, 80).replace(/\s+/g, ' ').trim(); if (!name) throw new Error('Name the browser profile.'); const p = { id: randomUUID(), name }; profiles.push(p); persist(); return p; },
    rename(id, name) { const p = get(id); name = clean(name, 80).replace(/\s+/g, ' ').trim(); if (!name) throw new Error('Name the browser profile.'); p.name = name; persist(); return { ...p }; },
    remove(id) { get(id); if (profiles.length === 1) throw new Error('Keep at least one browser profile.'); fs.rmSync(vaultPath(id), { force: true }); profiles = profiles.filter((p) => p.id !== id); persist(); },
    clearCredentials(id) { fs.rmSync(vaultPath(id), { force: true }); },
    importPasswords(id, text) { get(id); const parsed = parsePasswordCsv(text), entries = readVault(id); let imported = 0;
      for (const e of parsed.entries) { const old = entries.findIndex((v) => v.origin === e.origin && v.username === e.username); const value = { ...e, id: old < 0 ? randomUUID() : entries[old].id }; if (old < 0) entries.push(value); else entries[old] = value; imported++; }
      writeVault(id, entries); return { imported, skipped: parsed.skipped };
    },
    credentials(id, origin) { return readVault(id).filter((e) => !origin || e.origin === origin).map(({ id, origin, username }) => ({ id, origin, username })); },
    credential(id, entryId, origin) { const e = readVault(id).find((e) => e.id === entryId && e.origin === origin); if (!e) throw new Error('This password does not match the current website.'); return e; },
    deleteCredential(id, entryId) { writeVault(id, readVault(id).filter((e) => e.id !== entryId)); },
  };
}
module.exports = { createProfileStore, parsePasswordCsv };
