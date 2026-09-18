// Synchronous main-process transactions cannot interleave across IPC handlers.
// The encrypted journal is committed before plaintext cleanup and survives restarts.
const fs = require('node:fs');
const { writePrivateConfig } = require('./private-config');
const LEGACY = ['openaiKey', 'elevenKey', 'sttKey'];
const ALIASES = { OPENAI_API_KEY: 'openaiKey', ELEVENLABS_API_KEY: 'elevenKey' };
const ioDefault = { exists: fs.existsSync, read: f => fs.readFileSync(f, 'utf8'), write: writePrivateConfig };
const record = v => v && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const validName = n => typeof n === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && !['__proto__', 'constructor', 'prototype'].includes(n);
const masked = value => '••••••••' + (value.length > 4 ? value.slice(-4) : '');
const validRef = name => typeof name === 'string' && (validName(name) || (name.startsWith('legacy:') && LEGACY.includes(name.slice(7))));
const validId = id => typeof id === 'string' && (id.startsWith('named:') ? validName(id.slice(6)) : id.startsWith('legacy:') && LEGACY.includes(id.slice(7)));
const ERROR = 'Saved keys are unavailable. Unlock your system key store, check disk space and file permissions, then retry. If the credential file is damaged, restore an encrypted copy for this app profile.';
const SETTINGS_ERROR = 'settings.json is unreadable. Fix or restore that file, then retry. Nothing was overwritten.';
const CLEANUP_WARNING = 'Plaintext cleanup is incomplete. Encrypted data is preserved. Check settings.json permissions and contents, then retry cleanup.';
const VAULT_WARNING = 'Plaintext cleanup is blocked because credentials.json could not be verified. Restore a valid encrypted vault for this profile, unlock system protection if needed, then retry. Settings were preserved.';
const RECOVERY_WARNING = 'Settings contain keys that still need encrypted storage. Unlock system protection, check disk space and permissions, then retry. Plaintext source entries were preserved.';
const CLEANUP_ERROR = 'Plaintext cleanup could not finish during migration. Check settings.json permissions, then retry. Encrypted data is preserved.';
const SOURCE_CHANGED_ERROR = 'Settings keys changed during migration. Nothing was removed from settings.json. Retry to import the updated source.';
const skippedWarning = names => `These settings.json entries could not be imported and remain unencrypted there: ${names.join(', ')}. Fix or remove them in settings.json.`;
// What migration takes out of settings.json: a well-formed name with a text
// value. Anything else is left where it is and reported by name.
const importable = (name, value) => validName(name) && typeof value === 'string';
function preferences(doc) {
  const out = { ...doc }; delete out.envKeys;
  for (const key of LEGACY) delete out[key];
  return out;
}
function secretFields(doc) {
  return Object.fromEntries(['envKeys', ...LEGACY].filter(key => own(doc, key)).map(key => [key, doc[key]]));
}
// The names migration cannot take, never their values.
function skippedIn(doc) {
  const out = [];
  if (doc.envKeys != null) {
    if (!record(doc.envKeys)) out.push('envKeys');
    else for (const [name, value] of Object.entries(doc.envKeys)) if (!importable(name, value)) out.push(name);
  }
  for (const key of LEGACY) if (doc[key] != null && typeof doc[key] !== 'string') out.push(key);
  return out;
}
function hasImportable(doc) {
  if (record(doc.envKeys) && Object.entries(doc.envKeys).some(([name, value]) => importable(name, value))) return true;
  return LEGACY.some(key => typeof doc[key] === 'string');
}
// settings.json minus everything migration could import; skipped entries stay.
function scrubbed(doc) {
  const out = { ...doc };
  if (record(out.envKeys)) {
    const keep = Object.fromEntries(Object.entries(out.envKeys).filter(([name, value]) => !importable(name, value)));
    if (Object.keys(keep).length) out.envKeys = keep; else delete out.envKeys;
  } else if (out.envKeys == null) delete out.envKeys;
  for (const key of LEGACY) if (typeof out[key] === 'string' || out[key] == null) delete out[key];
  return out;
}
function tagged(message, kind) { const e = new Error(message); e.kind = kind; return e; }
function sourceError() { return tagged(SETTINGS_ERROR, 'settings'); }
function createCredentialStore({ file, settingsFile, encryption, io = ioDefault, platform = process.platform }) {
  // `state` is the last vault this process verified. Reads serve it from memory
  // and never throw: a store that is unavailable yields no saved keys, it does
  // not take terminals, agent status or shell-provided keys down with it.
  let state = null, error = 'Saved keys have not been initialized.', kind = 'storage';
  // What the vault on disk says, as far as this process could read it. Callers
  // use it to decide whether settings.json still holds a migration source.
  let migration = 'unknown';
  let cleanupPending = false, cleanupWarning = null, skippedKeys = [];
  const result = value => ({ ...value, cleanupPending, cleanupWarning, skippedKeys, skippedWarning: skippedKeys.length ? skippedWarning(skippedKeys) : null });
  function protect() {
    if (!['darwin', 'win32', 'linux'].includes(platform) || !encryption.isEncryptionAvailable()) throw new Error(ERROR);
    if (platform === 'linux' && ['basic_text', 'unknown'].includes(encryption.getSelectedStorageBackend())) throw new Error(ERROR);
  }
  function settings() {
    try {
      if (!io.exists(settingsFile)) return {};
      const text = io.read(settingsFile);
      if (!text.trim()) return {};
      const doc = JSON.parse(text);
      if (!record(doc)) throw new Error();
      return doc;
    } catch (_) { throw sourceError(); }
  }
  function settingsReadable() { try { settings(); return true; } catch (_) { return false; } }
  // Validate and sanitize exactly one snapshot; never reread between comparison
  // and replacement. Independent processes must still use separate profiles.
  function scrubSettings(source) {
    cleanupPending = true; cleanupWarning = CLEANUP_WARNING;
    const current = settings();
    skippedKeys = skippedIn(current);
    if (source && JSON.stringify(secretFields(current)) !== JSON.stringify(secretFields(source))) throw tagged(SOURCE_CHANGED_ERROR, 'source');
    if (hasImportable(current)) {
      // Do not delete a source based only on a cache after its durable copy changed.
      try { if (io.read(file) !== verifiedText) throw new Error(); }
      catch (_) { migration = 'unknown'; throw tagged(VAULT_WARNING, 'vault'); }
      try {
        io.write(settingsFile, JSON.stringify(scrubbed(current), null, 2) + '\n');
        if (hasImportable(settings())) throw new Error();
      } catch (_) { throw tagged(CLEANUP_ERROR, 'settings'); }
    }
    cleanupPending = false; cleanupWarning = null;
  }
  function validate(doc) {
    if (!record(doc) || doc.version !== 1 || !['pending', 'complete'].includes(doc.migration)
      || !record(doc.named) || !record(doc.legacy) || !record(doc.tombstones) || !Array.isArray(doc.imported)) throw new Error(ERROR);
    const namedValid = Object.entries(doc.named).every(([k, v]) => validName(k) && typeof v === 'string');
    const legacyValid = Object.entries(doc.legacy).every(([k, v]) => LEGACY.includes(k) && typeof v === 'string');
    if (!namedValid || !legacyValid) throw new Error(ERROR);
    if (!doc.imported.every(validId) || !Object.entries(doc.tombstones).every(([k,v]) => validId(k) && v === true)) throw new Error(ERROR);
    return doc;
  }
  // Raw file text behind `state`, so a mutation can tell "unchanged on disk"
  // from "replaced or damaged" without asking the key store to decrypt again.
  let verifiedText = null;
  function load(raw = io.read(file)) {
    const envelope = JSON.parse(raw);
    if (!record(envelope) || envelope.version !== 1 || typeof envelope.ciphertext !== 'string'
      || !envelope.ciphertext || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(envelope.ciphertext)) throw new Error(ERROR);
    const doc = validate(JSON.parse(encryption.decryptString(Buffer.from(envelope.ciphertext, 'base64'))));
    return { rawText: raw, document: doc };
  }
  function adopt(snapshot) {
    verifiedText = snapshot.rawText;
    state = snapshot.document;
    migration = state.migration;
  }
  function synchronize() {
    const raw = io.read(file);
    if (state && raw === verifiedText) { migration = state.migration; return; }
    protect();
    adopt(load(raw));
  }
  // Whether the last persist() attempted the atomic rename; before that point
  // the disk still holds the previous vault and the in-memory state is valid.
  let written = false;
  function persist(next) {
    written = false;
    protect();
    const text = JSON.stringify(validate(next));
    const encrypted = encryption.encryptString(text);
    // Catch unusable encryption output before replacing a previously valid vault.
    if (!Buffer.isBuffer(encrypted) || !encrypted.length || encryption.decryptString(encrypted) !== text) throw new Error(ERROR);
    // Once the write is attempted the disk may hold either vault, so any later
    // failure has to re-read to find out which.
    written = true;
    io.write(file, JSON.stringify({ version: 1, ciphertext: encrypted.toString('base64') }) + '\n');
    const verified = load();
    if (JSON.stringify(verified.document) !== text) throw new Error(ERROR);
    adopt(verified);
  }
  // The store itself is unusable (as opposed to one operation having failed).
  // Errors that know which file is at fault carry `kind`; everything else is
  // reported as the key store or vault.
  function unavailable(err) {
    state = null;
    kind = err && ['settings', 'source'].includes(err.kind) ? 'settings' : 'storage';
    error = err && err.kind === 'source' ? SOURCE_CHANGED_ERROR
      : kind === 'settings' ? (err.message === CLEANUP_ERROR ? CLEANUP_ERROR : SETTINGS_ERROR)
      : ERROR;
    return result({ ok: false, error });
  }
  const clone = doc => JSON.parse(JSON.stringify(doc));
  // Import only unseen identifiers. Existing values, imports and tombstones win.
  function reconcile(next, source) {
    const entries = [
      ...Object.entries(record(source.envKeys) ? source.envKeys : {}).filter(([name, value]) => importable(name, value)).map(([name, value]) => ['named', name, value]),
      ...LEGACY.filter(name => typeof source[name] === 'string').map(name => ['legacy', name, source[name]]),
    ];
    for (const [group, name, value] of entries) {
      if (!value) continue;
      const id = group + ':' + name;
      if (own(next[group], name) || own(next.tombstones, id) || next.imported.includes(id)) continue;
      next[group][name] = value;
      next.imported.push(id);
    }
    return next;
  }
  // Recover a possibly committed atomic write without pairing new bytes with old state.
  function commit(next) {
    try { persist(next); }
    catch (e) {
      if (!written) throw e;
      try { adopt(load()); }
      catch (readError) { migration = 'unknown'; pendingWarning(VAULT_WARNING); throw readError; }
      if (JSON.stringify(state) !== JSON.stringify(next)) throw e;
    }
  }
  function finishMigration(next) {
    const source = settings();
    skippedKeys = skippedIn(source);
    reconcile(next, source);
    persist(next);
    scrubSettings(source);
    persist({ ...next, migration: 'complete' });
    error = null;
  }
  function pendingWarning(message) {
    cleanupPending = true; cleanupWarning = message;
  }
  function retryCleanup() {
    pendingWarning(VAULT_WARNING);
    try { synchronize(); }
    catch (_) { migration = 'unknown'; return; }
    if (state.migration === 'pending') {
      try { finishMigration(clone(state)); }
      catch (e) { unavailable(e); }
      return;
    }
    try {
      pendingWarning(CLEANUP_WARNING);
      const source = settings();
      skippedKeys = skippedIn(source);
      const next = reconcile(clone(state), source);
      if (JSON.stringify(next) !== JSON.stringify(state)) {
        pendingWarning(RECOVERY_WARNING);
        commit(next);
      }
      scrubSettings(source);
    } catch (e) {
      // A completed cache remains usable; source recovery is a separate result.
      if (e && e.kind === 'vault') pendingWarning(VAULT_WARNING);
    }
  }
  function initialize() {
    try {
      protect();
      if (io.exists(file)) adopt(load());
      else { state = null; verifiedText = null; migration = 'pending'; }
    } catch (e) { migration = 'unknown'; return unavailable(e); }
    if (state && state.migration === 'complete') {
      error = null;
      retryCleanup();
      return result({ ok: !error, ...(error ? { error } : {}) });
    }
    try {
      finishMigration(state ? clone(state) : { version: 1, migration: 'pending', named: {}, legacy: {}, imported: [], tombstones: {} });
      return result({ ok: true });
    } catch (e) { return unavailable(e); }
  }
  function retry() {
    if (usable()) { retryCleanup(); return status(); }
    return initialize();
  }
  function change(fn) {
    if (!usable()) return result({ ok: false, error: error || ERROR });
    try { protect(); } catch (_) { return result({ ok: false, error: ERROR }); }
    try { synchronize(); }
    catch (_) {
      migration = 'unknown'; pendingWarning(VAULT_WARNING);
      return result({ ok: false, error: ERROR });
    }
    if (state.migration === 'pending') {
      try { finishMigration(clone(state)); }
      catch (e) { return unavailable(e); }
    }
    const next = clone(state);
    fn(next);
    try { commit(next); }
    catch (_) { return result({ ok: false, error: ERROR }); }
    // The requested encrypted mutation committed even if source recovery cannot.
    retryCleanup();
    return result({ ok: true });
  }
  function set(name, value) {
    if (!validName(name) || typeof value !== 'string' || !value.trim()) return result({ ok: false, error: 'Enter a valid key name and nonempty secret.' });
    return change(next => { next.named[name] = value.trim(); delete next.tombstones['named:' + name]; });
  }
  function remove(name) {
    if (!validRef(name)) return result({ ok: false, error: 'Invalid key name.' });
    return change(next => {
      if (name.startsWith('legacy:')) { const k = name.slice(7); delete next.legacy[k]; next.tombstones[name] = true; }
      else {
        delete next.named[name]; next.tombstones['named:' + name] = true;
        if (own(ALIASES, name)) { delete next.legacy[ALIASES[name]]; next.tombstones['legacy:' + ALIASES[name]] = true; }
      }
    });
  }
  function setLegacy(patch) {
    if (!record(patch) || LEGACY.some(k => own(patch, k) && patch[k] !== null && typeof patch[k] !== 'string')) {
      return result({ ok: false, error: 'API keys must be text, or null to remove them.' });
    }
    return change(next => {
      for (const k of LEGACY) {
        if (!own(patch, k)) continue;
        const value = patch[k];
        if (value === null || value === '') {
          delete next.legacy[k];
          next.tombstones['legacy:' + k] = true;
        } else {
          next.legacy[k] = value;
          delete next.tombstones['legacy:' + k];
        }
      }
    });
  }
  const usable = () => !error && !!state && state.migration === 'complete';
  const status = () => result({ ok: !error, error, kind: error ? kind : null, migration });
  // Total by design: consumers (session env, speech, agent status) get no saved
  // keys when the store is unavailable, and ask status() if they need to say why.
  function context() { return usable() ? { envKeys: { ...state.named }, ...state.legacy } : { envKeys: {} }; }
  function list() {
    if (!usable()) return result({ ok: false, error: error || ERROR, kind });
    const stored = Object.entries(state.named)
      .map(([name, value]) => ({ name, masked: masked(value) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const legacy = Object.entries(state.legacy)
      .map(([name, value]) => ({ name: 'legacy:' + name, masked: masked(value) }));
    return result({ ok: true, stored, legacy });
  }
  function reveal(name) {
    if (!validRef(name)) return result({ ok: false, error: 'Invalid key name.' });
    if (!usable()) return result({ ok: false, error: error || ERROR });
    const legacy = name.startsWith('legacy:');
    const entries = legacy ? state.legacy : state.named;
    const key = legacy ? name.slice(7) : name;
    return result({ ok: true, value: own(entries, key) ? entries[key] : '' });
  }
  return { initialize, retry, set, remove, setLegacy, context, list, reveal, status, settingsReadable };
}
module.exports = { createCredentialStore, preferences, LEGACY, ERROR, SETTINGS_ERROR, CLEANUP_WARNING, CLEANUP_ERROR, SOURCE_CHANGED_ERROR, VAULT_WARNING, RECOVERY_WARNING };
