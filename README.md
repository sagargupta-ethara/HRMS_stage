# HRMS · Documenso-style Template Builder

A self-contained **PDF template builder + document-signing pipeline** for an HRMS,
modelled on Documenso's template editor. Admins upload a PDF, place
drag-and-drop fields assigned to recipients (Candidate, HR, Manager, Authorized
Signatory), save it as a reusable template, then generate candidate
offer-letters/contracts that prefill from HRMS data and are sent through
**Documenso (v2 API)** for signing — with webhooks updating status in real time.

> The Documenso **API key lives only on the server** and is never shipped to the
> browser (enforced via `import 'server-only'` in `src/lib/documenso.ts`).

---

## Feature ↔ requirement map

| # | Requirement | Where |
|---|---|---|
| 1 | Upload a PDF template | `/templates/new` → `POST /api/templates` |
| 2 | PDF opens in a preview/editor | `/templates/[id]/edit` (pdfjs renderer in `src/components/pdf/pdf-document-view.tsx`) |
| 3 | Recipients (Candidate, HR, Manager, Authorized Signatory) | `src/lib/recipients.ts`, `recipients-panel.tsx` |
| 4 | Drag/drop 8 field types (Signature, Name, Email, Date, Text, Number, Checkbox, Dropdown — plus Initials/Radio) | `src/lib/fields.ts`, `field-box.tsx`, `field-palette.tsx` |
| 5 | Each field assigned to a recipient | field → `recipientId`, colored by recipient |
| 6 | Position stored as page + x%/y%/width%/height% | `TemplateField` in `prisma/schema.prisma` |
| 7 | Save as reusable template | `PUT /api/templates/[id]` |
| 8 | Usable for candidate contracts/offer letters | `category`, seeded offer-letter template |
| 9 | Prefill name, joining date, role, salary, department… | `src/lib/prefill.ts`, `/templates/[id]/generate` |
| 10 | Send through Documenso for signing | **Publish template → Documenso** (`/api/templates/:id/publish`), then **single or bulk-CSV** generate via `/envelope/use` |
| 11 | Webhook updates on viewed/signed/completed/rejected | `POST /api/webhooks/documenso` |
| 12 | API key backend-only, never in frontend | `server-only` guard + `src/lib/api-client.ts` only calls our own API |

---

## Quick start

```bash
npm install                 # also generates Prisma client + copies the pdf.js worker
cp .env.example .env        # then edit (see below)
npm run db:push             # create the SQLite schema (prisma/dev.db)
npm run db:seed             # optional: a ready-made Offer Letter template
npm run dev                 # http://localhost:3000
```

Open **http://localhost:3000** → Templates. The seed gives you a fully-placed
"Offer Letter — Software Engineer" template to edit or generate from.

### Production build

```bash
npm run build && npm start
```

---

