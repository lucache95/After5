'use client';
// PhotoCropper — square 1:1 crop UI.
// Pattern: fixed-size square viewport; the image is rendered behind it with
// CSS transforms (translate + scale). The user drags to pan and uses a slider
// to zoom. The visible square IS the crop. `onConfirm` receives a Blob of the
// cropped square pixels (JPEG, max 1080px side — generous for profile photos,
// the server's generate-blur further downscales to 64px for the blind feed).
//
// No external dep — built on canvas + PointerEvents. Mobile + desktop both
// supported. Pinch-zoom on mobile is OS-level; the slider is the primary zoom
// control on both platforms so it stays predictable.

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

const VIEWPORT_PX = 300;       // visible square in CSS pixels
const OUTPUT_PX = 1080;        // exported square edge in pixels (JPEG)
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

export function PhotoCropper({
  file,
  onConfirm,
  onCancel,
  busy = false,
}: {
  file: File;
  onConfirm: (cropped: Blob) => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  // Object URL for the picked file. Revoke on unmount.
  const objectUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(objectUrl), [objectUrl]);

  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // baseScale: how the natural image fits the viewport at zoom=1 (cover-style).
  // We scale the smaller image axis to fill the viewport so any zoom>=1 keeps the
  // viewport fully covered (no transparent edges).
  const baseScale = useMemo(() => {
    if (!naturalSize) return 1;
    return Math.max(VIEWPORT_PX / naturalSize.w, VIEWPORT_PX / naturalSize.h);
  }, [naturalSize]);

  // Clamp offset so the image always covers the viewport.
  function clampOffset(next: { x: number; y: number }, currentZoom: number) {
    if (!naturalSize) return { x: 0, y: 0 };
    const renderedW = naturalSize.w * baseScale * currentZoom;
    const renderedH = naturalSize.h * baseScale * currentZoom;
    const maxX = Math.max(0, (renderedW - VIEWPORT_PX) / 2);
    const maxY = Math.max(0, (renderedH - VIEWPORT_PX) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    setOffset({ x: 0, y: 0 });
    setZoom(MIN_ZOOM);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setOffset(clampOffset({ x: dragStart.current.ox + dx, y: dragStart.current.oy + dy }, zoom));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    setDragging(false);
    dragStart.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function onZoomChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = Number(e.target.value);
    setZoom(next);
    // Re-clamp offset against the new zoom level so we don't leave the image
    // half-empty after zooming out.
    setOffset((prev) => clampOffset(prev, next));
  }

  async function handleConfirm() {
    if (!naturalSize) return;
    // The viewport (300px) shows a center-cropped square. Convert viewport coords
    // back to natural-image coords to know what to draw onto the export canvas.
    //
    // The image is rendered with transform: translate(offset.x, offset.y) scale(s)
    // where s = baseScale * zoom. The center of the viewport corresponds to natural
    // coords (naturalSize/2 - offset / s). The viewport edge length in natural
    // coords is VIEWPORT_PX / s.
    const s = baseScale * zoom;
    const sourceEdge = VIEWPORT_PX / s;
    const cx = naturalSize.w / 2 - offset.x / s;
    const cy = naturalSize.h / 2 - offset.y / s;
    const sx = Math.max(0, cx - sourceEdge / 2);
    const sy = Math.max(0, cy - sourceEdge / 2);
    const sw = Math.min(naturalSize.w - sx, sourceEdge);
    const sh = Math.min(naturalSize.h - sy, sourceEdge);

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_PX;
    canvas.height = OUTPUT_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image_decode_failed'));
    });
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUTPUT_PX, OUTPUT_PX);

    canvas.toBlob(
      (blob) => { if (blob) onConfirm(blob); },
      'image/jpeg',
      0.9,
    );
  }

  return (
    <div className="space-y-4">
      <p className="font-body text-[13px] text-shell-ink/70">drag to position • slider to zoom</p>

      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn(
          'relative mx-auto overflow-hidden rounded-2xl bg-shell-ink/5 select-none touch-none',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
        style={{ width: VIEWPORT_PX, height: VIEWPORT_PX }}
        aria-label="crop preview"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={objectUrl}
          onLoad={onImageLoad}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${baseScale * zoom})`,
            transformOrigin: 'center center',
            maxWidth: 'none',
          }}
        />
        {/* Optional rule-of-thirds grid for compositional reference. */}
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-30">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="border border-white/40" />
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="zoom" className="sr-only">zoom</label>
        <input
          id="zoom"
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={onZoomChange}
          disabled={busy || !naturalSize}
          className="w-full accent-shell-accent"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className={cn(
            'flex min-h-[44px] flex-1 items-center justify-center rounded-full border border-shell-ink/15 bg-white/70 px-5 font-body text-[15px] lowercase text-shell-ink transition',
            'hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
            busy && 'cursor-not-allowed opacity-50',
          )}
        >
          choose different
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy || !naturalSize}
          className={cn(
            'flex min-h-[44px] flex-1 items-center justify-center rounded-full px-5 font-body text-[15px] font-semibold lowercase transition',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
            busy || !naturalSize
              ? 'cursor-not-allowed bg-shell-ink/10 text-shell-ink/35'
              : 'bg-shell-accent text-white shadow-fun hover:opacity-90 active:scale-95',
          )}
        >
          looks good
        </button>
      </div>
    </div>
  );
}
