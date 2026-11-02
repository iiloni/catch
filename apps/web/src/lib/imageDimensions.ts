type Dimensions = { width: number; height: number };

// Rendering hints only: do not change stored blocks just because an image was displayed.
const dimensions = new Map<string, Dimensions>();

export function imageDimensions(url: string) {
  return dimensions.get(url);
}

export function rememberImageDimensions(url: string, image: HTMLImageElement) {
  if (image.naturalWidth > 0 && image.naturalHeight > 0) {
    dimensions.set(url, { width: image.naturalWidth, height: image.naturalHeight });
  }
}
