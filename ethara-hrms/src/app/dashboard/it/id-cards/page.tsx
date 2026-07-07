"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { candidateIdCardApi, type CandidateIdCardQueueItem } from "@/lib/api";
import { exportToCsv } from "@/lib/export";
import { getInitials, timeAgo } from "@/lib/utils";
import { CheckCircle2, CreditCard, Download, Loader2, Users } from "lucide-react";
import { toast } from "sonner";

const ID_CARD_STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  awaiting_details: "outline",
  ready: "secondary",
  done: "default",
};

function idCardStatusLabel(status: string): string {
  if (status === "awaiting_details") return "Awaiting Details";
  if (status === "ready") return "Pending Distribution";
  if (status === "done") return "Done";
  return status;
}

type StatusFilter = "all" | "pending" | "done";

export default function ITIdCardsPage() {
  const [idCardQueue, setIdCardQueue] = useState<CandidateIdCardQueueItem[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [markingDone, setMarkingDone] = useState(false);

  const loadQueue = async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError("");
    try {
      const items = await candidateIdCardApi.listQueue();
      setIdCardQueue(items ?? []);
      setSelectedCandidateIds((prev) => prev.filter((candidateId) => (items ?? []).some((item) => item.candidateId === candidateId && item.canMarkDone)));
    } catch {
      setError("Unable to load the ID card queue.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadQueue();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const pendingItems = idCardQueue.filter((item) => item.status !== "done");
  const doneItems = idCardQueue.filter((item) => item.status === "done");
  const readyItems = idCardQueue.filter((item) => item.canMarkDone);
  const visibleItems = statusFilter === "all"
    ? idCardQueue
    : statusFilter === "pending"
      ? pendingItems
      : doneItems;
  const visibleReadyItems = visibleItems.filter((item) => item.canMarkDone);
  const allVisibleReadySelected = visibleReadyItems.length > 0 && visibleReadyItems.every((item) => selectedCandidateIds.includes(item.candidateId));

  const toggleSelection = (candidateId: string, checked: boolean) => {
    setSelectedCandidateIds((prev) => (
      checked
        ? Array.from(new Set([...prev, candidateId]))
        : prev.filter((id) => id !== candidateId)
    ));
  };

  const toggleAllVisibleReady = (checked: boolean) => {
    if (!checked) {
      const visibleReadyIds = new Set(visibleReadyItems.map((item) => item.candidateId));
      setSelectedCandidateIds((prev) => prev.filter((id) => !visibleReadyIds.has(id)));
      return;
    }
    setSelectedCandidateIds((prev) => Array.from(new Set([...prev, ...visibleReadyItems.map((item) => item.candidateId)])));
  };

  const handleExport = () => {
    if (visibleItems.length === 0) {
      toast.error("No ID card records to export.");
      return;
    }
    exportToCsv(
      visibleItems.map((item) => ({
        name: item.name ?? item.candidateName,
        employeeId: item.employeeId ?? "",
        designation: item.designation ?? "",
        bloodGroup: item.bloodGroup ?? "",
        emergencyNo: item.emergencyNo ?? "",
        photoUrl: item.photoUrl ?? "",
      })),
      [
        { key: "name", header: "Name" },
        { key: "employeeId", header: "Employee ID" },
        { key: "designation", header: "Designation" },
        { key: "bloodGroup", header: "Blood Group" },
        { key: "emergencyNo", header: "Emergency Contact No" },
        { key: "photoUrl", header: "Passport Size Photo URL" },
      ],
      `id_cards_${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  const handleMarkDone = async () => {
    if (selectedCandidateIds.length === 0) {
      toast.error("Select at least one pending ID card.");
      return;
    }
    setMarkingDone(true);
    try {
      const result = await candidateIdCardApi.markDone(selectedCandidateIds);
      toast.success(`Marked ${result.updatedCount} ID card${result.updatedCount === 1 ? "" : "s"} as done.`);
      setSelectedCandidateIds([]);
      void loadQueue(true);
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Could not update the selected ID cards.");
    } finally {
      setMarkingDone(false);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ID Cards</h1>
          <p className="text-muted-foreground text-sm">
            Track members whose ID cards are pending creation or distribution, and mark completed cards as done.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl text-xs"
            disabled={isLoading || visibleItems.length === 0}
            onClick={handleExport}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export
          </Button>
          <Button
            size="sm"
            className="rounded-xl text-xs"
            disabled={markingDone || selectedCandidateIds.length === 0}
            onClick={() => void handleMarkDone()}
          >
            {markingDone ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            Mark Selected Done
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6">
            <p className="text-2xl font-bold">{isLoading ? "—" : idCardQueue.length}</p>
            <p className="text-xs text-muted-foreground">Total Records</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6">
            <p className="text-2xl font-bold">{isLoading ? "—" : pendingItems.length}</p>
            <p className="text-xs text-muted-foreground">Pending</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6">
            <p className="text-2xl font-bold">{isLoading ? "—" : doneItems.length}</p>
            <p className="text-xs text-muted-foreground">Done</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                ID Card Queue
              </CardTitle>
              <CardDescription>
                `Awaiting Details` means the member has an Ethara email but hasn’t submitted the ID card form yet.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {([
                { value: "all", label: "All" },
                { value: "pending", label: "Pending" },
                { value: "done", label: "Done" },
              ] as const).map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => setStatusFilter(filter.value)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                    statusFilter === filter.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-muted-foreground">
              <Users className="h-8 w-8 opacity-30 mb-2" />
              <p className="text-sm">
                {statusFilter === "done"
                  ? "No completed ID cards yet."
                  : statusFilter === "pending"
                    ? "No pending ID cards."
                    : "No ID card records available."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-3 py-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded"
                    checked={allVisibleReadySelected}
                    onChange={(e) => toggleAllVisibleReady(e.target.checked)}
                    disabled={visibleReadyItems.length === 0}
                  />
                  Select visible pending distribution
                </label>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{readyItems.length} ready to distribute</span>
                  <span>·</span>
                  <span>{doneItems.length} done</span>
                </div>
              </div>

              {visibleItems.map((item) => {
                const isSelected = selectedCandidateIds.includes(item.candidateId);
                return (
                  <div
                    key={item.candidateId}
                    className="flex items-start justify-between gap-3 rounded-xl border border-border p-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded"
                        checked={isSelected}
                        disabled={!item.canMarkDone}
                        onChange={(e) => toggleSelection(item.candidateId, e.target.checked)}
                      />
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs">
                          {getInitials(item.candidateName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold">{item.candidateName}</p>
                          <Badge variant={ID_CARD_STATUS_VARIANT[item.status] ?? "outline"} className="text-[10px]">
                            {idCardStatusLabel(item.status)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{item.etharaEmail || "Ethara email pending"}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Employee ID: <span className="font-medium text-foreground">{item.employeeId || "Pending"}</span>
                          {" · "}
                          Blood Group: <span className="font-medium text-foreground">{item.bloodGroup || "Pending"}</span>
                          {" · "}
                          Emergency No: <span className="font-medium text-foreground">{item.emergencyNo || "Pending"}</span>
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {item.submittedAt
                            ? `Details submitted ${timeAgo(item.submittedAt)}`
                            : "Waiting for the member to submit ID card details."}
                          {item.itCompletedAt ? ` · Marked done ${timeAgo(item.itCompletedAt)}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Link href={`/dashboard/candidates/${item.candidateId}`}>
                        <Button variant="outline" size="sm" className="rounded-xl text-xs">
                          Open
                        </Button>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
