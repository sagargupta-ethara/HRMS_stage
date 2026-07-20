// Server-only PDF storage on local disk under <cwd>/storage. In production this
// would be swapped for S3/GCS; the public surface (saveTemplatePdf / readPdf)
// stays the same.
import 'server-only';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const STORAGE_ROOT = path.join(process.cwd(), 'storage');

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'document.pdf';
}

export function absolutePathFor(storageKey: string): string {
  // Prevent path traversal: storageKey must stay within STORAGE_ROOT.
  const resolved = path.resolve(STORAGE_ROOT, storageKey);
  if (!resolved.startsWith(STORAGE_ROOT)) {
    throw new Error('Invalid storage key');
  }
  return resolved;
}

export async function saveTemplatePdf(
  templateId: string,
  fileName: string,
  bytes: Buffer,
): Promise<{ storageKey: string; fileSize: number }> {
  const key = path.posix.join('templates', templateId, safeName(fileName));
  const dest = absolutePathFor(key);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, bytes);
  return { storageKey: key, fileSize: bytes.byteLength };
}

export async function readPdf(storageKey: string): Promise<Buffer> {
  const src = absolutePathFor(storageKey);
  if (!existsSync(src)) {
    throw new Error(`PDF not found for key: ${storageKey}`);
  }
  return readFile(src);
}

export async function deletePdf(storageKey: string): Promise<void> {
  const src = absolutePathFor(storageKey);
  if (existsSync(src)) await unlink(src);
}
