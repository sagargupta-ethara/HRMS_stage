"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useApAssessment, useApAssignments, useResendInvite, useRevokeAssignment,
} from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ApStatusBadge } from "@/components/assessment-platform/question-types";
import { BulkAssignDialog } from "@/components/assessment-platform/bulk-assign-dialog";
import { ArrowLeft, UserPlus, Mail, Ban, CheckCircle2, Upload } from "lucide-react";
import { ResultsUploadDialog } from "@/components/assessment-platform/results-upload-dialog";

export default function AssignmentsPage() {
  const params = useParams();
  const id = String(params.assessmentId);
  const { data: assessment } = useApAssessment(id);
  const { data: assignments, isLoading } = useApAssignments(id);
  const resend = useResendInvite(id);
  const revoke = useRevokeAssignment(id);
  const [open, setOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; email: string } | null>(null);

  const rows = assignments ?? [];

  return (
    <div className="space-y-5">
      <Link href={`/dashboard/assessment-platform/${id}/edit`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to builder
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Assignments</h1>
          <p className="text-sm text-muted-foreground">{assessment?.title} — invite candidates by email. They must log in to take it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setUploadOpen(true)}>
            <Upload className="size-4" /> Upload results
          </Button>
          <Button onClick={() => setOpen(true)} disabled={assessment?.status !== "published"}>
            <UserPlus className="size-4" /> Assign by email
          </Button>
        </div>
      </div>

      {assessment && assessment.status !== "published" && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
          Publish this assessment before assigning it.
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <div className="py-14 text-center text-sm text-muted-foreground">No one assigned yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempt</TableHead>
                  <TableHead className="text-center">Score</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <p className="font-medium">{a.email}</p>
                      {a.name && <p className="text-xs text-muted-foreground">{a.name}</p>}
                    </TableCell>
                    <TableCell>
                      {a.hasAccount
                        ? <span className="inline-flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="size-3.5" /> {a.provisioned ? "Provisioned" : "Existing"}</span>
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell><ApStatusBadge status={a.status} /></TableCell>
                    <TableCell>{a.attempt ? <ApStatusBadge status={a.attempt.resultStatus ?? a.attempt.status} /> : <span className="text-xs text-muted-foreground">Not started</span>}</TableCell>
                    <TableCell className="text-center">
                      {a.attempt?.totalScore != null ? `${a.attempt.totalScore}/${a.attempt.maxScore}` : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Resend invite" onClick={() => resend.mutate(a.id)}><Mail className="size-4" /></Button>
                        {a.status !== "revoked" && (
                          <Button variant="ghost" size="icon" title="Revoke" onClick={() => setRevokeTarget({ id: a.id, email: a.email })}>
                            <Ban className="size-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <BulkAssignDialog assessmentId={id} open={open} onOpenChange={setOpen} />
      <ResultsUploadDialog assessmentId={id} open={uploadOpen} onOpenChange={setUploadOpen} />
      <ConfirmDialog
        open={Boolean(revokeTarget)}
        title="Revoke assessment access?"
        description={revokeTarget ? `Revoke access for ${revokeTarget.email}?` : undefined}
        confirmLabel="Revoke"
        destructive
        loading={revoke.isPending}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setRevokeTarget(null);
        }}
        onConfirm={() => {
          if (!revokeTarget) return;
          revoke.mutate(revokeTarget.id, { onSettled: () => setRevokeTarget(null) });
        }}
      />
    </div>
  );
}
