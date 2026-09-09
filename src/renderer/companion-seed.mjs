// Companion seed is a labelled brief of the parent's visible work. Payload
// only: the caller inserts it without Enter.
import { brief } from './session-context.mjs';

const clean = value => String(value ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim();
function titleOf(value) {
  const title = clean(value) || 'parent';
  return title.replace(/\s+session$/i, '') || title; // "Claude session" must not become "Claude session session"
}
function snapshotOf(owner) {
  if (!owner) return {};
  if (typeof owner.brief === 'function' && typeof owner.user === 'function') return owner.brief();
  if (typeof owner.sessionContext === 'function') return owner.sessionContext();
  if (typeof owner.snapshot === 'function') return owner.snapshot();
  return owner.snapshot || owner;
}

export function formatBrief(snapshot, { parentTitle } = {}) {
  const title = titleOf(parentTitle ?? snapshot?.title);
  const seen = brief(snapshot || {});
  const content = String(seen.content || '').trim();
  if (!content) return `You are watching the ${title} session. Nothing to read yet.`;
  const marks = [seen.label || (seen.kind === 'terminal' ? 'Terminal snapshot · available scrollback only' : 'Visible chat'), 'incomplete'];
  if (seen.truncated) marks.push('truncated');
  return `You are helping the ${title} session. Latest visible work:\n${marks.join(' · ')}\n${content}`;
}

export function seedCompanion(owner, child) {
  const text = formatBrief(snapshotOf(owner), { parentTitle: owner?.title });
  if (typeof child?.insertSessionDraft === 'function') child.insertSessionDraft({ text });
  return text;
}
