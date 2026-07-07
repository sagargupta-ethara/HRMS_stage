"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatDateTime, formatLabel, timeAgo } from "@/lib/utils";
import { Briefcase, MapPin, Plus, Search, Edit2, CheckCircle2, XCircle, Flame, Loader2, Eye, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { employeesApi, positionsApi } from "@/lib/api";
import { formatDropdownOptionLabel, resolveEmployeeReferenceLabel } from "@/lib/employee-profile-options";

const DEPARTMENTS = [
  "Engineering",
  "Product",
  "Design",
  "Data & AI",
  "Infrastructure",
  "QA",
  "Operations - Technical",
  "Operations - Generalist",
  "Finance",
  "HR",
];

function mergePositionDepartmentOptions(
  dynamicOptions: string[] | null | undefined = [],
  currentValue?: string,
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const raw of [currentValue, ...(dynamicOptions ?? []), ...DEPARTMENTS]) {
    const value = (raw ?? "").trim();
    if (!value || value.toLowerCase() === "others") continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
  }
  return merged;
}
const WORK_MODES = ["Hybrid", "Remote", "On-site"];
const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Internship"];
const EXPERIENCE_LEVELS = [
  "Fresher (0-1 yr)",
  "Entry level (1-2 yrs)",
  "Associate (2-3 yrs)",
  "Mid level (3-5 yrs)",
  "Senior (5-8 yrs)",
  "Lead/Principal (8-12 yrs)",
  "Director-Sr.Director (12+ yrs)",
];
const EXPERIENCE_BRACKETS = [
  { value: "0", label: "0-1" },
  { value: "1", label: "1-2" },
  { value: "2", label: "2-3" },
  { value: "3", label: "3-5" },
  { value: "5", label: "5-8" },
  { value: "8", label: "8-12" },
  { value: "12", label: "12-15" },
  { value: "15", label: "15+" },
];
const URGENCY_OPTIONS = [
  { value: 3, label: "P0", description: "Critical" },
  { value: 2, label: "P1", description: "High" },
  { value: 1, label: "P2", description: "Normal" },
];
const HOW_WE_HIRE_STEPS = [
  { title: "Apply Online", description: "Fill in your details and submit your resume." },
  { title: "Recruiter Call", description: "A 30-min intro call to discuss fit and expectations." },
  { title: "Technical Round", description: "Skill-based evaluation tailored to the role." },
  { title: "Offer", description: "Fast turnaround with a clear, competitive package." },
];

function normalizeUrgencyLevel(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 2;
  if ((value ?? 0) >= 3) return 3;
  if ((value ?? 0) <= 1) return 1;
  return 2;
}

function urgencyLabel(value: number | null | undefined): string {
  return URGENCY_OPTIONS.find((option) => option.value === normalizeUrgencyLevel(value))?.label ?? "P1";
}

function urgencyOptionLabel(value: number | null | undefined): string {
  const option = URGENCY_OPTIONS.find((item) => item.value === normalizeUrgencyLevel(value));
  return option ? `${option.label} - ${option.description}` : "P1 - High";
}

function approvalStatusLabel(value: string | null | undefined): string {
  if (value === "pending_leadership_approval" || value === "pending_approval") return "Pending approval";
  return formatLabel(value ?? "pending_approval");
}

function isPendingApproval(value: string | null | undefined): boolean {
  return value === "pending_leadership_approval" || value === "pending_approval";
}

function normalizeExperienceLevel(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (EXPERIENCE_LEVELS.includes(raw)) return raw;
  const legacyMap: Record<string, string> = {
    Fresher: "Fresher (0-1 yr)",
    Junior: "Entry level (1-2 yrs)",
    "Mid-Senior": "Mid level (3-5 yrs)",
    Senior: "Senior (5-8 yrs)",
    Lead: "Lead/Principal (8-12 yrs)",
    Principal: "Lead/Principal (8-12 yrs)",
  };
  return legacyMap[raw] ?? "Mid level (3-5 yrs)";
}

function normalizeExperienceYears(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return EXPERIENCE_BRACKETS.reduce(
    (best, option) => (numeric >= Number(option.value) ? option.value : best),
    EXPERIENCE_BRACKETS[0].value
  );
}

function experienceYearsLabel(value: number | string | null | undefined): string {
  const normalized = normalizeExperienceYears(value);
  return EXPERIENCE_BRACKETS.find((option) => option.value === normalized)?.label ?? "";
}

