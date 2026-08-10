// Decide what opening something should do given the tiles already on the desk.
// 'file' opens match editor OR viewer tiles (a binary that fell back to a
// viewer tile must be found again without a re-read); 'card' matches cards only.
export function resolveOpen(panels, kind, filePath) {
  const kinds = kind === 'card' ? ['card'] : ['editor', 'viewer'];
  const hit = (panels || []).find((p) => kinds.includes(p.kind) && p.filePath === filePath);
  return hit ? { action: 'focus', id: hit.id } : { action: 'peek' };
}
