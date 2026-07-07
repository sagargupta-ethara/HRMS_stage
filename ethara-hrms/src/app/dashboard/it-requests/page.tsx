"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn, getInitials, timeAgo } from "@/lib/utils";
import { MonitorSmartphone, Clock, CheckCircle2, AlertTriangle, Mail, Loader2, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { itRequestsApi } from "@/lib/api";

type ITRequest = {
  id: string;
  candidateId: string;
  candidateName: string | null;
  candidatePersonalEmail?: string | null;
  status: string;
  suggestedEmail: string;
  createdEmail?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
};

export default function ITRequestsPage() {
  const qc = useQueryClient();
  const [pendingRequests, setPendingRequests] = useState<ITRequest[]>([]);
  const [completedRequests, setCompletedRequests] = useState<ITRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState<string | null>(null);
  const [emailOverrides, setEmailOverrides] = useState<Record<string, string>>({});
  const [openDialogId, setOpenDialogId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "completed">("all");
  const [now] = useState(() => Date.now());

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [pending, completed] = await Promise.all([
        itRequestsApi.list({ status: "pending" }),
        itRequestsApi.list({ status: "completed" }),
      ]);
      setPendingRequests(pending ?? []);
      setCompletedRequests(completed ?? []);
    } catch {
      setError("Unable to load IT requests.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, []);

  const handleCreate = async (req: ITRequest) => {
    const email = emailOverrides[req.id] || req.suggestedEmail;
    if (!email.trim()) { toast.error("Email address is required."); return; }
    setCreating(req.id);
    try {
      await itRequestsApi.complete(req.id, email);
      toast.success(`Email ${email} created successfully.`);
      setOpenDialogId(null);
      qc.invalidateQueries({ queryKey: ["it-requests"] });
      await loadData();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Failed to create email.");
    } finally {
      setCreating(null);
    }
  };

  const metrics = [
    { label: "Pending", value: pendingRequests.length, icon: Clock },
    {
      label: "Overdue (3+ days)",
      value: pendingRequests.filter((r) => {
        const diffDays = (now - new Date(r.createdAt).getTime()) / 86400000;
        return diffDays >= 3;
      }).length,
      icon: AlertTriangle,
    },
    { label: "Completed", value: completedRequests.length, icon: CheckCircle2 },
    { label: "Total", value: pendingRequests.length + completedRequests.length, icon: MonitorSmartphone },
  ];

  const sortedCompleted = [...completedRequests].sort((a, b) =>
    String(b.completedAt ?? b.updatedAt ?? "").localeCompare(String(a.completedAt ?? a.updatedAt ?? ""))
  );
  const visibleRequests =
    statusFilter === "pending" ? pendingRequests :
    statusFilter === "completed" ? sortedCompleted :
    [...pendingRequests, ...sortedCompleted];
  const filtered = visibleRequests.filter((r) =>
    !search || (r.candidateName ?? "").toLowerCase().includes(search.toLowerCase()) ||
    r.suggestedEmail.toLowerCase().includes(search.toLowerCase()) ||
    (r.createdEmail ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4 overflow-x-hidden animate-fade-in">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <MonitorSmartphone className="h-6 w-6 text-primary" />
          IT Requests — Email Creation
        </h1>
        <p className="text-muted-foreground">Create official Ethara emails for onboarding candidates</p>
      </div>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
            <m.icon className="h-5 w-5 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-xl font-bold">{isLoading ? "—" : m.value}</p>
              <p className="break-words text-xs text-muted-foreground">{m.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search candidates..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 rounded-xl h-10"
        />
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-base">Email Creation Queue</CardTitle>
              <CardDescription>Candidates who need an official Ethara email — completed requests stay listed</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {([
                { value: "all", label: "All" },
                { value: "pending", label: "Pending" },
                { value: "completed", label: "Completed" },
              ] as const).map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => setStatusFilter(filter.value)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    statusFilter === filter.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/30"
                  )}
                >
                  {filter.label}
                </button>
              ))}
              <Badge variant="outline" className="w-fit text-xs">
                {isLoading ? "—" : `${pendingRequests.length} pending · ${completedRequests.length} completed`}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-muted-foreground">
              <Users className="h-8 w-8 opacity-30 mb-2" />
              <p className="text-sm">
                {statusFilter === "completed" ? "No completed email requests yet" : "No email creation requests found"}
              </p>
            </div>
          ) : (
            filtered.map((req) => {
              const isCompleted = req.status === "completed";
              const diffDays = (now - new Date(req.createdAt).getTime()) / 86400000;
              const isOverdue = !isCompleted && diffDays >= 3;
              return (
                <div
                  key={req.id}
                  className={cn(
                    "flex flex-col gap-3 rounded-xl border p-4 transition-all sm:flex-row sm:items-center sm:justify-between",
                    isOverdue ? "border-destructive/30 bg-destructive/5" : "border-border hover:bg-muted/20"
                  )}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <Avatar className="h-10 w-10 shrink-0 sm:h-9 sm:w-9">
                      <AvatarFallback className={cn("text-xs", isCompleted ? "bg-success/10 text-success" : "bg-primary/10 text-primary")}>
                        {getInitials(req.candidateName ?? "?")}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold">{req.candidateName ?? "Unknown Candidate"}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {isCompleted
                          ? `Completed ${req.completedAt ? timeAgo(req.completedAt) : ""} · requested ${timeAgo(req.createdAt)}`
                          : `Pending since ${timeAgo(req.createdAt)}`}
                      </p>
                      <p className="mt-0.5 break-all text-[10px] text-muted-foreground/60">
                        {isCompleted ? "Email" : "Suggested"}:{" "}
                        <span className="font-mono font-medium text-foreground">{isCompleted ? (req.createdEmail ?? req.suggestedEmail) : req.suggestedEmail}</span>
                      </p>
                    </div>
                  </div>
                  <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-none sm:flex sm:items-center sm:gap-3">
                    <Badge
                      variant={isCompleted ? "default" : isOverdue ? "destructive" : "secondary"}
                      className="w-fit text-[10px]"
                    >
                      {isCompleted ? "Completed" : isOverdue ? `${Math.floor(diffDays)}d overdue` : "Pending"}
                    </Badge>
                    {isCompleted ? (
                      <span className="flex items-center gap-1 text-xs text-success">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Email created
                      </span>
                    ) : (
                    <Dialog
                      open={openDialogId === req.id}
                      onOpenChange={(o) => setOpenDialogId(o ? req.id : null)}
                    >
                      <DialogTrigger
                        render={
                          <Button size="sm" className="rounded-xl text-xs" disabled={creating === req.id} />
                        }
                      >
                        {creating === req.id
                          ? <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Creating...</span>
                          : <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> Create Email</span>}
                      </DialogTrigger>
                      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Create Ethara Email</DialogTitle>
                          <DialogDescription>
                            Confirm or modify the email for {req.candidateName ?? "this candidate"}
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">Email Address</Label>
                            <Input
                              defaultValue={req.suggestedEmail}
                              onChange={(e) =>
                                setEmailOverrides((prev) => ({ ...prev, [req.id]: e.target.value }))
                              }
                              className="rounded-xl"
                            />
                            <p className="text-[10px] text-muted-foreground">
                              Email will be assigned as the candidate&apos;s official Ethara address
                            </p>
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              className="rounded-xl text-xs"
                              onClick={() => setOpenDialogId(null)}
                            >
                              Cancel
                            </Button>
                            <Button
                              className="rounded-xl text-xs"
                              disabled={creating === req.id}
                              onClick={() => handleCreate(req)}
                            >
                              {creating === req.id
                                ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Creating...</>
                                : <><Mail className="mr-1.5 h-3.5 w-3.5" /> Confirm & Create</>}
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
