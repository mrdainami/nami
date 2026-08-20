import { CrepeBuilder } from '@milkdown/crepe/builder';
import { blockEdit } from '@milkdown/crepe/feature/block-edit';
import { cursor } from '@milkdown/crepe/feature/cursor';
import { imageBlock } from '@milkdown/crepe/feature/image-block';
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip';
import { listItem } from '@milkdown/crepe/feature/list-item';
import { placeholder } from '@milkdown/crepe/feature/placeholder';
import { table } from '@milkdown/crepe/feature/table';
import { toolbar } from '@milkdown/crepe/feature/toolbar';

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
      advancedGroup: { math: null },
    })
    .addFeature(placeholder, { text: 'Type / for blocks', mode: 'block' })
    .addFeature(toolbar, { latexIcon: '', latexLabel: '' })
    .addFeature(table);

  builder.on((listener) => {
    listener.markdownUpdated((_ctx, next, previous) => {
      if (next !== previous && options.onChange) options.onChange(next);
    });
    listener.focus(() => options.onFocus && options.onFocus());
  });
  await builder.create();

  return {
    getMarkdown: () => builder.getMarkdown(),
    setReadonly: (value) => builder.setReadonly(!!value),
    focus: () => root.querySelector('.ProseMirror')?.focus(),
    destroy: () => builder.destroy(),
  };
}
