// The home folder, as the renderer knows it.
//
// For years nothing here knew it at all. It was read off the front of whatever
// path was in hand — /Users/<name> — which is right on a Mac and finds nothing
// in C:\Users\You\proj, so on Windows `~\notes.md` in a chat opened \notes.md
// and no path on any tile was ever shortened to `~`.
//
// A path cannot say where home is on Windows: a project on D:\ has no home in
// it. So main says (os.homedir(), in the boot payload), app.js hands it to
// setHome once, and the Windows column uses that. The Mac column is what it
// always was, regex and all — including that it shortens any /Users/<name>,
// not only this one.
import { currentPlatform, isInside, fromFileUrl } from './paths.mjs';

let known = '';
export function setHome(home) { known = typeof home === 'string' ? home : ''; }
export function homeDir() { return known; }

// The home a chat session resolves `~` against.
export function sessionHome(cwd, home = known, platform = currentPlatform()) {
  if (platform === 'win32') return String(home || '').replace(/[\\/]+$/, '');
  return (String(cwd || '').match(/^\/(Users|home)\/[^/]+/) || [''])[0];
}

// C:\Users\You\proj → ~\proj, for showing. Windows ends the home folder at
// either separator and does not mind how it was capitalised; what follows the
// `~` is left exactly as it was written.
export function shortHome(p, home = known, platform = currentPlatform()) {
  const s = String(p || '');
  if (platform !== 'win32') return s.replace(/^\/Users\/[^/]+/, '~');
  const h = String(home || '').replace(/[\\/]+$/, '');
  return h && isInside(h, s, platform) ? '~' + s.slice(h.length) : s;
}

// The folder a file:// URL names, as a path: decoded, in the platform's own
// spelling, no trailing separator. The demo and screenshot scenes start a chat
// in the folder above the app, and used to take it from URL.pathname — which is
// /C:/nami/ on Windows, a path nothing can open.
export function folderOfUrl(url, platform = currentPlatform()) {
  const p = decodeURIComponent(fromFileUrl(url, platform));
  return platform === 'win32' ? p.replace(/\\$/, '') : p.replace(/\/$/, '');
}
