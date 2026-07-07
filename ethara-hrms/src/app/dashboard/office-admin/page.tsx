"use client";

import { useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DashboardInsightStrip } from "@/components/dashboard/insight-strip";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getInitials } from "@/lib/utils";
import { IdCardStatusUpload } from "@/components/id-cards/status-upload-dialog";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Download,
  Loader2,
  Package,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  assetsApi,
  candidateIdCardApi,
  employeesApi,
  separationApi,
  type CandidateIdCardQueueItem,
  type EmployeeRecord,
  type SeparationRecord,
} from "@/lib/api";

const ID_CARD_STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  awaiting_details: "outline",
  ready: "secondary",
  done: "default",
};

function idCardStatusLabel(status: string): string {
  if (status === "awaiting_details") return "Awaiting Details";
  if (status === "ready") return "Ready To Issue";
  if (status === "done") return "Issued";
  return status;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

type StatusFilter = "all" | "pending" | "done";

export default function OfficeAdminDashboard() {
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [separations, setSeparations] = useState<SeparationRecord[]>([]);
  const [idCardQueue, setIdCardQueue] = useState<CandidateIdCardQueueItem[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [loading, setLoading] = useState(true);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [markingDone, setMarkingDone] = useState(false);
  const [exportingEmployees, setExportingEmployees] = useState(false);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [empRes, sepRes, idCardRes] = await Promise.allSettled([
        employeesApi.list({ limit: 500 }),
        separationApi.list(),
        candidateIdCardApi.listQueue(),
      ]);

      if (empRes.status === "fulfilled") {
        const raw = empRes.value;
        setEmployees(Array.isArray(raw) ? raw : (raw as { data?: EmployeeRecord[] }).data ?? []);
      }
      if (sepRes.status === "fulfilled") {
        const raw = Array.isArray(sepRes.value) ? sepRes.value : [];
        setSeparations(raw.filter((s: SeparationRecord) => s.status === "approved"));
      }
      if (idCardRes.status === "fulfilled") {
        const items = idCardRes.value ?? [];
        setIdCardQueue(items);
        setSelectedCandidateIds((prev) => prev.filter((candidateId) => items.some((item) => item.candidateId === candidateId && item.canMarkDone)));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const pendingIdCards = idCardQueue.filter((item) => item.status !== "done");
  const doneIdCards = idCardQueue.filter((item) => item.status === "done");
  const readyIdCards = idCardQueue.filter((item) => item.canMarkDone);
  const visibleIdCards = statusFilter === "all"
    ? idCardQueue
    : statusFilter === "pending"
      ? pendingIdCards
      : doneIdCards;
  const visibleReadyIdCards = visibleIdCards.filter((item) => item.canMarkDone);
  const allVisibleReadySelected = visibleReadyIdCards.length > 0 && visibleReadyIdCards.every((item) => selectedCandidateIds.includes(item.candidateId));

  const toggleSelection = (candidateId: string, checked: boolean) => {
    setSelectedCandidateIds((prev) => (
      checked
        ? Array.from(new Set([...prev, candidateId]))
        : prev.filter((id) => id !== candidateId)
    ));
  };

  const toggleAllVisibleReady = (checked: boolean) => {
    const visibleReadyIds = new Set(visibleReadyIdCards.map((item) => item.candidateId));
    if (!checked) {
      setSelectedCandidateIds((prev) => prev.filter((id) => !visibleReadyIds.has(id)));
      return;
    }
    setSelectedCandidateIds((prev) => Array.from(new Set([...prev, ...visibleReadyIds])));
  };

  const handleExportEmployees = async () => {
    setExportingEmployees(true);
    try {
      const blob = await employeesApi.exportCsv();
      downloadBlob(blob, `office_admin_employees_${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success("Employee export ready.");
    } catch (error) {
      const msg = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Employee export failed.");
    } finally {
      setExportingEmployees(false);
    }
  };

  const handleMarkSelectedDone = async () => {
    if (selectedCandidateIds.length === 0) {
      toast.error("Select at least one ready ID card.");
      return;
    }
    setMarkingDone(true);
    try {
      const result = await candidateIdCardApi.markDone(selectedCandidateIds);
      toast.success(`Marked ${result.updatedCount} ID card${result.updatedCount === 1 ? "" : "s"} as issued.`);
      setSelectedCandidateIds([]);
      void load(true);
    } catch (error) {
      const msg = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Could not update the selected ID cards.");
    } finally {
      setMarkingDone(false);
    }
  };

  const handleClearChecklist = async (separationId: string) => {
    setClearingId(separationId);
    try {
      const checklist = await assetsApi.getOffboardingChecklist(separationId);
      await assetsApi.updateOffboardingChecklist(checklist.id, { office_admin_cleared: true });
      toast.success("Office admin clearance marked.");
      setSeparations((prev) => prev.filter((s) => s.id !== separationId));
    } catch (error) {
      const msg = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Failed to update checklist.");
    } finally {
      setClearingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const officeInsights = [
    {
      label: "ID Card Completion",
      value: idCardQueue.length ? `${Math.round((doneIdCards.length / idCardQueue.length) * 100)}%` : "—",
      detail: `${doneIdCards.length} issued and ${pendingIdCards.length} pending.`,
      icon: CreditCard,
      tone: pendingIdCards.length ? "warning" as const : "success" as const,
      progress: idCardQueue.length ? Math.round((doneIdCards.length / idCardQueue.length) * 100) : 0,
      href: "/dashboard/office-admin",
    },
    {
      label: "Ready To Issue",
      value: readyIdCards.length,
      detail: "ID cards with complete details ready for office action.",
      icon: CheckCircle2,
      tone: readyIdCards.length ? "warning" as const : "success" as const,
      href: "/dashboard/office-admin",
    },
    {
      label: "Offboarding Clearance",
      value: separations.length,
      detail: "Approved exits waiting for office-admin clearance.",
      icon: Package,
      tone: separations.length ? "danger" as const : "success" as const,
      href: "/dashboard/office-admin",
    },
    {
      label: "Employee Records",
      value: employees.length,
      detail: "Directory records available for office-admin exports and checks.",
      icon: Users,
      tone: "info" as const,
      href: "/dashboard/employees",
    },
  ];

  return (
    <div className="space-y-5 overflow-x-hidden px-4 py-5 sm:p-6">
      <PageHeader
        title="Office Admin Dashboard"
        icon={ClipboardList}
        description="ID card distribution, employee records, and offboarding clearances"
        actions={
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 rounded-xl text-xs sm:w-auto"
            disabled={exportingEmployees}
            onClick={() => void handleExportEmployees()}
          >
            {exportingEmployees ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Export Employees
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="flex min-w-0 items-center gap-3 pt-5">
            <div className="shrink-0 rounded-xl bg-info/10 p-2.5">
              <Users className="h-4 w-4 text-info" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold">{employees.length}</p>
              <p className="text-xs text-muted-foreground">Total Employees</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="flex min-w-0 items-center gap-3 pt-5">
            <div className="shrink-0 rounded-xl bg-success/10 p-2.5">
              <CreditCard className="h-4 w-4 text-success" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold">{doneIdCards.length}</p>
              <p className="text-xs text-muted-foreground">ID Cards Issued</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="flex min-w-0 items-center gap-3 pt-5">
            <div className="shrink-0 rounded-xl bg-warning/10 p-2.5">
              <AlertCircle className="h-4 w-4 text-warning" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold">{pendingIdCards.length}</p>
              <p className="text-xs text-muted-foreground">ID Cards Pending</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="flex min-w-0 items-center gap-3 pt-5">
            <div className="shrink-0 rounded-xl bg-primary/10 p-2.5">
              <Package className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold">{separations.length}</p>
              <p className="text-xs text-muted-foreground">Pending Offboarding</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <DashboardInsightStrip
        title="Office Admin Operating Summary"
        subtitle="ID card status, issuance readiness, offboarding, and employee records."
        insights={officeInsights}
      />

      <Tabs defaultValue="id-cards">
        <TabsList className="mb-4 grid w-full grid-cols-2 sm:w-auto">
          <TabsTrigger value="id-cards" className="gap-1.5">
            <CreditCard className="h-3.5 w-3.5" /> ID Cards
          </TabsTrigger>
          <TabsTrigger value="offboarding" className="gap-1.5">
            <ClipboardList className="h-3.5 w-3.5" /> Offboarding
            {separations.length > 0 && (
              <Badge variant="destructive" className="ml-1 h-4 px-1 text-[10px]">
                {separations.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="id-cards">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <CreditCard className="h-4 w-4" />
                  ID Card Distribution
                </CardTitle>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="grid grid-cols-3 gap-1 rounded-xl border border-border p-1">
                    {([
                      { value: "all", label: "All" },
                      { value: "pending", label: "Pending" },
                      { value: "done", label: "Issued" },
                    ] as const).map((filter) => (
                      <button
                        key={filter.value}
                        type="button"
                        onClick={() => setStatusFilter(filter.value)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                          statusFilter === filter.value
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted/40"
                        }`}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>
                  <IdCardStatusUpload onUploaded={() => void load(true)} />
                  <Button
                    size="sm"
                    className="gap-2 rounded-xl text-xs"
                    disabled={markingDone || selectedCandidateIds.length === 0}
                    onClick={() => void handleMarkSelectedDone()}
                  >
                    {markingDone ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Mark Selected Issued
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {visibleIdCards.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {statusFilter === "done" ? "No issued ID cards yet." : "No ID card records found."}
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded"
                        checked={allVisibleReadySelected}
                        onChange={(event) => toggleAllVisibleReady(event.target.checked)}
                        disabled={visibleReadyIdCards.length === 0}
                      />
                      Select visible ready ID cards
                    </label>
                    <p className="text-[11px] text-muted-foreground">
                      {readyIdCards.length} ready to issue · {doneIdCards.length} issued
                    </p>
                  </div>

                  {visibleIdCards.map((item) => {
                    const selected = selectedCandidateIds.includes(item.candidateId);
                    return (
                      <div key={item.candidateId} className="rounded-xl border border-border p-3 transition-colors hover:bg-muted/30">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 rounded"
                            checked={selected}
                            disabled={!item.canMarkDone}
                            onChange={(event) => toggleSelection(item.candidateId, event.target.checked)}
                          />
                          <Avatar className="h-9 w-9 shrink-0">
                            <AvatarFallback className="bg-primary/10 text-xs text-primary">
                              {getInitials(item.candidateName)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="break-words text-sm font-semibold">{item.name || item.candidateName}</p>
                              <Badge variant={ID_CARD_STATUS_VARIANT[item.status] ?? "outline"} className="text-[10px]">
                                {idCardStatusLabel(item.status)}
                              </Badge>
                            </div>
                            <p className="break-all text-xs text-muted-foreground">{item.etharaEmail || "Ethara email pending"}</p>
                            <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                              <div>
                                <p className="text-muted-foreground">Employee ID</p>
                                <p className="font-medium">{item.employeeId || "Pending"}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Blood Group</p>
                                <p className="font-medium">{item.bloodGroup || "Pending"}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Emergency No.</p>
                                <p className="font-medium">{item.emergencyNo || "Pending"}</p>
                              </div>
                            </div>
                            <p className="mt-2 text-[11px] text-muted-foreground">
                              {item.submittedAt
                                ? `Details submitted ${new Date(item.submittedAt).toLocaleDateString("en-IN")}`
                                : "Waiting for the member to submit ID card details."}
                              {item.itCompletedAt ? ` · Issued ${new Date(item.itCompletedAt).toLocaleDateString("en-IN")}` : ""}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="offboarding">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Package className="h-4 w-4" />
                Pending Offboarding Clearances
              </CardTitle>
            </CardHeader>
            <CardContent>
              {separations.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No pending offboarding clearances
                </p>
              ) : (
                <div className="space-y-3">
                  {separations.map((sep) => (
                    <div key={sep.id} className="rounded-xl border border-border p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-medium">{sep.employeeName || "—"}</p>
                          <p className="break-words text-xs text-muted-foreground">{sep.employeeCode}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <Badge variant="secondary" className="text-xs capitalize">
                              {sep.separationType}
                            </Badge>
                            {sep.lastWorkingDay && (
                              <span className="text-xs text-muted-foreground">
                                LWD: {new Date(sep.lastWorkingDay).toLocaleDateString("en-IN")}
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 gap-2 rounded-xl text-xs"
                          disabled={clearingId === sep.id}
                          onClick={() => void handleClearChecklist(sep.id)}
                        >
                          {clearingId === sep.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                          Mark Cleared
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
