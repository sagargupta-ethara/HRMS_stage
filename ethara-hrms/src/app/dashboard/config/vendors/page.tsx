"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, LineChart, Line,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/page-header";
import { cn, formatLabel, getInitials, timeAgo, STAGE_LABELS, STAGE_COLORS } from "@/lib/utils";
import {
  Building2, Check, Plus, Search, Edit2, CheckCircle2, XCircle,
  Upload, Loader2, ChevronDown, ChevronUp,
  Users, TrendingUp, X, BarChart3,
} from "lucide-react";
import { toast } from "sonner";
import { candidatesApi, vendorsApi } from "@/lib/api";
import type { CandidateStage } from "@/types";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { DatePicker } from "@/components/ui/date-picker";

type Vendor = {
  id: string;
  name: string;
  contactEmail: string;
  contactPhone?: string;
  isActive: boolean;
  createdAt: string;
};

type CandidateRow = {
  id: string;
  fullName: string;
  currentStage: CandidateStage;
  currentStatus: string;
  createdAt: string;
  lastAppliedAt?: string;
  priorityScore: number;
  resumeScore?: number;
  sourceType: string;
  vendorId?: string;
  position?: { title?: string; department?: string } | null;
  positionTitle?: string;
};

type VendorForm = { name: string; contactEmail: string; contactPhone: string };
const EMPTY_FORM: VendorForm = { name: "", contactEmail: "", contactPhone: "" };

type Tab = "analytics" | "config";

const SCREEN_PASS_STAGES: CandidateStage[] = [
  "resume_shortlisted", "evaluation_assigned", "evaluation_in_progress",
  "evaluation_passed", "evaluation_failed", "selection_form_sent",
  "selection_form_submitted", "selection_form_validated",
  "contract_sent", "contract_signed", "induction_completed",
  "it_email_created", "welcome_mail_sent", "statutory_forms_sent",
  "statutory_forms_submitted", "compliance_verified", "onboarding_completed",
];
const REJECTED_STAGES: CandidateStage[] = ["resume_rejected", "evaluation_failed"];
const SELECTED_STAGES: CandidateStage[] = [
  "selection_form_sent", "selection_form_submitted", "selection_form_validated",
  "contract_sent", "contract_signed", "induction_completed",
  "it_email_created", "welcome_mail_sent", "statutory_forms_sent",
  "statutory_forms_submitted", "compliance_verified",
];
const JOINED_STAGES: CandidateStage[] = ["onboarding_completed"];

const ASSESSMENT_PASS_STAGES: CandidateStage[] = [
  "evaluation_passed", "selection_form_sent", "selection_form_submitted", "selection_form_validated",
  "contract_sent", "contract_signed", "induction_completed", "it_email_created",
  "welcome_mail_sent", "statutory_forms_sent", "statutory_forms_submitted",
  "compliance_verified", "onboarding_completed",
];

function calcVendorStats(candidates: CandidateRow[]) {
  const total = candidates.length;
  const screeningPass = candidates.filter((c) => SCREEN_PASS_STAGES.includes(c.currentStage)).length;
  const assessmentPass = candidates.filter((c) => ASSESSMENT_PASS_STAGES.includes(c.currentStage)).length;
  const rejected = candidates.filter((c) => REJECTED_STAGES.includes(c.currentStage)).length;
  const selected = candidates.filter((c) => SELECTED_STAGES.includes(c.currentStage)).length;
  const joined = candidates.filter((c) => JOINED_STAGES.includes(c.currentStage)).length;
  const pending = total - screeningPass - rejected;
  const scoredCandidates = candidates.filter((c) => c.resumeScore != null && c.resumeScore > 0);
  const avgScore = scoredCandidates.length > 0
    ? Math.round(scoredCandidates.reduce((s, c) => s + (c.resumeScore ?? 0), 0) / scoredCandidates.length)
    : 0;
  const dropOffCount = screeningPass - selected;
  return {
    total,
    pending: Math.max(0, pending),
    screeningPass,
    assessmentPass,
    rejected,
    selected,
    joined,
    dropOff: Math.max(0, dropOffCount),
    screeningPassRate: total > 0 ? Math.round((screeningPass / total) * 100) : 0,
    assessmentPassRate: total > 0 ? Math.round((assessmentPass / total) * 100) : 0,
    selectionRate: total > 0 ? Math.round((selected / total) * 100) : 0,
    joiningRate: total > 0 ? Math.round((joined / total) * 100) : 0,
    rejectionRate: total > 0 ? Math.round((rejected / total) * 100) : 0,
    dropOffRate: screeningPass > 0 ? Math.round((dropOffCount / screeningPass) * 100) : 0,
    conversionRate: total > 0 ? Math.round((joined / total) * 100) : 0,
    avgScore,
  };
}

function parseVendorCsv(text: string): VendorForm[] {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
    return {
      name: row["vendor_name"] ?? row["name"] ?? "",
      contactEmail: row["contact_email"] ?? row["contactemail"] ?? row["email"] ?? "",
      contactPhone: row["contact_phone"] ?? row["contactphone"] ?? row["phone"] ?? "",
    };
  }).filter((r) => r.name && r.contactEmail);
}

