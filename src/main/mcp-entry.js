// One connector, two spellings.
//
// A Mac writes `npx -y pkg`. A PC is often told to write `cmd /c npx -y pkg`,
// because npx on Windows is npx.cmd and a client that spawns the bare name
// without a shell cannot find it. A project's .mcp.json is committed and shared,
// so both spellings of the same server meet in one file, under one id.
//
// What each client really does with a bare `npx` on Windows, checked 2026-09-20
// (re-verify on change):
//   Claude Code   starts it. Run in the Windows 11 VM, 2.1.278: bare and
//                 wrapped both "Connected". The docs' old "requires the cmd /c
//                 wrapper" line is gone, and 2.1.119 removed the warning as a
//                 false positive.
//   Codex         starts it since 0.59 (rmcp-client/program_resolver.rs reads
//                 PATH and PATHEXT).
//   Grok          starts it; its MCP guide says so in as many words.
//   Gemini CLI    starts it: the MCP TypeScript SDK spawns through cross-spawn.
//   OpenCode      the same SDK, the same answer.
//   Kimi          starts it: the MCP Python SDK looks the name up with PATHEXT.
//   Antigravity   unknown. It shares Gemini's file, so it gets Gemini's entry.
//   Cursor        the one client still reported to need the wrapper.
//
// So the plain spelling is the portable one — it starts on both machines — and
// the wrapper starts only on a PC. That decides every rule below: the wrapper is
// written only where a client needs it, and it never replaces a plain entry for
// the same server, because that would break the teammate on the Mac to fix
// nothing on the PC.
//
// Pure: no IO, and platform is always a parameter.

// npm's own launchers, the ones installed as .cmd files. `node`, `uvx`,
// `python` and the rest are real programs and start without help.
const CMD_SHIMS = new Set(['npx', 'npm', 'pnpm', 'pnpx', 'yarn']);

// OpenCode keeps program and arguments in one array and calls env
// `environment`. Read both dialects as one shape.
function parts(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (Array.isArray(entry.command)) {
    return { command: String(entry.command[0] || ''), args: entry.command.slice(1), env: entry.environment || {} };
  }
  if (typeof entry.command !== 'string') return null;
  return { command: entry.command, args: Array.isArray(entry.args) ? entry.args : [], env: entry.env || {} };
}

// Where the wrapped command starts: after `cmd`, any /d or /s, and the /c.
function wrappedAt(p) {
  if (!p || !/^(.*[\\/])?cmd(\.exe)?$/i.test(p.command)) return -1;
  let i = 0;
  while (i < p.args.length && /^\/[ds]$/i.test(String(p.args[i]))) i += 1;
  if (!/^\/c$/i.test(String(p.args[i] || '')) || i + 1 >= p.args.length) return -1;
  return i + 1;
}

function isCmdWrapped(entry) { return wrappedAt(parts(entry)) >= 0; }

// The entry with the wrapper taken off, in the dialect it came in. An entry
// with no wrapper is handed back as it came, the same object.
function unwrapCmd(entry) {
  const p = parts(entry);
  const at = wrappedAt(p);
  if (at < 0) return entry;
  if (Array.isArray(entry.command)) return { ...entry, command: p.args.slice(at) };
  return { ...entry, command: String(p.args[at]), args: p.args.slice(at + 1) };
}

function wrapCmd(entry) {
  if (!entry || typeof entry.command !== 'string' || !CMD_SHIMS.has(entry.command)) return entry;
  return { ...entry, command: 'cmd', args: ['/c', entry.command, ...(entry.args || [])] };
}

// The entry to deliver to one client on one platform. `wrap` is that client's
// answer to "does it need the wrapper on a PC" — connections.js keeps the list.
function entryFor(entry, { platform = process.platform, wrap = false } = {}) {
  return platform === 'win32' && wrap ? wrapCmd(entry) : entry;
}

function sameEnv(a, b) {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && String(a[k]) === String(b[k]));
}

// Same program, same arguments, same keys, once any wrapper is off. A remote
// server is its address.
function sameServer(a, b) {
  if (!a || !b) return false;
  if (a.url || b.url) return !!a.url && a.url === b.url;
  const pa = parts(a), pb = parts(b);
  if (!pa || !pb) return false;
  const strip = (p) => { const at = wrappedAt(p); return at < 0 ? p : { command: String(p.args[at]), args: p.args.slice(at + 1), env: p.env }; };
  const x = strip(pa), y = strip(pb);
  return x.command === y.command
    && x.args.length === y.args.length && x.args.every((v, i) => String(v) === String(y.args[i]))
    && sameEnv(x.env, y.env);
}

// What to store when `want` is about to land on `existing` under one id.
// Always `want`, as it always was — with one exception: a wrapper never
// replaces the plain spelling of the same server.
function settleEntry(existing, want) {
  if (existing && isCmdWrapped(want) && !isCmdWrapped(existing) && sameServer(existing, want)) return existing;
  return want;
}

module.exports = { CMD_SHIMS, isCmdWrapped, unwrapCmd, wrapCmd, entryFor, sameServer, settleEntry };
