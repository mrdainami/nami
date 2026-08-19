// True when `abs` is not the project root and not under it. Separator-aware so
// a sibling that merely shares a name prefix ("/proj" vs "/proj-evil") counts
// as outside. Renderer paths on the supported platforms are already resolved
// absolutes (main returns `path.resolve`d `abs`), so a boundary prefix test is
// sufficient. When no project is open there is nothing to confine against.
export function isOutsideProject(root, abs) {
  if (!root || !abs) return false;
  // Windows paths ("C:\..." or "C:/...") use backslash separators; POSIX paths
  // do not, and a backslash there is an ordinary filename character. Detect the
  // Windows shape by its drive-letter prefix and compare on a single separator.
  const win = /^[A-Za-z]:[\\/]/.test(String(root));
  const norm = (s) => win ? String(s).replace(/\\/g, '/') : String(s);
  const r = norm(root).replace(/\/+$/, '');
  const a = norm(abs);
  if (a === r) return false;
  // Note: symlinks inside the project that point outside are not resolved here;
  // this is a defense-in-depth confirmation, not the security boundary.
  return !a.startsWith(r + '/');
}
