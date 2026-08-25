import { CrepeBuilder } from '@milkdown/crepe/builder';
import { blockEdit } from '@milkdown/crepe/feature/block-edit';
import { cursor } from '@milkdown/crepe/feature/cursor';
import { imageBlock } from '@milkdown/crepe/feature/image-block';
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip';
import { listItem } from '@milkdown/crepe/feature/list-item';
import { placeholder } from '@milkdown/crepe/feature/placeholder';
import { table } from '@milkdown/crepe/feature/table';
import { toolbar } from '@milkdown/crepe/feature/toolbar';
import { editorViewCtx, editorViewOptionsCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { hardbreakFilterNodes } from '@milkdown/kit/preset/commonmark';
import { toggleMark } from '@milkdown/kit/prose/commands';
import { Selection } from '@milkdown/kit/prose/state';
import { addRowAfter, isInTable, selectedRect } from '@milkdown/kit/prose/tables';
import { $markSchema, $remark, replaceAll } from '@milkdown/kit/utils';

import '@milkdown/crepe/theme/common/prosemirror.css';
import '@milkdown/crepe/theme/common/reset.css';
import '@milkdown/crepe/theme/common/block-edit.css';
import '@milkdown/crepe/theme/common/cursor.css';
import '@milkdown/crepe/theme/common/image-block.css';
import '@milkdown/crepe/theme/common/link-tooltip.css';
import '@milkdown/crepe/theme/common/list-item.css';
import '@milkdown/crepe/theme/common/placeholder.css';
import '@milkdown/crepe/theme/common/table.css';
import '@milkdown/crepe/theme/common/toolbar.css';

const COLOURS = {
  coral: 'var(--red-ink)',
  green: 'var(--green)',
  amber: 'var(--amber-ink)',
  muted: 'var(--muted)',
};
const safeColour = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  return Object.values(COLOURS).includes(raw) || /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/.test(raw) ? raw : '';
};

function splitHighlights(node) {
  if (!node || !Array.isArray(node.children)) return;
  for (const child of node.children) splitHighlights(child);
  // A <br> is how GFM spells a line break inside a table cell; the editor
  // works in real break nodes, so the html token becomes one on the way in.
  node.children = node.children.map((child) =>
    child.type === 'html' && /^<br\s*\/?>$/i.test(String(child.value || '').trim())
      ? { type: 'break' } : child);
  const expanded = [];
  for (const child of node.children) {
    if (child.type !== 'text' || !String(child.value || '').includes('==')) { expanded.push(child); continue; }
    const value = String(child.value || '');
    const re = /==([^=\n]+)==/g;
    let index = 0;
    for (let match; (match = re.exec(value));) {
      if (match.index > index) expanded.push({ type: 'text', value: value.slice(index, match.index) });
      expanded.push({ type: 'namiHighlight', children: [{ type: 'text', value: match[1] }] });
      index = match.index + match[0].length;
    }
    if (index < value.length) expanded.push({ type: 'text', value: value.slice(index) });
  }
  node.children = expanded;

  const coloured = [];
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const open = child.type === 'html' && String(child.value || '').match(/^<span\s+style=["']color\s*:\s*([^;"']+)\s*;?["']\s*>$/i);
    if (!open) { coloured.push(child); continue; }
    const colour = safeColour(open[1]);
    const close = node.children.slice(i + 1).findIndex((next) => next.type === 'html' && /^<\/span\s*>$/i.test(String(next.value || '')));
    if (!colour || close < 0) { coloured.push(child); continue; }
    const end = i + 1 + close;
    coloured.push({ type: 'namiColour', colour, children: node.children.slice(i + 1, end) });
    i = end;
  }
  node.children = coloured;
}

const namiRemark = $remark('namiInlineMarks', () => () => (tree) => splitHighlights(tree));

const highlightSchema = $markSchema('namiHighlight', () => ({
  parseDOM: [{ tag: 'mark[data-nami-highlight]' }],
  toDOM: () => ['mark', { 'data-nami-highlight': '' }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'namiHighlight',
    runner: (state, node, markType) => { state.openMark(markType); state.next(node.children); state.closeMark(markType); },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'namiHighlight',
    runner: (state, mark) => { state.withMark(mark, 'namiHighlight'); },
  },
}));

const colourSchema = $markSchema('namiColour', () => ({
  attrs: { colour: { default: COLOURS.coral, validate: 'string' } },
  parseDOM: [{ tag: 'span[data-nami-colour]', getAttrs: (dom) => ({ colour: safeColour(dom.dataset.namiColour) || COLOURS.coral }) }],
  toDOM: (mark) => ['span', { 'data-nami-colour': mark.attrs.colour, style: `color:${safeColour(mark.attrs.colour) || COLOURS.coral}` }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'namiColour',
    runner: (state, node, markType) => { state.openMark(markType, { colour: node.colour }); state.next(node.children); state.closeMark(markType); },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'namiColour',
    runner: (state, mark) => { state.withMark(mark, 'namiColour', undefined, { colour: mark.attrs.colour }); },
  },
}));

