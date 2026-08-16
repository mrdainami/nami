// Hermes keeps everything in ~/.hermes/state.db (SQLite): a `sessions` table
// (source='acp' for card-driven runs, cwd inside origin_json) and a
// `messages` table (role user|assistant|tool, content, tool_calls JSON in
// the OpenAI shape, epoch-second timestamps). Probed live 2026-08-16:
// hermes answers session/load (the model resumes) but replays no
// conversation frames — only commands/usage updates — so unlike opencode
// the card's history must be read from this db. Electron's node:sqlite,
// read-only, no deps.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { clip, toolKindFor } = require('./agent-events.js');

const MAX_EVENTS = 400;

function hermesDb(home) { return path.join(home || os.homedir(), '.hermes', 'state.db'); }

function openRo(file) {
  let sqlite = null;
  try { sqlite = require('node:sqlite'); } catch (_) { return null; }
  try { fs.statSync(file); } catch (_) { return null; }
  try { return new sqlite.DatabaseSync(file, { readOnly: true }); } catch (_) { return null; }
}

function hermesSessions({ cwd, home }) {
  const db = openRo(hermesDb(home));
  if (!db) return null;
  try {
    // the session's folder rides in model_config's JSON ({"cwd": …}) on the
    // real db — the cwd/origin_json columns sit empty on acp rows
    const rows = db.prepare(
      "select id, title, cwd, origin_json, model_config, started_at, last_activity_at from sessions where source = 'acp' order by started_at desc limit 60"
    ).all();
    const out = [];
    for (const r of rows) {
      let dir = r.cwd || '';
      for (const j of [r.model_config, r.origin_json]) {
        if (dir || !j) continue;
        try { dir = JSON.parse(j).cwd || ''; } catch (_) {}
      }
      if (cwd && dir && dir !== cwd) continue;
      out.push({
        id: String(r.id),
        title: String(r.title || ''),
        atMs: (Number(r.last_activity_at || r.started_at) || 0) * 1000,
      });
    }
    return out;
  } catch (_) {
    return null;
  } finally {
    try { db.close(); } catch (_) {}
  }
}

function hermesBacklog(sessionId, home) {
  const db = openRo(hermesDb(home));
  if (!db) return { events: [] };
  try {
    const rows = db.prepare(
      "select role, content, tool_calls, tool_call_id, tool_name, timestamp from messages where session_id = ? and role in ('user','assistant','tool') order by timestamp limit 2000"
    ).all(String(sessionId));
    const out = [];
    for (const r of rows) {
      const at = (Number(r.timestamp) || 0) * 1000;
      const text = String(r.content || '').trim();
      if (r.role === 'user') {
        if (text) out.push({ kind: 'user', at, text });
      } else if (r.role === 'assistant') {
        if (text) out.push({ kind: 'assistant', at, text });
        // tool_calls ride the assistant row, OpenAI-shaped
        let calls = [];
        try { calls = JSON.parse(r.tool_calls || '[]'); } catch (_) {}
        for (const c of Array.isArray(calls) ? calls : []) {
          if (!c) continue;
          const name = c.name || (c.function && c.function.name) || '';
          let input = c.arguments || (c.function && c.function.arguments) || {};
          if (typeof input === 'string') { try { input = JSON.parse(input); } catch (_) { input = { input }; } }
          out.push({
            kind: 'tool', at, toolId: c.call_id || c.id || null,
            name: String(name), toolKind: toolKindFor(name), input,
          });
        }
      } else if (r.role === 'tool') {
        const { body, truncated } = clip(text);
        if (body) {
          out.push({
            kind: 'tool_result', at, toolId: r.tool_call_id || null,
            isError: /"success":\s*false/.test(body.slice(0, 200)), body, truncated,
          });
        }
      }
    }
    const partial = out.length > MAX_EVENTS;
    return { events: out.slice(-MAX_EVENTS), partial };
  } catch (_) {
    return { events: [] };
  } finally {
    try { db.close(); } catch (_) {}
  }
}

module.exports = { hermesSessions, hermesBacklog };
