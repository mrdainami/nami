// Makes the Windows ARM64 installer install the app, which without this it
// does not.
//
// electron-builder packs the app into a 7z archive with a current 7-Zip (24.09)
// and unpacks it on the user's PC with the Nsis7z plugin, which is built from a
// 7-Zip many years older. Since 23.01, 7-Zip runs every ARM64 .exe and .dll
// through a new "ARM64" branch filter before compressing it. The old plugin has
// never heard of that filter, and it does not fail: it skips the file. Measured
// on the first arm64 build, installed on a Windows 11 ARM64 VM:
//
//   installer exit code 0, shortcuts made, uninstaller registered
//   Nami.exe                          not there
//   every .dll in the app             not there
//   conpty.node, sharp-*.node         there (.node is not a name 7-Zip filters)
//
// The portable build unpacks through the same plugin. x64 never showed it,
// because the x86 filter ("BCJ") is older than the plugin.
//
// ELECTRON_BUILDER_7Z_FILTER is electron-builder's own switch for the filter.
// BCJ, the x86 one, is a filter the plugin can undo; on ARM64 code it finds
// nothing to convert. What it costs is the ARM64 filter's gain: the installer
// goes from 146 MB to 157 MB. ARM, PPC and SPARC were measured too and come out
// the same, so there is nothing cleverer to pick. When electron-builder ships a
// newer Nsis7z this whole file can go, and check-bundle plus one real install
// is how to find out.
//
// It is set here, in a hook, so that it holds however the build is started: an
// npm script could only set it for one shell, and CI and a person at a prompt
// do not share one. Only arm64 is touched. x64 already gets BCJ on its own, and
// a value somebody set by hand is theirs to keep.
import { createRequire } from 'node:module';

const FILTER = 'ELECTRON_BUILDER_7Z_FILTER';
let ours = false;

export function packEnv(platformName, arch, env) {
  if (platformName === 'win32' && arch === 'arm64' && !env[FILTER]) { env[FILTER] = 'BCJ'; ours = true; }
  // One run can pack more than one arch, and the environment outlives each.
  else if (ours && !(platformName === 'win32' && arch === 'arm64')) { delete env[FILTER]; ours = false; }
  return env;
}

export default function beforePack(context) {
  // context.arch is electron-builder's number for it; this is its own table.
  const { Arch } = createRequire(import.meta.url)('builder-util');
  packEnv(context.electronPlatformName, Arch[context.arch], process.env);
}
