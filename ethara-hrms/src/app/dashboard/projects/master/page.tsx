"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Download, FolderKanban, Loader2, Pencil, Plus, Search, Settings2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { projectsApi, usersApi, type ProjectFieldDef, type ProjectRecord } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { DELIVERY_LABEL, Panel, RFP_LABEL, TYPE_LABEL, fmtMoney } from "../shared";
import { EmptyState } from "@/components/shared/empty-state";

type UserLite = { id: string; name: string; role?: string };
const EMPTY = "__none__";

export default function ProjectMasterPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  // Managers (and admin/leadership) create & edit projects. PLs are read-only
  // here — they propose budgets from the Budgets & Approvals page instead.
  // Keyed off the ACTIVE role so a multi-role user who switches to PL sees the
  // read-only view (matches the backend's active-role visibility scoping).
  const canManage = ["super_admin", "admin", "leadership", "manager"].includes(user?.role ?? "");
  const fileRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ProjectRecord | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects", showArchived],
    queryFn: () => projectsApi.list({ includeArchived: showArchived }),
  });
  const { data: fieldDefs = [] } = useQuery({ queryKey: ["project-field-defs"], queryFn: () => projectsApi.fieldDefs() });
  const { data: users = [] } = useQuery<UserLite[]>({ queryKey: ["users-lite"], queryFn: () => usersApi.list() as Promise<UserLite[]> });

  const archiveMut = useMutation({
    mutationFn: ({ id, unarchive }: { id: string; unarchive: boolean }) => projectsApi.archive(id, unarchive),
    onSuccess: () => { toast.success("Project updated."); void qc.invalidateQueries({ queryKey: ["projects"] }); },
    onError: () => toast.error("Failed to update project."),
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) => projectsApi.bulkUpload(file),
    onSuccess: (r) => {
      toast.success(`Imported ${r.total}: ${r.created} created, ${r.updated} updated, ${r.rejected} rejected`);
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["project-field-defs"] });
    },
    onError: () => toast.error("Import failed. Check the file format (.xlsx or .csv)."),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      [p.internalName, p.externalName, p.client, p.tpmName, ...p.plNames].some((v) => (v ?? "").toLowerCase().includes(q)),
    );
  }, [projects, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "#F8FAFC" }}>Project Master</h1>
          <p className="text-sm text-muted-foreground">{projects.length} projects · configurable columns</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <Link href="/dashboard/projects/settings">
              <Button variant="outline" size="sm"><Settings2 className="mr-1.5 h-4 w-4" /> Columns</Button>
            </Link>
          )}
          <input
            ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMut.mutate(f); e.target.value = ""; }}
          />
          {canManage && (
            <Button variant="outline" size="sm" disabled={uploadMut.isPending} onClick={() => fileRef.current?.click()}>
              {uploadMut.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />} Import
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => projectsApi.exportFile("xlsx").catch(() => toast.error("Export failed."))}>
            <Download className="mr-1.5 h-4 w-4" /> Export
          </Button>
          {canManage && (
            <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-4 w-4" /> New Project</Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects, clients, TPM/PL…" className="pl-9" />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
        </label>
      </div>

      <Panel>
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No projects found"
            description={search ? "No projects match your search." : "Create your first project, or import from a spreadsheet."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide" style={{ color: "rgba(197,203,232,0.55)" }}>
                  <th className="px-3 py-2">Internal</th>
                  <th className="px-3 py-2">Client / External</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">TPM</th>
                  <th className="px-3 py-2">PL</th>
                  <th className="px-3 py-2 text-right">Members</th>
                  <th className="px-3 py-2 text-right">Approved</th>
                  <th className="px-3 py-2 text-right">Consumed</th>
                  {fieldDefs.map((fd) => <th key={fd.id} className="px-3 py-2">{fd.label}</th>)}
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="border-t" style={{ borderColor: "rgba(144,141,206,0.12)", opacity: p.isArchived ? 0.55 : 1 }}>
                    <td className="px-3 py-2 font-medium" style={{ color: "#E5E7EB" }}>{p.internalName}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.externalName ?? "—"}{p.client ? ` · ${p.client}` : ""}</td>
                    <td className="px-3 py-2">{TYPE_LABEL[p.projectType] ?? p.projectType}</td>
                    <td className="px-3 py-2 text-muted-foreground">{RFP_LABEL[p.rfpStatus] ?? p.rfpStatus} / {DELIVERY_LABEL[p.deliveryStatus] ?? p.deliveryStatus}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.tpmName ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.plNames.join(", ") || "—"}</td>
                    <td className="px-3 py-2 text-right">{p.totalMembers ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(p.approvedBudget)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(p.consumedBudget)}</td>
                    {fieldDefs.map((fd) => <td key={fd.id} className="px-3 py-2 text-muted-foreground">{String((p.customFields ?? {})[fd.key] ?? "—")}</td>)}
                    <td className="px-3 py-2">
                      {canManage ? (
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(p)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => archiveMut.mutate({ id: p.id, unarchive: p.isArchived })}>
                            {p.isArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                          </Button>
                        </div>
                      ) : (
                        <span className="block text-right text-xs text-muted-foreground">View only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {(creating || editing) && (
        <ProjectDialog
          project={editing}
          users={users}
          fieldDefs={fieldDefs}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); void qc.invalidateQueries({ queryKey: ["projects"] }); }}
        />
      )}
    </div>
  );
}

