import { ImageResponse } from 'next/og';

// Code-generated social share image (Barbiecore). Next file-convention
// auto-wires this for openGraph + twitter on every route that doesn't
// override it, superseding the old static /og.jpg.
export const runtime = 'nodejs';

export const alt = 'after5 — match on the night, not the guy';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Re-usable aliases so app/twitter-image.tsx can declare its own config
// locally (Next can't statically read a re-exported config field).
export const shareImageAlt = alt;
export const shareImageSize = size;

// Caprasimo (font-heading) is the brand display face. next/og can't read
// next/font, so fetch the TTF once. If the fetch fails the image still
// renders in the serif fallback rather than throwing.
async function loadCaprasimo(): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      'https://fonts.googleapis.com/css2?family=Caprasimo&display=swap',
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
    ).then((r) => r.text());
    const url = css.match(/src: url\((https:\/\/[^)]+\.ttf)\)/)?.[1];
    if (!url) return null;
    return await fetch(url).then((r) => r.arrayBuffer());
  } catch {
    return null;
  }
}

export async function renderShareImage(): Promise<ImageResponse> {
  const caprasimo = await loadCaprasimo();
  const headingFont = caprasimo ? 'Caprasimo' : 'Georgia, serif';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          backgroundColor: '#FAF4EC',
          padding: '90px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '20px',
            color: '#E0218A',
            fontFamily: headingFont,
            fontSize: 64,
          }}
        >
          <span>after5</span>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 999,
              backgroundColor: '#E0218A',
            }}
          />
        </div>
        <div
          style={{
            marginTop: 36,
            color: '#3D0F2E',
            fontFamily: headingFont,
            fontSize: 110,
            lineHeight: 1.04,
            letterSpacing: '-3px',
            maxWidth: 980,
          }}
        >
          match on the night, not the guy
        </div>
      </div>
    ),
    {
      ...size,
      fonts: caprasimo
        ? [{ name: 'Caprasimo', data: caprasimo, style: 'normal', weight: 400 }]
        : undefined,
    },
  );
}

export default function OpengraphImage() {
  return renderShareImage();
}
