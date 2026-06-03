/**
 * One-shot icon generator. Renders the brand mark (the square woven-PT
 * logo at /public/logo-mark.svg) into the three PNG sizes the PWA
 * manifest references:
 *
 *   /public/icon-192.png         - Android adaptive icon
 *   /public/icon-512.png         - Android install prompt + splash
 *   /public/apple-touch-icon.png - iOS Add-to-Home-Screen (180x180)
 *
 * Run from the app directory:
 *     npm install --save-dev sharp
 *     node scripts/generate-icons.mjs
 *
 * Commit the generated PNGs once - they don't need to regenerate on
 * every build.
 */
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const PUBLIC_DIR = join(dirname(__filename), '..', 'public');
const SOURCE_SVG = join(PUBLIC_DIR, 'logo-mark.svg');

const TARGETS = [
  { out: 'icon-192.png', size: 192 },
  { out: 'icon-512.png', size: 512 },
  { out: 'apple-touch-icon.png', size: 180 },
];

const svg = await readFile(SOURCE_SVG);

for (const { out, size } of TARGETS) {
  const dest = join(PUBLIC_DIR, out);
  const png = await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 31, g: 32, b: 87, alpha: 1 } })
    .png()
    .toBuffer();
  await writeFile(dest, png);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${out} (${size} x ${size}, ${png.length} bytes)`);
}

// eslint-disable-next-line no-console
console.log('\nAll icons generated. Commit them: git add public/icon-*.png public/apple-touch-icon.png');
