// Visible session material only. This store has no provider-store or filesystem
// reader: the trusted renderer publishes bounded chat text / terminal snapshots.
const { clean } = require('./browser-policy');
class SessionContextStore {
  constructor() { this.sources = new Map(); this.grants = new Map(); }
  update({ id, windowId, identity, title, kind, content, truncated = false, incompleteHistory = true }) {
    if (!id || !identity || !['chat', 'terminal'].includes(kind)) throw new Error('Invalid session context.');
    const old = this.sources.get(id);
    if (old && old.windowId !== windowId) throw new Error('Session context belongs to another window.');
    if (old && old.identity !== identity) this.revokeSource(id);
    const text = String(content || '');
    const source = { id, windowId, identity: clean(identity, 200), title: clean(title, 200), kind,
      incompleteHistory: incompleteHistory !== false, content: clean(text, 64000), truncated: !!truncated || text.length > 64000, capturedAt: Date.now() };
    this.sources.set(id, source); return this.describe(source);
  }
  describe(s) { return { id: s.id, title: s.title, kind: s.kind, capturedAt: s.capturedAt, truncated: s.truncated, incompleteHistory: s.incompleteHistory || s.kind === 'terminal' || s.truncated, identity: s.identity }; }
  grant(recipient, windowId, ids) {
    const grant = new Map();
    for (const id of ids) {
      const source = this.sources.get(id);
      if (!source || source.windowId !== windowId || id === recipient) throw new Error('Session context is unavailable.');
      grant.set(id, source.identity);
    }
    this.grants.set(recipient, grant);
  }
  list(recipient) { return [...(this.grants.get(recipient) || [])].flatMap(([id, identity]) => { const s = this.sources.get(id); return s?.identity === identity ? [this.describe(s)] : []; }); }
  read(recipient, id) {
    const s = this.sources.get(id);
    if (!s || this.grants.get(recipient)?.get(id) !== s.identity) throw new Error('This session context is not shared with the recipient.');
    return { ...this.describe(s), content: s.content };
  }
  revokeSource(id) { for (const grant of this.grants.values()) grant.delete(id); }
  remove(id) { this.sources.delete(id); this.grants.delete(id); this.revokeSource(id); }
  clearGrants() { this.grants.clear(); }
}
module.exports = { SessionContextStore };
