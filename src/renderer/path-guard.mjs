// True when `abs` is not the project root and not under it. Separator-aware so
// a sibling that merely shares a name prefix ("/proj" vs "/proj-evil") counts
// as outside. Renderer paths on the supported platforms are already resolved
// absolutes (main returns `path.resolve`d `abs`), so a boundary prefix test is
// sufficient. When no project is open there is nothing to confine against.
export function isOutsideProject(root, abs) {
  if (!root || !abs) return false;
  const r = String(root).replace(/\/+$/, '');
  const a = String(abs);
  if (a === r) return false;
  return !a.startsWith(r + '/');
}
