// Copies the pdf.js worker out of node_modules into /public so the browser can
// load it from a stable, same-origin URL (`/pdf.worker.min.mjs`). Run on
// postinstall and via `npm run copy-worker`.
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const candidates = [
  join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'),
  join(root, 'node_modules/pdfjs-dist/build/pdf.worker.mjs'),
];

const dest = join(root, 'public/pdf.worker.min.mjs');

const src = candidates.find((p) => existsSync(p));

if (!src) {
  console.warn(
    '[copy-pdf-worker] pdfjs-dist worker not found in node_modules yet. ' +
      'Run `npm run copy-worker` after install completes.',
  );
  process.exit(0);
}

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`[copy-pdf-worker] Copied ${src} -> ${dest}`);
