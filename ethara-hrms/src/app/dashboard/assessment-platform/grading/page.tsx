"use client";

import { useRouter } from "next/navigation";
import { useGradingQueue } from "@/lib/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ClipboardCheck } from "lucide-react";

export default function GradingQueuePage() {
  const router = useRouter();
  const { data: queue, isLoading } = useGradingQueue();
  const rows = queue ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Grading Queue</h1>
        <p className="text-sm text-muted-foreground">Submitted attempts with answers awaiting manual review.</p>
      </div>
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
              <ClipboardCheck className="size-8" /><p>Nothing to grade. You&apos;re all caught up.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Assessment</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-center">Auto score</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <p className="font-medium">{a.name ?? a.email}</p>
                      <p className="text-xs text-muted-foreground">{a.email}</p>
                    </TableCell>
                    <TableCell>{a.assessmentTitle}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{a.submittedAt ? new Date(a.submittedAt).toLocaleString() : "—"}</TableCell>
                    <TableCell className="text-center">{a.autoScore ?? 0}/{a.maxScore ?? 0}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" onClick={() => router.push(`/dashboard/assessment-platform/grading/${a.id}`)}>Grade</Button>
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
