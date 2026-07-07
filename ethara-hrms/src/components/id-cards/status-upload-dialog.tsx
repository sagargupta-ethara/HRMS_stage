"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { candidateIdCardApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

type UploadResult = {
  markedDone: number;
  markedPending: number;
  notFound: string[];
  skipped: { email: string; reason: string }[];
};

/**
 * "Upload ID Card Status" — a single trigger button that opens a dialog where staff
 * can download an example sheet (Email, Status) and upload a filled-in copy to bulk
 * mark ID cards as created ("Done") or revert them to outstanding ("Pending").
 *
 * Used on both the Employees page and the Office Admin dashboard (the team that
 * physically creates the cards). Match is by Ethara email.
 */
export function IdCardStatusUpload({
  onUploaded,
  triggerClassName,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
}: {
  onUploaded?: () => void;
  triggerClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const open = controlledOpen ?? internalOpen;

  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
    if (!nextOpen) setResult(null);
  };

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const res = await candidateIdCardApi.uploadStatusSheet(file);
      setResult(res);
      const extra: string[] = [];
      if (res.markedPending) extra.push(`${res.markedPending} reverted to pending`);
      if (res.notFound.length) extra.push(`${res.notFound.length} email(s) not matched`);
      if (res.skipped.length) extra.push(`${res.skipped.length} skipped`);
      toast.success(
        `${res.markedDone} ID card${res.markedDone === 1 ? "" : "s"} marked created.` +
          (extra.length ? ` ${extra.join(", ")}.` : ""),
      );
      onUploaded?.();
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Failed to process the status sheet.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      {showTrigger && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("h-9 gap-1.5 rounded-xl text-xs", triggerClassName)}
          onClick={() => setOpen(true)}
        >
          <Upload className="h-3.5 w-3.5" /> Upload ID Card Status
        </Button>
      )}

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4 text-primary" /> Upload ID Card Status
            </DialogTitle>
            <DialogDescription>
              Upload a CSV with two columns. Match each member by their Ethara email. Status accepts
              Done or Pending.
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-xs">jane.doe@ethara.ai</TableCell>
                  <TableCell className="text-xs text-emerald-400">Done</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs">john.smith@ethara.ai</TableCell>
                  <TableCell className="text-xs text-amber-400">Pending</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            <strong>Done</strong> marks the ID card as created/issued — only once the member has
            submitted their ID card details. <strong>Pending</strong> reverts a previously-issued
            card back to outstanding.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-xl text-xs"
              onClick={() => void candidateIdCardApi.downloadStatusTemplate()}
            >
              <Download className="h-3.5 w-3.5" /> Download template
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <Button
              type="button"
              size="sm"
              className="gap-1.5 rounded-xl text-xs"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Choose CSV & Upload
            </Button>
          </div>

          {result && (
            <div className="space-y-1.5 rounded-xl border border-border p-3 text-xs">
              <p className="font-semibold">
                {result.markedDone} marked created
                {result.markedPending > 0 && ` · ${result.markedPending} reverted to pending`}
              </p>
              {result.notFound.length > 0 && (
                <p className="text-amber-500">
                  Not matched: {result.notFound.slice(0, 8).join(", ")}
                  {result.notFound.length > 8 ? ` +${result.notFound.length - 8} more` : ""}
                </p>
              )}
              {result.skipped.slice(0, 8).map((s) => (
                <p key={s.email} className="text-muted-foreground">
                  {s.email}: {s.reason}
                </p>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