const markIsActive = (ctx, markType, attrs) => {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const marks = state.storedMarks || state.selection.$from.marks();
  const matches = (mark) => mark.type === markType && (!attrs || Object.entries(attrs).every(([key, value]) => mark.attrs[key] === value));
  if (state.selection.empty) return marks.some(matches);
  let active = false;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
    if (node.marks.some(matches)) active = true;
  });
  return active;
};
const toggle = (ctx, markType, attrs) => {
  const view = ctx.get(editorViewCtx);
  toggleMark(markType, attrs)(view.state, view.dispatch);
  view.focus();
};
const highlightIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16h14v3H5zm3-2 4-10 4 10h-2l-.7-2h-2.6L10 14zm3.3-4h1.4L12 7.8z"/></svg>';
const colourIcon = (colour) => `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" style="fill:${colour}"/><path d="M8 18h8v2H8z"/></svg>`;

// Enter in a cell moves to the cell below, same column — the way a notes app
// walks a table. On the last row it grows the table by one row first.
function enterWalksDown(view) {
  let rect;
  try { rect = selectedRect(view.state); } catch (_) { return false; }
  if (rect.top + 1 >= rect.map.height) addRowAfter(view.state, view.dispatch);
  const state = view.state;
  let next;
  try { next = selectedRect(state); } catch (_) { return true; }
  const row = Math.min(next.top + 1, next.map.height - 1);
  const cellPos = next.tableStart + next.map.map[row * next.map.width + next.left];
  const tr = state.tr.setSelection(Selection.near(state.doc.resolve(cellPos + 1))).scrollIntoView();
  view.dispatch(tr);
  return true;
}

