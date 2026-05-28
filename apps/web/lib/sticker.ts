// Deterministic -3°..+3° rotation from a string hash so "slapped-on" sticker
// chips look hand-placed but stay stable across renders (DESIGN-SYSTEM §5).
// Shared by the dating-vertical surfaces (feed cards, post-a-night plan cards).
export function stickerRotation(label: string): number {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 7) - 3; // -3..+3
}
