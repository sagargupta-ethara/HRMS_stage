// Seeds one ready-to-use "Offer Letter" template: generates a sample PDF with
// pdf-lib, writes it to the same on-disk location the app's storage layer uses
// (storage/templates/<id>/<file>), and creates the template + recipients +
// prefill-bound fields. Run with: npm run db:seed
//
// NOTE: we deliberately do NOT import src/lib/storage.ts here — it is marked
// `server-only` and would throw under tsx. We replicate its key convention.
import { PrismaClient } from '@prisma/client';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_ROLES } from '../src/lib/recipients';

const prisma = new PrismaClient();

const PAGE_W = 595; // A4 @ 72dpi
const PAGE_H = 842;

/** Build a one-page offer letter and return its bytes. */
async function buildOfferLetterPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.1, 0.12);
  const dim = rgb(0.45, 0.47, 0.5);

  const fromTop = (yPct: number) => PAGE_H * (1 - yPct / 100);
  const text = (s: string, xPct: number, yPct: number, size = 11, f = font, color = ink) =>
    page.drawText(s, { x: (xPct / 100) * PAGE_W, y: fromTop(yPct) - size, size, font: f, color });

  text('ETHARA AI', 8, 7, 20, bold);
  text('Bridging the Gap to AGI', 8, 11, 10, font, dim);
  text('OFFER OF EMPLOYMENT', 8, 18, 15, bold);

  text('Dear', 8, 24, 11);
  text('We are pleased to offer you the position below. The terms of your', 8, 40, 11);
  text('employment are as follows:', 8, 43, 11);

  text('Position / Role:', 8, 28, 11, bold);
  text('Joining Date:', 8, 32, 11, bold);
  text('Annual CTC:', 8, 36, 11, bold);

  text('Department:', 8, 48, 11, bold);
  text('Work Location:', 8, 52, 11, bold);

  // Signature blocks
  text('Accepted by Candidate', 8, 74, 10, bold, dim);
  text('For Ethara AI (Authorized Signatory)', 58, 74, 10, bold, dim);
  text('Signature', 8, 86, 9, font, dim);
  text('Date', 8, 91, 9, font, dim);
  text('Signature', 58, 86, 9, font, dim);
  text('Name', 58, 91, 9, font, dim);

  return pdf.save();
}

async function main() {
  // Clean any prior seed of the same name so re-running is idempotent.
  await prisma.template.deleteMany({ where: { name: 'Offer Letter — Software Engineer (Sample)' } });

  const template = await prisma.template.create({
    data: {
      name: 'Offer Letter — Software Engineer (Sample)',
      description: 'Seeded sample. Upload your own PDF to build a fresh template.',
      category: 'offer_letter',
      status: 'published',
      fileName: 'offer-letter-sample.pdf',
      storageKey: '',
      pageCount: 1,
      recipients: {
        create: DEFAULT_ROLES.map((r) => ({
          roleKey: r.roleKey,
          label: r.label,
          color: r.color,
          signingOrder: r.signingOrder,
          defaultName: r.roleKey === 'hr' ? 'Anjali Rao' : null,
          defaultEmail: r.roleKey === 'hr' ? 'hr.contracts@ethara.ai' : null,
        })),
      },
    },
    include: { recipients: true },
  });

  // Write the PDF to storage/templates/<id>/<file> (matches storage.ts).
  const bytes = await buildOfferLetterPdf();
  const storageKey = path.posix.join('templates', template.id, 'offer-letter-sample.pdf');
  const dest = path.join(process.cwd(), 'storage', storageKey);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, bytes);
  await prisma.template.update({
    where: { id: template.id },
    data: { storageKey, fileSize: bytes.byteLength },
  });

  const byRole = Object.fromEntries(template.recipients.map((r) => [r.roleKey, r.id]));

  // Placed fields. Geometry is percentage-of-page, top-left origin.
  const fields: Array<{
    roleKey: string;
    type: string;
    label: string;
    page: number;
    xPct: number;
    yPct: number;
    widthPct: number;
    heightPct: number;
    prefillKey?: string;
  }> = [
    { roleKey: 'candidate', type: 'name', label: 'Candidate Name', page: 1, xPct: 16, yPct: 23.5, widthPct: 30, heightPct: 4, prefillKey: 'candidate.fullName' },
    { roleKey: 'candidate', type: 'text', label: 'Role', page: 1, xPct: 30, yPct: 27.5, widthPct: 30, heightPct: 4, prefillKey: 'candidate.role' },
    { roleKey: 'candidate', type: 'date', label: 'Joining Date', page: 1, xPct: 30, yPct: 31.5, widthPct: 22, heightPct: 4, prefillKey: 'candidate.joiningDate' },
    { roleKey: 'candidate', type: 'number', label: 'Annual CTC', page: 1, xPct: 30, yPct: 35.5, widthPct: 22, heightPct: 4, prefillKey: 'candidate.annualSalary' },
    { roleKey: 'candidate', type: 'text', label: 'Department', page: 1, xPct: 30, yPct: 47.5, widthPct: 30, heightPct: 4, prefillKey: 'candidate.department' },
    { roleKey: 'candidate', type: 'text', label: 'Work Location', page: 1, xPct: 30, yPct: 51.5, widthPct: 30, heightPct: 4, prefillKey: 'candidate.workLocation' },
    { roleKey: 'candidate', type: 'signature', label: 'Candidate Signature', page: 1, xPct: 8, yPct: 78, widthPct: 28, heightPct: 7 },
    { roleKey: 'candidate', type: 'date', label: 'Date Signed', page: 1, xPct: 8, yPct: 91.5, widthPct: 20, heightPct: 4 },
    { roleKey: 'authorized_signatory', type: 'signature', label: 'Authorized Signature', page: 1, xPct: 58, yPct: 78, widthPct: 28, heightPct: 7 },
    { roleKey: 'authorized_signatory', type: 'name', label: 'Signatory Name', page: 1, xPct: 58, yPct: 91.5, widthPct: 30, heightPct: 4, prefillKey: 'signatory.name' },
  ];

  await prisma.templateField.createMany({
    data: fields.map((f) => ({
      templateId: template.id,
      recipientId: byRole[f.roleKey],
      type: f.type,
      label: f.label,
      required: true,
      page: f.page,
      xPct: f.xPct,
      yPct: f.yPct,
      widthPct: f.widthPct,
      heightPct: f.heightPct,
      prefillKey: f.prefillKey ?? null,
    })),
  });

  console.log(`Seeded template "${template.name}" (${template.id}) with ${fields.length} fields.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
