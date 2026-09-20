// Small, dependency-free contracts shared by the Markdown card and the lazy
// rich editor bundle. Keeping these outside the bundle lets Read and Markdown
// mode use path/media helpers without loading ProseMirror.

import { currentPlatform, sepOf, isAbsolute, dirName, splitAll, docUrlFor } from './paths.mjs';

let modulePromise;
let stylePromise;

function loadEditorStyle() {
  if (stylePromise) return stylePromise;
  stylePromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('link[data-nami-markdown-editor]');
    if (existing) {
      if (existing.dataset.loaded === 'true' || existing.sheet) resolve();
      else {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Could not load Markdown editor styles.')), { once: true });
      }
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './vendor/markdown-editor.css';
    link.dataset.namiMarkdownEditor = '';
    link.addEventListener('load', () => { link.dataset.loaded = 'true'; resolve(); }, { once: true });
    link.addEventListener('error', () => reject(new Error('Could not load Markdown editor styles.')), { once: true });
    document.head.appendChild(link);
  });
  return stylePromise;
}

export async function loadMarkdownEditor() {
  modulePromise ||= import('./vendor/markdown-editor.mjs');
  const [editorModule] = await Promise.all([modulePromise, loadEditorStyle()]);
  return editorModule;
}

export async function mountMarkdownEditor(root, markdown, options) {
  const { createNamiMarkdownEditor } = await loadMarkdownEditor();
  return createNamiMarkdownEditor(root, markdown, options);
}

export function richMarkdownPath(filePath) {
  return /\.(?:md|markdown)$/i.test(String(filePath || ''));
}

export function editorModesFor(filePath) {
  if (richMarkdownPath(filePath)) return ['read', 'edit', 'markdown'];
  if (/\.(?:mdx|html?|xhtml)$/i.test(String(filePath || ''))) return ['read', 'markdown'];
  return ['markdown'];
}

function encodePathPart(part) {
  // Markdown commonly stores spaces as %20. Decode once before encoding so a
  // correct path does not become %2520 when it is turned into a protocol URL.
  try { return encodeURIComponent(decodeURIComponent(part)); }
  catch (_) { return encodeURIComponent(part); }
}

// A document's own images go through nami-doc://, served from the document's
// folder; one that names a place of its own — absolute, or under ~ — is not the
// document's and gets no URL. On Windows that includes C:\pics\a.png, which
// would otherwise sail past as "relative" and be glued onto the folder.
export function markdownImageUrl(documentPath, source, platform = currentPlatform()) {
  const src = String(source || '');
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  if (!documentPath || isAbsolute(src, platform) || src.startsWith('~')) return null;
  const dir = dirName(documentPath, platform) || sepOf(platform);
  return docUrlFor(dir, splitAll(src, platform).map(encodePathPart));
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const COLOUR_TOKENS = {
  coral: 'var(--red-ink)',
  green: 'var(--green)',
  amber: 'var(--amber-ink)',
  muted: 'var(--muted)',
};

export function colourSpan(colour, text) {
  const raw = String(colour || '').trim().toLowerCase();
  const safe = COLOUR_TOKENS[raw] || (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(raw) ? raw : '');
  const body = escapeHtml(text);
  return safe ? `<span style="color:${safe}">${body}</span>` : body;
}
