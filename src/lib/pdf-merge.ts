// Server-only helpers for combining uploaded PDFs into a single template
// document. When an admin uploads several contracts (e.g. offer letter + NDA +
// policy) we concatenate their pages, in the given order, into ONE PDF so the
// builder, publishing and signing all operate on a single envelope.
import 'server-only';
import { PDFDocument } from 'pdf-lib';

/** Count pages in a single PDF without rewriting its bytes. */
export async function countPdfPages(bytes: Buffer): Promise<number> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPageCount();
}

export interface MergeResult {
  bytes: Buffer;
  pageCount: number;
}

/**
 * Concatenate the given PDFs (in array order) into one document.
 * Throws a descriptive Error naming the offending file if any input can't be
 * parsed, so the caller can surface it to the user.
 */
export async function mergePdfs(
  inputs: Array<{ name: string; bytes: Buffer }>,
): Promise<MergeResult> {
  if (inputs.length === 0) throw new Error('No PDF files provided');

  const out = await PDFDocument.create();
  for (const input of inputs) {
    let src: PDFDocument;
    try {
      src = await PDFDocument.load(input.bytes, { ignoreEncryption: true });
    } catch {
      throw new Error(`"${input.name}" is not a readable PDF`);
    }
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const page of pages) out.addPage(page);
  }

  const merged = await out.save();
  return { bytes: Buffer.from(merged), pageCount: out.getPageCount() };
}
