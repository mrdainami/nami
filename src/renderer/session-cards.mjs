// Transcript events → the rows a card tile draws. Pure; the DOM is app.js's job.
//
// One rule shapes all of it: a row may only say what the transcript said. A
// tool that has not returned yet is pending, not done; a body that was capped
// says so; a result whose call scrolled off the top of the window is still
// shown, unlabelled, rather than dropped.

const MAX_LABEL = 64;
const MAX_DETAIL = 72;

function short(s, n) {
  const text = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return text.length > n ? text.slice(0, n - 1) + '…' : text;
}
function baseName(p) { return String(p || '').split(/[\\/]/).filter(Boolean).pop() || ''; }
function lineCount(s) { return String(s == null ? '' : s) ? String(s).split('\n').length : 0; }

// What the row is called. The vocabulary matches labelTool in claude-driver.js,
// so an SDK-driven card and a transcript-driven one read identically.
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
  if (name === 'Edit' || name === 'MultiEdit') {
    // Derived from the strings the call carries, not from a diff we never saw:
    // the lines going out, and the lines coming in.
    const edits = Array.isArray(i.edits) ? i.edits : [{ old_string: i.old_string, new_string: i.new_string }];
    let add = 0, del = 0;
    for (const e of edits) { add += lineCount(e && e.new_string); del += lineCount(e && e.old_string); }
    return add || del ? `+${add} −${del}` : '';
  }
  if (name === 'Write') return `${lineCount(i.content)} lines`;
  if (i.file_path) return short(i.file_path, MAX_DETAIL);
  return '';
}

export function fmtDuration(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (n < 60000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.floor(n / 60000)}m ${Math.round((n % 60000) / 1000)}s`;
}

export function buildRows(events) {
  const rows = [];
  const byTool = new Map(); // toolId -> the row waiting for its result

  for (const e of events || []) {
    if (!e) continue;
    switch (e.kind) {
      case 'user':
      case 'assistant':
      case 'thinking':
        rows.push({ kind: e.kind, id: e.id, at: e.at, text: e.text, command: !!e.command });
        break;

      case 'tool': {
        const row = {
          kind: 'tool', id: e.id, at: e.at, toolId: e.toolId, name: e.name,
          label: toolLabel(e.name, e.input), detail: toolDetail(e.name, e.input),
          body: '', isError: false, truncated: false, pending: true,
        };
        if (e.toolId) byTool.set(e.toolId, row);
        rows.push(row);
        break;
      }

      case 'tool_result': {
        const row = e.toolId && byTool.get(e.toolId);
        if (row) {
          row.body = e.body || '';
          row.isError = !!e.isError;
          row.truncated = !!e.truncated;
          row.pending = false;
          byTool.delete(e.toolId);
          break;
        }
        // No call in view. Common and expected: a large transcript opens on its
        // last screenful, so the tool_use can be off the top. The output is
        // real either way.
        rows.push({
          kind: 'tool', id: e.id, at: e.at, toolId: e.toolId, name: '',
          label: 'Tool result', detail: '',
          body: e.body || '', isError: !!e.isError, truncated: !!e.truncated, pending: false,
        });
        break;
      }

      case 'turn_end':
        rows.push({ kind: 'turn_end', id: e.id, at: e.at, duration: fmtDuration(e.durationMs) });
        break;

      default:
        break;
    }
  }
  return rows;
}
