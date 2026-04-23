// Compose tilted polaroid PNGs with photo + frame + caption baked in.
// Output goes to apps/web/public/email/ — hotlinked from welcome.ts.
// Rendered at 2x for retina, displayed at 1x in the email.

import sharp from 'sharp';
import fs from 'node:fs';

const PUBLIC = '/Users/lucassenechal/Projects/After5/apps/web/public';
const OUT_DIR = `${PUBLIC}/email`;
fs.mkdirSync(OUT_DIR, { recursive: true });

async function compose({ src, caption, photoW, photoH, angle, out }) {
  const padSide = 20;   // 10 at 1x
  const padTop = 20;    // 10 at 1x
  const padBottom = 100; // 50 at 1x (extra room for caption)
  const cardW = photoW + padSide * 2;
  const cardH = photoH + padTop + padBottom;

  // 2x photo
  const photoBuf = await sharp(src)
    .resize(photoW, photoH, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 92 })
    .toBuffer();

  // SVG card — white base + caption text. Font stack resolves to Helvetica
  // on macOS rendering, which matches the email's own Inter fallback.
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${cardH}">
      <rect x="0" y="0" width="${cardW}" height="${cardH}" fill="#FFFFFF" stroke="#ECE4D2" stroke-width="2"/>
      <text x="${cardW / 2}" y="${photoH + padTop + 60}"
            text-anchor="middle"
            font-family="Helvetica, Arial, sans-serif"
            font-size="20" font-weight="700"
            letter-spacing="5"
            fill="#7A6F5F">${caption.toUpperCase()}</text>
    </svg>
  `);

  const card = await sharp(svg)
    .composite([{ input: photoBuf, top: padTop, left: padSide }])
    .png()
    .toBuffer();

  // Rotate with transparent padding so the bounding box fits the tilted card
  const rotated = await sharp(card)
    .rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();

  fs.writeFileSync(`${OUT_DIR}/${out}`, rotated);
  const meta = await sharp(rotated).metadata();
  console.log(`${out} → ${meta.width}×${meta.height} @ ${Math.round(rotated.length / 1024)}kb`);
  return { w: meta.width, h: meta.height };
}

const first = await compose({
  src: `${PUBLIC}/pins/couple-trail.jpg`,
  caption: 'West Kelowna',
  photoW: 320,
  photoH: 400,
  angle: -5,
  out: 'polaroid-west-kelowna.png',
});

const second = await compose({
  src: `${PUBLIC}/pins/couple-lake-kiss.jpg`,
  caption: 'Lakeside',
  photoW: 276,
  photoH: 340,
  angle: 6,
  out: 'polaroid-lakeside.png',
});

console.log('done.', { first, second });
