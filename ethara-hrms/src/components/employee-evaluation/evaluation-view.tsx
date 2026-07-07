"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Sparkles, Star } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StarRating } from "@/components/skills/star-rating";
import { PmsPanel } from "@/components/employee-evaluation/pms-panel";
import {
  employeeEvaluationApi,
  skillsApi,
  type EmployeeEvaluationInsight,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn, formatDate, formatLabel, getInitials, hasAssignedRole } from "@/lib/utils";

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

function StatChip({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-h-[64px] flex-col justify-center rounded-xl border border-border bg-muted/20 px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

/**
 * Full employee-evaluation view: header signals + Insight / PMS / Skills sub-tabs.
 * Shared by the standalone Employee Evaluation profile page and the gated
 * "Performance" tab on the staff employee detail page so both stay identical.
 * The evaluation API keys off the same id as the employee `[id]` route param
 * (employeeProfileId). Pass `enabled={false}` to defer all fetching until the
 * view is actually shown (e.g. only when its tab is active).
 */
export function EvaluationView({ employeeId, enabled = true }: { employeeId: string; enabled?: boolean }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  // The PMS endpoints are gated to admin/leadership/HR — evaluators would get a
  // 403, so they see the read-only summary from the profile payload instead.
  const canManagePms = hasAssignedRole(user, ["super_admin", "admin", "leadership", "hr"]);

  const [subTab, setSubTab] = useState("insight");

  const { data: profile, isLoading, isError } = useQuery({
    queryKey: ["employee-evaluation", "profile", employeeId],
    queryFn: () => employeeEvaluationApi.getProfile(employeeId),
    enabled: enabled && !!employeeId,
    staleTime: 30_000,
  });

  const { data: catalog = [] } = useQuery({
    queryKey: ["skills-catalog"],
    queryFn: () => skillsApi.catalog(),
    enabled,
    staleTime: 300_000,
  });

  // Local, seeded-from-server state for the editable Skills tab.
  const [editSkills, setEditSkills] = useState<Record<string, number>>({});
  const [insight, setInsight] = useState<EmployeeEvaluationInsight | null>(null);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [addSkillOpen, setAddSkillOpen] = useState(false);
  const [newSkillLabel, setNewSkillLabel] = useState("");

  // Re-seed editable skills whenever a fresh profile arrives (initial load or after a
  // save invalidation). Adjusting state during render on an identity change is the
  // React-recommended alternative to an effect; query data is stable while editing,
  // so in-progress edits are never clobbered.
  const [seededFor, setSeededFor] = useState<typeof profile | null>(null);
  if (profile && profile !== seededFor) {
    setSeededFor(profile);
    const initial: Record<string, number> = {};
    profile.skills.forEach((entry) => { initial[entry.skill] = entry.rating; });
    setEditSkills(initial);
  }

  const insightMutation = useMutation({
    mutationFn: () => employeeEvaluationApi.generateInsight(employeeId),
    onSuccess: (data) => {
      setInsight(data);
      setInsightError(null);
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 503) {
        setInsightError("AI analysis is not available (Gemini key not configured).");
        return;
      }
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setInsightError(detail || "Could not generate insight. Please try again.");
    },
  });

  const skillsMutation = useMutation({
    mutationFn: () => {
      const skills = Object.entries(editSkills)
        .filter(([, rating]) => rating > 0)
        .map(([skill, rating]) => ({ skill, rating }));
      return skillsApi.setEmployeeSkills(employeeId, skills);
    },
    onSuccess: () => {
      toast.success("Skills saved.");
      void qc.invalidateQueries({ queryKey: ["employee-evaluation", "profile", employeeId] });
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not save skills.");
    },
  });

  const createSkillMutation = useMutation({
    mutationFn: (label: string) => skillsApi.createSkill({ label }),
    onSuccess: () => {
      toast.success("Skill added to the catalog.");
      setNewSkillLabel("");
      setAddSkillOpen(false);
      void qc.invalidateQueries({ queryKey: ["skills-catalog"] });
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not add skill.");
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Could not load this employee&apos;s evaluation.
        </CardContent>
      </Card>
    );
  }

  const { employee } = profile;

  return (
    <div className="min-w-0 space-y-4">
      {/* ── Header: identity + verdict + signal tiles ─────────────────────── */}
      <Card className="border-0 shadow-sm">
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar className="h-12 w-12 shrink-0">
                <AvatarFallback className="bg-primary/10 text-primary font-bold">
                  {getInitials(employee.name ?? "?")}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold tracking-tight sm:text-xl">{employee.name ?? "Unnamed"}</h2>
                <p className="truncate text-xs text-muted-foreground">
                  {employee.employeeCode ?? "—"}
                  {employee.department ? ` · ${employee.department}` : ""}
                  {employee.designation ? ` · ${employee.designation}` : ""}
                </p>
              </div>
            </div>
            {employee.evaluationVerdict && (
              <Badge
                variant="outline"
                className={cn(
                  "h-auto shrink-0 self-start rounded-full px-3 py-1 text-sm font-semibold sm:self-auto",
                  verdictBadgeClasses(employee.evaluationVerdict),
                )}
              >
                {formatLabel(employee.evaluationVerdict)}
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatChip
              label="Assessment"
              value={
                profile.assessment && (profile.assessment.score !== null || profile.assessment.verdict)
                  ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {profile.assessment.score ?? "—"}
                      {profile.assessment.verdict && (
                        <Badge variant="outline" className="text-[10px]">{formatLabel(profile.assessment.verdict)}</Badge>
                      )}
                    </span>
                  )
                  : "—"
              }
            />
            <StatChip
              label="PI Verdict"
              value={profile.piVerdict ? formatLabel(profile.piVerdict) : "—"}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Sub-tabs ──────────────────────────────────────────────────────── */}
      <Tabs value={subTab} onValueChange={setSubTab} className="min-w-0 space-y-4">
        <TabsList className="flex h-auto w-full max-w-full items-stretch justify-start gap-1 overflow-x-auto rounded-xl bg-muted/50 p-1 [scrollbar-width:thin] group-data-horizontal/tabs:h-auto sm:w-fit sm:flex-nowrap [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
          {[
            { value: "insight", label: "Insight", icon: Sparkles },
            { value: "pms", label: "PMS", icon: Star },
            { value: "skills", label: "Skills", icon: Star },
          ].map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="h-auto min-h-9 min-w-0 flex-1 rounded-lg px-2 py-1 text-center text-[11px] leading-tight whitespace-normal gap-1.5 data-[state=active]:shadow-sm sm:min-h-0 sm:flex-none sm:shrink-0 sm:whitespace-nowrap sm:px-3 sm:text-xs"
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Insight ─────────────────────────────────────────────────────── */}
        <TabsContent value="insight" className="min-w-0 space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <CardTitle className="text-base">AI Insight</CardTitle>
              <Button
                size="sm"
                className="rounded-xl text-xs gap-1.5"
                disabled={insightMutation.isPending}
                onClick={() => insightMutation.mutate()}
              >
                {insightMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {insight ? "Regenerate" : "Generate insight"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {insightError && (
                <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                  {insightError}
                </div>
              )}
              {!insight && !insightError && (
                <p className="text-sm text-muted-foreground">
                  Generate an AI insight to summarise this employee&apos;s strengths, focus areas and a recommendation.
                </p>
              )}
              {insight && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={cn("text-xs", verdictBadgeClasses(insight.analysis.verdict))}>
                      {formatLabel(insight.analysis.verdict)}
                    </Badge>
                    <p className="text-sm font-semibold">{insight.analysis.headline}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">{insight.analysis.summary}</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-border bg-muted/10 p-3">
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Strengths</p>
                      <ul className="list-disc space-y-1 pl-4 text-sm">
                        {insight.analysis.strengths.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-xl border border-border bg-muted/10 p-3">
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Focus Areas</p>
                      <ul className="list-disc space-y-1 pl-4 text-sm">
                        {insight.analysis.focusAreas.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/20 p-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recommendation</p>
                    <p className="text-sm">{insight.analysis.recommendation}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── PMS ─────────────────────────────────────────────────────────── */}
        <TabsContent value="pms" className="min-w-0 space-y-4">
          {canManagePms ? (
            <PmsPanel
              employeeId={employeeId}
              employeeName={employee.name}
              enabled={enabled && subTab === "pms"}
            />
          ) : (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">PMS Evaluation</CardTitle>
              </CardHeader>
              <CardContent>
                {profile.pms ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-xl border border-border p-3 text-center">
                      <p className="text-2xl font-bold text-primary">{profile.pms.totalScore}/36</p>
                      <p className="text-[10px] text-muted-foreground">Total Score</p>
                    </div>
                    <div className="rounded-xl border border-border p-3 text-center">
                      <p className="text-xl font-bold">{profile.pms.averageScore}</p>
                      <p className="text-[10px] text-muted-foreground">Average Score</p>
                    </div>
                    <div className="flex items-center justify-center rounded-xl border border-border p-3 text-center">
                      {profile.pms.overallRating ? (
                        <Badge variant="outline" className="text-xs">{formatLabel(profile.pms.overallRating)}</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </div>
                    <div className="rounded-xl border border-border p-3 text-center">
                      <p className="text-sm font-semibold">{profile.pms.submittedAt ? formatDate(profile.pms.submittedAt) : "—"}</p>
                      <p className="text-[10px] text-muted-foreground">Submitted</p>
                    </div>
                  </div>
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No PMS evaluation submitted yet.
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Skills ──────────────────────────────────────────────────────── */}
        <TabsContent value="skills" className="min-w-0 space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <CardTitle className="text-base">Skills</CardTitle>
              <Button variant="outline" size="sm" className="rounded-xl text-xs gap-1.5" onClick={() => setAddSkillOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add global skill
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {catalog.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No skills in the catalog yet.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {catalog.map((item) => (
                    <div key={item.key} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
                      <span className={cn("min-w-0 truncate text-sm font-medium", (editSkills[item.key] ?? 0) === 0 && "text-muted-foreground")}>
                        {item.label}
                      </span>
                      <StarRating
                        value={editSkills[item.key] ?? 0}
                        onChange={(value) => setEditSkills((prev) => ({ ...prev, [item.key]: value }))}
                      />
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end pt-1">
                <Button
                  className="rounded-xl text-xs"
                  disabled={skillsMutation.isPending}
                  onClick={() => skillsMutation.mutate()}
                >
                  {skillsMutation.isPending ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Saving…</> : "Save Skills"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={addSkillOpen} onOpenChange={setAddSkillOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add global skill</DialogTitle>
            <DialogDescription>
              Adds a new skill to the shared catalog so it can be tagged for any employee.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-skill-label" className="text-xs">Skill name</Label>
              <Input
                id="new-skill-label"
                value={newSkillLabel}
                onChange={(e) => setNewSkillLabel(e.target.value)}
                placeholder="e.g. Data Labeling"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" className="rounded-xl text-xs" onClick={() => setAddSkillOpen(false)}>Cancel</Button>
              <Button
                className="rounded-xl text-xs"
                disabled={createSkillMutation.isPending || !newSkillLabel.trim()}
                onClick={() => createSkillMutation.mutate(newSkillLabel.trim())}
              >
                {createSkillMutation.isPending ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Adding…</> : "Add Skill"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
