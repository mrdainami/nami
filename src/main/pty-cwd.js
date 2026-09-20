// Where a session actually is, as opposed to where it started.
//
// A panel's cwd is fixed when the pty spawns and never moves again, so every
// relative path an agent prints after a `cd` is resolved against the original
// root, stats to nothing, and is never offered as a link. The file is real;
// the link is not. Nothing in the tree tracks the shell's own movement — the
// OSC handling here is titles (osc-title.js), hyperlinks (xterm's own) and
// run-done, never OSC 7.
//
// OSC 7 is the usual answer and it is the wrong one for us. macOS gates
// /etc/zshrc's emitter on TERM_PROGRAM=Apple_Terminal, so adopting it means
// injecting a precmd hook into the user's shell — a different shim for zsh,
// bash and fish — and it still goes quiet inside anything that does not print
// a prompt. Asking the OS costs one lsof, needs no configuration, and answers
// for every shell.
//
// Lazy on purpose: this is only ever reached by a *relative* token that has
// already missed against the frozen cwd, and only while a link is being
// hovered. execFile is injectable so the tests never shell out — a test that
// ran the real lsof would pass here and fail on a machine without it.
//
// Windows has no lsof and no cheap equivalent, so there the shell is asked to
// say where it is on every prompt (shell-integration.js), main.js passes what
// it said to tell(), and the same question is answered from memory. A session
// that never said anything — an agent tile, which shows no prompt — answers
// null, and the caller keeps the folder the tile started in.

const { execFile } = require('child_process');

// Long enough that hovering along a line of paths asks once, short enough that
// a `cd` is picked up before you have finished reading the next reply.
const TTL_MS = 4000;
// A hung lsof must never hold a hover open. Well past a local answer.
const TIMEOUT_MS = 400;
const MAX_PIDS = 100;

function createPtyCwd({
  run = execFile,
  platform = process.platform,
  now = Date.now,
  ttl = TTL_MS,
  max = MAX_PIDS,
} = {}) {
  const cache = new Map();   // pid -> { at, cwd }
  const told = new Map();    // pid -> cwd, as the shell itself last reported it

  function ptyCwd(pid) {
    if (pid && platform === 'win32') return Promise.resolve(told.get(pid) || null);
    // lsof is a mac and BSD answer. Everywhere else this feature does not
    // exist, which is the same behaviour as before it was written.
    if (!pid || platform !== 'darwin') return Promise.resolve(null);
    const hit = cache.get(pid);
    // A miss is cached as hard as a hit. A pid that has exited answers with an
    // error every time, and hovering down a column of dead paths would
    // otherwise spawn one lsof per token.
    if (hit && now() - hit.at < ttl) return Promise.resolve(hit.cwd);
    return new Promise((resolve) => {
      run('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'], { timeout: TIMEOUT_MS }, (err, out) => {
        let cwd = null;
        if (!err) {
          // -F prints one field per line, each tagged by its first character.
          // Only the n row is a path, and only slice(1) is safe: a directory
          // with spaces in it is still one field.
          const row = String(out || '').split('\n').find((l) => l.startsWith('n') && l.length > 1);
          if (row) cwd = row.slice(1);
        }
        if (cache.size >= max) cache.clear();
        cache.set(pid, { at: now(), cwd });
        resolve(cwd);
      });
    });
  }

  // One entry per live pane, dropped when its pty exits, so there is nothing
  // to cap and nothing to expire: the last thing a shell said stays true until
  // it says something else.
  ptyCwd.tell = (pid, cwd) => { if (pid && cwd) told.set(pid, String(cwd)); };
  ptyCwd.forget = (pid) => { told.delete(pid); cache.delete(pid); };
  ptyCwd.size = () => cache.size;
  ptyCwd.clear = () => { cache.clear(); told.clear(); };
  return ptyCwd;
}

module.exports = { createPtyCwd, ptyCwd: createPtyCwd(), TTL_MS, TIMEOUT_MS };
