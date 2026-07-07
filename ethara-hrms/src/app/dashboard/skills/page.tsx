"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Briefcase,
  Download,
  Loader2,
  Pencil,
  Search,
  Tags,
  Upload,
  Users,
  X,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StarRating } from "@/components/skills/star-rating";
import {
  skillsApi,
  type SkillBulkUploadResult,
  type SkillCatalogItem,
  type SkillTaggedEmployee,
} from "@/lib/api";
import { cn, getInitials } from "@/lib/utils";

const ALL = "__all__";

function SkillChips({ skills }: { skills: SkillTaggedEmployee["skills"] }) {
  if (skills.length === 0) {
    return <Badge variant="outline" className="text-[10px] text-muted-foreground">Untagged</Badge>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {skills.map((entry) => (
        <span
          key={entry.skill}
          className="flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary"
        >
          {entry.label}
          <StarRating value={entry.rating} size="sm" />
        </span>
      ))}
    </div>
  );
}

export default function SkillTagsPage() {
  const qc = useQueryClient();
  const [skillFilter, setSkillFilter] = useState(ALL);
  const [minRating, setMinRating] = useState(0);
  const [assignment, setAssignment] = useState<"all" | "assigned" | "unassigned">("all");
  const [search, setSearch] = useState("");
  const [editTarget, setEditTarget] = useState<SkillTaggedEmployee | null>(null);
  const [editSkills, setEditSkills] = useState<Record<string, number>>({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadResult, setUploadResult] = useState<SkillBulkUploadResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filters = useMemo(() => ({
    skill: skillFilter !== ALL ? skillFilter : undefined,
    minRating: minRating > 0 ? minRating : undefined,
    assignment,
    search: search.trim() || undefined,
  }), [skillFilter, minRating, assignment, search]);

  const { data: catalog = [] } = useQuery({
    queryKey: ["skills-catalog"],
    queryFn: () => skillsApi.catalog(),
    staleTime: 300_000,
  });

  const { data: employees = [], isLoading, isFetching } = useQuery({
    queryKey: ["skills-employees", filters],
    queryFn: () => skillsApi.employees(filters),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  const { data: allEmployees = [] } = useQuery({
    queryKey: ["skills-employees", { assignment: "all" }],
    queryFn: () => skillsApi.employees({ assignment: "all" }),
    staleTime: 30_000,
  });

  const tagged = allEmployees.filter((row) => row.skills.length > 0).length;
  const unassigned = allEmployees.filter((row) => !row.project).length;

  const saveMutation = useMutation({
    mutationFn: (payload: { id: string; skills: Array<{ skill: string; rating: number }> }) =>
      skillsApi.setEmployeeSkills(payload.id, payload.skills),
    onSuccess: () => {
      toast.success("Skill tags saved.");
      setEditTarget(null);
      void qc.invalidateQueries({ queryKey: ["skills-employees"] });
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not save skill tags.");
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => skillsApi.bulkUpload(file),
    onSuccess: (result) => {
      setUploadResult(result);
      toast.success(`Processed ${result.total} rows: ${result.created} created, ${result.updated} updated, ${result.rejected} rejected.`);
      void qc.invalidateQueries({ queryKey: ["skills-employees"] });
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Bulk upload failed.");
    },
  });

  const openEditor = (employee: SkillTaggedEmployee) => {
    const initial: Record<string, number> = {};
    employee.skills.forEach((entry) => { initial[entry.skill] = entry.rating; });
    setEditSkills(initial);
    setEditTarget(employee);
  };

  const handleSave = () => {
    if (!editTarget) return;
    const skills = Object.entries(editSkills)
      .filter(([, rating]) => rating > 0)
      .map(([skill, rating]) => ({ skill, rating }));
    saveMutation.mutate({ id: editTarget.employeeProfileId, skills });
  };

  const handleExport = async () => {
    try {
      await skillsApi.exportCsv(filters);
      toast.success("Skill tag export is ready.");
    } catch {
      toast.error("Export failed.");
    }
  };

  const metrics = [
    { label: "Employees", value: allEmployees.length, icon: Users },
    { label: "Tagged", value: tagged, icon: Tags },
    { label: "Untagged", value: Math.max(0, allEmployees.length - tagged), icon: Pencil },
    { label: "Not on a Project", value: unassigned, icon: Briefcase },
  ];

  return (
    <div className="space-y-4 overflow-x-hidden animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
            <Tags className="h-6 w-6 text-primary" />
            Skill Tags
          </h1>
          <p className="text-muted-foreground text-sm">
            Tag onboarded employees with rated skills and track project allocation from Resource Segregation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="rounded-xl text-xs gap-1.5" onClick={() => { setUploadResult(null); setUploadOpen(true); }}>
            <Upload className="h-3.5 w-3.5" /> Bulk Upload
          </Button>
          <Button variant="outline" size="sm" className="rounded-xl text-xs gap-1.5" onClick={() => void handleExport()}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label} className="border-0 shadow-sm">
            <CardContent className="flex items-center gap-3 p-4">
              <metric.icon className="h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-xl font-bold">{isLoading ? "—" : metric.value}</p>
                <p className="text-xs text-muted-foreground">{metric.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Employees ({employees.length})</CardTitle>
              <CardDescription>Filter by skill tag, star rating, and project allocation</CardDescription>
            </div>
            {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-[180px_auto_190px_minmax(220px,1fr)]">
            <Select value={skillFilter} onValueChange={(v) => setSkillFilter(v ?? ALL)}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="All skills">
                  {(value) => value === ALL ? "All skills" : catalog.find((c) => c.key === value)?.label ?? String(value ?? "")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All skills</SelectItem>
                {catalog.map((item: SkillCatalogItem) => (
                  <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex h-10 items-center gap-2 rounded-md border border-input px-3">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Min rating</span>
              <StarRating value={minRating} onChange={setMinRating} size="sm" />
              {minRating > 0 && (
                <button onClick={() => setMinRating(0)} aria-label="Clear rating filter">
                  <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>
            <Select value={assignment} onValueChange={(v) => setAssignment((v as typeof assignment) ?? "all")}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="All employees">
                  {(value) => value === "assigned" ? "On a project" : value === "unassigned" ? "Not assigned" : "All employees"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employees</SelectItem>
                <SelectItem value="assigned">On a project</SelectItem>
                <SelectItem value="unassigned">Not assigned</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, code, email, department"
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : employees.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-muted-foreground">
              <Users className="mb-2 h-8 w-8 opacity-30" />
              <p className="text-sm">No employees match these filters.</p>
            </div>
          ) : (
            employees.map((employee) => (
              <div
                key={employee.employeeProfileId}
                className="flex flex-col gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-muted/20 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3 lg:w-[320px] lg:shrink-0">
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {getInitials(employee.name ?? "?")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{employee.name ?? "Unnamed"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {employee.employeeCode ?? "—"}{employee.department ? ` · ${employee.department}` : ""}
                    </p>
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <SkillChips skills={employee.skills} />
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {employee.project ? (
                    <Badge variant="outline" className="border-success/30 text-[10px] text-success">
                      {employee.project.name ?? "On a project"}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-warning/30 text-[10px] text-warning">
                      Not assigned
                    </Badge>
                  )}
                  <Button variant="outline" size="sm" className="rounded-xl text-xs gap-1" onClick={() => openEditor(employee)}>
                    <Pencil className="h-3 w-3" /> Tags
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={editTarget !== null} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Skill tags — {editTarget?.name ?? ""}</DialogTitle>
            <DialogDescription>
              Rate each relevant skill out of 5 stars. Click a star again to remove the tag.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {catalog.map((item) => (
              <div key={item.key} className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
                <span className={cn("text-sm font-medium", (editSkills[item.key] ?? 0) === 0 && "text-muted-foreground")}>
                  {item.label}
                </span>
                <StarRating
                  value={editSkills[item.key] ?? 0}
                  onChange={(value) => setEditSkills((prev) => ({ ...prev, [item.key]: value }))}
                />
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" className="rounded-xl text-xs" onClick={() => setEditTarget(null)}>Cancel</Button>
              <Button className="rounded-xl text-xs" disabled={saveMutation.isPending} onClick={handleSave}>
                {saveMutation.isPending ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Saving…</> : "Save Tags"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Bulk upload skill tags</DialogTitle>
            <DialogDescription>
              Upload a CSV with one row per employee-skill. Identify each employee by Employee Code or Email — either column is enough.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left">
                    {["Employee Code", "Email", "Skill", "Rating"].map((header) => (
                      <th key={header} className="px-3 py-2 font-semibold">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <td className="px-3 py-1.5">GRP1001</td><td className="px-3 py-1.5"></td><td className="px-3 py-1.5">Python</td><td className="px-3 py-1.5">4</td>
                  </tr>
                  <tr className="border-b border-border/60">
                    <td className="px-3 py-1.5">GRP1001</td><td className="px-3 py-1.5"></td><td className="px-3 py-1.5">Git</td><td className="px-3 py-1.5">3</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-1.5"></td><td className="px-3 py-1.5">employee@ethara.ai</td><td className="px-3 py-1.5">Docker</td><td className="px-3 py-1.5">5</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Skills: Python, Git, Docker, Generalist · Rating: 1–5 · Existing tags are updated, new ones created.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="rounded-xl text-xs gap-1.5" onClick={() => void skillsApi.downloadTemplate()}>
                <Download className="h-3.5 w-3.5" /> Download template
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadMutation.mutate(file);
                  e.target.value = "";
                }}
              />
              <Button size="sm" className="rounded-xl text-xs gap-1.5" disabled={uploadMutation.isPending} onClick={() => fileInputRef.current?.click()}>
                {uploadMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Choose CSV & Upload
              </Button>
            </div>
            {uploadResult && (
              <div className="space-y-2 rounded-xl border border-border p-3">
                <p className="text-xs font-semibold">
                  {uploadResult.created} created · {uploadResult.updated} updated ·{" "}
                  <span className={cn(uploadResult.rejected > 0 && "text-destructive")}>{uploadResult.rejected} rejected</span>
                </p>
                {uploadResult.results.filter((r) => r.status === "rejected").slice(0, 8).map((r) => (
                  <p key={`${r.row}-${r.skill}`} className="text-[11px] text-destructive">
                    Row {r.row} ({r.identifier}): {r.reason}
                  </p>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
