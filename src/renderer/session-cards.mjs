// Agent events → the rows a card tile draws. Pure; the DOM is cards-dom.mjs's
// job. Works the same whether the events came from a live adapter or the
// transcript tail — that is the whole point of one vocabulary.
//
// One rule shapes all of it: a row may only say what the channel said. A tool
// that has not returned yet is pending, not done; a body that was capped says
// so; a result whose call scrolled off the top of the window is still shown,
// unlabelled, rather than dropped.

const MAX_LABEL = 64;
const MAX_DETAIL = 72;

// The glyph a row wears is its kind, never its tool's name — ACP types its
// calls this way and every other channel maps onto the same set.
export const TOOL_GLYPHS = {
  read: '◧', edit: '✎', execute: '▸', search: '⌕',
  fetch: '⇄', think: '⋯', checkpoint: '⎇', other: '•',
};

// Claude-shaped tool names → kind, for events that arrive without one (the
// transcript tail). Mirrors toolKindFor in src/main/agent-events.js.
export function toolKind(name) {
  switch (name) {
    case 'Read': case 'NotebookRead': return 'read';
    case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit': return 'edit';
    case 'Bash': case 'BashOutput': case 'KillShell': return 'execute';
    case 'Grep': case 'Glob': return 'search';
    case 'WebFetch': case 'WebSearch': return 'fetch';
    default: return 'other';
  }
}

function short(s, n) {
  const text = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return text.length > n ? text.slice(0, n - 1) + '…' : text;
}
function baseName(p) { return String(p || '').split(/[\\/]/).filter(Boolean).pop() || ''; }
function lineCount(s) { return String(s == null ? '' : s) ? String(s).split('\n').length : 0; }
function nLines(n) { return `${n} line${n === 1 ? '' : 's'}`; }

// What the row is called — the vocabulary the tile uses everywhere else.
export function toolLabel(name, input) {
  const i = input || {};
  switch (name) {
    case 'Read': return short(`Read ${baseName(i.file_path)}`, MAX_LABEL);
    case 'Write': return short(`Write ${baseName(i.file_path)}`, MAX_LABEL);
    case 'Edit': case 'MultiEdit': return short(`Edit ${baseName(i.file_path)}`, MAX_LABEL);
    case 'NotebookEdit': return short(`Edit ${baseName(i.notebook_path || i.file_path)}`, MAX_LABEL);
    case 'Bash': return short(i.description || i.command || 'Run a command', MAX_LABEL);
    case 'Grep': return short(`Grep ${i.pattern || ''}`, MAX_LABEL);
    case 'Glob': return short(`Glob ${i.pattern || ''}`, MAX_LABEL);
    case 'WebFetch': return short(`Fetch ${i.url || ''}`, MAX_LABEL);
    case 'WebSearch': return short(`Search the web${i.query ? ` for ${i.query}` : ''}`, MAX_LABEL);
    case 'Task': return short(i.description || 'Run a sub-agent', MAX_LABEL);
    case 'TodoWrite': return 'Update the plan';
    default: return short(name || 'Tool', MAX_LABEL);
  }
}

// The second line: the thing the label summarised. Empty when the label already
// said everything — a row with the same text twice reads as a rendering bug.
function toolDetail(name, input) {
  const i = input || {};
  if (name === 'Bash') return i.description ? short(i.command, MAX_DETAIL) : '';
  // The label already named the file. Repeating its whole path here reads as a
  // rendering fault, and a 70-character absolute path pushes the row wider than
  // the tile it sits in.
  if (name === 'Read' || name === 'NotebookRead') return '';
  if (name === 'Edit' || name === 'MultiEdit') {
    const d = editCounts(i);
    return d ? `+${d.add} −${d.del}` : '';
  }
  if (name === 'Write') return nLines(lineCount(i.content));
  if (i.file_path) return short(i.file_path, MAX_DETAIL);
  return '';
}