function normalizePositionDepartment(value: string | null | undefined): string {
  if ((value ?? "").trim() === "Operations") return "Operations - Generalist";
  return value || "Engineering";
}

type Position = {
  id: string;
  title: string;
  slug?: string;
  department: string;
  urgencyLevel: number;
  isActive: boolean;
  candidateCount?: number;
  description?: string;
  summary?: string;
  location?: string;
  employmentType?: string;
  workMode?: string;
  experienceLevel?: string;
  experienceYears?: number | null;
  salaryBracket?: string | null;
  openings?: number;
  featured?: boolean;
  requirements?: string[];
  responsibilities?: string[];
  preferredSkills?: string[];
  screeningPrompt?: string;
  approvalStatus?: string;
  approvalRequestedAt?: string | null;
  approvalDecidedAt?: string | null;
  approvalRecipientEmail?: string | null;
  reviewedByEmail?: string | null;
  rejectionReason?: string | null;
  approvalEmailSentAt?: string | null;
  postedAt?: string | null;
  createdAt: string;
};

type FormState = {
  title: string;
  department: string;
  urgencyLevel: number;
  description: string;
  summary: string;
  location: string;
  employmentType: string;
  workMode: string;
  experienceLevel: string;
  experienceYears: string;
  salaryBracket: string;
  openings: number;
  featured: boolean;
  requirements: string;
  responsibilities: string;
  preferredSkills: string;
  screeningPrompt: string;
};

const BLANK_FORM: FormState = {
  title: "", department: "Engineering", urgencyLevel: 2,
  description: "", summary: "", location: "Bengaluru, India",
  employmentType: "Full-time", workMode: "Hybrid", experienceLevel: "Mid level (3-5 yrs)",
  experienceYears: "3", salaryBracket: "",
  openings: 1, featured: false,
  requirements: "", responsibilities: "", preferredSkills: "",
  screeningPrompt: "",
};

