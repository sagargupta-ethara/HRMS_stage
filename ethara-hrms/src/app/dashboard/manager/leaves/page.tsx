"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";
import { CalendarDays, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { leaveApi, type LeaveRequest } from "@/lib/api";

const LEAVE_TYPE_LABELS: Record<string, string> = {
  casual: "Casual", sick: "Sick", earned: "Earned",
  maternity: "Maternity", paternity: "Paternity", unpaid: "Unpaid", compensatory: "Comp Off",
};

export default function ManagerLeavesPage() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<LeaveRequest | null>(null);
  const [action, setAction] = useState<"approved" | "rejected" | null>(null);
  const [remarks, setRemarks] = useState("");
  const [acting, setActing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await leaveApi.managerInbox();
      setRequests(data);
    } catch {
      toast.error("Failed to load leave requests");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const handleAction = async () => {
    if (!selected || !action) return;
    setActing(true);
    try {
      await leaveApi.managerAction(selected.id, action, remarks || undefined);
      toast.success(`Leave ${action}`);
      setSelected(null);
      setAction(null);
      setRemarks("");
      void load();
    } catch {
      toast.error("Action failed");
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <CalendarDays className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-semibold">Leave Approvals</h1>
          <p className="text-sm text-muted-foreground">Review and action team leave requests</p>
        </div>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Pending ({requests.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : requests.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-3 text-center">
              <CheckCircle2 className="h-8 w-8 text-success" />
              <p className="text-sm text-muted-foreground">No pending leave requests</p>
            </div>
          ) : (
            <div className="space-y-2">
              {requests.map((r) => (
                <div key={r.id} className="flex items-center gap-4 rounded-xl border border-border p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{r.employeeName}</p>
                      <Badge variant="secondary" className="text-xs">{LEAVE_TYPE_LABELS[r.leaveType] || r.leaveType}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDate(r.startDate)} – {formatDate(r.endDate)} · {r.days} day{r.days !== 1 ? "s" : ""}
                      {r.reason && ` · ${r.reason}`}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      onClick={() => { setSelected(r); setAction("approved"); }}
                    >
                      <CheckCircle2 className="h-3 w-3" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 gap-1 text-xs"
                      onClick={() => { setSelected(r); setAction("rejected"); }}
                    >
                      <XCircle className="h-3 w-3" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) { setSelected(null); setAction(null); setRemarks(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{action === "approved" ? "Approve" : "Reject"} Leave Request</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 py-2">
              <div className="rounded-xl bg-muted/40 p-3 text-sm">
                <p className="font-medium">{selected.employeeName}</p>
                <p className="text-muted-foreground">
                  {LEAVE_TYPE_LABELS[selected.leaveType] || selected.leaveType} · {selected.days} days
                  · {formatDate(selected.startDate)} – {formatDate(selected.endDate)}
                </p>
                {selected.reason && <p className="mt-1 text-xs">{selected.reason}</p>}
              </div>
              <div className="space-y-2">
                <Label>Remarks (optional)</Label>
                <Textarea
                  placeholder="Add remarks…"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSelected(null); setAction(null); }} disabled={acting}>
              Cancel
            </Button>
            <Button
              onClick={handleAction}
              disabled={acting}
              variant={action === "rejected" ? "destructive" : "default"}
              className="gap-2"
            >
              {acting && <Loader2 className="h-4 w-4 animate-spin" />}
              {action === "approved" ? "Confirm Approval" : "Confirm Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