// Derived from the strings the call carries, not from a diff we never saw:
// the lines going out, and the lines coming in.
function editCounts(i) {
  const edits = Array.isArray(i.edits) ? i.edits : [{ old_string: i.old_string, new_string: i.new_string }];
  let add = 0, del = 0;
  for (const e of edits) { add += lineCount(e && e.new_string); del += lineCount(e && e.old_string); }
  return add || del ? { add, del } : null;
}

// The diff a row can open. For an edit it is the call's own strings; for a
// permission it is what the channel attached to the ask. Never synthesised.
export function toolDiff(name, input) {
  const i = input || {};
  if ((name === 'Edit') && (i.old_string || i.new_string)) {
    return { path: i.file_path || '', oldText: String(i.old_string || ''), newText: String(i.new_string || '') };
  }
  if (name === 'MultiEdit' && Array.isArray(i.edits) && i.edits.length) {
    const e = i.edits[0];
    return { path: i.file_path || '', oldText: String(e.old_string || ''), newText: String(e.new_string || ''), more: i.edits.length - 1 };
  }
  if (name === 'Write' && typeof i.content === 'string') {
    return { path: i.file_path || '', oldText: '', newText: i.content };
  }
  return null;
}

// A representative conversation for `--scene=cards`: one of every row shape,
// drawn from the shapes the real captures produced. This is what `npm run
// shot` renders, so the four theme screenshots are a command, not a ritual.
export function sceneEvents() {
  return [
    { kind: 'intro', id: 's0', name: 'Claude Code', version: '3.1.8', model: 'claude-opus-5', mode: 'default', cwd: '~/work/atlas' },
    { kind: 'user', id: 's1', text: 'Tighten up the greeting logic and check the tests still pass' },
    { kind: 'thinking', id: 's2', text: 'Two call sites use greet(); changing the signature would break the CLI path, so the default parameter is the safer edit.' },
    { kind: 'tool', id: 's3', toolId: 'x1', name: 'Read', input: { file_path: '/repo/src/greet.js' } },
    { kind: 'tool_result', id: 's4', toolId: 'x1', body: 'export function greet(name) {\n  return `hello ${name}`\n}\n', truncated: false },
    { kind: 'tool', id: 's5', toolId: 'x2', name: 'Edit', input: { file_path: '/repo/src/greet.js', old_string: 'export function greet(name) {\n  return `hello ${name}`\n}', new_string: 'export function greet(name = \'there\') {\n  return `hello ${name}`\n}' } },
    { kind: 'tool_result', id: 's6', toolId: 'x2', body: '', truncated: false },
    { kind: 'tool', id: 's7', toolId: 'x3', name: 'Bash', input: { command: 'npm test', description: 'Run the test suite' } },
    { kind: 'tool_result', id: 's8', toolId: 'x3', body: 'ℹ tests 24\nℹ pass 24\nℹ fail 0\n', truncated: false },
    { kind: 'plan', id: 's9', todos: [
      { text: 'Read the greeting module', status: 'completed' },
      { text: 'Default the name parameter', status: 'completed' },
      { text: 'Run the tests', status: 'in_progress' },
    ] },
    { kind: 'assistant', id: 's10', text: 'Done — `greet()` now defaults its name to **there**, so the bare call in `cli.js` stops printing `hello undefined`. All 24 tests pass.' },
    { kind: 'turn_end', id: 's11', durationMs: 12400, tokens: 18240 },
    { kind: 'user', id: 's12', text: 'Now rename it across the repo' },
    { kind: 'tool', id: 's13', toolId: 'x4', name: 'Grep', input: { pattern: 'greet\\(' } },
    { kind: 'tool', id: 's15', toolId: 'task1', name: 'Task', input: { description: 'Sub-agent — audit the pricing copy' } },
    { kind: 'assistant', id: 's16', text: 'Reading the tier table and the marketing page for drift…', parentToolId: 'task1' },
    { kind: 'tool', id: 's17', toolId: 'x6', name: 'Read', input: { file_path: '/repo/src/pricing.ts' }, parentToolId: 'task1' },
    { kind: 'tool_result', id: 's18', toolId: 'x6', body: 'export const tiers = …', truncated: false },
    { kind: 'permission', id: 's14', permissionId: 'sp1', toolName: 'Bash', title: 'Bash',
      description: 'Rename greet to welcome across src/',
      input: { command: 'grep -rl \'greet(\' src/ | xargs sed -i \'\' \'s/greet(/welcome(/g\'' },
      options: [
        { id: 'allow', label: 'Allow' },
        { id: 'sugg:0', label: 'Always allow `sed -i s/greet/welcome/`' },
        { id: 'deny', label: 'Deny' },
      ] },
  ];
}