## Configuration (`.env`)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | SQLite file (default `file:./dev.db`). Swap the datasource for Postgres in `schema.prisma`. |
| `APP_BASE_URL` | This app's public URL (used in webhook/links). |
| `DOCUMENSO_API_URL` | `https://app.documenso.com/api/v2` (or just the origin — it's normalised). **Blank ⇒ mock mode.** |
| `DOCUMENSO_API_KEY` | Documenso API token. Sent verbatim as `Authorization: api_xxx` (no `Bearer`). **Server-only.** |
| `DOCUMENSO_WEBHOOK_SECRET` | Verified against the `X-Documenso-Secret` header on inbound webhooks. |
| `DOCUMENSO_DISTRIBUTION_METHOD` | `EMAIL` (default) or `NONE` (create the envelope without emailing — good for a first dry run). |

### The template-based flow (primary)

1. **Build** a template (upload PDF, place fields, assign recipients).
2. **Publish to Documenso** (button in the editor → `POST /api/templates/:id/publish`).
   This creates a reusable **TEMPLATE envelope** in your Documenso account and
   stores the returned ids (`documensoTemplateId`, per-recipient + per-field ids).
   It sends **no emails**.
   - `POST /envelope/create` (multipart: `payload` `type:TEMPLATE` + the PDF)
   - `GET /envelope/{id}` → recipient ids + envelope item id
   - `POST /envelope/field/create-many` (positioned fields, coords 0–100 %)
3. **Generate** — single (the generate form) or **bulk (CSV)**. For each candidate
   the app calls `POST /envelope/use` with the template id, real recipient
   contacts, and `prefillFields` (resolved from HRMS data), then distributes.
   - Prefilled NAME/EMAIL/DATE fields are published as read-only TEXT so the
     resolved value renders; NUMBER stays numeric; dropdown keeps its options.

If a template has **not** been published, generation falls back to building a
one-off document envelope from scratch (`/envelope/create` → fields → distribute).

### Dry run first (avoid emailing real people!)

`DISTRIBUTION_METHOD=NONE` makes `/envelope/use` (and distribute) create the
document + recipients in Documenso **without sending any emails** — review it in
the Documenso dashboard, then switch to `EMAIL`. Do this before your first real
batch, especially if your candidate data contains real addresses.

### Mock mode

With no API URL/key, generation creates a local record and the document detail
page shows **Simulate** buttons (Viewed / Signed / Completed / Reject) that POST
realistic payloads to the webhook handler — so you can demo the entire status
lifecycle with no Documenso account.

### Webhooks (real mode)

In Documenso → **Settings → Webhooks**, add an endpoint pointing at
`{APP_BASE_URL}/api/webhooks/documenso`, set the same secret as
`DOCUMENSO_WEBHOOK_SECRET`, and subscribe to document events. We correlate the
incoming event to our document via the `externalId` (set to our document id on
create), so status/recipient updates land even though Documenso's internal id
differs from ours.

---

## Prefill

Each field can bind to a **prefill token** (e.g. `candidate.fullName`,
`candidate.joiningDate`, `candidate.role`, `candidate.annualSalary`,
`candidate.department`). On the generate screen you fill an HRMS data form;
bound fields resolve live (dates → `15 July 2026`, currency → `₹18,00,000`) and
are pushed into Documenso as read-only values. Signatures/unbound fields are
collected at signing time. See `src/lib/prefill.ts`.

---

## Architecture

```
src/
  app/
    templates/                 list · new (upload) · [id]/edit (builder) · [id]/generate
    documents/                 list · [id] (status + event timeline)
    api/
      templates/...            CRUD + PDF stream  (server-only)
      documents/...            generate · simulate (mock)
      webhooks/documenso/      inbound status updates
  components/
    builder/                   3-pane editor (steps · PDF overlay · palette/properties)
    documents/ · generate/     status views · prefill form
    pdf/pdf-document-view.tsx  SSR-safe pdfjs renderer with a render-prop overlay
    ui.tsx · icons.tsx · top-nav.tsx
  lib/
    documenso.ts               server-ONLY Documenso v2 client (real + mock)
    documents.ts               generate + webhook orchestration
    prefill.ts · fields.ts · recipients.ts · validation.ts · storage.ts · mappers.ts
prisma/schema.prisma           Template · TemplateRecipient · TemplateField · Document · DocumentRecipient · DocumentEvent
```

**Stack:** Next.js 16 (App Router) · TypeScript · Prisma + SQLite · Tailwind v4 ·
pdfjs-dist · Zod.

## Security notes

- All Documenso calls happen in server modules guarded by `import 'server-only'`;
  the browser client (`src/lib/api-client.ts`) talks **only** to our own
  `/api/*` routes.
- Uploaded PDFs are stored under `storage/` and served through an app route, not
  from a public folder.
- Webhook requests are rejected unless the `X-Documenso-Secret` header matches
  `DOCUMENSO_WEBHOOK_SECRET` (when configured).
