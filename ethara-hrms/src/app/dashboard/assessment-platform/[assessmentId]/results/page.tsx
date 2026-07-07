"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useApResults, useReleaseResults, useReleaseAttempt } from "@/lib/queries";
import { assessmentPlatformApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ApStatusBadge } from "@/components/assessment-platform/question-types";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Download, Send, CheckCircle2, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";

export default function ResultsPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.assessmentId);
  const { data, isLoading } = useApResults(id, { limit: 200 });
  const releaseAll = useReleaseResults(id);
  const releaseOne = useReleaseAttempt(id);
  const [exporting, setExporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [verdict, setVerdict] = useState("all");

  const syncSheet = async () => {
    setSyncing(true);
    try {
      const res = await assessmentPlatformApi.resyncSheet(id);
      toast.success(`Synced ${res.synced} of ${res.total} submission(s) to the Google Sheet.`);
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail ?? "Could not sync to the Google Sheet.");
    } finally {
      setSyncing(false);
    }
  };

  const rows = useMemo(() => {
    const all = data?.data ?? [];
    if (verdict === "all") return all;
    if (verdict === "pending") return all.filter((a) => !a.resultStatus || a.resultStatus === "pending");
    return all.filter((a) => a.resultStatus === verdict);
  }, [data, verdict]);

  const releasable = (data?.data ?? []).some((a) => a.resultStatus && a.resultStatus !== "pending" && !a.resultReleased);

  return (
    <div className="space-y-5">
      <Link href={`/dashboard/assessment-platform/${id}/edit`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to builder
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Results</h1>
          <p className="text-sm text-muted-foreground">{data?.assessment?.title} — {data?.total ?? 0} attempt(s)</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={verdict} onValueChange={(v) => setVerdict(v ?? "all")}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All verdicts</SelectItem>
              <SelectItem value="pass">Pass</SelectItem>
              <SelectItem value="fail">Fail</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
          <Button disabled={!releasable || releaseAll.isPending}
            onClick={() => { if (confirm("Release all graded results? Candidates will then see their verdict.")) releaseAll.mutate(); }}>
            <Send className="size-4" /> Release results
          </Button>
          <Button variant="outline" disabled={syncing || (data?.data ?? []).length === 0} onClick={syncSheet}>
            <FileSpreadsheet className="size-4" /> {syncing ? "Syncing…" : "Sync to Sheet"}
          </Button>
          <Button variant="outline" disabled={exporting || (data?.data ?? []).length === 0}
            onClick={async () => { setExporting(true); try { await assessmentPlatformApi.exportResultsCsv(id); } finally { setExporting(false); } }}>
            <Download className="size-4" /> Export CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">No attempts.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Score</TableHead>
                  <TableHead className="text-center">%</TableHead>
                  <TableHead>Verdict</TableHead>
                  <TableHead className="text-right">Release</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.id} className="cursor-pointer" onClick={() => router.push(`/dashboard/assessment-platform/${id}/results/${a.id}`)}>
                    <TableCell>
                      <p className="font-medium">{a.name ?? a.email}</p>
                      <p className="text-xs text-muted-foreground">{a.email}</p>
                    </TableCell>
                    <TableCell><ApStatusBadge status={a.status} /></TableCell>
                    <TableCell className="text-center">{a.totalScore != null ? `${a.totalScore}/${a.maxScore}` : "—"}</TableCell>
                    <TableCell className="text-center">{a.percentage != null ? `${a.percentage}%` : "—"}</TableCell>
                    <TableCell>{a.resultStatus ? <ApStatusBadge status={a.resultStatus} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {a.resultReleased ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="size-3.5" /> Released</span>
                      ) : a.resultStatus && a.resultStatus !== "pending" ? (
                        <Button variant="ghost" size="sm" disabled={releaseOne.isPending} onClick={() => releaseOne.mutate(a.id)}>Release</Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
