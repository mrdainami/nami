import { CrepeBuilder } from '@milkdown/crepe/builder';
import { blockEdit } from '@milkdown/crepe/feature/block-edit';
import { cursor } from '@milkdown/crepe/feature/cursor';
import { imageBlock } from '@milkdown/crepe/feature/image-block';
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip';
import { listItem } from '@milkdown/crepe/feature/list-item';
import { placeholder } from '@milkdown/crepe/feature/placeholder';
import { table } from '@milkdown/crepe/feature/table';
import { toolbar } from '@milkdown/crepe/feature/toolbar';
import { editorViewCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { toggleMark } from '@milkdown/kit/prose/commands';
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
    .config((ctx) => ctx.update(remarkStringifyOptionsCtx, (options) => ({
      ...options,
      handlers: {
        ...options.handlers,
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

  return {
    getMarkdown: () => builder.getMarkdown(),
    setMarkdown: (value) => builder.editor.action(replaceAll(value || '')),
    setReadonly: (value) => builder.setReadonly(!!value),
    focus: () => root.querySelector('.ProseMirror')?.focus({ preventScroll: true }),
    destroy: () => builder.destroy(),
  };
}
