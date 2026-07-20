// /api/templates/[id] — read, save (full replace of recipients+fields), delete.
import { prisma } from '@/lib/prisma';
import { deletePdf } from '@/lib/storage';
import { saveTemplateSchema } from '@/lib/validation';
import { toTemplateDTO } from '@/lib/mappers';

type RouteContext = { params: Promise<{ id: string }> };

// GET: full template with recipients + fields.
export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const template = await prisma.template.findUnique({
      where: { id },
      include: { recipients: true, fields: true },
    });
    if (!template) {
      return Response.json({ error: 'Template not found' }, { status: 404 });
    }
    return Response.json({ template: toTemplateDTO(template) });
  } catch (err) {
    console.error('[GET /api/templates/:id]', err);
    return Response.json({ error: 'Failed to load template' }, { status: 500 });
  }
}

// PUT: persist the builder state. Recipients (and their fields) are fully
// replaced; field.recipientId is remapped to the freshly-created recipient ids.
export async function PUT(req: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const json: unknown = await req.json().catch(() => null);
    const parsed = saveTemplateSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 },
      );
    }
    const payload = parsed.data;

    const existing = await prisma.template.findUnique({ where: { id } });
    if (!existing) {
      return Response.json({ error: 'Template not found' }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      // Scalars.
      await tx.template.update({
        where: { id },
        data: {
          name: payload.name,
          description: payload.description ?? null,
          category: payload.category,
          status: payload.status ?? existing.status,
          pageCount: payload.pageCount,
        },
      });

      // Wipe recipients (cascades to their fields) then recreate everything.
      await tx.templateRecipient.deleteMany({ where: { templateId: id } });

      // incoming recipient id -> new db id
      const idMap = new Map<string, string>();
      for (const r of payload.recipients) {
        const createdRec = await tx.templateRecipient.create({
          data: {
            templateId: id,
            roleKey: r.roleKey,
            label: r.label,
            defaultName: r.defaultName ?? null,
            defaultEmail: r.defaultEmail || null,
            signingOrder: r.signingOrder,
            color: r.color,
          },
        });
        idMap.set(r.id, createdRec.id);
      }

      for (const f of payload.fields) {
        const recipientId = idMap.get(f.recipientId);
        if (!recipientId) continue; // drop orphaned fields
        await tx.templateField.create({
          data: {
            templateId: id,
            recipientId,
            type: f.type,
            label: f.label ?? null,
            required: f.required,
            page: f.page,
            xPct: f.xPct,
            yPct: f.yPct,
            widthPct: f.widthPct,
            heightPct: f.heightPct,
            prefillKey: f.prefillKey ?? null,
            meta: f.meta ? JSON.stringify(f.meta) : null,
          },
        });
      }
    });

    const updated = await prisma.template.findUnique({
      where: { id },
      include: { recipients: true, fields: true },
    });
    return Response.json({ template: toTemplateDTO(updated!) });
  } catch (err) {
    console.error('[PUT /api/templates/:id]', err);
    return Response.json({ error: 'Failed to save template' }, { status: 500 });
  }
}

// DELETE: remove the template (cascades) and best-effort delete the PDF.
export async function DELETE(_req: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const template = await prisma.template.findUnique({ where: { id } });
    if (!template) {
      return Response.json({ error: 'Template not found' }, { status: 404 });
    }
    try {
      await deletePdf(template.storageKey);
    } catch (e) {
      console.warn('[DELETE /api/templates/:id] PDF delete failed', e);
    }
    await prisma.template.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/templates/:id]', err);
    return Response.json({ error: 'Failed to delete template' }, { status: 500 });
  }
}