export default function PositionsConfigPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [open, setOpen] = useState(false);
  const [editingPositionId, setEditingPositionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewPosition, setPreviewPosition] = useState<Position | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Position | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [departmentOptions, setDepartmentOptions] = useState<string[]>(() =>
    mergePositionDepartmentOptions()
  );
  const [departmentOptionsLoading, setDepartmentOptionsLoading] = useState(false);

  const isEditing = editingPositionId !== null;

  const approvalTone = (statusValue?: string) => {
    switch (statusValue) {
      case "posted":
      case "approved":
        return "bg-emerald-100 text-emerald-700 border-emerald-200";
      case "rejected":
        return "bg-red-100 text-red-700 border-red-200";
      case "draft":
        return "bg-slate-100 text-slate-700 border-slate-200";
      default:
        return "bg-amber-100 text-amber-700 border-amber-200";
    }
  };

  const approvalMessage = (position: Position) => {
    if (position.approvalStatus === "posted" || position.approvalStatus === "approved") {
      return position.postedAt
        ? `Posted ${timeAgo(position.postedAt)}`
        : "Approved and ready";
    }
    if (position.approvalStatus === "rejected") {
      return position.rejectionReason?.trim()
        ? `Rejected: ${position.rejectionReason}`
        : "Rejected";
    }
    if (position.approvalStatus === "draft") {
      return "Draft saved";
    }
    if (position.approvalRequestedAt) {
      return `Approval requested ${timeAgo(position.approvalRequestedAt)}`;
    }
    return "Awaiting approval";
  };

  const buildPayload = (state: FormState) => ({
    title: state.title.trim(),
    department: state.department,
    urgencyLevel: normalizeUrgencyLevel(state.urgencyLevel),
    description: state.description.trim() || null,
    summary: state.summary.trim() || state.description.trim() || null,
    location: state.location.trim() || "Bengaluru, India",
    employmentType: state.employmentType,
    workMode: state.workMode,
    experienceLevel: normalizeExperienceLevel(state.experienceLevel),
    experienceYears: state.experienceYears.trim() ? Number(state.experienceYears) : null,
    salaryBracket: state.salaryBracket.trim() || null,
    openings: state.openings,
    featured: state.featured,
    isActive: true,
    requirements: state.requirements.split("\n").map((s) => s.trim()).filter(Boolean),
    responsibilities: state.responsibilities.split("\n").map((s) => s.trim()).filter(Boolean),
    preferredSkills: state.preferredSkills.split(",").map((s) => s.trim()).filter(Boolean),
    screeningPrompt: state.screeningPrompt.trim() || null,
  });

  const resetDialogState = () => {
    setForm(BLANK_FORM);
    setEditingPositionId(null);
    setOpen(false);
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setForm(BLANK_FORM);
      setEditingPositionId(null);
    }
  };

  const load = async () => {
    try {
      const data = await positionsApi.list();
      setPositions(Array.isArray(data) ? data : data.data ?? []);
    } catch {
      toast.error("Failed to load positions");
    } finally {
      setLoading(false);
    }
  };

  const loadDepartmentOptions = useCallback(async () => {
    setDepartmentOptionsLoading(true);
    try {
      const options = await employeesApi.referenceOptions();
      setDepartmentOptions(mergePositionDepartmentOptions(options.departments));
    } catch {
      setDepartmentOptions((current) => mergePositionDepartmentOptions(current));
    } finally {
      setDepartmentOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadInitial = async () => {
      try {
        const data = await positionsApi.list();
        if (!cancelled) {
          setPositions(Array.isArray(data) ? data : data.data ?? []);
        }
      } catch {
        if (!cancelled) {
          toast.error("Failed to load positions");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDepartmentOptions(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDepartmentOptions]);

  const filtered = positions.filter(
    (p) =>
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.department.toLowerCase().includes(search.toLowerCase())
  );

  const openCreateDialog = () => {
    setEditingPositionId(null);
    setForm(BLANK_FORM);
    void loadDepartmentOptions();
    setOpen(true);
  };

  const openEditDialog = (position: Position) => {
    setEditingPositionId(position.id);
    setForm({
      title: position.title,
      department: normalizePositionDepartment(position.department),
      urgencyLevel: normalizeUrgencyLevel(position.urgencyLevel),
      description: position.description ?? "",
      summary: position.summary ?? "",
      location: position.location ?? "Bengaluru, India",
      employmentType: position.employmentType ?? "Full-time",
      workMode: position.workMode ?? "Hybrid",
      experienceLevel: normalizeExperienceLevel(position.experienceLevel),
      experienceYears: normalizeExperienceYears(position.experienceYears),
      salaryBracket: position.salaryBracket ?? "",
      openings: position.openings ?? 1,
      featured: position.featured ?? false,
      requirements: (position.requirements ?? []).join("\n"),
      responsibilities: (position.responsibilities ?? []).join("\n"),
      preferredSkills: (position.preferredSkills ?? []).join(", "),
      screeningPrompt: position.screeningPrompt ?? "",
    });
    setDepartmentOptions((current) =>
      mergePositionDepartmentOptions(current, normalizePositionDepartment(position.department))
    );
    void loadDepartmentOptions();
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    if (form.experienceYears.trim() && !EXPERIENCE_BRACKETS.some((option) => option.value === form.experienceYears)) {
      toast.error("Please select a valid experience bracket");
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload(form);
      if (editingPositionId) {
        await positionsApi.update(editingPositionId, payload);
        toast.success("JD updated and sent for approval");
      } else {
        await positionsApi.create(payload);
        toast.success("JD created and sent for approval");
      }
      resetDialogState();
      void load();
    } catch {
      toast.error(isEditing ? "Failed to update position" : "Failed to create position");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: string, current: boolean) => {
    try {
      const updated = await positionsApi.toggleActive(id, !current);
      setPositions((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...updated } : p))
      );
      toast.success(current ? "Position deactivated" : "Activation sent for approval");
    } catch {
      toast.error("Failed to update position");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await positionsApi.delete(deleteTarget.id);
      setPositions((prev) => prev.filter((position) => position.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success("JD deleted");
      void load();
    } catch {
      toast.error("Failed to delete JD");
    } finally {
      setDeleting(false);
    }
  };

  const urgencyColors: Record<number, string> = {
    1: "text-slate-400",
    2: "text-amber-500",
    3: "text-red-500",
  };
  const sectionClassName = "rounded-2xl border border-border/60 bg-muted/20 p-4 sm:p-5";
  const fieldClassName = "space-y-2";
  const inputClassName = "rounded-xl";
  const textareaClassName = "rounded-xl";
  const selectClassName = "h-11 w-full rounded-xl border border-input bg-background px-3 text-sm";
  const visibleDepartmentOptions = mergePositionDepartmentOptions(departmentOptions, form.department);
  const renderPreviewList = (items: string[] | undefined, emptyText: string) => {
    const cleanItems = (items ?? []).filter(Boolean);
    if (!cleanItems.length) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
    return (
      <ul className="space-y-2 text-sm text-muted-foreground">
        {cleanItems.map((item, index) => (
          <li key={`${item}-${index}`} className="flex gap-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="min-w-0 whitespace-pre-wrap break-words">{item}</span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="space-y-6 overflow-x-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5">
            <Briefcase className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Job Positions</h1>
            <p className="text-sm text-muted-foreground">{positions.length} total positions</p>
          </div>
        </div>

        <Dialog open={open} onOpenChange={handleDialogOpenChange}>
          <Button size="sm" className="w-fit rounded-xl gap-1.5 sm:w-auto" onClick={openCreateDialog}>
            <Plus className="h-4 w-4" /> Add Position
          </Button>
          <DialogContent className="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-4xl">
            <DialogHeader className="border-b border-border/60 px-6 py-5 pr-14">
              <DialogTitle className="text-lg">{isEditing ? "Edit Position" : "Create New Position"}</DialogTitle>
              <DialogDescription>
                Capture the essentials, hiring context, and screening notes in a layout that is easier to scan.
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
              <section className={sectionClassName}>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">Role basics</h3>
                  <p className="text-xs text-muted-foreground">
                    Start with the information recruiters and candidates will notice first.
                  </p>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className={fieldClassName}>
                    <Label>Job Title *</Label>
                    <Input
                      className={inputClassName}
                      value={form.title}
                      onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                      placeholder="e.g. Senior Frontend Developer"
                    />
                  </div>
                  <div className={fieldClassName}>
                    <Label>Department *</Label>
                    <Select
                      value={form.department}
                      onValueChange={(v) => setForm((f) => ({ ...f, department: v ?? "" }))}
                      onOpenChange={(nextOpen) => {
                        if (nextOpen) void loadDepartmentOptions();
                      }}
                    >
                      <SelectTrigger className={selectClassName}>
                        <SelectValue placeholder="Select department">
                          {(value) => resolveEmployeeReferenceLabel(value as string) || "Select department"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {departmentOptionsLoading && (
                          <SelectItem value="__loading_departments__" disabled>
                            Loading latest departments...
                          </SelectItem>
                        )}
                        {visibleDepartmentOptions.map((department) => (
                          <SelectItem key={department} value={department}>
                            {formatDropdownOptionLabel(department)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className={cn(fieldClassName, "md:col-span-2")}>
                    <Label>Summary</Label>
                    <Input
                      className={inputClassName}
                      value={form.summary}
                      onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
                      placeholder="Short role summary for the careers page"
                    />
                  </div>
                  <div className={cn(fieldClassName, "md:col-span-2")}>
                    <Label>Description</Label>
                    <Textarea
                      rows={4}
                      className={textareaClassName}
                      value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                      placeholder="Detailed role description..."
                    />
                  </div>
                </div>
              </section>

              <div className="grid gap-5 xl:grid-cols-2">
                <section className={sectionClassName}>
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-foreground">Role details</h3>
                    <p className="text-xs text-muted-foreground">
                      Clarify where the role sits and what experience profile you are hiring for.
                    </p>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className={cn(fieldClassName, "md:col-span-2")}>
                      <Label>Location</Label>
                      <Input
                        className={inputClassName}
                        value={form.location}
                        onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                        placeholder="Bengaluru, India"
                      />
                    </div>
                    <div className={fieldClassName}>
                      <Label>Employment Type</Label>
                      <Select value={form.employmentType} onValueChange={(v) => setForm((f) => ({ ...f, employmentType: v ?? "" }))}>
                        <SelectTrigger className={selectClassName}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EMPLOYMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className={fieldClassName}>
                      <Label>Work Mode</Label>
                      <Select value={form.workMode} onValueChange={(v) => setForm((f) => ({ ...f, workMode: v ?? "" }))}>
                        <SelectTrigger className={selectClassName}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WORK_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className={fieldClassName}>
                      <Label>Experience Level</Label>
                      <Select value={form.experienceLevel} onValueChange={(v) => setForm((f) => ({ ...f, experienceLevel: v ?? "" }))}>
                        <SelectTrigger className={selectClassName}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EXPERIENCE_LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className={fieldClassName}>
                      <Label>Experience</Label>
                      <Select value={form.experienceYears} onValueChange={(v) => setForm((f) => ({ ...f, experienceYears: v ?? "" }))}>
                        <SelectTrigger className={selectClassName}>
                          <SelectValue placeholder="Select bracket" />
                        </SelectTrigger>
                        <SelectContent>
                          {EXPERIENCE_BRACKETS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </section>

                <section className={sectionClassName}>
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-foreground">Hiring settings</h3>
                    <p className="text-xs text-muted-foreground">
                      Add the internal details that help the team prioritize the opening.
                    </p>
                  </div>

                  <div className="mt-4 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className={fieldClassName}>
                        <Label>Openings</Label>
                        <Input
                          className={inputClassName}
                          type="number"
                          min={1}
                          value={form.openings}
                          onChange={(e) => setForm((f) => ({ ...f, openings: parseInt(e.target.value) || 1 }))}
                        />
                      </div>
                      <div className={fieldClassName}>
                        <Label>Urgency Level</Label>
                        <Select
                          value={String(normalizeUrgencyLevel(form.urgencyLevel))}
                          onValueChange={(value) => setForm((f) => ({ ...f, urgencyLevel: Number(value) || 2 }))}
                        >
                          <SelectTrigger className={selectClassName}>
                            <span className="flex flex-1 text-left">{urgencyOptionLabel(form.urgencyLevel)}</span>
                          </SelectTrigger>
                          <SelectContent>
                            {URGENCY_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={String(option.value)}>
                                {option.label} - {option.description}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className={fieldClassName}>
                      <Label>Salary Bracket</Label>
                      <Input
                        className={inputClassName}
                        value={form.salaryBracket}
                        onChange={(e) => setForm((f) => ({ ...f, salaryBracket: e.target.value }))}
                        placeholder="Rs18 LPA - Rs24 LPA"
                      />
                    </div>
                    <div className="rounded-xl border border-dashed border-border/80 bg-background/80 px-4 py-3">
                      <label htmlFor="featured" className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          id="featured"
                          checked={form.featured}
                          onChange={(e) => setForm((f) => ({ ...f, featured: e.target.checked }))}
                          className="mt-0.5 h-4 w-4 rounded"
                        />
                        <span className="space-y-1">
                          <span className="block text-sm font-medium text-foreground">Featured opening</span>
                          <span className="block text-xs text-muted-foreground">
                            Show this position more prominently on the careers page.
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>
                </section>
              </div>

              <section className={sectionClassName}>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">Success profile</h3>
                  <p className="text-xs text-muted-foreground">
                    Outline what the person needs to bring and what they will own after joining.
                  </p>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  <div className={fieldClassName}>
                    <Label>Required Skill Set (one per line)</Label>
                    <Textarea
                      rows={5}
                      className={textareaClassName}
                      value={form.requirements}
                      onChange={(e) => setForm((f) => ({ ...f, requirements: e.target.value }))}
                      placeholder={"3+ years of React experience\nStrong TypeScript skills\nExperience with REST APIs"}
                    />
                  </div>
                  <div className={fieldClassName}>
                    <Label>Key Job Responsibilities (one per line)</Label>
                    <Textarea
                      rows={5}
                      className={textareaClassName}
                      value={form.responsibilities}
                      onChange={(e) => setForm((f) => ({ ...f, responsibilities: e.target.value }))}
                      placeholder={"Build and maintain React components\nWork with backend engineers\nCode reviews and mentoring"}
                    />
                  </div>
                  <div className={cn(fieldClassName, "xl:col-span-2")}>
                    <Label>Additional Skill Keywords (comma separated)</Label>
                    <Input
                      className={inputClassName}
                      value={form.preferredSkills}
                      onChange={(e) => setForm((f) => ({ ...f, preferredSkills: e.target.value }))}
                      placeholder="React, TypeScript, Next.js, GraphQL"
                    />
                  </div>
                </div>
              </section>

              <section className={sectionClassName}>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">AI screening guidance</h3>
                  <p className="text-xs text-muted-foreground">
                    Give the screening workflow a clear brief so the first pass stays consistent.
                  </p>
                </div>

                <div className="mt-4 space-y-2">
                  <Label>LLM Screening Prompt</Label>
                  <Textarea
                    rows={5}
                    className={textareaClassName}
                    value={form.screeningPrompt}
                    onChange={(e) => setForm((f) => ({ ...f, screeningPrompt: e.target.value }))}
                    placeholder="Describe how to evaluate candidates for this role. E.g.: 'Shortlist candidates with strong React/TypeScript experience and 3+ years. Reject candidates without frontend experience. Look for problem-solving ability and system design understanding.'"
                  />
                  <p className="text-xs text-muted-foreground">
                    This prompt guides the AI when screening resumes for this position.
                  </p>
                </div>
              </section>

              <div className="flex flex-col-reverse gap-2 border-t border-border/60 bg-background/80 px-0 pt-5 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={resetDialogState}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      {isEditing ? "Sending…" : "Sending…"}
                    </>
                  ) : (
                    isEditing ? "Save & Resend for Approval" : "Create & Send for Approval"
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={!!previewPosition} onOpenChange={(nextOpen) => !nextOpen && setPreviewPosition(null)}>
        <DialogContent className="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="border-b border-border/60 px-6 py-5 pr-14">
            <DialogTitle className="text-lg">View JD</DialogTitle>
            <DialogDescription>
              Preview the candidate-facing role details before publishing or approval.
            </DialogDescription>
          </DialogHeader>
          {previewPosition && (
            <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
              <section className={sectionClassName}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="break-words text-xl font-bold">{previewPosition.title}</h2>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline">{previewPosition.department}</Badge>
                      <Badge variant="outline">{urgencyOptionLabel(previewPosition.urgencyLevel)}</Badge>
                      <Badge variant="outline" className={cn("border", approvalTone(previewPosition.approvalStatus))}>
                        {approvalStatusLabel(previewPosition.approvalStatus)}
                      </Badge>
                    </div>
                  </div>
                  {previewPosition.featured && (
                    <Badge className="w-fit bg-amber-100 text-amber-700 border-amber-200">Featured</Badge>
                  )}
                </div>
                {previewPosition.summary && (
                  <p className="mt-4 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    {previewPosition.summary}
                  </p>
                )}
              </section>

              <section className={sectionClassName}>
                <h3 className="text-sm font-semibold text-foreground">Description</h3>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                  {previewPosition.description || "No detailed description added yet."}
                </p>
              </section>

              <section className={sectionClassName}>
                <h3 className="text-sm font-semibold text-foreground">Role Details</h3>
                <div className="mt-4 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
                  <span><strong className="text-foreground">Location:</strong> {previewPosition.location || "Not added"}</span>
                  <span><strong className="text-foreground">Type:</strong> {previewPosition.employmentType || "Not added"}</span>
                  <span><strong className="text-foreground">Work Mode:</strong> {previewPosition.workMode || "Not added"}</span>
                  <span><strong className="text-foreground">Experience Level:</strong> {previewPosition.experienceLevel || "Not added"}</span>
                  <span><strong className="text-foreground">Experience:</strong> {experienceYearsLabel(previewPosition.experienceYears) || "Not added"}</span>
                  <span><strong className="text-foreground">Openings:</strong> {previewPosition.openings ?? 1}</span>
                  <span className="sm:col-span-2"><strong className="text-foreground">Salary:</strong> {previewPosition.salaryBracket || "Not added"}</span>
                </div>
              </section>

              <div className="grid gap-5 xl:grid-cols-2">
                <section className={sectionClassName}>
                  <h3 className="text-sm font-semibold text-foreground">Required Skill Set</h3>
                  <div className="mt-3">{renderPreviewList(previewPosition.requirements, "No required skills added yet.")}</div>
                </section>
                <section className={sectionClassName}>
                  <h3 className="text-sm font-semibold text-foreground">Key Job Responsibilities</h3>
                  <div className="mt-3">{renderPreviewList(previewPosition.responsibilities, "No responsibilities added yet.")}</div>
                </section>
              </div>

              <section className={sectionClassName}>
                <h3 className="text-sm font-semibold text-foreground">Additional Skill Keywords</h3>
                {(previewPosition.preferredSkills ?? []).filter(Boolean).length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(previewPosition.preferredSkills ?? []).filter(Boolean).map((skill) => (
                      <Badge key={skill} variant="outline">{skill}</Badge>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">No additional skill keywords added yet.</p>
                )}
              </section>

              <section className={sectionClassName}>
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">How We Hire</h3>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {HOW_WE_HIRE_STEPS.map((step, index) => (
                    <div key={step.title} className="rounded-xl border border-border/70 bg-background/70 p-4">
                      <div className="flex gap-3">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-primary/40 text-xs font-bold text-primary">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">{step.title}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete JD</DialogTitle>
            <DialogDescription>
              This removes the JD from the positions list and careers page while keeping linked candidate history intact.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
              <p className="font-medium text-foreground">{deleteTarget.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{deleteTarget.department}</p>
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete JD
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search positions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 rounded-xl"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((position) => (
            <Card key={position.id} className={cn("border-0 shadow-sm transition-all", !position.isActive && "opacity-60")}>
              <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <h3 className="break-words text-sm font-semibold sm:truncate">{position.title}</h3>
                    <Badge variant="outline" className="text-[10px]">{position.department}</Badge>
                    {position.featured && (
                      <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-200">Featured</Badge>
                    )}
                    <Badge
                      variant={position.isActive ? "default" : "secondary"}
                      className="text-[10px]"
                    >
                      {position.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <Badge variant="outline" className={cn("text-[10px] border", approvalTone(position.approvalStatus))}>
                      {approvalStatusLabel(position.approvalStatus)}
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:mt-1 sm:flex sm:flex-wrap sm:items-center sm:gap-4">
                    <span className="col-span-2 break-words sm:col-auto">{approvalMessage(position)}</span>
                    {position.location && <span className="inline-flex min-w-0 items-start gap-1 break-words sm:items-center"><MapPin className="mt-0.5 h-3 w-3 shrink-0 sm:mt-0" />{position.location}</span>}
                    {position.workMode && <span>{position.workMode}</span>}
                    {position.experienceYears != null && <span>{experienceYearsLabel(position.experienceYears)}</span>}
                    {position.salaryBracket && <span className="break-words">{position.salaryBracket}</span>}
                    {position.openings && <span>{position.openings} opening{position.openings !== 1 ? "s" : ""}</span>}
                    {position.candidateCount !== undefined && (
                      <span>{position.candidateCount} candidate{position.candidateCount !== 1 ? "s" : ""}</span>
                    )}
                  </div>
                  {(position.description || position.summary) && (
                    <p className="mt-3 line-clamp-2 text-xs text-muted-foreground sm:mt-1 sm:line-clamp-1">
                      {position.description || position.summary}
                    </p>
                  )}
                  {position.approvalDecidedAt && (
                    <p className="mt-2 text-[11px] text-muted-foreground sm:mt-1">
                      Last decision: {formatDateTime(position.approvalDecidedAt)}
                    </p>
                  )}
                </div>

                <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:items-center">
                  <div className={cn("flex items-center gap-1 text-xs font-medium sm:justify-start", urgencyColors[normalizeUrgencyLevel(position.urgencyLevel)] || "text-slate-400")}>
                    <Flame className="h-3.5 w-3.5" />
                    {urgencyLabel(position.urgencyLevel)}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 rounded-lg text-xs sm:h-7"
                    onClick={() => setPreviewPosition(position)}
                  >
                    <Eye className="h-3.5 w-3.5 mr-1" />View JD
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 rounded-lg text-xs sm:h-7"
                    onClick={() => openEditDialog(position)}
                  >
                    <Edit2 className="h-3.5 w-3.5 mr-1" />Edit JD
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 rounded-lg text-xs sm:h-7"
                    onClick={() => handleToggle(position.id, position.isActive)}
                    disabled={!position.isActive && isPendingApproval(position.approvalStatus)}
                  >
                    {position.isActive ? (
                      <><XCircle className="h-3.5 w-3.5 mr-1 text-destructive" />Deactivate</>
                    ) : isPendingApproval(position.approvalStatus) ? (
                      <><Loader2 className="h-3.5 w-3.5 mr-1" />Approval Pending</>
                    ) : (
                      <><CheckCircle2 className="h-3.5 w-3.5 mr-1 text-green-500" />Activate</>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 rounded-lg text-xs text-destructive hover:text-destructive sm:h-7"
                    onClick={() => setDeleteTarget(position)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />Delete JD
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          {filtered.length === 0 && !loading && (
            <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              {search ? "No positions matched your search." : "No positions yet. Create your first one."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