export default function VendorsConfigPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("analytics");

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorCandidates, setVendorCandidates] = useState<CandidateRow[]>([]);
  const [internalCandidates, setInternalCandidates] = useState<CandidateRow[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(true);
  const [loadingCandidates, setLoadingCandidates] = useState(true);

  const [search, setSearch] = useState("");
  const [expandedVendorId, setExpandedVendorId] = useState<string | null>(null);
  const [drawerCandidate, setDrawerCandidate] = useState<CandidateRow | null>(null);
  const [compareVendors, setCompareVendors] = useState<string[]>([]);
  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");

  const [form, setForm] = useState<VendorForm>(EMPTY_FORM);
  const [editTarget, setEditTarget] = useState<Vendor | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [csvPreview, setCsvPreview] = useState<VendorForm[]>([]);
  const [csvUploading, setCsvUploading] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);

  const loadVendors = useCallback(async () => {
    setLoadingVendors(true);
    try {
      const data = await vendorsApi.list();
      setVendors(Array.isArray(data) ? data : []);
    } catch {
      toast.error("Unable to load vendors.");
    } finally {
      setLoadingVendors(false);
    }
  }, []);

  const loadCandidates = useCallback(async () => {
    setLoadingCandidates(true);
    try {
      const [vendorRes, directRes, referralRes, lateralRes] = await Promise.all([
        candidatesApi.list({ sourceType: "vendor", limit: 500 }),
        candidatesApi.list({ sourceType: "direct_application", limit: 300 }),
        candidatesApi.list({ sourceType: "employee_referral", limit: 300 }),
        candidatesApi.list({ sourceType: "lateral_hiring", limit: 300 }),
      ]);
      setVendorCandidates(vendorRes.data ?? []);
      const internal = [
        ...(directRes.data ?? []),
        ...(referralRes.data ?? []),
        ...(lateralRes.data ?? []),
      ];
      setInternalCandidates(internal);
    } catch {
      toast.error("Unable to load candidate data.");
    } finally {
      setLoadingCandidates(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadVendors();
    void loadCandidates();
  }, [loadVendors, loadCandidates]);

  const monthRange = useMemo(() => {
    let from = 0;
    let to = Infinity;
    if (fromMonth) {
      const [y, m] = fromMonth.split("-").map(Number);
      from = new Date(y, m - 1, 1).getTime();
    }
    if (toMonth) {
      const [y, m] = toMonth.split("-").map(Number);
      to = new Date(y, m, 1).getTime();
    }
    return { from, to };
  }, [fromMonth, toMonth]);

  const filteredVendorCandidates = useMemo(() => {
    if (monthRange.from === 0 && monthRange.to === Infinity) return vendorCandidates;
    return vendorCandidates.filter((c) => {
      const t = new Date(c.createdAt).getTime();
      return t >= monthRange.from && t < monthRange.to;
    });
  }, [vendorCandidates, monthRange]);

  const filteredInternalCandidates = useMemo(() => {
    if (monthRange.from === 0 && monthRange.to === Infinity) return internalCandidates;
    return internalCandidates.filter((c) => {
      const t = new Date(c.createdAt).getTime();
      return t >= monthRange.from && t < monthRange.to;
    });
  }, [internalCandidates, monthRange]);

  const vendorMap = useMemo(() => {
    const map = new Map<string, { vendor: Vendor; candidates: CandidateRow[] }>();
    for (const v of vendors) {
      map.set(v.id, { vendor: v, candidates: [] });
    }
    for (const c of filteredVendorCandidates) {
      if (c.vendorId && map.has(c.vendorId)) {
        map.get(c.vendorId)!.candidates.push(c);
      } else {
        const fallback = vendors.find((v) => v.contactEmail && c.currentStatus?.toLowerCase().includes(v.name.toLowerCase()));
        if (fallback && map.has(fallback.id)) {
          map.get(fallback.id)!.candidates.push(c);
        }
      }
    }
    return map;
  }, [vendors, filteredVendorCandidates]);

  const vendorStats = useMemo(() =>
    Array.from(vendorMap.entries()).map(([id, { vendor, candidates }]) => ({
      id,
      vendor,
      candidates,
      stats: calcVendorStats(candidates),
    })).sort((a, b) => b.stats.total - a.stats.total),
    [vendorMap]
  );

  const filteredVendorStats = useMemo(() =>
    vendorStats.filter((v) =>
      !search ||
      v.vendor.name.toLowerCase().includes(search.toLowerCase()) ||
      v.vendor.contactEmail.toLowerCase().includes(search.toLowerCase())
    ),
    [vendorStats, search]
  );

  const internalStats = useMemo(() => calcVendorStats(filteredInternalCandidates), [filteredInternalCandidates]);
  const allVendorStats = useMemo(() => calcVendorStats(filteredVendorCandidates), [filteredVendorCandidates]);

  const comparisonData = useMemo(() => {
    const targets = compareVendors.length > 0
      ? vendorStats.filter((v) => compareVendors.includes(v.id))
      : vendorStats.slice(0, 5);
    return targets.map((v) => ({
      name: v.vendor.name.length > 12 ? v.vendor.name.slice(0, 12) + "…" : v.vendor.name,
      Total: v.stats.total,
      "Pass Rate": v.stats.screeningPassRate,
      "Select Rate": v.stats.selectionRate,
      "Join Rate": v.stats.joiningRate,
      "Reject Rate": v.stats.rejectionRate,
    }));
  }, [compareVendors, vendorStats]);

  const vsInternalData = [
    { metric: "Total", Vendor: allVendorStats.total, Internal: internalStats.total },
    { metric: "Pass Rate%", Vendor: allVendorStats.screeningPassRate, Internal: internalStats.screeningPassRate },
    { metric: "Select Rate%", Vendor: allVendorStats.selectionRate, Internal: internalStats.selectionRate },
    { metric: "Join Rate%", Vendor: allVendorStats.joiningRate, Internal: internalStats.joiningRate },
    { metric: "Reject Rate%", Vendor: allVendorStats.rejectionRate, Internal: internalStats.rejectionRate },
  ];

  const handleAdd = async () => {
    if (!form.name.trim() || !form.contactEmail.trim()) { toast.error("Company name and email are required."); return; }
    setSaving(true);
    try {
      await vendorsApi.create({ name: form.name, contactEmail: form.contactEmail, contactPhone: form.contactPhone });
      toast.success("Vendor added successfully.");
      setForm(EMPTY_FORM);
      setAddOpen(false);
      qc.invalidateQueries({ queryKey: ["vendors"] });
      await loadVendors();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Failed to add vendor.");
    } finally { setSaving(false); }
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    if (!form.name.trim() || !form.contactEmail.trim()) { toast.error("Company name and email are required."); return; }
    setSaving(true);
    try {
      await vendorsApi.update(editTarget.id, { name: form.name, contactEmail: form.contactEmail, contactPhone: form.contactPhone });
      toast.success("Vendor updated.");
      setEditOpen(false);
      setEditTarget(null);
      qc.invalidateQueries({ queryKey: ["vendors"] });
      await loadVendors();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Failed to update vendor.");
    } finally { setSaving(false); }
  };

  const handleToggleActive = async (v: Vendor) => {
    try {
      await vendorsApi.update(v.id, { isActive: !v.isActive });
      toast.success(`Vendor ${v.isActive ? "deactivated" : "activated"}.`);
      qc.invalidateQueries({ queryKey: ["vendors"] });
      await loadVendors();
    } catch { toast.error("Failed to update vendor status."); }
  };

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseVendorCsv(text);
      if (rows.length === 0) { toast.error("No valid rows found. Expected: vendor_name, contact_email, contact_phone"); return; }
      setCsvPreview(rows);
      toast.info(`${rows.length} vendors ready to import.`);
    };
    reader.readAsText(file);
    if (csvRef.current) csvRef.current.value = "";
  };

  const handleCsvImport = async () => {
    if (csvPreview.length === 0) return;
    setCsvUploading(true);
    let ok = 0; let fail = 0;
    for (const row of csvPreview) {
      try { await vendorsApi.create({ name: row.name, contactEmail: row.contactEmail, contactPhone: row.contactPhone }); ok++; }
      catch { fail++; }
    }
    setCsvPreview([]);
    qc.invalidateQueries({ queryKey: ["vendors"] });
    await loadVendors();
    setCsvUploading(false);
    toast.success(`Imported ${ok} vendor(s).${fail > 0 ? ` ${fail} failed.` : ""}`);
  };

  const isLoading = loadingVendors || loadingCandidates;

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        icon={Building2}
        title="Vendor Intelligence"
        description="Unified vendor hiring intelligence and comparison"
        actions={
          <>
          <Button variant="outline" size="sm" className="rounded-xl text-xs gap-1.5" onClick={() => csvRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> CSV Upload
          </Button>
          <input ref={csvRef} type="file" accept=".csv" className="hidden" onChange={handleCsvFile} />
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger render={<Button size="sm" className="rounded-xl text-xs" />}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Vendor
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add New Vendor</DialogTitle></DialogHeader>
              <VendorFormFields form={form} onChange={setForm} />
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" className="rounded-xl text-xs" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button className="rounded-xl text-xs" disabled={saving} onClick={handleAdd}>
                  {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving…</> : "Add Vendor"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </>
        }
      />

      {csvPreview.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm font-semibold">{csvPreview.length} vendors ready to import</p>
              <p className="text-xs text-muted-foreground">{csvPreview.slice(0, 3).map((r) => r.name).join(", ")}{csvPreview.length > 3 ? ` +${csvPreview.length - 3} more` : ""}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="rounded-xl text-xs" onClick={() => setCsvPreview([])}>Cancel</Button>
              <Button size="sm" className="rounded-xl text-xs" disabled={csvUploading} onClick={handleCsvImport}>
                {csvUploading ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Importing…</> : "Confirm Import"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-1 border-b border-border">
        {(["analytics", "config"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize",
              activeTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "analytics" ? <BarChart3 className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
            {t === "analytics" ? "Analytics" : "Configuration"}
          </button>
        ))}
      </div>

      {activeTab === "config" && (
        <ConfigTab
          vendors={vendors}
          isLoading={loadingVendors}
          search={search}
          setSearch={setSearch}
          form={form}
          setForm={setForm}
          editTarget={editTarget}
          setEditTarget={setEditTarget}
          editOpen={editOpen}
          setEditOpen={setEditOpen}
          saving={saving}
          handleEdit={handleEdit}
          handleToggleActive={handleToggleActive}
        />
      )}

      {activeTab === "analytics" && (
        <AnalyticsTab
          isLoading={isLoading}
          filteredVendorStats={filteredVendorStats}
          allVendorStats={allVendorStats}
          internalStats={internalStats}
          search={search}
          setSearch={setSearch}
          fromMonth={fromMonth}
          setFromMonth={setFromMonth}
          toMonth={toMonth}
          setToMonth={setToMonth}
          expandedVendorId={expandedVendorId}
          setExpandedVendorId={setExpandedVendorId}
          drawerCandidate={drawerCandidate}
          setDrawerCandidate={setDrawerCandidate}
          compareVendors={compareVendors}
          setCompareVendors={setCompareVendors}
          comparisonData={comparisonData}
          vsInternalData={vsInternalData}
          vendorStats={vendorStats}
        />
      )}
    </div>
  );
}

function ConfigTab({
  vendors, isLoading, search, setSearch, form, setForm,
  editTarget, setEditTarget, editOpen, setEditOpen, saving,
  handleEdit, handleToggleActive,
}: {
  vendors: Vendor[];
  isLoading: boolean;
  search: string;
  setSearch: (s: string) => void;
  form: VendorForm;
  setForm: (f: VendorForm) => void;
  editTarget: Vendor | null;
  setEditTarget: (v: Vendor | null) => void;
  editOpen: boolean;
  setEditOpen: (o: boolean) => void;
  saving: boolean;
  handleEdit: () => void;
  handleToggleActive: (v: Vendor) => void;
}) {
  const filtered = vendors.filter((v) =>
    !search ||
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    v.contactEmail.toLowerCase().includes(search.toLowerCase())
  );

  const renderVendorActions = (v: Vendor, mobile = false) => (
    <div className={cn(
      mobile
        ? "grid grid-cols-2 gap-2"
        : "flex items-center justify-end gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
    )}>
      <Dialog open={editOpen && editTarget?.id === v.id} onOpenChange={(o) => { setEditOpen(o); if (!o) setEditTarget(null); }}>
        <DialogTrigger
          render={
            <Button
              variant={mobile ? "outline" : "ghost"}
              size={mobile ? "sm" : "icon"}
              className={cn(mobile ? "h-9 rounded-lg text-xs" : "h-7 w-7")}
            />
          }
          onClick={() => {
            setEditTarget(v);
            setForm({ name: v.name, contactEmail: v.contactEmail, contactPhone: v.contactPhone ?? "" });
          }}
        >
          {mobile ? (
            <span className="inline-flex items-center gap-1.5">
              <Edit2 className="h-3.5 w-3.5" />
              Edit
            </span>
          ) : (
            <Edit2 className="h-3.5 w-3.5" />
          )}
        </DialogTrigger>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Vendor</DialogTitle></DialogHeader>
          <VendorFormFields form={form} onChange={setForm} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" className="rounded-xl text-xs" onClick={() => { setEditOpen(false); setEditTarget(null); }}>Cancel</Button>
            <Button className="rounded-xl text-xs" disabled={saving} onClick={handleEdit}>
              {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving…</> : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Button
        variant={mobile ? "outline" : "ghost"}
        size={mobile ? "sm" : "icon"}
        className={cn(mobile ? "h-9 rounded-lg text-xs" : "h-7 w-7")}
        onClick={() => handleToggleActive(v)}
      >
        {v.isActive ? (
          <span className="inline-flex items-center gap-1.5">
            <XCircle className="h-3.5 w-3.5 text-destructive" />
            {mobile ? "Disable" : null}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            {mobile ? "Enable" : null}
          </span>
        )}
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search vendors..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 rounded-xl h-10" />
      </div>
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="space-y-3 p-4 sm:hidden">
            {isLoading ? (
              <div className="py-12 text-center">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No vendors found</div>
            ) : filtered.map((v) => (
              <div key={v.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Building2 className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-semibold">{v.name}</p>
                    <p className="mt-1 break-all text-sm text-muted-foreground">{v.contactEmail}</p>
                    {v.contactPhone && <p className="break-words text-xs text-muted-foreground">{v.contactPhone}</p>}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <Badge variant={v.isActive ? "outline" : "secondary"} className={cn("mt-1 gap-1 text-xs", v.isActive ? "text-success border-success/30" : "")}>
                      {v.isActive ? <><CheckCircle2 className="h-3 w-3" /> Active</> : <><XCircle className="h-3 w-3" /> Inactive</>}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Added</p>
                    <p className="mt-1">{timeAgo(v.createdAt)}</p>
                  </div>
                </div>

                <div className="mt-4">
                  {renderVendorActions(v, true)}
                </div>
              </div>
            ))}
          </div>

          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Vendor", "Contact", "Status", "Added", "Actions"].map((h) => (
                    <th key={h} className={cn("py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider", h === "Actions" ? "text-right" : "text-left")}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={5} className="py-12 text-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" /></td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={5} className="py-10 text-center text-sm text-muted-foreground">No vendors found</td></tr>
                ) : filtered.map((v) => (
                  <tr key={v.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors group">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Building2 className="h-4 w-4 text-primary" />
                        </div>
                        <p className="font-semibold">{v.name}</p>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <p className="text-sm">{v.contactEmail}</p>
                      {v.contactPhone && <p className="text-xs text-muted-foreground">{v.contactPhone}</p>}
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={v.isActive ? "outline" : "secondary"} className={cn("text-xs gap-1", v.isActive ? "text-success border-success/30" : "")}>
                        {v.isActive ? <><CheckCircle2 className="h-3 w-3" /> Active</> : <><XCircle className="h-3 w-3" /> Inactive</>}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-xs text-muted-foreground">{timeAgo(v.createdAt)}</td>
                    <td className="py-3 px-4 text-right">
                      {renderVendorActions(v)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

type VendorStatRow = {
  id: string;
  vendor: Vendor;
  candidates: CandidateRow[];
  stats: ReturnType<typeof calcVendorStats>;
};

function AnalyticsTab({
  isLoading, filteredVendorStats, allVendorStats, internalStats,
  search, setSearch, fromMonth, setFromMonth, toMonth, setToMonth,
  expandedVendorId, setExpandedVendorId,
  drawerCandidate, setDrawerCandidate,
  compareVendors, setCompareVendors,
  comparisonData, vsInternalData, vendorStats,
}: {
  isLoading: boolean;
  filteredVendorStats: VendorStatRow[];
  allVendorStats: ReturnType<typeof calcVendorStats>;
  internalStats: ReturnType<typeof calcVendorStats>;
  search: string;
  setSearch: (s: string) => void;
  fromMonth: string;
  setFromMonth: (s: string) => void;
  toMonth: string;
  setToMonth: (s: string) => void;
  expandedVendorId: string | null;
  setExpandedVendorId: (id: string | null) => void;
  drawerCandidate: CandidateRow | null;
  setDrawerCandidate: (c: CandidateRow | null) => void;
  compareVendors: string[];
  setCompareVendors: (ids: string[]) => void;
  comparisonData: Record<string, string | number>[];
  vsInternalData: Record<string, string | number>[];
  vendorStats: VendorStatRow[];
}) {
  const hasFilter = fromMonth || toMonth;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search vendors…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 rounded-xl h-9 text-xs" />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground shrink-0">From</label>
            <DatePicker
              value={fromMonth}
              onChange={(v) => setFromMonth(v)}
              placeholder="From month"
              className="h-9 w-auto rounded-xl"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground shrink-0">To</label>
            <DatePicker
              value={toMonth}
              onChange={(v) => setToMonth(v)}
              placeholder="To month"
              className="h-9 w-auto rounded-xl"
            />
          </div>
          {hasFilter && (
            <button
              onClick={() => { setFromMonth(""); setToMonth(""); }}
              className="flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/5 px-2.5 py-1 text-xs text-destructive"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: "Total Submitted", value: allVendorStats.total, sub: "all vendors combined", color: "text-primary" },
          { label: "Screening Pass Rate", value: `${allVendorStats.screeningPassRate}%`, sub: `${allVendorStats.screeningPass} passed`, color: "text-emerald-500" },
          { label: "Assessment Pass Rate", value: `${allVendorStats.assessmentPassRate}%`, sub: `${allVendorStats.assessmentPass} passed evals`, color: "text-blue-500" },
          { label: "Selected", value: `${allVendorStats.selectionRate}%`, sub: `${allVendorStats.selected} selected`, color: "text-indigo-500" },
          { label: "Joined / Onboarded", value: allVendorStats.joined, sub: `${allVendorStats.conversionRate}% conversion rate`, color: "text-violet-500" },
          { label: "Rejected", value: allVendorStats.rejected, sub: `${allVendorStats.rejectionRate}% rejection rate`, color: "text-red-500" },
          { label: "Drop-off Rate", value: `${allVendorStats.dropOffRate}%`, sub: `${allVendorStats.dropOff} dropped after pass`, color: "text-amber-500" },
          { label: "Avg Resume Score", value: allVendorStats.avgScore > 0 ? `${allVendorStats.avgScore}/100` : "—", sub: "average screening score", color: "text-cyan-500" },
        ].map((kpi) => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{kpi.label}</p>
              <p className={cn("text-2xl font-bold mt-1", kpi.color)}>{isLoading ? "–" : kpi.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{kpi.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" /> Vendor-wise Hiring Status
          </h2>
          <span className="text-xs text-muted-foreground">{filteredVendorStats.length} vendors</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredVendorStats.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No vendors found. Add vendors to see hiring intelligence here.
          </div>
        ) : (
          filteredVendorStats.map((row) => (
            <VendorRow
              key={row.id}
              row={row}
              expanded={expandedVendorId === row.id}
              onToggle={() => setExpandedVendorId(expandedVendorId === row.id ? null : row.id)}
              onCandidateClick={setDrawerCandidate}
              inCompare={compareVendors.includes(row.id)}
              onToggleCompare={() =>
                setCompareVendors(
                  compareVendors.includes(row.id)
                    ? compareVendors.filter((id) => id !== row.id)
                    : [...compareVendors, row.id]
                )
              }
            />
          ))
        )}
      </div>

      <VendorComparison
        comparisonData={comparisonData}
        compareVendors={compareVendors}
        setCompareVendors={setCompareVendors}
        vendorStats={vendorStats}
        isLoading={isLoading}
      />

      <VsInternalSection
        allVendorStats={allVendorStats}
        internalStats={internalStats}
        vsInternalData={vsInternalData}
        isLoading={isLoading}
      />

      {drawerCandidate && (
        <CandidateDrawer candidate={drawerCandidate} onClose={() => setDrawerCandidate(null)} />
      )}
    </div>
  );
}

function VendorRow({
  row, expanded, onToggle, onCandidateClick, inCompare, onToggleCompare,
}: {
  row: VendorStatRow;
  expanded: boolean;
  onToggle: () => void;
  onCandidateClick: (c: CandidateRow) => void;
  inCompare: boolean;
  onToggleCompare: () => void;
}) {
  const { vendor, candidates, stats } = row;
  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <div
        className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold">{vendor.name}</p>
              <Badge variant={vendor.isActive ? "outline" : "secondary"} className={cn("text-[10px]", vendor.isActive ? "text-success border-success/30" : "")}>
                {vendor.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{vendor.contactEmail}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {[
            { label: "Total", val: stats.total, color: "text-primary" },
            { label: "Pending", val: stats.pending, color: "text-amber-500" },
            { label: "Passed", val: stats.screeningPass, color: "text-emerald-500" },
            { label: "Selected", val: stats.selected, color: "text-blue-500" },
            { label: "Rejected", val: stats.rejected, color: "text-red-500" },
            { label: "Joined", val: stats.joined, color: "text-violet-500" },
          ].map((s) => (
            <div key={s.label} className="text-center min-w-[44px]">
              <p className={cn("text-base font-bold", s.color)}>{s.val}</p>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
            </div>
          ))}
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={(e) => { e.stopPropagation(); onToggleCompare(); }}
              className={cn(
                "text-[10px] px-2 py-1 rounded-lg border transition-colors",
                inCompare ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/30"
              )}
            >
              <span className="flex items-center gap-1">{inCompare ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}Compare</span>
            </button>
            {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>
      </div>

      {expanded && candidates.length > 0 && (
        <div className="border-t border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 border-b border-border">
                  {["Candidate", "Role", "Submitted", "Stage", "Screening", "Status"].map((h) => (
                    <th key={h} className="py-2.5 px-4 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {candidates.slice(0, 20).map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-border/40 hover:bg-muted/20 transition-colors cursor-pointer"
                    onClick={() => onCandidateClick(c)}
                  >
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className="text-[9px] bg-primary/10 text-primary">{getInitials(c.fullName)}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-xs">{c.fullName}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-xs text-muted-foreground">{c.position?.title ?? c.positionTitle ?? "—"}</td>
                    <td className="py-2.5 px-4 text-xs text-muted-foreground">{timeAgo(c.createdAt)}</td>
                    <td className="py-2.5 px-4">
                      <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", STAGE_COLORS[c.currentStage] ?? "bg-muted text-muted-foreground")}>
                        {STAGE_LABELS[c.currentStage] ?? formatLabel(c.currentStage)}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-xs">
                      {c.resumeScore != null
                        ? <span className={cn("font-semibold", c.resumeScore >= 70 ? "text-emerald-500" : c.resumeScore >= 50 ? "text-amber-500" : "text-red-500")}>{c.resumeScore}/100</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-muted-foreground">{c.currentStatus}</td>
                  </tr>
                ))}
                {candidates.length > 20 && (
                  <tr>
                    <td colSpan={6} className="py-2 px-4 text-center text-xs text-muted-foreground">
                      +{candidates.length - 20} more candidates not shown
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {candidates.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">No candidates from this vendor yet.</div>
          )}
        </div>
      )}
      {expanded && candidates.length === 0 && (
        <div className="border-t border-border py-8 text-center text-sm text-muted-foreground">
          No candidates submitted by this vendor yet.
        </div>
      )}
    </div>
  );
}

function VendorComparison({
  comparisonData, compareVendors, setCompareVendors, vendorStats, isLoading,
}: {
  comparisonData: Record<string, string | number>[];
  compareVendors: string[];
  setCompareVendors: (ids: string[]) => void;
  vendorStats: VendorStatRow[];
  isLoading: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" /> Vendor Comparison
        </h2>
        {compareVendors.length > 0 && (
          <button
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            onClick={() => setCompareVendors([])}
          >
            <X className="h-3 w-3" /> Clear selection
          </button>
        )}
      </div>

      {compareVendors.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Click <strong>+ Compare</strong> on any vendor row above to compare up to 5 vendors. Showing top 5 by default.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Candidate Volume</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <div className="h-40 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={comparisonData} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.12)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "rgba(8,8,16,0.95)", border: "1px solid rgba(144,141,206,0.22)", borderRadius: 8, fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="Total" fill="#ED00ED" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Conversion Rates (%)</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <div className="h-40 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={comparisonData} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.12)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "rgba(8,8,16,0.95)", border: "1px solid rgba(144,141,206,0.22)", borderRadius: 8, fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="Pass Rate" fill="#908DCE" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Select Rate" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Join Rate" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Vendor", "Total", "Pass Rate", "Select Rate", "Join Rate", "Reject Rate", "Avg Score"].map((h) => (
                    <th key={h} className="py-2.5 px-4 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(compareVendors.length > 0 ? vendorStats.filter((v) => compareVendors.includes(v.id)) : vendorStats.slice(0, 8)).map((v) => (
                  <tr key={v.id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="py-2.5 px-4 font-medium text-xs">{v.vendor.name}</td>
                    <td className="py-2.5 px-4 text-xs">{v.stats.total}</td>
                    <td className="py-2.5 px-4 text-xs">
                      <div className="flex items-center gap-2">
                        <Progress value={v.stats.screeningPassRate} className="h-1.5 w-14" />
                        <span>{v.stats.screeningPassRate}%</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-xs">
                      <div className="flex items-center gap-2">
                        <Progress value={v.stats.selectionRate} className="h-1.5 w-14" />
                        <span>{v.stats.selectionRate}%</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-xs">{v.stats.joiningRate}%</td>
                    <td className="py-2.5 px-4 text-xs text-red-500">{v.stats.rejectionRate}%</td>
                    <td className="py-2.5 px-4 text-xs">{v.stats.avgScore > 0 ? `${v.stats.avgScore}/100` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function VsInternalSection({
  allVendorStats, internalStats, vsInternalData, isLoading,
}: {
  allVendorStats: ReturnType<typeof calcVendorStats>;
  internalStats: ReturnType<typeof calcVendorStats>;
  vsInternalData: Record<string, string | number>[];
  isLoading: boolean;
}) {
  const mobileVsInternalData = vsInternalData.map((item) => ({
    ...item,
    metric: String(item.metric)
      .replace(" Rate%", "")
      .replace("Pass", "Pass")
      .replace("Select", "Select")
      .replace("Reject", "Rej")
      .replace("Join", "Join"),
  }));

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" /> Vendor vs Internal Hiring
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Vendor Total", val: allVendorStats.total, sub: `vs ${internalStats.total} internal` },
          { label: "Vendor Pass Rate", val: `${allVendorStats.screeningPassRate}%`, sub: `internal: ${internalStats.screeningPassRate}%` },
          { label: "Vendor Select Rate", val: `${allVendorStats.selectionRate}%`, sub: `internal: ${internalStats.selectionRate}%` },
          { label: "Vendor Join Rate", val: `${allVendorStats.joiningRate}%`, sub: `internal: ${internalStats.joiningRate}%` },
        ].map((k) => (
          <Card key={k.label} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{k.label}</p>
              <p className="text-2xl font-bold mt-1 text-primary">{isLoading ? "–" : k.val}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{k.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Vendor vs Internal — Metrics</CardTitle></CardHeader>
          <CardContent className="px-2 pb-4 pt-2 sm:p-6">
            {isLoading ? <div className="h-40 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : (
              <>
              <div className="sm:hidden">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={mobileVsInternalData} margin={{ top: 10, right: 8, left: 0, bottom: 12 }} barCategoryGap="28%">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.12)" />
                  <XAxis dataKey="metric" interval={0} tickMargin={8} tick={{ fontSize: 9 }} />
                  <YAxis width={34} tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "rgba(8,8,16,0.95)", border: "1px solid rgba(144,141,206,0.22)", borderRadius: 8, fontSize: 11 }} />
                  <Legend verticalAlign="bottom" height={28} wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
                  <Bar dataKey="Vendor" fill="#ED00ED" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Internal" fill="#908DCE" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              </div>
              <div className="hidden sm:block">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={vsInternalData} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.12)" />
                  <XAxis dataKey="metric" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "rgba(8,8,16,0.95)", border: "1px solid rgba(144,141,206,0.22)", borderRadius: 8, fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="Vendor" fill="#ED00ED" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Internal" fill="#908DCE" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Trend Comparison</CardTitle></CardHeader>
          <CardContent className="px-2 pb-4 pt-2 sm:p-6">
            {isLoading ? <div className="h-40 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : (
              <>
              <div className="sm:hidden">
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={mobileVsInternalData} margin={{ top: 14, right: 8, left: 0, bottom: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.12)" />
                  <XAxis dataKey="metric" interval={0} tickMargin={8} tick={{ fontSize: 9 }} />
                  <YAxis width={34} tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "rgba(8,8,16,0.95)", border: "1px solid rgba(144,141,206,0.22)", borderRadius: 8, fontSize: 11 }} />
                  <Legend verticalAlign="bottom" height={28} wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
                  <Line type="monotone" dataKey="Vendor" stroke="#ED00ED" strokeWidth={2} dot={{ fill: "#ED00ED", r: 3 }} />
                  <Line type="monotone" dataKey="Internal" stroke="#908DCE" strokeWidth={2} dot={{ fill: "#908DCE", r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
              </div>
              <div className="hidden sm:block">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={vsInternalData} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.12)" />
                  <XAxis dataKey="metric" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "rgba(8,8,16,0.95)", border: "1px solid rgba(144,141,206,0.22)", borderRadius: 8, fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="Vendor" stroke="#ED00ED" strokeWidth={2} dot={{ fill: "#ED00ED", r: 3 }} />
                  <Line type="monotone" dataKey="Internal" stroke="#908DCE" strokeWidth={2} dot={{ fill: "#908DCE", r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
              </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Source", "Total", "Pass Rate", "Select Rate", "Join Rate", "Reject Rate"].map((h) => (
                    <th key={h} className="py-2.5 px-4 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "All Vendors", stats: allVendorStats },
                  { label: "Internal Hiring", stats: internalStats },
                ].map((row) => (
                  <tr key={row.label} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="py-2.5 px-4 font-semibold text-xs">{row.label}</td>
                    <td className="py-2.5 px-4 text-xs">{row.stats.total}</td>
                    <td className="py-2.5 px-4 text-xs text-emerald-500">{row.stats.screeningPassRate}%</td>
                    <td className="py-2.5 px-4 text-xs text-blue-500">{row.stats.selectionRate}%</td>
                    <td className="py-2.5 px-4 text-xs text-violet-500">{row.stats.joiningRate}%</td>
                    <td className="py-2.5 px-4 text-xs text-red-500">{row.stats.rejectionRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CandidateDrawer({ candidate, onClose }: { candidate: CandidateRow; onClose: () => void }) {
  const stages: CandidateStage[] = [
    "new_application", "source_tagged", "resume_uploaded", "resume_screening_pending",
    "resume_shortlisted", "evaluation_assigned", "evaluation_in_progress", "evaluation_passed",
    "selection_form_sent", "contract_sent", "contract_signed", "onboarding_completed",
  ];
  const currentIdx = stages.indexOf(candidate.currentStage);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-sm overflow-y-auto shadow-2xl"
        style={{ background: "rgba(8,8,16,0.98)", backdropFilter: "blur(24px)", border: "1px solid rgba(144,141,206,0.18)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b" style={{ background: "rgba(8,8,16,0.97)", borderColor: "rgba(144,141,206,0.14)" }}>
          <p className="font-semibold text-sm" style={{ color: "#C5CBE8" }}>Candidate Detail</p>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted/40 transition-colors">
            <X className="h-4 w-4" style={{ color: "rgba(197,203,232,0.60)" }} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12">
              <AvatarFallback className="text-sm font-bold bg-primary/10 text-primary">{getInitials(candidate.fullName)}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold" style={{ color: "#C5CBE8" }}>{candidate.fullName}</p>
              <p className="text-xs" style={{ color: "rgba(197,203,232,0.55)" }}>{candidate.position?.title ?? candidate.positionTitle ?? "Role not assigned"}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Submitted", val: timeAgo(candidate.createdAt) },
              { label: "Status", val: candidate.currentStatus },
              { label: "Source", val: "Vendor" },
              { label: "Score", val: candidate.resumeScore != null ? `${candidate.resumeScore}/100` : "—" },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border p-3" style={{ borderColor: "rgba(144,141,206,0.16)", background: "rgba(144,141,206,0.04)" }}>
                <p className="text-[10px] uppercase tracking-wide" style={{ color: "rgba(197,203,232,0.40)" }}>{item.label}</p>
                <p className="text-sm font-medium mt-0.5" style={{ color: "#C5CBE8" }}>{item.val}</p>
              </div>
            ))}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "rgba(197,203,232,0.40)" }}>Journey Timeline</p>
            <div className="space-y-0">
              {stages.map((stage, i) => {
                const done = i < currentIdx;
                const active = i === currentIdx;
                return (
                  <div key={stage} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div className={cn(
                        "h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                        done ? "bg-emerald-500 text-white" : active ? "bg-primary text-white" : "border"
                      )} style={!done && !active ? { borderColor: "rgba(144,141,206,0.22)", color: "rgba(197,203,232,0.30)" } : {}}>
                        {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                      </div>
                      {i < stages.length - 1 && (
                        <div className="w-px h-5 my-0.5" style={{ background: done ? "rgba(34,197,94,0.40)" : "rgba(144,141,206,0.14)" }} />
                      )}
                    </div>
                    <p className={cn("text-xs pb-3 mt-0.5", done ? "text-muted-foreground line-through" : active ? "font-semibold" : "text-muted-foreground")}
                      style={active ? { color: "#ED00ED" } : {}}>
                      {STAGE_LABELS[stage]}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border p-3" style={{ borderColor: "rgba(144,141,206,0.16)", background: "rgba(144,141,206,0.04)" }}>
            <p className="text-[10px] uppercase tracking-wide mb-2" style={{ color: "rgba(197,203,232,0.40)" }}>Current Stage</p>
            <span className={cn("text-xs px-2.5 py-1 rounded-full font-medium", STAGE_COLORS[candidate.currentStage] ?? "bg-muted text-muted-foreground")}>
              {STAGE_LABELS[candidate.currentStage] ?? formatLabel(candidate.currentStage)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function VendorFormFields({ form, onChange }: { form: VendorForm; onChange: (f: VendorForm) => void }) {
  return (
    <div className="space-y-4 mt-2">
      {[
        { label: "Company Name *", key: "name" as const, placeholder: "Acme Hiring Partners" },
        { label: "Contact Email *", key: "contactEmail" as const, placeholder: "hr@example.com" },
        { label: "Contact Phone", key: "contactPhone" as const, placeholder: "9876543000" },
      ].map((f) => (
        <div key={f.key} className="space-y-1.5">
          <Label className="text-sm">{f.label}</Label>
          <Input
            placeholder={f.placeholder}
            value={form[f.key]}
            onChange={(e) => onChange({ ...form, [f.key]: e.target.value })}
            className="rounded-xl"
          />
        </div>
      ))}
    </div>
  );
}