function ProjectDialog({ project, users, fieldDefs, onClose, onSaved }: {
  project: ProjectRecord | null;
  users: UserLite[];
  fieldDefs: ProjectFieldDef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!project;
  const [form, setForm] = useState<Record<string, string>>(() => ({
    internalName: project?.internalName ?? "",
    externalName: project?.externalName ?? "",
    client: project?.client ?? "",
    platform: project?.platform ?? "",
    projectType: project?.projectType ?? "technical",
    rfpStatus: project?.rfpStatus ?? "rfp",
    deliveryStatus: project?.deliveryStatus ?? "ongoing",
    aht: project?.aht?.toString() ?? "",
    targetVolume: project?.targetVolume?.toString() ?? "",
    deliveredVolume: project?.deliveredVolume?.toString() ?? "",
    dateOfDelivery: project?.dateOfDelivery ?? "",
    fteDemand: project?.fteDemand?.toString() ?? "",
    fteCount: project?.fteCount?.toString() ?? "",
    internCount: project?.internCount?.toString() ?? "",
    totalMembers: project?.totalMembers?.toString() ?? "",
    approvedBudget: project?.approvedBudget?.toString() ?? "",
    notes: project?.notes ?? "",
    tpmUserId: project?.tpmUserId ?? EMPTY,
  }));
  const [pls, setPls] = useState<Set<string>>(() => new Set((project?.leads ?? []).filter((l) => l.role === "pl").map((l) => l.userId)));
  const [custom, setCustom] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const fd of fieldDefs) out[fd.key] = String((project?.customFields ?? {})[fd.key] ?? "");
    return out;
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const mut = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        internalName: form.internalName.trim(),
        externalName: form.externalName.trim() || null,
        client: form.client.trim() || null,
        platform: form.platform.trim() || null,
        projectType: form.projectType,
        rfpStatus: form.rfpStatus,
        deliveryStatus: form.deliveryStatus,
        aht: num(form.aht),
        targetVolume: num(form.targetVolume),
        deliveredVolume: num(form.deliveredVolume),
        dateOfDelivery: form.dateOfDelivery || null,
        fteDemand: num(form.fteDemand),
        fteCount: num(form.fteCount),
        internCount: num(form.internCount),
        totalMembers: num(form.totalMembers),
        approvedBudget: num(form.approvedBudget),
        notes: form.notes.trim() || null,
        tpmUserId: form.tpmUserId === EMPTY ? null : form.tpmUserId,
        leadUserIds: [...pls],
        customFields: custom,
      };
      return isEdit ? projectsApi.update(project!.id, payload) : projectsApi.create(payload);
    },
    onSuccess: () => { toast.success(isEdit ? "Project updated." : "Project created."); onSaved(); },
    onError: () => toast.error("Save failed. Check required fields."),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Project" : "New Project"}</DialogTitle>
          <DialogDescription>Map the project, ownership and budget. Custom columns appear at the bottom.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Internal Name *"><Input value={form.internalName} onChange={(e) => set("internalName", e.target.value)} /></Field>
          <Field label="External / Client Project"><Input value={form.externalName} onChange={(e) => set("externalName", e.target.value)} /></Field>
          <Field label="Client"><Input value={form.client} onChange={(e) => set("client", e.target.value)} /></Field>
          <Field label="Platform"><Input value={form.platform} onChange={(e) => set("platform", e.target.value)} /></Field>
          <Field label="Type">
            <SelectBox value={form.projectType} onChange={(v) => set("projectType", v)} options={[["technical", "Technical"], ["generalist", "Generalist"]]} />
          </Field>
          <Field label="RFP Status">
            <SelectBox value={form.rfpStatus} onChange={(v) => set("rfpStatus", v)} options={[["rfp", "RFP"], ["production", "Production"], ["delivered", "Delivered"]]} />
          </Field>
          <Field label="Delivery Status">
            <SelectBox value={form.deliveryStatus} onChange={(v) => set("deliveryStatus", v)} options={[["ongoing", "Ongoing"], ["completed", "Completed"]]} />
          </Field>
          <Field label="Date of Delivery"><Input type="date" value={form.dateOfDelivery} onChange={(e) => set("dateOfDelivery", e.target.value)} /></Field>
          <Field label="AHT"><Input value={form.aht} onChange={(e) => set("aht", e.target.value)} inputMode="decimal" /></Field>
          <Field label="Target Volume"><Input value={form.targetVolume} onChange={(e) => set("targetVolume", e.target.value)} inputMode="numeric" /></Field>
          <Field label="Delivered Volume"><Input value={form.deliveredVolume} onChange={(e) => set("deliveredVolume", e.target.value)} inputMode="numeric" /></Field>
          <Field label="FTE Demand"><Input value={form.fteDemand} onChange={(e) => set("fteDemand", e.target.value)} inputMode="numeric" /></Field>
          <Field label="No. of FTEs"><Input value={form.fteCount} onChange={(e) => set("fteCount", e.target.value)} inputMode="numeric" /></Field>
          <Field label="No. of Interns"><Input value={form.internCount} onChange={(e) => set("internCount", e.target.value)} inputMode="numeric" /></Field>
          <Field label="Total Members"><Input value={form.totalMembers} onChange={(e) => set("totalMembers", e.target.value)} inputMode="numeric" /></Field>
          <Field label="Approved Budget (₹)"><Input value={form.approvedBudget} onChange={(e) => set("approvedBudget", e.target.value)} inputMode="numeric" /></Field>
          <Field label="TPM">
            <SelectBox value={form.tpmUserId} onChange={(v) => set("tpmUserId", v)} options={[[EMPTY, "— Unassigned —"], ...users.map((u) => [u.id, u.name] as [string, string])]} />
          </Field>
        </div>

        <Field label="Project Leads (PL)">
          <div className="max-h-36 overflow-y-auto rounded-md border p-2" style={{ borderColor: "rgba(144,141,206,0.2)" }}>
            <div className="grid grid-cols-2 gap-1">
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={pls.has(u.id)} onChange={(e) => setPls((prev) => { const n = new Set(prev); if (e.target.checked) n.add(u.id); else n.delete(u.id); return n; })} />
                  {u.name}
                </label>
              ))}
            </div>
          </div>
        </Field>

        {fieldDefs.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {fieldDefs.map((fd) => (
              <Field key={fd.id} label={fd.label}>
                <Input
                  value={custom[fd.key] ?? ""}
                  inputMode={fd.dataType === "number" || fd.dataType === "currency" ? "numeric" : undefined}
                  type={fd.dataType === "date" ? "date" : "text"}
                  onChange={(e) => setCustom((c) => ({ ...c, [fd.key]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
        )}

        <Field label="Notes"><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} /></Field>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!form.internalName.trim() || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} {isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}

function SelectBox({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? "")}>
      <SelectTrigger>
        <SelectValue>{(v) => options.find(([val]) => val === v)?.[1] ?? ""}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
