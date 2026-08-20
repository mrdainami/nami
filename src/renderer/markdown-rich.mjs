// Small, dependency-free contracts shared by the Markdown card and the lazy
// rich editor bundle. Keeping these outside the bundle lets Read and Markdown
// mode use path/media helpers without loading ProseMirror.

const IMAGE_EXT = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
const VIDEO_EXT = /\.(?:m4v|mov|mp4|ogv|webm)(?:[?#].*)?$/i;

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

function pathParts(value) {
  return String(value || '').split('/').filter((part) => part && part !== '.');
}

export function relativeMarkdownPath(documentPath, targetPath) {
  const target = String(targetPath || '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) return target;
  const doc = String(documentPath || '');
  if (!doc.startsWith('/') || !target.startsWith('/')) return target;
  const from = pathParts(doc).slice(0, -1);
  const to = pathParts(target);
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++;
  const relative = [...Array(from.length - shared).fill('..'), ...to.slice(shared)].join('/');
  if (!relative) return './';
  return relative.startsWith('..') ? relative : './' + relative;
}

export function markdownAssetKind(value) {
  const path = String(value || '');
  if (IMAGE_EXT.test(path)) return 'image';
  if (VIDEO_EXT.test(path)) return 'video';
  if (/\.(?:md|markdown)(?:[?#].*)?$/i.test(path)) return 'markdown';
  return 'file';
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

export const markdownRichInternals = { IMAGE_EXT, VIDEO_EXT, COLOUR_TOKENS };