export function fmtDuration(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (n < 60000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.floor(n / 60000)}m ${Math.round((n % 60000) / 1000)}s`;
}

function toolRow(e) {
  const kind = e.toolKind || toolKind(e.name);
  return {
    kind: 'tool', id: e.id, at: e.at, toolId: e.toolId, name: e.name,
    toolKind: kind, glyph: TOOL_GLYPHS[kind] || TOOL_GLYPHS.other,
    label: toolLabel(e.name, e.input), detail: toolDetail(e.name, e.input),
    diff: e.diff || toolDiff(e.name, e.input),
    body: '', isError: false, truncated: false, pending: true,
    children: null,
  };
}

export function buildRows(events) {
  const rows = [];
  const byTool = new Map();  // toolId -> the row waiting for its result
  const byPerm = new Map();  // permissionId -> the approval row
  let turnFiles = [];        // files edited since the last meter, for its chips

  // A sub-agent's turns belong under the Task row that spawned it, folded —
  // the card shows one line, expandable, not the sub-agent's whole life
  // interleaved with the main conversation.
  const push = (e, row) => {
    if (e.parentToolId) {
      const parent = byTool.get(e.parentToolId);
      if (parent) { (parent.children = parent.children || []).push(row); return; }
    }
    rows.push(row);
  };

  for (const e of events || []) {
    if (!e) continue;
    switch (e.kind) {
      case 'user':
        rows.push({ kind: 'user', id: e.id, at: e.at, text: e.text, command: !!e.command });
        break;

      case 'assistant':
      case 'thinking':
        push(e, { kind: e.kind, id: e.id, at: e.at, text: e.text });
        break;

      case 'tool': {
        const file = e.input && (e.input.file_path || e.input.filepath || e.input.AbsolutePath || e.input.TargetFile);
        if (file && (e.toolKind === 'edit' || toolKind(e.name) === 'edit') && !turnFiles.includes(file)) turnFiles.push(file);
        // An adapter may re-describe a call it already announced — ACP's
        // tool_call_update knows more than its tool_call did. Same row,
        // better words: update in place, never a second row.
        const seen = e.toolId && byTool.get(e.toolId);
        if (seen && seen.pending) {
          const fresh = toolRow(e);
          seen.name = fresh.name; seen.toolKind = fresh.toolKind; seen.glyph = fresh.glyph;
          seen.label = fresh.label; seen.detail = fresh.detail;
          seen.diff = fresh.diff || seen.diff;
          break;
        }
        const row = toolRow(e);
        if (e.toolId) byTool.set(e.toolId, row);
        push(e, row);
        break;
      }

      case 'tool_result': {
        const row = e.toolId && byTool.get(e.toolId);
        if (row) {
          row.body = e.body || '';
          row.isError = !!e.isError;
          row.truncated = !!e.truncated;
          if (e.diff) row.diff = e.diff;
          row.pending = false;
          // A read's one open question is how much came back.
          if (row.toolKind === 'read' && !row.detail && row.body) row.detail = nLines(lineCount(row.body));
          byTool.delete(e.toolId);
          break;
        }
        // No call in view. Common and expected: a large transcript opens on its
        // last screenful, so the tool_use can be off the top.
        rows.push({
          kind: 'tool', id: e.id, at: e.at, toolId: e.toolId, name: '',
          toolKind: 'other', glyph: TOOL_GLYPHS.other, label: 'Tool result', detail: '', diff: null,
          body: e.body || '', isError: !!e.isError, truncated: !!e.truncated, pending: false, children: null,
        });
        break;
      }

      case 'plan':
        rows.push({ kind: 'plan', id: e.id, at: e.at, todos: Array.isArray(e.todos) ? e.todos : [] });
        break;

      case 'permission': {
        const row = {
          kind: 'permission', id: `perm:${e.permissionId}`, at: e.at,
          permissionId: e.permissionId, toolName: e.toolName,
          title: e.title || e.toolName, description: e.description || '',
          options: Array.isArray(e.options) ? e.options : [],
          diff: e.diff || null, input: e.input || {},
          resolved: null,
        };
        byPerm.set(e.permissionId, row);
        rows.push(row);
        break;
      }

      case 'permission_resolved': {
        const row = byPerm.get(e.permissionId);
        if (row) row.resolved = e.optionId || 'resolved';
        break;
      }

      case 'intro':
        rows.push({
          kind: 'intro', id: e.id, at: e.at,
          name: e.name || 'Agent', version: e.version || '', model: e.model || '',
          mode: e.mode || '', cwd: e.cwd || '', channel: e.channel || '',
          note: e.note || '',
        });
        break;

      case 'note':
        rows.push({ kind: 'note', id: e.id, at: e.at, text: e.text, action: e.action || null });
        break;

      case 'error':
        rows.push({ kind: 'error', id: e.id, at: e.at, text: e.message });
        break;

      case 'turn_end':
        rows.push({
          kind: 'turn_end', id: e.id, at: e.at,
          duration: fmtDuration(e.durationMs),
          tokens: Number(e.tokens) || 0,
          files: turnFiles,
        });
        turnFiles = [];
        break;

      // init and status shape the tile (badge, composer, commands), not the
      // list — app.js reads them before the rows are built.
      default:
        break;
    }
  }

  // Pending is not permanent: a channel that never completes its calls (Hermes)
  // would otherwise leave spinners forever. The final settle happens at
  // turn_end in the live path; here every dangling call after the last
  // turn_end of the stream keeps its pending mark — the DOM decides.
  return groupTurns(rows);
}

// A finished turn folds its work — the Codex reading: your bubble, then
// `worked for 12.4s · 6 steps ▸`, then the prose, then an Edited-N-files
// card, then the meter. Only completed turns fold; the live one is watched.
function groupTurns(rows) {
  const out = [];
  let turn = [];   // everything since the last user row

  // how: 'ended' — a turn_end closed it (meter is that row);
  //      'implied' — the next user turn arrived, so this one is over even
  //                  though the channel never said so (SDK transcripts carry
  //                  no turn_duration records);
  //      'live' — still happening: never folded, you watch it.
  const flush = (how, meter) => {
    if (!turn.length) { if (meter) out.push(meter); return; }
    if (how === 'live') { out.push(...turn); turn = []; return; }

    // What folds: the activity. What stays: what was said, what failed, and
    // anything still waiting on the user.
    const folded = [];
    const visible = [];
    const edited = [];
    for (const r of turn) {
      if (r.kind === 'tool' || r.kind === 'thinking' || (r.kind === 'permission' && r.resolved)) {
        folded.push(r);
        if (r.kind === 'tool' && r.toolKind === 'edit' && !r.isError) {
          const path = (r.diff && r.diff.path) || '';
          edited.push({ path: path || r.label.replace(/^\S+\s+/, ''), diff: r.diff || null });
        }
      } else {
        visible.push(r);
      }
    }

    const anchor = meter || folded[0] || visible[0];
    if (folded.length) {
      out.push({
        kind: 'fold', id: `fold:${anchor.id}`,
        count: folded.length, duration: meter ? meter.duration : '', children: folded,
      });
    }
    out.push(...visible);
    if (edited.length) out.push({ kind: 'edits', id: `edits:${anchor.id}`, files: edited });
    if (meter) out.push(meter);
    turn = [];
  };

  for (const r of rows) {
    if (r.kind === 'user') { flush('implied', null); out.push(r); continue; }
    if (r.kind === 'turn_end') { flush('ended', r); continue; }
    turn.push(r);
  }
  flush('live', null);
  return out;
}
