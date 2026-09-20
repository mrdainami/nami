// What the import screen offers, given what main says this platform can copy
// (browser-import-capability.js). The screen never works it out for itself: it
// shows the boxes main will accept and, where sign-ins cannot be copied, one
// sentence in their place — not a greyed button, and not a Keychain that
// Windows does not have.
const ALL = ['passwords', 'cookies', 'history'];

// The boxes to draw, in the order the screen has always drawn them. A main
// process that says nothing is one that can copy everything.
export function importCategories(capability) {
  const allowed = Array.isArray(capability?.categories) ? capability.categories : ALL;
  return ALL.filter((k) => allowed.includes(k));
}

// '' means "say what the screen has always said". Anything else replaces it.
export function importNote(capability) {
  if (!capability || capability.available !== false) return '';
  if (capability.reason === 'windows-app-bound') return 'Windows browsers lock their saved sign-ins to the browser itself, so Nami cannot copy them; signing in inside this browser tile works and is remembered.';
  return 'Saved sign-ins cannot be copied from another browser here; signing in inside this browser tile works and is remembered.';
}
