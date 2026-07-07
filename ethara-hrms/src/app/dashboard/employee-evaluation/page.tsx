"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Download, Loader2, Search, SlidersHorizontal, Star, Upload, Users, X } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StarRating } from "@/components/skills/star-rating";
import {
  downloadBlob,
  employeeEvaluationApi,
  skillsApi,
  type EmployeeEvaluationBulkResult,
  type EmployeeEvaluationFilters,
  type EmployeeSkillEntry,
  type SkillCatalogItem,
} from "@/lib/api";
import { cn, formatLabel, getInitials } from "@/lib/utils";

const ANY = "__any__";

const VERDICT_OPTIONS = [
  { value: "pass", label: "Pass" },
  { value: "fail", label: "Fail" },
];

// When a skill filter is active, show that skill's rating (read-only) per row.
function RowSkillRating({ skills, skillKey, label }: { skills?: EmployeeSkillEntry[]; skillKey: string; label: string }) {
  const entry = skills?.find((s) => s.skill === skillKey);
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
      {entry?.label ?? label}
      {entry ? (
        <StarRating value={entry.rating} size="sm" />
      ) : (
        <span className="text-[10px] font-normal text-muted-foreground">Not tagged</span>
      )}
    </span>
  );
}

function verdictBadgeClasses(verdict: string | null | undefined) {
  switch (verdict) {
    case "strong":
    case "pass":
      return "border-success/30 bg-success/10 text-success";
    case "solid":
      return "border-info/30 bg-info/10 text-info";
    case "developing":
      return "border-warning/30 bg-warning/10 text-warning";
    case "at_risk":
    case "fail":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    default:
      return "border-border text-muted-foreground";
  }
}

