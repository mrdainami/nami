// Per-tile text size. − ＋ on a card used to turn one shared dial; the helpers
// here are the new dial: a number on the panel, stepped, with a fallback for
// tiles that have never been tapped (the old global, so a saved desk does not
// jump on first launch).

export const TERM_FONT_MIN = 10;
export const TERM_FONT_MAX = 18;
export const TERM_FONT_DEFAULT = 12;
export const DOC_STEPS = [0.85, 1, 1.15, 1.3, 1.5, 1.75, 2];

export function clampTermFont(n, fallback = TERM_FONT_DEFAULT) {
  const v = Number(n);
  if (v >= TERM_FONT_MIN && v <= TERM_FONT_MAX) return v;
  const f = Number(fallback);
  if (f >= TERM_FONT_MIN && f <= TERM_FONT_MAX) return f;
  return TERM_FONT_DEFAULT;
}

export function nextTermFont(cur, dir, fallback = TERM_FONT_DEFAULT) {
  const now = clampTermFont(cur, fallback);
  return Math.min(TERM_FONT_MAX, Math.max(TERM_FONT_MIN, now + dir));
}

export function clampDocScale(n, fallback = 1) {
  const v = Number(n);
  if (DOC_STEPS.includes(v)) return v;
  const f = Number(fallback);
  return DOC_STEPS.includes(f) ? f : 1;
}

export function nextDocScale(cur, dir, fallback = 1) {
  const now = clampDocScale(cur, fallback);
  const i = DOC_STEPS.indexOf(now);
  return DOC_STEPS[Math.min(DOC_STEPS.length - 1, Math.max(0, i + dir))];
}
