// Clock B — tell the pty the size, once per gesture.
//
// Clock A (fitCanvas) may resize the xterm many times while a card is moving.
// Each of those raises term.onResize. This module is the only place that
// becomes a term:resize IPC. The rule: one send after the burst, and only if
// cols/rows actually changed.
//
// Discrete (expand, collapse, grip drop) used to set delay 0 for 300ms. A
// delay of 0 fires before the next animation frame, so every extra fit in
// that window was its own SIGWINCH. Trailing 32ms still lands on the same
// paint as the gesture (not the old 140ms "tile then agent later" split) but
// coalesces the frames of one expand.

export const PTY_SETTLE_MS = 140;
export const PTY_DISCRETE_MS = 300;
export const PTY_DISCRETE_TRAIL_MS = 32;

export function createClockB({ send, now, schedule, cancel }) {
  let fastUntil = 0;
  const recs = new Map();

  function rec(id) {
    let s = recs.get(id);
    if (!s) {
      s = { last: null, timer: null, hold: false, pending: false };
      recs.set(id, s);
    }
    return s;
  }

  function fire(id, cols, rows) {
    const s = rec(id);
    s.timer = null;
    s.pending = false;
    if (s.last && s.last.cols === cols && s.last.rows === rows) return;
    s.last = { cols, rows };
    send({ id, cols, rows });
  }

  return {
    discrete() { fastUntil = now() + PTY_DISCRETE_MS; },
    setHold(id, on) { rec(id).hold = !!on; },
    isPending(id) { return rec(id).pending; },
    clearPending(id) { rec(id).pending = false; },
    notify(id, cols, rows) {
      const s = rec(id);
      if (s.hold) { s.pending = true; return; }
      if (s.timer != null) cancel(s.timer);
      const wait = now() < fastUntil ? PTY_DISCRETE_TRAIL_MS : PTY_SETTLE_MS;
      s.timer = schedule(wait, () => fire(id, cols, rows));
    },
    flushPending(id, cols, rows) {
      const s = rec(id);
      if (!s.pending) return;
      s.pending = false;
      this.notify(id, cols, rows);
    },
    forget(id) {
      const s = recs.get(id);
      if (!s) return;
      if (s.timer != null) cancel(s.timer);
      recs.delete(id);
    },
  };
}
