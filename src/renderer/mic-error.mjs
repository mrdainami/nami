// What to say when the microphone will not open.
//
// On a Mac the browser's own message is what has always been shown, and it
// stays. macOS asks the first time and its refusal reads well enough.
//
// Windows never asks. One switch, off by default on some work PCs, denies the
// microphone to every desktop app at once, and what reaches the page is
// "Permission denied" or "Could not start audio source" — true, and no help,
// because nothing on screen says where the permission lives. So on Windows the
// message names the setting, in the words Windows 11 prints beside it.
//
// NotReadableError is listed with NotAllowedError on purpose: Chromium reports
// the privacy switch as either, depending on its version, and the other cause
// of NotReadableError (another program holding the mic) is covered by the same
// sentence.
//
// Platform is passed in (api.platform); nothing here looks at the machine.
const WIN_BLOCKED = 'Windows is not letting Nami use the microphone. Open Settings → Privacy & security → Microphone and turn on “Let desktop apps access your microphone”. If it is already on, another app may be holding the mic.';
const WIN_MISSING = 'No microphone was found. Plug one in, or pick one in Settings → System → Sound → Input.';

export function micErrorText(error, platform) {
  const message = (error && error.message) || String(error);
  if (platform !== 'win32') return message;
  const name = error && error.name;
  if (name === 'NotAllowedError' || name === 'NotReadableError' || name === 'SecurityError') return WIN_BLOCKED;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return WIN_MISSING;
  return message;
}
