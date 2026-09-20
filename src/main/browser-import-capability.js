// What "Import from Chrome" can honestly copy on this platform.
//
// On a Mac the browser's storage key sits in the Keychain, and the person can
// let Nami read it; cookies, saved passwords and history all come across.
//
// On Windows that key is tied to the browser itself. Since Chrome 127 cookies
// are "app-bound" (the v20 blobs the worker already refuses): they decrypt only
// inside the browser's own signed program, by design, and the only ways round
// that are the ones malware uses. So Nami does not offer it. An import that
// could only ever copy nothing, and then blame a Keychain that Windows does not
// have, is worse than saying so up front.
//
// History is a plain database with nothing locked in it, so it still imports.
//
// Pure, with the platform as a parameter, so a Mac can test the Windows column.
// browser-views.js hands the answer to the screen and refuses at the door; the
// worker asks again on its own thread, in case anything ever reaches it another
// way.
const CATEGORIES = ['cookies', 'passwords', 'history'];
const WINDOWS_REFUSAL = 'Windows browsers lock their saved sign-ins to the browser itself, so Nami cannot copy them. Sign in inside the browser tile instead.';

function importCapability(platform = process.platform) {
  if (platform === 'win32') return { available: false, reason: 'windows-app-bound', categories: ['history'] };
  return { available: true, reason: '', categories: CATEGORIES.slice() };
}

// The categories a request asks for, read the way the job queue reads them: a
// category is wanted unless it was switched off.
function refusedCategories(args = {}, platform = process.platform) {
  const allowed = importCapability(platform).categories;
  return CATEGORIES.filter((k) => args[k] !== false && !allowed.includes(k));
}

// '' when the request may start, otherwise the sentence to show instead.
function importRefusal(args = {}, platform = process.platform) {
  return refusedCategories(args, platform).length ? WINDOWS_REFUSAL : '';
}

// A source that holds nothing this platform can copy is not a source: offering
// an Edge profile with no History file would start an import of nothing.
function importableSources(status, platform = process.platform) {
  const allowed = importCapability(platform).categories;
  const browsers = (status?.browsers || []).filter((s) => allowed.some((k) => s[k]));
  return { ...status, available: browsers.length > 0, browsers };
}

module.exports = { importCapability, refusedCategories, importRefusal, importableSources, WINDOWS_REFUSAL };
