import { defaultBlockSpecs } from '@blocknote/core';
import { cachedAttachmentUrl } from '@/lib/attachmentFiles';
import { imageDimensions, rememberImageDimensions } from '@/lib/imageDimensions';

const base = defaultBlockSpecs.image;

// Keep BlockNote's resizing, schema and export; reserve the preview's space before its
// asynchronous URL resolver and image decoder have finished on each editor mount.
export const imageBlock: typeof base = {
  ...base,
  implementation: {
    ...base.implementation,
    render(block, editor) {
      const rendered = base.implementation.render.call(this, block, editor);
      if (this.renderType !== 'nodeView') return rendered;
      const image = rendered.dom.querySelector('img');
      if (!image) return rendered;
      if (!block.props.previewWidth && rendered.dom instanceof HTMLElement) {
        rendered.dom.style.width = '100%';
      }
      const dimensions = imageDimensions(block.props.url);
      if (dimensions) image.style.aspectRatio = `auto ${dimensions.width} / ${dimensions.height}`;
      const source = cachedAttachmentUrl(block.props.url, true);
      if (source) image.src = source;
      image.addEventListener('load', () => rememberImageDimensions(block.props.url, image));
      return rendered;
    },
  },
};
