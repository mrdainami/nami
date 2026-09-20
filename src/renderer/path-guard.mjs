import { currentPlatform, isInside } from './paths.mjs';

// True when `abs` is not the project root and not under it. Separator-aware so
// a sibling that merely shares a name prefix ("/proj" vs "/proj-evil") counts
// as outside. Renderer paths on the supported platforms are already resolved
// absolutes (main returns `path.resolve`d `abs`), so a boundary prefix test is
// sufficient. When no project is open there is nothing to confine against.
//
// Which characters separate is the platform's call, not the path's: this used
// to read a drive letter off the root and switch to backslashes on the strength
// of it, which is the one kind of guess the Windows port does not allow. The
// rule itself now lives in paths.mjs, where Windows also gets the other half of
// it — C:\Proj and c:\proj are one folder there.
//
// Note: symlinks inside the project that point outside are not resolved here;
// this is a defense-in-depth confirmation, not the security boundary.
export function isOutsideProject(root, abs, platform = currentPlatform()) {
  if (!root || !abs) return false;
  return !isInside(root, abs, platform);
}
