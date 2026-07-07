"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { employeesApi, type EmployeeIdCardDetails } from "@/lib/api";

type Mode = "staff" | "self";

export function IdCardDetailsCard({
  mode,
  employeeId,
  onSaved,
}: {
  mode: Mode;
  employeeId?: string;
  onSaved?: (details: EmployeeIdCardDetails) => void;
}) {
  const [details, setDetails] = useState<EmployeeIdCardDetails | null>(null);
  const [bloodGroup, setBloodGroup] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    const load = mode === "self"
      ? employeesApi.getMyIdCardDetails()
      : employeesApi.getIdCardDetails(employeeId as string);
    load
      .then((d) => {
        if (cancelled) return;
        setDetails(d);
        setBloodGroup(d.bloodGroup ?? "");
        setEmergencyPhone(d.emergencyContactPhone ?? "");
      })
      .catch(() => {
        if (!cancelled) toast.error("Could not load ID card details.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, employeeId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { bloodGroup, emergencyContactPhone: emergencyPhone };
      const saved = mode === "self"
        ? await employeesApi.saveMyIdCardDetails(payload)
        : await employeesApi.saveIdCardDetails(employeeId as string, payload);
      setDetails(saved);
      toast.success("ID card details saved.");
      onSaved?.(saved);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not save ID card details.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading ID card details…
        </CardContent>
      </Card>
    );
  }

  // The ID Card module only applies to employees onboarded through the HRMS.
  if (!details?.applicable) {
    if (mode === "staff") return null;
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="py-6 text-sm text-muted-foreground">
          ID card details are not required for your account.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" /> ID Card Details
        </CardTitle>
        {details.incomplete && (
          <Badge variant="warning" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> Incomplete
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {details.incomplete && (
          <p className="rounded-lg border border-warning/25 bg-warning/10 p-3 text-xs text-warning">
            Blood group is required for the ID card and is still missing.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs text-muted-foreground">Name</Label>
            <Input className="mt-1" value={details.name} readOnly disabled />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Employee ID</Label>
            <Input className="mt-1" value={details.employeeId || "—"} readOnly disabled />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Blood Group</Label>
            <Input
              className="mt-1"
              placeholder="e.g. O+, A-, AB+"
              value={bloodGroup}
              onChange={(e) => setBloodGroup(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Emergency Contact Number</Label>
            <Input
              className="mt-1"
              placeholder="10-digit phone"
              value={emergencyPhone}
              onChange={(e) => setEmergencyPhone(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
            {saving ? "Saving…" : "Save ID Card Details"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
