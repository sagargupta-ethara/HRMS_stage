"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/page-header";
import { cn, timeAgo } from "@/lib/utils";
import { GraduationCap, Plus, Search, Edit2, CheckCircle2, XCircle, Upload, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { collegesApi } from "@/lib/api";

type College = {
  id: string;
  name: string;
  shortName?: string;
  short_name?: string;
  isActive: boolean;
  createdAt: string;
};

type CollegeForm = { name: string; shortName: string };
const EMPTY_FORM: CollegeForm = { name: "", shortName: "" };

function parseCsvColleges(text: string): CollegeForm[] {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
    return {
      name: row.college_name ?? row.full_name ?? row.name ?? "",
      shortName: row.short_name ?? row.shortname ?? row.abbreviation ?? "",
    };
  }).filter((r) => r.name);
}

export default function CollegesConfigPage() {
  const qc = useQueryClient();
  const [colleges, setColleges] = useState<College[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<CollegeForm>(EMPTY_FORM);
  const [editTarget, setEditTarget] = useState<College | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [csvPreview, setCsvPreview] = useState<CollegeForm[]>([]);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvHelpOpen, setCsvHelpOpen] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);

  const loadColleges = async () => {
    setIsLoading(true);
    try {
      const data = await collegesApi.list();
      setColleges(Array.isArray(data) ? data : []);
    } catch {
      setError("Unable to load colleges.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadColleges();
  }, []);

  const filtered = colleges.filter((c) =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.shortName ?? c.short_name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const handleAdd = async () => {
    if (!form.name.trim()) { toast.error("College name is required."); return; }
    setSaving(true);
    try {
      await collegesApi.create({ name: form.name, shortName: form.shortName || undefined });
      toast.success("College added.");
      setForm(EMPTY_FORM);
      setAddOpen(false);
      qc.invalidateQueries({ queryKey: ["colleges"] });
      await loadColleges();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Failed to add college.");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    if (!form.name.trim()) { toast.error("College name is required."); return; }
    setSaving(true);
    try {
      await collegesApi.update(editTarget.id, { name: form.name, shortName: form.shortName || undefined });
      toast.success("College updated.");
      setEditOpen(false);
      setEditTarget(null);
      qc.invalidateQueries({ queryKey: ["colleges"] });
      await loadColleges();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Failed to update college.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (c: College) => {
    try {
      await collegesApi.update(c.id, { isActive: !c.isActive });
      toast.success(`College ${c.isActive ? "deactivated" : "activated"}.`);
      qc.invalidateQueries({ queryKey: ["colleges"] });
      await loadColleges();
    } catch {
      toast.error("Failed to update college status.");
    }
  };

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = parseCsvColleges(ev.target?.result as string);
      if (rows.length === 0) {
        toast.error("No valid rows found. Expected columns: college_name, short_name");
        return;
      }
      setCsvPreview(rows);
      toast.info(`${rows.length} colleges ready to import.`);
    };
    reader.readAsText(file);
    if (csvRef.current) csvRef.current.value = "";
  };

  const handleCsvImport = async () => {
    setCsvUploading(true);
    let ok = 0, fail = 0;
    for (const row of csvPreview) {
      try {
        await collegesApi.create({ name: row.name, shortName: row.shortName || undefined });
        ok++;
      } catch {
        fail++;
      }
    }
    setCsvPreview([]);
    qc.invalidateQueries({ queryKey: ["colleges"] });
    await loadColleges();
    setCsvUploading(false);
    toast.success(`Imported ${ok} college(s).${fail > 0 ? ` ${fail} failed.` : ""}`);
  };

  const openCsvPicker = () => {
    setCsvHelpOpen(false);
    window.setTimeout(() => csvRef.current?.click(), 0);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        icon={GraduationCap}
        title="Colleges"
        description="Manage registered institutions for candidate sourcing"
        actions={
          <>
          <Button variant="outline" size="sm" className="rounded-xl text-xs gap-1.5" onClick={() => setCsvHelpOpen(true)}>
            <Upload className="h-3.5 w-3.5" /> CSV Upload
          </Button>
          <input ref={csvRef} type="file" accept=".csv" className="hidden" onChange={handleCsvFile} />
          <Dialog open={csvHelpOpen} onOpenChange={setCsvHelpOpen}>
            <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
              <DialogHeader><DialogTitle>College CSV format</DialogTitle></DialogHeader>
              <div className="min-w-0 space-y-3 text-sm">
                <div className="min-w-0 rounded-lg border border-border bg-muted/20 p-4">
                  <p className="text-base font-medium">Columns</p>
                  <div className="mt-3 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
                    <div className="min-w-0 rounded-md bg-background/40 p-3">
                      <p className="font-semibold text-foreground">Required</p>
                      <p className="mt-1 break-words font-mono">college_name</p>
                    </div>
                    <div className="min-w-0 rounded-md bg-background/40 p-3">
                      <p className="font-semibold text-foreground">Optional</p>
                      <p className="mt-1 break-words font-mono">short_name</p>
                    </div>
                  </div>
                </div>
                <div className="min-w-0 rounded-lg border border-border bg-muted/20 p-4">
                  <p className="text-base font-medium">Accepted aliases</p>
                  <div className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                    <p>
                      Name: <span className="font-mono">college_name</span>, <span className="font-mono">full_name</span>, <span className="font-mono">name</span>
                    </p>
                    <p>
                      Short name: <span className="font-mono">short_name</span>, <span className="font-mono">shortname</span>, <span className="font-mono">abbreviation</span>
                    </p>
                  </div>
                </div>
                <div className="min-w-0 rounded-lg border border-border bg-background p-4">
                  <p className="text-base font-medium">Example</p>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-muted/30 p-3 text-xs leading-relaxed"><code>{`college_name,short_name
Indian Institute of Technology Bombay,IIT Bombay
Birla Institute of Technology and Science,BITS`}</code></pre>
                </div>
              </div>
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" className="rounded-xl text-xs" onClick={() => setCsvHelpOpen(false)}>Cancel</Button>
                <Button className="rounded-xl text-xs gap-1.5" onClick={openCsvPicker}>
                  <Upload className="h-3.5 w-3.5" /> Choose CSV
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger render={<Button size="sm" className="rounded-xl text-xs" />}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add College
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add New College</DialogTitle></DialogHeader>
              <CollegeFormFields form={form} onChange={setForm} />
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" className="rounded-xl text-xs" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button className="rounded-xl text-xs" disabled={saving} onClick={handleAdd}>
                  {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Saving...</> : "Add College"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </>
        }
      />

      {csvPreview.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">{csvPreview.length} colleges ready to import</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {csvPreview.slice(0, 3).map((r) => r.shortName || r.name).join(", ")}{csvPreview.length > 3 ? ` +${csvPreview.length - 3} more` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="rounded-xl text-xs" onClick={() => setCsvPreview([])}>Cancel</Button>
                <Button size="sm" className="rounded-xl text-xs" disabled={csvUploading} onClick={handleCsvImport}>
                  {csvUploading ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Importing...</> : "Confirm Import"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />{error}
          </CardContent>
        </Card>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search colleges..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 rounded-xl h-10" />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => {
            const shortName = c.shortName ?? c.short_name;
            return (
              <Card key={c.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <GraduationCap className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm leading-tight">{shortName || c.name}</p>
                        {shortName && <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{c.name}</p>}
                      </div>
                    </div>
                    <Badge variant={c.isActive ? "outline" : "secondary"} className={cn("text-[10px] shrink-0", c.isActive ? "text-success border-success/30" : "")}>
                      {c.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-xs text-muted-foreground">{timeAgo(c.createdAt)}</p>
                    <div className="flex gap-1">
                      <Dialog open={editOpen && editTarget?.id === c.id} onOpenChange={(o) => { setEditOpen(o); if (!o) setEditTarget(null); }}>
                        <DialogTrigger render={<Button variant="ghost" size="icon" className="h-7 w-7" />}
                          onClick={() => { setEditTarget(c); setForm({ name: c.name, shortName: shortName ?? "" }); }}>
                          <Edit2 className="h-3 w-3" />
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader><DialogTitle>Edit College</DialogTitle></DialogHeader>
                          <CollegeFormFields form={form} onChange={setForm} />
                          <div className="flex justify-end gap-2 pt-2">
                            <Button variant="outline" className="rounded-xl text-xs" onClick={() => { setEditOpen(false); setEditTarget(null); }}>Cancel</Button>
                            <Button className="rounded-xl text-xs" disabled={saving} onClick={handleEdit}>
                              {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Saving...</> : "Save Changes"}
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleToggle(c)}>
                        {c.isActive ? <XCircle className="h-3 w-3 text-destructive" /> : <CheckCircle2 className="h-3 w-3 text-success" />}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full flex flex-col items-center py-8 text-muted-foreground">
              <GraduationCap className="h-8 w-8 opacity-30 mb-2" />
              <p className="text-sm">No colleges found</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CollegeFormFields({ form, onChange }: { form: CollegeForm; onChange: (f: CollegeForm) => void }) {
  return (
    <div className="space-y-4 mt-2">
      <div className="space-y-1.5">
        <Label className="text-sm">Full Name *</Label>
        <Input placeholder="Indian Institute of Technology, Bombay" value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} className="rounded-xl" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-sm">Short Name</Label>
        <Input placeholder="IIT Bombay" value={form.shortName} onChange={(e) => onChange({ ...form, shortName: e.target.value })} className="rounded-xl" />
      </div>
    </div>
  );
}
