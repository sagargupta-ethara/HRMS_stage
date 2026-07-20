// /api/templates — create (PDF upload) and list templates.
import { prisma } from '@/lib/prisma';
import { saveTemplatePdf } from '@/lib/storage';
import { countPdfPages, mergePdfs } from '@/lib/pdf-merge';
import { DEFAULT_ROLES } from '@/lib/recipients';
import { toTemplateSummaryDTO } from '@/lib/mappers';

function stripPdfExt(name: string): string {
  return name.replace(/\.pdf$/i, '');
}

// POST: multipart upload of one OR MORE PDFs -> creates a draft Template. When
// several PDFs are uploaded their pages are concatenated, in upload order, into
// a single combined document so the whole template is one signable envelope.
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    // Accept both the single `file` field and any number of them.
    const files = form
      .getAll('file')
      .filter((f): f is File => f instanceof File && f.size > 0);

    if (files.length === 0) {
      return Response.json({ error: 'At least one PDF file is required' }, { status: 400 });
    }
    for (const f of files) {
      const isPdf =
        f.type === 'application/pdf' || (f.name || '').toLowerCase().endsWith('.pdf');
      if (!isPdf) {
        return Response.json(
          { error: `"${f.name || 'file'}" must be a PDF` },
          { status: 400 },
        );
      }
    }

    const inputs = await Promise.all(
      files.map(async (f) => ({
        name: f.name || 'document.pdf',
        bytes: Buffer.from(await f.arrayBuffer()),
      })),
    );

    // Combine into a single PDF. One file -> keep its bytes as-is; several ->
    // merge. pageCount is resolved up front (the builder's save re-confirms it).
    let outBytes: Buffer;
    let pageCount: number;
    let fileName: string;
    if (inputs.length === 1) {
      outBytes = inputs[0].bytes;
      fileName = inputs[0].name;
      try {
        pageCount = await countPdfPages(outBytes);
      } catch {
        pageCount = 1; // unreadable metadata shouldn't block the upload
      }
    } else {
      try {
        const merged = await mergePdfs(inputs);
        outBytes = merged.bytes;
        pageCount = merged.pageCount;
      } catch (mergeErr) {
        const message =
          mergeErr instanceof Error ? mergeErr.message : 'Could not combine the PDFs';
        return Response.json({ error: message }, { status: 400 });
      }
      // A readable, order-preserving name for the combined document.
      fileName = `${stripPdfExt(inputs[0].name)} + ${inputs.length - 1} more.pdf`;
    }

    const nameField = form.get('name');
    const categoryField = form.get('category');
    const name =
      (typeof nameField === 'string' && nameField.trim()) || stripPdfExt(inputs[0].name);
    const category =
      (typeof categoryField === 'string' && categoryField.trim()) || 'offer_letter';

    // Create the row first so we have an id for the storage path.
    const template = await prisma.template.create({
      data: {
        name,
        category,
        fileName,
        storageKey: '',
        pageCount,
        recipients: {
          create: DEFAULT_ROLES.map((r) => ({
            roleKey: r.roleKey,
            label: r.label,
            color: r.color,
            signingOrder: r.signingOrder,
          })),
        },
      },
    });

    const { storageKey, fileSize } = await saveTemplatePdf(template.id, fileName, outBytes);
    await prisma.template.update({
      where: { id: template.id },
      data: { storageKey, fileSize },
    });

    return Response.json({ id: template.id, pageCount, sourceCount: inputs.length }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/templates]', err);
    return Response.json({ error: 'Failed to create template' }, { status: 500 });
  }
}

// GET: list templates (newest first) with recipient/field counts.
export async function GET() {
  try {
    const templates = await prisma.template.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { recipients: true, fields: true } } },
    });
    return Response.json({ templates: templates.map(toTemplateSummaryDTO) });
  } catch (err) {
    console.error('[GET /api/templates]', err);
    return Response.json({ error: 'Failed to list templates' }, { status: 500 });
  }
}