export default function EmployeeEvaluationListPage() {
  const router = useRouter();
  const qc = useQueryClient();

  // Primary filters
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [verdict, setVerdict] = useState(ANY);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [minRating, setMinRating] = useState(0);

  // Advanced filters
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [designation, setDesignation] = useState("");
  const [assessmentVerdict, setAssessmentVerdict] = useState("");
  const [piVerdict, setPiVerdict] = useState("");
  const [hasSkills, setHasSkills] = useState(ANY);

  const [exporting, setExporting] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadResult, setUploadResult] = useState<EmployeeEvaluationBulkResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filters: EmployeeEvaluationFilters = useMemo(() => ({
    search: search.trim() || undefined,
    department: department.trim() || undefined,
    designation: designation.trim() || undefined,
    verdict: verdict !== ANY ? verdict : undefined,
    assessmentVerdict: assessmentVerdict.trim() || undefined,
    piVerdict: piVerdict.trim() || undefined,
    // Comma-separated list — the backend matches employees having ANY of them.
    skill: selectedSkills.length > 0 ? selectedSkills.join(",") : undefined,
    minRating: minRating > 0 ? minRating : undefined,
    hasSkills: hasSkills === ANY ? undefined : hasSkills === "yes",
  }), [search, department, designation, verdict, assessmentVerdict, piVerdict, selectedSkills, minRating, hasSkills]);

  const advancedActive =
    designation.trim() !== "" ||
    assessmentVerdict.trim() !== "" ||
    piVerdict.trim() !== "" ||
    hasSkills !== ANY;

  const { data: catalog = [] } = useQuery({
    queryKey: ["skills-catalog"],
    queryFn: () => skillsApi.catalog(),
    staleTime: 300_000,
  });

  const skillLabelFor = (key: string) =>
    catalog.find((c) => c.key === key)?.label ?? formatLabel(key);

  const toggleSkill = (key: string, checked: boolean) => {
    setSelectedSkills((prev) =>
      checked ? (prev.includes(key) ? prev : [...prev, key]) : prev.filter((k) => k !== key),
    );
  };

  const { data: employees = [], isLoading, isFetching } = useQuery({
    queryKey: ["employee-evaluation", "employees", filters],
    queryFn: () => employeeEvaluationApi.listEmployees(filters),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => employeeEvaluationApi.bulkUpload(file),
    onSuccess: (result) => {
      setUploadResult(result);
      downloadBlob(result.blob, `employee_evaluation_results_${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success(`Updated ${result.updated}, Failed ${result.failed}.`);
      void qc.invalidateQueries({ queryKey: ["employee-evaluation", "employees"] });
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as Error)?.message;
      toast.error(detail || "Bulk update failed.");
    },
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await employeeEvaluationApi.exportEmployees(filters);
      downloadBlob(blob, "employee_evaluation_export.csv");
      toast.success("Export ready.");
    } catch {
      toast.error("Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const clearAdvanced = () => {
    setDesignation("");
    setAssessmentVerdict("");
    setPiVerdict("");
    setHasSkills(ANY);
  };

  return (
    <div className="space-y-4 overflow-x-hidden animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
            <Star className="h-6 w-6 text-primary" />
            Employee Evaluation
          </h1>
          <p className="text-muted-foreground text-sm">
            Review each employee&apos;s evaluation signals — assessment, PI, PMS and skills.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl text-xs gap-1.5"
            disabled={exporting}
            onClick={() => void handleExport()}
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl text-xs gap-1.5"
            onClick={() => { setUploadResult(null); setUploadOpen(true); }}
          >
            <Upload className="h-3.5 w-3.5" /> Bulk Update Scores
          </Button>
        </div>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Employees ({employees.length})</CardTitle>
              <CardDescription>Search, filter, and open an employee to review their evaluation</CardDescription>
            </div>
            {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {/* Primary filters: search takes the remaining width; the four controls
              share equal widths on one desktop row and stack in pairs below xl. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_repeat(4,minmax(150px,175px))]">
            <div className="relative sm:col-span-2 xl:col-span-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, code, department"
                className="h-10 pl-9"
              />
            </div>
            <Input
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="Department"
              className="h-10"
            />
            <Select value={verdict} onValueChange={(v) => setVerdict(v ?? ANY)}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="Any verdict">
                  {(value) => value === ANY ? "Any verdict" : VERDICT_OPTIONS.find((o) => o.value === value)?.label ?? formatLabel(String(value ?? ""))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any verdict</SelectItem>
                {VERDICT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    className="h-10 w-full justify-between rounded-lg px-3 text-sm font-normal"
                  />
                }
              >
                <span className={cn(selectedSkills.length === 0 && "text-muted-foreground")}>
                  {selectedSkills.length > 0 ? `Skills (${selectedSkills.length})` : "Skills"}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto rounded-xl">
                {catalog.map((item: SkillCatalogItem) => (
                  <DropdownMenuCheckboxItem
                    key={item.key}
                    checked={selectedSkills.includes(item.key)}
                    onCheckedChange={(checked) => toggleSkill(item.key, checked)}
                    className="text-xs"
                  >
                    {item.label}
                  </DropdownMenuCheckboxItem>
                ))}
                {selectedSkills.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="justify-center text-xs text-muted-foreground"
                      onClick={() => setSelectedSkills([])}
                    >
                      Clear selection
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input px-3 dark:bg-input/30">
              <span className="whitespace-nowrap text-xs text-muted-foreground">Min rating</span>
              <span className="flex items-center gap-1.5">
                <StarRating value={minRating} onChange={setMinRating} size="sm" />
                {minRating > 0 && (
                  <button type="button" onClick={() => setMinRating(0)} aria-label="Clear rating filter">
                    <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                  </button>
                )}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-xl text-xs gap-1.5"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Advanced filters
              {advancedActive && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
            </Button>
            {advancedActive && (
              <Button variant="ghost" size="sm" className="rounded-xl text-xs text-muted-foreground" onClick={clearAdvanced}>
                Clear
              </Button>
            )}
          </div>

          {showAdvanced && (
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-muted/20 p-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Designation</Label>
                <Input className="h-10" value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Engineer" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Assessment verdict</Label>
                <Input className="h-10" value={assessmentVerdict} onChange={(e) => setAssessmentVerdict(e.target.value)} placeholder="e.g. passed" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">PI verdict</Label>
                <Input className="h-10" value={piVerdict} onChange={(e) => setPiVerdict(e.target.value)} placeholder="e.g. selected" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Has skills</Label>
                <Select value={hasSkills} onValueChange={(v) => setHasSkills(v ?? ANY)}>
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue placeholder="Any">
                      {(value) => value === "yes" ? "Yes" : value === "no" ? "No" : "Any"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Any</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
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
              <button
                key={employee.id}
                type="button"
                onClick={() => router.push(`/dashboard/employee-evaluation/${employee.id}`)}
                className="flex w-full flex-col gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-muted/20 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3 lg:w-[340px] lg:shrink-0">
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {getInitials(employee.name ?? "?")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{employee.name ?? "Unnamed"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {employee.employeeCode ?? "—"}
                      {employee.department ? ` · ${employee.department}` : ""}
                      {employee.designation ? ` · ${employee.designation}` : ""}
                    </p>
                  </div>
                </div>
                {/* Right cluster: skill pills flow on the left; the Assess /
                    verdict / skill-count slots have fixed widths so badges line
                    up column-wise across rows. */}
                <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:shrink-0 lg:flex-nowrap lg:justify-end">
                  {selectedSkills.length > 0 && (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {selectedSkills.map((key) => (
                        <RowSkillRating key={key} skills={employee.skills} skillKey={key} label={skillLabelFor(key)} />
                      ))}
                    </span>
                  )}
                  <span
                    className={cn(
                      "inline-flex min-w-[74px] shrink-0 justify-end text-[11px] text-muted-foreground",
                      employee.assessmentScore === null && "invisible",
                    )}
                    aria-hidden={employee.assessmentScore === null}
                  >
                    Assess:&nbsp;
                    <span className="font-semibold text-foreground">{employee.assessmentScore ?? "—"}</span>
                  </span>
                  {employee.evaluationVerdict ? (
                    <Badge variant="outline" className={cn("min-w-[64px] shrink-0 justify-center text-[10px]", verdictBadgeClasses(employee.evaluationVerdict))}>
                      {formatLabel(employee.evaluationVerdict)}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="min-w-[64px] shrink-0 justify-center text-[10px] text-muted-foreground">No verdict</Badge>
                  )}
                  <Badge variant="secondary" className="min-w-[64px] shrink-0 justify-center text-[10px]">
                    {employee.skillCount} skill{employee.skillCount === 1 ? "" : "s"}
                  </Badge>
                </div>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Bulk update evaluation scores</DialogTitle>
            <DialogDescription>
              Download the template, fill in the scores, then upload it. The annotated result CSV downloads automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              The template covers Assessment Score, Assessment Verdict, PI Score, PI Verdict, Final Verdict (pass/fail) plus
              one column per catalog skill. Leave a cell blank to keep the existing value; identify each employee by Employee
              Code or Email.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl text-xs gap-1.5"
                onClick={() => void employeeEvaluationApi.downloadBulkTemplate()}
              >
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
              <Button
                size="sm"
                className="rounded-xl text-xs gap-1.5"
                disabled={uploadMutation.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Choose CSV &amp; Upload
              </Button>
            </div>
            {uploadResult && (
              <div className="space-y-1 rounded-xl border border-border p-3">
                <p className="text-xs font-semibold">
                  {uploadResult.updated} updated ·{" "}
                  <span className={cn(uploadResult.failed > 0 && "text-destructive")}>{uploadResult.failed} failed</span>
                </p>
                <p className="text-[11px] text-muted-foreground">The annotated result CSV has been downloaded.</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
