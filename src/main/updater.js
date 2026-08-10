// Downloading and swapping in a new Nami. The part that can brick an install.
//
// update-check.js decides whether there is anything worth offering; this file
// does something about it, and only ever when the user has said yes. The split
// is deliberate — the deciding is pure and tested, the doing touches the app
// bundle on disk, and mixing the two would put the risky half beyond reach of a
// test.
//
// Two rules run through everything here:
//
//   Nothing is downloaded unasked. The dmg is ~166 MB, which is somebody's
//   tether or hotel wifi, so autoDownload stays off and the first byte moves
//   when a button is pressed.
//
//   Nothing is installed while Nami is running. main.js kills every pty and
//   closes every Claude session on before-quit, so a restart-to-update would
//   end whatever the agents were doing. The swap therefore waits for a quit the
//   user chose for their own reasons — autoInstallOnAppQuit — and there is no
//   Restart button anywhere in the app that could take that choice away.
//
// When any of it fails, the app falls back to what 0.1.3 did: hand the dmg to a
// browser and let the user install it. A broken updater must degrade into the
// app we shipped last week, never into a dead end.

const fs = require('fs');
const path = require('path');

// The states the bar can be in, and the only moves between them.
//
// Written as a table because the rules are all in the gaps: 'ready' accepts
// nothing, so an update already staged can never be downloaded twice however
// many times the poll fires or a window reloads; 'failed' accepts 'download'
// again, so a flaky network is retryable; and a stray progress event after an
// error cannot drag the bar back into 'downloading'.
const FLOW = {
  idle: { download: 'downloading' },
  downloading: { progress: 'downloading', ready: 'ready', error: 'failed' },
  ready: {},
  failed: { download: 'downloading' },
};

function nextState(state, event) {
  const row = FLOW[state] || FLOW.idle;
  return row[event] || state;
}

// electron-updater reports progress as floats with a lot of decimal places and,
// on a resumed or mis-sized download, occasionally as more than 100. The bar
// renders whatever this returns, so it is clamped and rounded here rather than
// in the renderer, where a NaN would reach the DOM as the word "NaN".
function percentOf(p) {
  const n = Number(p && p.percent);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// The updater is loaded on first use, not at require time. electron-updater
// pulls in a fair amount on import, and the overwhelmingly common session never
// downloads an update at all — most launches should not pay for this file.
let auto = null;
function autoUpdater() {
  if (auto) return auto;
  ({ autoUpdater: auto } = require('electron-updater'));
  auto.autoDownload = false;          // rule one: nothing unasked
  auto.autoInstallOnAppQuit = true;   // rule two: nothing mid-session
  // Its own logging is off by default; when something does go wrong in the
  // field the only trace is what main prints, so let it speak into the console
  // main already writes to.
  auto.logger = { info: log, warn: log, error: log, debug: () => {} };
  return auto;
}

function log(...args) { console.log('[update]', ...args); }

// One download at a time, one staged update at a time, for the whole app —
// there can be three windows open and they are all looking at the same copy of
// Nami on disk.
let state = 'idle';
let staged = null;   // { version } once an update is sitting there waiting for a quit

function updaterState() { return { state, version: staged ? staged.version : null }; }

// Start the download the user just asked for.
//
// `emit` is how this file talks to the windows; main owns the sending. Every
// path through here ends in an emit, including the failures, because a bar that
// says "Getting Nami 0.1.4…" forever is worse than one that admits defeat and
// offers the browser again.
//
// checkForUpdates runs first because electron-updater will not download
// something it has not looked at. That is a second request to GitHub after the
// one update-check.js already made, and the two can disagree for the minute a
// release is being published — a disagreement surfaces here as an error, which
// is the browser fallback, which is correct.
async function downloadUpdate({ isPackaged, emit }) {
  // A dev build must never replace anything. main guards the poll the same way;
  // this is the guard that matters, because it is the one that writes to disk.
  if (!isPackaged) { log('not packaged — refusing to download'); return updaterState(); }

  const moved = nextState(state, 'download');
  if (moved === state) return updaterState();  // already downloading, or already staged
  state = moved;
  emit('update:progress', { percent: 0 });

  try {
    const up = autoUpdater();
    const found = await up.checkForUpdates();
    const version = (found && found.updateInfo && found.updateInfo.version) || null;

    const onProgress = (p) => {
      if (state !== 'downloading') return;
      emit('update:progress', { percent: percentOf(p), version });
    };
    up.on('download-progress', onProgress);
    try {
      await up.downloadUpdate();
    } finally {
      up.removeListener('download-progress', onProgress);
    }

    state = nextState(state, 'ready');
    staged = { version };
    log(`v${version} downloaded — it will install on quit`);
    emit('update:ready', { version });
  } catch (err) {
    state = nextState(state, 'error');
    staged = null;
    log('download failed:', (err && err.message) || err);
    // No version in the payload: the renderer still holds the one it was
    // offered, and it needs only to know it is back to opening a browser.
    emit('update:failed', {});
  }
  return updaterState();
}

// Is there a download sitting in the cache from a previous run?
//
// electron-updater writes the file and an update-info.json beside it, and then
// forgets both the moment the app closes: the handler that installs on quit is
// registered when a download finishes and lives in memory only, so a staged
// update that misses its moment is never installed by anything, ever. Nami
// reads the cache itself at launch so it can offer it again.
//
// update-info.json records the file name and its hash but not the version, so
// this answers "is something waiting" and nothing more. Which version it is
// comes from update-check.js, as it always has.
function hasStagedFile(cacheRoot, io = fs) {
  try {
    const dir = path.join(cacheRoot, 'pending');
    const info = JSON.parse(io.readFileSync(path.join(dir, 'update-info.json'), 'utf8'));
    const name = info && typeof info.fileName === 'string' ? info.fileName : '';
    return Boolean(name) && io.existsSync(path.join(dir, name));
  } catch (_) {
    return false;
  }
}

// Install it now, rather than hoping to win a race at quit time.
//
// The quit handler was the whole plan once, and it lost four times in a row on
// a real machine: it fires as the app is closing, Squirrel then waits for the
// process to actually go, and anyone who reopens Nami inside that window — 30
// seconds on a laptop with sessions to tear down, sometimes two minutes — gets
// "App Still Running Error" and no update, with nothing to say why. Quitting on
// purpose, through electron-updater, has no window to lose.
//
// The download comes first even when the file is already there. install() reads
// downloadedFileInfo, which only exists after a download has run in this
// process, so a cached file has to be claimed before it can be installed —
// validating one takes milliseconds, and a missing one is simply fetched.
async function installNow({ isPackaged, emit }) {
  if (!isPackaged) { log('not packaged — refusing to install'); return updaterState(); }

  if (state !== 'ready') await downloadUpdate({ isPackaged, emit });
  if (state !== 'ready') return updaterState();   // the download failed; the bar has already said so

  // Out of this tick: quitAndInstall tears the app down, and doing that inside
  // an IPC handler leaves the renderer waiting on a reply that can never come.
  setImmediate(() => {
    try {
      log('installing and restarting');
      autoUpdater().quitAndInstall(true, true);
    } catch (err) {
      log('install failed:', (err && err.message) || err);
      state = 'failed';
      emit('update:failed', {});
    }
  });
  return updaterState();
}

module.exports = { downloadUpdate, installNow, hasStagedFile, updaterState, nextState, percentOf };
