export function selectionReference({ path = 'Untitled', source, start, end, text }) {
  const result = { text: String(text || '') };
  if (typeof source === 'string' && Number.isInteger(start) && Number.isInteger(end) && end > start) {
    result.text = source.slice(start, end);
    result.startLine = source.slice(0, start).split('\n').length;
    result.endLine = source.slice(0, Math.max(start, end - (source[end - 1] === '\n' ? 1 : 0))).split('\n').length;
  }
  result.reference = result.startLine ? `${path}:${result.startLine}${result.endLine !== result.startLine ? '-' + result.endLine : ''}` : `${path} (excerpt)`;
  return result;
}
export function appendDraft(existing, text) { return existing ? existing + '\n\n' + text : text; }
export function terminalDraft(text, bracketed) {
  const clean = String(text).replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  if (clean.includes('\n') && !bracketed) return null;
  return (bracketed ? '\x1b[200~' + clean + '\x1b[201~' : clean) + '\r';
}