// ---- session column widths --------------------------------------------------
// GFM cannot store a column width, so widths never touch the document: they
// live in a style tag keyed by table order, applied from outside ProseMirror's
// managed DOM (a colgroup inside it would be fought over and re-parsed).
// app.js keeps the map per card and mirrors it into the Read pane.
function setupColumnResize(root, options) {
  const widths = new Map();
  for (const [key, value] of Object.entries(options.columnWidths || {})) {
    if (Array.isArray(value)) widths.set(Number(key), value.slice());
  }
  const styleTag = document.createElement('style');
  root.appendChild(styleTag);
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:6;';
  let raf = 0;

  const blocks = () => Array.from(root.querySelectorAll('.milkdown-table-block'));
  const tableOf = (block) => block.querySelector('table');

  function writeStyles() {
    let css = '';
    for (const [index, cols] of widths) {
      const total = cols.reduce((sum, w) => sum + (w || 0), 0);
      if (!total) continue;
      const scope = `.milkdown-table-block[data-nami-table="${index}"] table`;
      css += `${scope}{table-layout:fixed;width:${total}px;}`;
      cols.forEach((w, i) => {
        if (w) css += `${scope} tr>*:nth-child(${i + 1}){width:${w}px;}`;
      });
    }
    styleTag.textContent = css;
  }

  function refresh() {
    raf = 0;
    const milkdown = root.querySelector('.milkdown');
    if (!milkdown) return;
    if (layer.parentNode !== milkdown) milkdown.appendChild(layer);
    layer.textContent = '';
    const layerBox = milkdown.getBoundingClientRect();
    blocks().forEach((block, index) => {
      if (block.dataset.namiTable !== String(index)) block.dataset.namiTable = String(index);
      const tbl = tableOf(block);
      const row = tbl && tbl.rows[0];
      if (!row) return;
      const tableBox = tbl.getBoundingClientRect();
      Array.from(row.cells).forEach((cell, col) => {
        const box = cell.getBoundingClientRect();
        const handle = document.createElement('div');
        handle.className = 'nami-col-resize';
        handle.style.cssText += `pointer-events:auto;left:${box.right - layerBox.left - 4.5}px;` +
          `top:${tableBox.top - layerBox.top}px;height:${tableBox.height}px;`;
        handle.addEventListener('pointerdown', (event) => startDrag(event, handle, index, col));
        layer.appendChild(handle);
      });
    });
    writeStyles();
  }
  const queueRefresh = () => { if (!raf) raf = requestAnimationFrame(refresh); };

  function startDrag(event, handle, index, col) {
    event.preventDefault();
    event.stopPropagation();
    const block = root.querySelector(`.milkdown-table-block[data-nami-table="${index}"]`);
    const row = block && tableOf(block) && tableOf(block).rows[0];
    if (!row) return;
    if (!widths.has(index) || widths.get(index).length !== row.cells.length) {
      widths.set(index, Array.from(row.cells, (cell) => Math.round(cell.getBoundingClientRect().width)));
    }
    const cols = widths.get(index);
    const startX = event.clientX;
    const startW = cols[col];
    handle.classList.add('live');
    handle.setPointerCapture(event.pointerId);
    const move = (ev) => {
      cols[col] = Math.max(48, Math.round(startW + (ev.clientX - startX)));
      writeStyles();
    };
    const up = () => {
      handle.classList.remove('live');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      queueRefresh();
      if (options.onColumnWidths) options.onColumnWidths(index, cols.slice());
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }

  const observer = new MutationObserver((records) => {
    // our own layer and style writes must not re-trigger the pass
    if (records.every((r) => layer.contains(r.target) || r.target === styleTag)) return;
    queueRefresh();
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  const sizer = new ResizeObserver(queueRefresh);
  sizer.observe(root);
  queueRefresh();

  return () => {
    observer.disconnect();
    sizer.disconnect();
    if (raf) cancelAnimationFrame(raf);
    layer.remove();
    styleTag.remove();
  };
}

export async function createNamiMarkdownEditor(root, markdown, options = {}) {
  const imagePath = async (file) => {
    if (options.onImageFile) return options.onImageFile(file);
    return URL.createObjectURL(file);
  };
  const builder = new CrepeBuilder({ root, defaultValue: markdown || '' })
    .addFeature(cursor, { color: false, virtual: true })
    .addFeature(listItem)
    .addFeature(linkTooltip, {
      inputPlaceholder: 'Paste a URL or project path…',
      onCopyLink: (link) => options.onCopyLink && options.onCopyLink(link),
    })
    .addFeature(imageBlock, {
      onUpload: imagePath,
      inlineOnUpload: imagePath,
      blockOnUpload: imagePath,
      proxyDomURL: (url) => options.resolveImage ? options.resolveImage(url) : url,
    })
    .addFeature(blockEdit, {
      // Existing Markdown images still render through imageBlock, but image and
      // video creation stay out of the menu until Nami has one complete flow.
      advancedGroup: { image: null, math: null },
    })
    .addFeature(placeholder, { text: 'Type / for blocks', mode: 'block' })
    .addFeature(toolbar, {
      buildToolbar: (groups) => {
        groups.addGroup('nami-formatting', 'Nami formatting')
          .addItem('highlight', {
            icon: highlightIcon, label: 'Highlight',
            active: (ctx) => markIsActive(ctx, highlightSchema.type(ctx)),
            onRun: (ctx) => toggle(ctx, highlightSchema.type(ctx)),
          })
          .addItem('coral', {
            icon: colourIcon(COLOURS.coral), label: 'Coral text',
            active: (ctx) => markIsActive(ctx, colourSchema.type(ctx), { colour: COLOURS.coral }),
            onRun: (ctx) => toggle(ctx, colourSchema.type(ctx), { colour: COLOURS.coral }),
          })
          .addItem('green', {
            icon: colourIcon(COLOURS.green), label: 'Green text',
            active: (ctx) => markIsActive(ctx, colourSchema.type(ctx), { colour: COLOURS.green }),
            onRun: (ctx) => toggle(ctx, colourSchema.type(ctx), { colour: COLOURS.green }),
          })
          .addItem('amber', {
            icon: colourIcon(COLOURS.amber), label: 'Amber text',
            active: (ctx) => markIsActive(ctx, colourSchema.type(ctx), { colour: COLOURS.amber }),
            onRun: (ctx) => toggle(ctx, colourSchema.type(ctx), { colour: COLOURS.amber }),
          });
      },
    })
    .addFeature(table);

  builder.editor
    // Milkdown ships with hardbreaks banned inside tables; lifting the ban is
    // the whole Shift+Enter-in-a-cell feature — serialization is <br>.
    .config((ctx) => ctx.set(hardbreakFilterNodes.key, ['code_block']))
    .config((ctx) => ctx.update(editorViewOptionsCtx, (viewOptions) => ({
      ...viewOptions,
      handleKeyDown: (view, event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
        if (!isInTable(view.state)) return false;
        return enterWalksDown(view);
      },
    })))
    .config((ctx) => ctx.update(remarkStringifyOptionsCtx, (options) => ({
      ...options,
      handlers: {
        ...options.handlers,
        // In a table cell the stock handler degrades a break to a space (a
        // raw newline would end the row); <br> is the form GFM accepts.
        break: (_node, _parent, state) => state.stack.includes('tableCell') ? '<br>' : '\\\n',
        namiHighlight: (node, _parent, state, info) => `==${state.containerPhrasing(node, { ...info, before: '==', after: '==' })}==`,
        namiColour: (node, _parent, state, info) => {
          const colour = safeColour(node.colour);
          return colour ? `<span style="color:${colour}">${state.containerPhrasing(node, info)}</span>` : state.containerPhrasing(node, info);
        },
      },
    })))
    .use(namiRemark)
    .use(highlightSchema)
    .use(colourSchema);

  builder.on((listener) => {
    listener.markdownUpdated((_ctx, next, previous) => {
      if (next !== previous && options.onChange) options.onChange(next);
    });
    listener.focus(() => options.onFocus && options.onFocus());
  });
  await builder.create();
  const teardownResize = setupColumnResize(root, options);

  return {
    getMarkdown: () => builder.getMarkdown(),
    setMarkdown: (value) => builder.editor.action(replaceAll(value || '')),
    setReadonly: (value) => builder.setReadonly(!!value),
    focus: () => root.querySelector('.ProseMirror')?.focus({ preventScroll: true }),
    destroy: () => { teardownResize(); builder.destroy(); },
  };
}
