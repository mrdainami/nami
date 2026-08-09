// "now" / "12m" / "3h" / "Tue" / "12 Mar" — the age on a Recents row.
//
// The row needs just enough to explain the order at a glance; an exact
// timestamp would be noise in a list whose only job is "which of these did I
// touch most recently". Resolution drops off the same way memory does: minutes
// while it is still this hour, weekday inside the last week, then a date.
//
// `now` is a parameter so the ladder is testable without freezing the clock.
export function shortAge(at, now = Date.now()) {
  if (!at) return '';
  const d = now - at;
  if (d < 0) return 'now';           // a clock change must not print "-3h"
  if (d < 60e3) return 'now';
  if (d < 3600e3) return Math.round(d / 60e3) + 'm';
  if (d < 86400e3) return Math.round(d / 3600e3) + 'h';
  const then = new Date(at);
  if (d < 7 * 86400e3) return then.toLocaleDateString(undefined, { weekday: 'short' });
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
