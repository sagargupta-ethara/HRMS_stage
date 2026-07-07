"use client";

import { useMemo, useState, type ElementType } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BarChart3,
  Check,
  FolderKanban,
  Loader2,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth-context";
import {
  resourceSegregationApi,
  skillsApi,
  type ResourceDashboard,
  type ResourceEmployee,
  type ResourcePerson,
  type ResourceProject,
  type ResourceUploadResult,
} from "@/lib/api";
import { cn, formatLabel } from "@/lib/utils";

function UnassignedEmployeesPanel() {
  const { data: unassigned = [], isLoading } = useQuery({
    queryKey: ["skills-employees", { assignment: "unassigned" }],
    queryFn: () => skillsApi.employees({ assignment: "unassigned" }),
    staleTime: 30_000,
  });
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await skillsApi.exportCsv({ assignment: "unassigned" });
      toast.success("Unassigned employees export is ready.");
    } catch {
      toast.error("Export failed.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Not Assigned to Any Project</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {isLoading ? "Loading…" : `${unassigned.length} employee${unassigned.length === 1 ? "" : "s"} without an active project allocation`}
            </p>
          </div>
          <Button variant="outline" size="sm" disabled={exporting || unassigned.length === 0} onClick={() => void handleExport()}>
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {unassigned.length === 0 && !isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Everyone is allocated to a project.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Skill Tags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unassigned.slice(0, 25).map((employee) => (
                <TableRow key={employee.employeeProfileId}>
                  <TableCell className="font-medium">{employee.name ?? "—"}</TableCell>
                  <TableCell>{employee.employeeCode ?? "—"}</TableCell>
                  <TableCell>{employee.department ?? "—"}</TableCell>
                  <TableCell>
                    {employee.skills.length === 0 ? (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">Untagged</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {employee.skills.map((entry) => `${entry.label} (${entry.rating}/5)`).join(", ")}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {unassigned.length > 25 && (
          <p className="mt-2 text-xs text-muted-foreground">Showing first 25 — export to see all {unassigned.length}.</p>
        )}
      </CardContent>
    </Card>
  );
}

const MANAGE_ROLES = new Set(["super_admin", "admin", "leadership", "hr", "manager"]);
const OPERATE_ROLES = new Set([...MANAGE_ROLES, "pl_tpm"]);

function roleSet(userRoles?: string[], role?: string | null) {
  const values = new Set<string>();
  if (role) values.add(role);
  (userRoles || []).forEach((item) => values.add(item));
  return values;
}

function hasAny(values: Set<string>, allowed: Set<string>) {
  for (const value of values) if (allowed.has(value)) return true;
  return false;
}

function normalizeSearch(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function matchesPlTpmDesignation(value: string | null | undefined) {
  const normalized = normalizeSearch(value).replace(/[^a-z0-9]+/g, " ").trim();
  return (
    normalized === "tpm" ||
    normalized === "pl" ||
    normalized.includes("project lead") ||
    normalized.includes("technical project manager") ||
    normalized.includes("technical program manager")
  );
}

type LeadOption = ResourcePerson & {
  employeeCode?: string | null;
  employeeEmail?: string | null;
  department?: string | null;
  designation?: string | null;
};

function leadHaystack(person: LeadOption) {
  return [
    person.name,
    person.email,
    person.employeeEmail,
    person.employeeCode,
    person.department,
    person.designation,
  ].map(normalizeSearch).filter(Boolean);
}

function leadSearchScore(person: LeadOption, query: string) {
  const haystack = leadHaystack(person);
  const email = normalizeSearch(person.employeeEmail || person.email);
  if (email === query) return 0;
  if (email.startsWith(query)) return 1;
  if (haystack.some((value) => value.startsWith(query))) return 2;
  if (haystack.some((value) => value.includes(query))) return 3;
  return 9;
}

function StateBadge({ state }: { state: string }) {
  const present = state === "present";
  return (
    <Badge
      variant="outline"
      className={cn(
        "border text-xs",
        present
          ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-700"
          : "border-rose-400/40 bg-rose-500/10 text-rose-700",
      )}
    >
      {present ? "Present" : "Absent"}
    </Badge>
  );
}

function Kpi({ label, value, icon: Icon }: { label: string; value: number; icon: ElementType }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </div>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

export default function ResourceSegregationPage() {
  const { user } = useAuth();
  const roles = roleSet(user?.roles as string[] | undefined, user?.role);
  const canManage = hasAny(roles, MANAGE_ROLES);
  const canOperate = hasAny(roles, OPERATE_ROLES);
  const qc = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [leadUserId, setLeadUserId] = useState("");
  const [leadSearch, setLeadSearch] = useState("");
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<ResourceProject | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<ResourceUploadResult | null>(null);
  const [transferComments, setTransferComments] = useState<Record<string, string>>({});

  const dashboardQuery = useQuery({
    queryKey: ["resource-segregation-dashboard"],
    queryFn: () => resourceSegregationApi.dashboard(),
  });

  const peopleQuery = useQuery({
    queryKey: ["resource-segregation-people"],
    queryFn: () => resourceSegregationApi.people(),
    enabled: canOperate,
  });

  const dashboard = dashboardQuery.data as ResourceDashboard | undefined;
  const projects = useMemo(() => dashboard?.projects ?? [], [dashboard]);
  const selectedProject = useMemo<ResourceProject | undefined>(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId],
  );
  const selectedAssignments = dashboard?.assignments.filter(
    (assignment) => !selectedProject || assignment.projectId === selectedProject.id,
  ) ?? [];
  // Approvals must be visible no matter which project is selected — pending first.
  const selectedTransfers = useMemo(() => {
    const transfers = dashboard?.transferRequests ?? [];
    return [...transfers].sort((a, b) => {
      const aPending = a.status === "pending" ? 0 : 1;
      const bPending = b.status === "pending" ? 0 : 1;
      return aPending - bPending;
    });
  }, [dashboard]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["resource-segregation-dashboard"] });

  const createMutation = useMutation({
    mutationFn: () =>
      resourceSegregationApi.createProject({
        name: projectName,
        code: projectCode || undefined,
        description: projectDescription || undefined,
      }),
    onSuccess: (project) => {
      toast.success("Project created");
      setSelectedProjectId(project.id);
      setProjectName("");
      setProjectCode("");
      setProjectDescription("");
      setCreateOpen(false);
      void refresh();
    },
    onError: () => toast.error("Could not create project"),
  });

  const leadMutation = useMutation({
    mutationFn: (userIds: string[]) =>
      resourceSegregationApi.setLeads(selectedProject?.id ?? "", {
        userIds,
      }),
    onSuccess: () => {
      toast.success("PL/TPM updated");
      setLeadUserId("");
      setLeadSearch("");
      void refresh();
    },
    onError: () => toast.error("Could not update PL/TPM"),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: (projectId: string) => resourceSegregationApi.deleteProject(projectId),
    onSuccess: () => {
      toast.success("Project deleted");
      setSelectedProjectId("");
      setDeleteProjectTarget(null);
      void refresh();
    },
    onError: () => toast.error("Could not delete project"),
  });

  const uploadMutation = useMutation({
    mutationFn: () => resourceSegregationApi.uploadAssignments(selectedProject?.id ?? "", uploadFile as File),
    onSuccess: (result) => {
      setUploadResult(result);
      toast.success("Roster processed");
      setUploadFile(null);
      void refresh();
    },
    onError: () => toast.error("Could not process roster"),
  });

  const transferMutation = useMutation({
    mutationFn: ({ id, action, comment }: { id: string; action: "approve" | "reject"; comment?: string }) =>
      resourceSegregationApi.transferAction(id, action, comment),
    onSuccess: (_result, variables) => {
      toast.success("Transfer updated");
      setTransferComments((prev) => {
        const next = { ...prev };
        delete next[variables.id];
        return next;
      });
      void refresh();
    },
    onError: () => toast.error("Could not update transfer"),
  });

  const availableLeadUsers = useMemo<LeadOption[]>(() => {
    const users = peopleQuery.data?.users ?? [];
    const employees = peopleQuery.data?.employees ?? [];
    const profilesByUserId = new Map(
      employees
        .filter((employee): employee is ResourceEmployee & { userId: string } => Boolean(employee.userId))
        .map((employee) => [employee.userId, employee]),
    );
    const profilesByEmail = new Map<string, ResourceEmployee>();
    for (const employee of employees) {
      if (employee.etharaEmail) profilesByEmail.set(normalizeSearch(employee.etharaEmail), employee);
    }
    const currentLeadIds = new Set(selectedProject?.leads.map((lead) => lead.userId) ?? []);

    return users
      .map((person) => {
        const profile = profilesByUserId.get(person.id) ?? profilesByEmail.get(normalizeSearch(person.email));
        return {
          ...person,
          employeeCode: person.employeeCode ?? profile?.employeeCode ?? null,
          employeeEmail: person.employeeEmail ?? profile?.etharaEmail ?? null,
          department: person.department ?? profile?.department ?? null,
          designation: person.designation ?? profile?.designation ?? null,
        };
      })
      .filter((person) => {
        if (person.isActive === false || currentLeadIds.has(person.id)) return false;
        const personRoles = new Set(person.roles ?? [person.role ?? ""]);
        return (
          ["pl_tpm", "manager", "hr", "leadership", "admin", "super_admin"].some((role) => personRoles.has(role)) ||
          person.designationMatchesPlTpm === true ||
          matchesPlTpmDesignation(person.designation)
        );
      });
  }, [peopleQuery.data?.employees, peopleQuery.data?.users, selectedProject?.leads]);

  const leadSearchQuery = normalizeSearch(leadSearch);
  const suggestedLeadUsers = useMemo(() => {
    const matches = leadSearchQuery
      ? availableLeadUsers.filter((person) => leadSearchScore(person, leadSearchQuery) < 9)
      : availableLeadUsers;
    return [...matches]
      .sort((a, b) => {
        const scoreDiff = leadSearchScore(a, leadSearchQuery) - leadSearchScore(b, leadSearchQuery);
        if (scoreDiff !== 0) return scoreDiff;
        return normalizeSearch(a.name || a.email).localeCompare(normalizeSearch(b.name || b.email));
      })
      .slice(0, 8);
  }, [availableLeadUsers, leadSearchQuery]);

  const selectedLeadUser = availableLeadUsers.find((person) => person.id === leadUserId) ?? null;

  const addLeadUser = () => {
    if (!selectedProject || !leadUserId) return;
    leadMutation.mutate(
      Array.from(new Set([...selectedProject.leads.map((lead) => lead.userId), leadUserId])),
    );
  };

  const removeLeadUser = (userId: string) => {
    if (!selectedProject) return;
    leadMutation.mutate(selectedProject.leads.map((lead) => lead.userId).filter((id) => id !== userId));
  };

  const confirmDeleteProject = () => {
    if (!deleteProjectTarget) return;
    deleteProjectMutation.mutate(deleteProjectTarget.id);
  };

  const submitTransferAction = (id: string, action: "approve" | "reject") => {
    const comment = (transferComments[id] ?? "").trim();
    if (action === "reject" && !comment) {
      toast.error("Add a rejection reason before rejecting.");
      return;
    }
    transferMutation.mutate({ id, action, comment: comment || undefined });
  };

  if (dashboardQuery.isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5 overflow-x-hidden px-4 py-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FolderKanban className="h-6 w-6 text-muted-foreground" />
            <h1 className="text-xl font-semibold">Resource Segregation</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {canOperate ? "Project staffing, attendance state, and transfer approvals" : "Your project allocation"}
          </p>
        </div>
        {canManage && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger render={<Button />}>
              <FolderKanban className="h-4 w-4" />
              New Project
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Project</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Code</Label>
                  <Input value={projectCode} onChange={(event) => setProjectCode(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Description</Label>
                  <Textarea value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} />
                </div>
                <Button
                  className="w-full"
                  disabled={!projectName.trim() || createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                >
                  {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Projects" value={dashboard?.summary.projects ?? 0} icon={FolderKanban} />
        <Kpi label="Tagged" value={dashboard?.summary.tagged ?? 0} icon={Users} />
        <Kpi label="Present" value={dashboard?.summary.present ?? 0} icon={Check} />
        <Kpi label="Absent" value={dashboard?.summary.absent ?? 0} icon={X} />
        <Kpi label="Transfers" value={dashboard?.summary.pendingTransfers ?? 0} icon={BarChart3} />
      </div>

      {projects.length > 0 && (
        <div className="flex flex-col gap-2 sm:max-w-sm">
          <Label>Project</Label>
          <Select value={selectedProject?.id ?? ""} onValueChange={(v) => setSelectedProjectId(v ?? "")}>
            <SelectTrigger>
              <SelectValue placeholder="Select a project">
                {(value) => projects.find((project) => project.id === value)?.name ?? "Select a project"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {selectedProject && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>{selectedProject.name}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">{selectedProject.managerName ?? "Unassigned manager"}</p>
                </div>
                <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
                  <Badge variant="outline">{selectedProject.analytics.tagged} tagged</Badge>
                  <Badge variant="outline" className="border-emerald-400/40 bg-emerald-500/10 text-emerald-700">
                    {selectedProject.analytics.present} present
                  </Badge>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setDeleteProjectTarget(selectedProject)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Reporting</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedAssignments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        No resources tagged.
                      </TableCell>
                    </TableRow>
                  ) : (
                    selectedAssignments.map((assignment) => (
                      <TableRow key={assignment.id}>
                        <TableCell className="font-medium">{assignment.employee?.fullName ?? "Employee"}</TableCell>
                        <TableCell>{assignment.employee?.employeeCode ?? "-"}</TableCell>
                        <TableCell>{assignment.reportingMember?.fullName ?? "-"}</TableCell>
                        <TableCell>{assignment.projectName ?? selectedProject.name}</TableCell>
                        <TableCell><StateBadge state={assignment.state} /></TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {canOperate && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">PL/TPM</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {selectedProject.leads.length === 0 ? (
                      <span className="text-sm text-muted-foreground">None assigned</span>
                    ) : (
                      selectedProject.leads.map((lead) => (
                        <Badge key={lead.id} variant="secondary" className="gap-1 pr-1">
                          <span>{lead.name ?? lead.email}</span>
                          {canManage && (
                            <button
                              type="button"
                              className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-background/80 hover:text-foreground"
                              onClick={() => removeLeadUser(lead.userId)}
                              disabled={leadMutation.isPending}
                              aria-label={`Remove ${lead.name ?? lead.email ?? "PL/TPM"}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </Badge>
                      ))
                    )}
                  </div>
                  {canManage && (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <div className="relative min-w-0 flex-1">
                          <Input
                            value={leadSearch}
                            onChange={(event) => {
                              setLeadSearch(event.target.value);
                              setLeadUserId("");
                            }}
                            placeholder="Search name or email"
                            className="pr-8"
                          />
                          {leadSearch && (
                            <button
                              type="button"
                              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                              onClick={() => {
                                setLeadSearch("");
                                setLeadUserId("");
                              }}
                              aria-label="Clear PL/TPM search"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        <Button
                          size="icon"
                          disabled={!leadUserId || leadMutation.isPending}
                          onClick={addLeadUser}
                        >
                          {leadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                        </Button>
                      </div>
                      {selectedLeadUser && (
                        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                          <p className="font-medium">{selectedLeadUser.name ?? selectedLeadUser.email}</p>
                          <p className="break-all text-xs text-muted-foreground">
                            {selectedLeadUser.employeeEmail ?? selectedLeadUser.email}
                            {selectedLeadUser.designation ? ` · ${selectedLeadUser.designation}` : ""}
                          </p>
                        </div>
                      )}
                      <div className="max-h-56 overflow-y-auto rounded-md border">
                        {peopleQuery.isLoading ? (
                          <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Loading users
                          </div>
                        ) : suggestedLeadUsers.length === 0 ? (
                          <div className="px-3 py-3 text-sm text-muted-foreground">
                            No PL/TPM suggestions found.
                          </div>
                        ) : (
                          suggestedLeadUsers.map((person) => {
                            const isSelected = leadUserId === person.id;
                            return (
                              <button
                                key={person.id}
                                type="button"
                                className={cn(
                                  "flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted",
                                  isSelected && "bg-primary/10",
                                )}
                                onClick={() => {
                                  setLeadUserId(person.id);
                                  setLeadSearch(person.employeeEmail ?? person.email ?? person.name ?? "");
                                }}
                              >
                                <span className="font-medium">{person.name ?? person.email}</span>
                                <span className="break-all text-xs text-muted-foreground">
                                  {person.employeeEmail ?? person.email}
                                  {person.employeeCode ? ` · ${person.employeeCode}` : ""}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {person.designation ?? "PL/TPM"}
                                  {person.department ? ` · ${person.department}` : ""}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Roster Upload</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    CSV columns: <strong>Email</strong> (required), <strong>Name</strong> (optional, must match the
                    record), <strong>Reporting Member</strong> (optional — must be the manager&apos;s <strong>email</strong>,
                    so they&apos;re identified unambiguously).
                  </p>
                  <Input
                    type="file"
                    accept=".csv,.tsv,text/csv,text/tab-separated-values"
                    onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                  />
                  <Button
                    className="w-full"
                    disabled={!uploadFile || uploadMutation.isPending}
                    onClick={() => uploadMutation.mutate()}
                  >
                    {uploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Upload
                  </Button>
                  {uploadResult && (
                    <div className="space-y-2 rounded-md border p-3 text-sm">
                      <div className="flex justify-between">
                        <span>Accepted</span>
                        <strong>{uploadResult.accepted}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Rejected</span>
                        <strong>{uploadResult.rejected}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Transfers</span>
                        <strong>{uploadResult.transferRequested}</strong>
                      </div>
                      {uploadResult.results.filter((row) => row.status !== "accepted").slice(0, 5).map((row) => (
                        <p key={`${row.row}-${row.email}`} className="text-xs text-muted-foreground">
                          Row {row.row}: {row.reason}
                        </p>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {canOperate && (
        <Card>
          <CardHeader>
            <CardTitle>Transfer Requests</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Approvals for moving people between projects — shown across all projects, pending first.
            </p>
          </CardHeader>
          <CardContent>
            {selectedTransfers.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No transfer requests yet. When a roster upload assigns someone who is already active on
                another project, the move lands here and waits for approval before it takes effect.
              </p>
            ) : (
            <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reason / Comment</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
              <TableBody>
                {selectedTransfers.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell>{request.employee?.fullName ?? "-"}</TableCell>
                    <TableCell>{request.fromProjectName}</TableCell>
                    <TableCell>{request.toProjectName}</TableCell>
                    <TableCell>{formatLabel(request.status)}</TableCell>
                    <TableCell className="min-w-[220px]">
                      {request.status === "pending" ? (
                        <Textarea
                          rows={2}
                          value={transferComments[request.id] ?? ""}
                          onChange={(event) => setTransferComments((prev) => ({ ...prev, [request.id]: event.target.value }))}
                          placeholder="Required when rejecting"
                        />
                      ) : (
                        <span className="text-sm text-muted-foreground">{request.decisionComment || request.reason || "-"}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {request.status === "pending" ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={transferMutation.isPending}
                            onClick={() => submitTransferAction(request.id, "reject")}
                          >
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            disabled={transferMutation.isPending}
                            onClick={() => submitTransferAction(request.id, "approve")}
                          >
                            Approve
                          </Button>
                        </div>
                      ) : (
                        <Badge variant="outline">{formatLabel(request.status)}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            )}
          </CardContent>
        </Card>
      )}

      {!selectedProject && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No resource projects available.
          </CardContent>
        </Card>
      )}

      {canOperate && <UnassignedEmployeesPanel />}

      <ConfirmDialog
        open={Boolean(deleteProjectTarget)}
        title="Delete project"
        description={
          deleteProjectTarget
            ? `Delete ${deleteProjectTarget.name}? This removes its PL/TPM mapping, resource tags, and transfer requests.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={deleteProjectMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setDeleteProjectTarget(null);
        }}
        onConfirm={confirmDeleteProject}
      />
    </div>
  );
}
