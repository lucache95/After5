import { renderShareImage, shareImageAlt, shareImageSize } from './opengraph-image';

// Twitter card reuses the opengraph-image render (same Barbiecore wordmark).
// `runtime` is declared locally because Next can't statically read a
// re-exported config field.
export const runtime = 'nodejs';
export const alt = shareImageAlt;
export const size = shareImageSize;
export const contentType = 'image/png';

export default function TwitterImage() {
  return renderShareImage();
}
