"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatDate, formatLabel } from "@/lib/utils";
import {
  ArrowRightLeft, CheckCircle2, Download, Laptop, Loader2, Package, Plus, RefreshCw, Search,
} from "lucide-react";
import { toast } from "sonner";
import { assetsApi, employeesApi, type EmployeeAsset } from "@/lib/api";
import { exportToCsv } from "@/lib/export";

type Employee = {
  id: string;
  fullName?: string | null;
  name?: string | null;
  employeeCode?: string | null;
  etharaEmail?: string | null;
};

type AssetDraft = {
  assetType: string;
  model: string;
  serialNumber: string;
  chargerIssued: boolean;
  assetTag: string;
  notes: string;
};

const ASSET_TYPES = ["Laptop", "Mobile", "Monitor", "Keyboard", "Mouse", "Headset", "Docking Station", "Other"];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  assigned: "default",
  returned: "secondary",
  damaged: "destructive",
};

const STATUS_LABEL: Record<string, string> = {
  assigned: "Assigned",
  returned: "Returned",
  damaged: "Damaged",
};

const EMPTY_ASSIGN_FORM = {
  employee_profile_id: "",
};

const createAssetDraft = (assetType = "Laptop"): AssetDraft => ({
  assetType,
  model: "",
  serialNumber: "",
  notes: "",
  chargerIssued: false,
  assetTag: "",
});

function employeeDisplayName(employee?: Employee | null): string {
  return employee?.fullName || employee?.name || "Unnamed employee";
}

function employeeOptionLabel(employee?: Employee | null): string {
  if (!employee) return "";
  const code = employee.employeeCode || employee.etharaEmail || "";
  return `${employeeDisplayName(employee)}${code ? ` (${code})` : ""}`;
}

export default function ITAssetsPage() {
  const [assets, setAssets] = useState<EmployeeAsset[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "assigned" | "returned" | "damaged">("all");

  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_ASSIGN_FORM });
  const [assetDrafts, setAssetDrafts] = useState<AssetDraft[]>([createAssetDraft()]);

  const [reassignAsset, setReassignAsset] = useState<EmployeeAsset | null>(null);
  const [reassignEmployeeId, setReassignEmployeeId] = useState("");
  const [reassignCharger, setReassignCharger] = useState(false);
  const [reassignNotes, setReassignNotes] = useState("");
  const [reassigning, setReassigning] = useState(false);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [a, e] = await Promise.all([
        assetsApi.list(),
        employeesApi.list({ limit: 500 }).then((r) => Array.isArray(r) ? r : (r as { data?: unknown[] }).data ?? []),
      ]);
      setAssets(a);
      setEmployees(e as Employee[]);
    } catch {
      toast.error("Failed to load assets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const filtered = assets.filter((a) => {
    const q = search.toLowerCase();
    const matchesSearch = !q
      || a.employeeName?.toLowerCase().includes(q)
      || a.serialNumber?.toLowerCase().includes(q)
      || a.model?.toLowerCase().includes(q)
      || a.assetType?.toLowerCase().includes(q)
      || a.assetTag?.toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" || a.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const counts = {
    all: assets.length,
    assigned: assets.filter((a) => a.status === "assigned").length,
    returned: assets.filter((a) => a.status === "returned").length,
    damaged: assets.filter((a) => a.status === "damaged").length,
  };

  const selectedAssetTypes = assetDrafts.map((draft) => draft.assetType);

  const toggleAssetType = (assetType: string) => {
    const alreadySelected = selectedAssetTypes.includes(assetType);
    if (alreadySelected && assetDrafts.length === 1) {
      toast.error("Select at least one asset type");
      return;
    }
    setAssetDrafts((current) => (
      current.some((draft) => draft.assetType === assetType)
        ? current.filter((draft) => draft.assetType !== assetType)
        : [...current, createAssetDraft(assetType)]
    ));
  };

  const updateAssetDraft = (index: number, patch: Partial<AssetDraft>) => {
    setAssetDrafts((current) => current.map((draft, i) => (
      i === index ? { ...draft, ...patch } : draft
    )));
  };

  const handleAssign = async () => {
    if (!form.employee_profile_id || assetDrafts.length === 0) {
      toast.error("Select an employee and asset type");
      return;
    }
    setSaving(true);
    try {
      for (const draft of assetDrafts) {
        await assetsApi.assign({
          employee_profile_id: form.employee_profile_id,
          asset_type: draft.assetType,
          model: draft.model.trim() || undefined,
          serial_number: draft.serialNumber.trim() || undefined,
          charger_issued: draft.chargerIssued,
          asset_tag: draft.assetTag.trim() || undefined,
          notes: draft.notes.trim() || undefined,
        });
      }
      toast.success(assetDrafts.length === 1 ? "Asset assigned successfully" : `${assetDrafts.length} assets assigned successfully`);
      setAddOpen(false);
      setForm({ ...EMPTY_ASSIGN_FORM });
      setAssetDrafts([createAssetDraft()]);
      void load(true);
    } catch {
      toast.error("Failed to assign asset");
    } finally {
      setSaving(false);
    }
  };

  const handleMarkReturned = async (assetId: string) => {
    try {
      await assetsApi.update(assetId, { status: "returned" });
      toast.success("Asset marked as returned");
      void load(true);
    } catch {
      toast.error("Failed to update asset");
    }
  };

  const openReassign = (asset: EmployeeAsset) => {
    setReassignAsset(asset);
    setReassignEmployeeId("");
    setReassignCharger(asset.chargerIssued);
    setReassignNotes(asset.notes ?? "");
  };

  const handleReassign = async () => {
    if (!reassignAsset || !reassignEmployeeId) {
      toast.error("Select the new employee to assign this asset to");
      return;
    }
    if (reassignEmployeeId === reassignAsset.employeeProfileId) {
      toast.error("Same employee selected — choose a different employee");
      return;
    }
    setReassigning(true);
    try {
      await assetsApi.reassign(reassignAsset.id, {
        employee_profile_id: reassignEmployeeId,
        charger_issued: reassignCharger,
        notes: reassignNotes.trim() || undefined,
      });
      const emp = employees.find((e) => e.id === reassignEmployeeId);
      toast.success(`Asset reassigned to ${emp ? employeeOptionLabel(emp) : "new employee"}`);
      setReassignAsset(null);
      void load(true);
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Failed to reassign asset");
    } finally {
      setReassigning(false);
    }
  };

  const currentOwner = reassignAsset
    ? employees.find((e) => e.id === reassignAsset.employeeProfileId)
    : null;
  const selectedAssignEmployee = employees.find((e) => e.id === form.employee_profile_id);
  const selectedReassignEmployee = employees.find((e) => e.id === reassignEmployeeId);

  const handleExportAssets = () => {
    if (filtered.length === 0) {
      toast.error("No assets to export.");
      return;
    }
    exportToCsv(
      filtered.map((asset) => ({
        employeeName: asset.employeeName ?? "",
        employeeCode: asset.employeeCode ?? "",
        assetType: asset.assetType,
        model: asset.model ?? "",
        serialNumber: asset.serialNumber ?? "",
        assetTag: asset.assetTag ?? "",
        chargerIssued: asset.chargerIssued ? "Yes" : "No",
        status: STATUS_LABEL[asset.status] ?? formatLabel(asset.status),
        assignedAt: asset.assignedAt ? formatDate(asset.assignedAt) : "",
        returnedAt: asset.returnedAt ? formatDate(asset.returnedAt) : "",
        returnCondition: asset.returnCondition ?? "",
        notes: asset.notes ?? "",
        createdAt: asset.createdAt ? formatDate(asset.createdAt) : "",
      })),
      [
        { key: "employeeName", header: "Employee Name" },
        { key: "employeeCode", header: "Employee Code" },
        { key: "assetType", header: "Asset Type" },
        { key: "model", header: "Model" },
        { key: "serialNumber", header: "Serial Number" },
        { key: "assetTag", header: "Asset Tag" },
        { key: "chargerIssued", header: "Charger Issued" },
        { key: "status", header: "Status" },
        { key: "assignedAt", header: "Assigned At" },
        { key: "returnedAt", header: "Returned At" },
        { key: "returnCondition", header: "Return Condition" },
        { key: "notes", header: "Notes" },
        { key: "createdAt", header: "Created At" },
      ],
      `it_assets_${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  return (
    <div className="space-y-5 overflow-x-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Laptop className="h-6 w-6 text-muted-foreground" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">IT Asset Management</h1>
            <p className="text-sm text-muted-foreground">Assign, track, and reassign employee devices</p>
          </div>
        </div>
        <div className="grid w-full grid-cols-[1fr_auto] items-center gap-2 sm:flex sm:w-auto">
          <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={handleExportAssets}>
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button variant="ghost" size="icon" className="rounded-xl h-9 w-9" onClick={() => void load()}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          <Button onClick={() => setAddOpen(true)} className="col-span-2 gap-2 rounded-xl sm:col-span-1">
            <Plus className="h-4 w-4" /> Assign Asset
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { key: "all", label: "Total Assets", value: counts.all, icon: Package, color: "text-primary" },
          { key: "assigned", label: "Assigned", value: counts.assigned, icon: CheckCircle2, color: "text-success" },
          { key: "returned", label: "Returned", value: counts.returned, icon: Package, color: "text-muted-foreground" },
          { key: "damaged", label: "Damaged", value: counts.damaged, icon: Package, color: "text-destructive" },
        ].map((s) => (
          <Card
            key={s.key}
            className={cn(
              "border-0 shadow-sm cursor-pointer transition-all",
              statusFilter === s.key && "ring-2 ring-primary"
            )}
            onClick={() => setStatusFilter(s.key as typeof statusFilter)}
          >
            <CardContent className="flex min-w-0 items-center gap-3 pt-4 pb-4 sm:gap-4 sm:pt-5">
              <div className="shrink-0 rounded-xl bg-muted/40 p-2.5">
                <s.icon className={cn("h-5 w-5", s.color)} />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold">{loading ? "—" : s.value}</p>
                <p className="break-words text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <CardTitle className="text-sm">
              Assets {statusFilter !== "all" ? `— ${STATUS_LABEL[statusFilter] ?? formatLabel(statusFilter)}` : ""} ({filtered.length})
            </CardTitle>
            <div className="relative w-full sm:w-auto">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search employee, serial, model…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-full rounded-xl pl-8 text-sm sm:h-8 sm:w-64"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
            <div className="space-y-3 px-4 pb-4 sm:hidden">
              {filtered.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No assets found
                </div>
              ) : (
                filtered.map((a) => (
                  <div key={a.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium">{a.employeeName || "—"}</p>
                        <p className="break-all font-mono text-xs text-muted-foreground">{a.employeeCode}</p>
                      </div>
                      <Badge variant={STATUS_VARIANT[a.status] ?? "outline"} className="shrink-0 text-xs">
                        {STATUS_LABEL[a.status] ?? formatLabel(a.status)}
                      </Badge>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-muted-foreground">Type</p>
                        <Badge variant="secondary" className="mt-1 text-xs">{a.assetType}</Badge>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Charger</p>
                        <Badge variant={a.chargerIssued ? "default" : "outline"} className="mt-1 text-xs">
                          {a.chargerIssued ? "Yes" : "No"}
                        </Badge>
                      </div>
                      <div className="col-span-2">
                        <p className="text-muted-foreground">Model / Serial</p>
                        <p className="mt-1 break-words">{a.model || "—"}</p>
                        {a.serialNumber && <p className="break-all font-mono text-muted-foreground">{a.serialNumber}</p>}
                        {a.assetTag && <p className="break-words text-muted-foreground">Tag: {a.assetTag}</p>}
                      </div>
                      <div className="col-span-2">
                        <p className="text-muted-foreground">Assigned</p>
                        <p className="mt-1">{a.assignedAt ? formatDate(a.assignedAt) : "—"}</p>
                        {a.returnedAt && (
                          <p className="text-muted-foreground/60">Returned: {formatDate(a.returnedAt)}</p>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 gap-1 rounded-lg text-xs"
                        onClick={() => openReassign(a)}
                      >
                        <ArrowRightLeft className="h-3 w-3" /> Reassign
                      </Button>
                      {a.status === "assigned" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 rounded-lg text-xs"
                          onClick={() => handleMarkReturned(a.id)}
                        >
                          Returned
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="hidden w-full overflow-x-auto sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Model / Serial</TableHead>
                  <TableHead>Charger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                      No assets found
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <p className="text-sm font-medium">{a.employeeName || "—"}</p>
                        <p className="text-xs text-muted-foreground font-mono">{a.employeeCode}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">{a.assetType}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        <p>{a.model || "—"}</p>
                        <p className="text-muted-foreground font-mono">{a.serialNumber || ""}</p>
                        {a.assetTag && <p className="text-muted-foreground">Tag: {a.assetTag}</p>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={a.chargerIssued ? "default" : "outline"} className="text-xs">
                          {a.chargerIssued ? "Yes" : "No"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[a.status] ?? "outline"} className="text-xs">
                          {STATUS_LABEL[a.status] ?? formatLabel(a.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.assignedAt ? formatDate(a.assignedAt) : "—"}
                        {a.returnedAt && (
                          <p className="text-muted-foreground/60">Returned: {formatDate(a.returnedAt)}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 rounded-lg"
                            onClick={() => openReassign(a)}
                            title="Reassign to another employee"
                          >
                            <ArrowRightLeft className="h-3 w-3" /> Reassign
                          </Button>
                          {a.status === "assigned" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs rounded-lg"
                              onClick={() => handleMarkReturned(a.id)}
                            >
                              Returned
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open && !saving) {
            setForm({ ...EMPTY_ASSIGN_FORM });
            setAssetDrafts([createAssetDraft()]);
          }
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Assign New Asset</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Employee *</Label>
              <Select
                value={form.employee_profile_id}
                onValueChange={(v) => setForm((f) => ({ ...f, employee_profile_id: v ?? "" }))}
              >
                <SelectTrigger className="w-full min-w-0 rounded-xl">
                  <SelectValue className="min-w-0 truncate" placeholder="Select employee…">
                    {selectedAssignEmployee ? employeeOptionLabel(selectedAssignEmployee) : "Select employee…"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="w-auto min-w-[var(--anchor-width)] max-w-[calc(100vw-3rem)]">
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {employeeOptionLabel(e)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Asset Types *</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {ASSET_TYPES.map((type) => {
                  const selected = selectedAssetTypes.includes(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => toggleAssetType(type)}
                      className={cn(
                        "flex h-10 min-w-0 items-center justify-between gap-2 rounded-xl border px-3 text-left text-sm transition-colors",
                        selected
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-muted/10 text-foreground hover:bg-muted/20",
                      )}
                    >
                      <span className="truncate">{type}</span>
                      {selected && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              {assetDrafts.map((draft, index) => (
                <div key={draft.assetType} className="rounded-xl border border-border bg-muted/10 p-3">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <Label className="min-w-0 truncate text-sm font-semibold">{draft.assetType} details</Label>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">Asset {index + 1}</Badge>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`asset-model-${index}`}>Model</Label>
                      <Input
                        id={`asset-model-${index}`}
                        placeholder="e.g. Dell Latitude 5530"
                        value={draft.model}
                        onChange={(e) => updateAssetDraft(index, { model: e.target.value })}
                        className="rounded-xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`asset-serial-${index}`}>Serial Number</Label>
                      <Input
                        id={`asset-serial-${index}`}
                        placeholder="Serial / IMEI"
                        value={draft.serialNumber}
                        onChange={(e) => updateAssetDraft(index, { serialNumber: e.target.value })}
                        className="rounded-xl"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor={`asset-tag-${index}`}>Asset Tag</Label>
                      <Input
                        id={`asset-tag-${index}`}
                        placeholder="e.g. ETH-LT-001"
                        value={draft.assetTag}
                        onChange={(e) => updateAssetDraft(index, { assetTag: e.target.value })}
                        className="rounded-xl"
                      />
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    <Label htmlFor={`asset-notes-${index}`}>Notes</Label>
                    <Textarea
                      id={`asset-notes-${index}`}
                      placeholder="Condition, accessories included, etc."
                      value={draft.notes}
                      onChange={(e) => updateAssetDraft(index, { notes: e.target.value })}
                      rows={2}
                      className="resize-none rounded-xl"
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <input
                      type="checkbox"
                      id={`asset-charger-${index}`}
                      checked={draft.chargerIssued}
                      onChange={(e) => updateAssetDraft(index, { chargerIssued: e.target.checked })}
                      className="h-4 w-4 rounded"
                    />
                    <Label htmlFor={`asset-charger-${index}`}>Charger Issued</Label>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleAssign} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Assign Asset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!reassignAsset}
        onOpenChange={(open) => { if (!open) setReassignAsset(null); }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-primary" />
              Reassign Asset
            </DialogTitle>
          </DialogHeader>
          {reassignAsset && (
            <div className="space-y-4 py-2">
              <div
                className="rounded-xl p-3 text-sm space-y-1"
                style={{ background: "rgba(144,141,206,0.07)", border: "1px solid rgba(144,141,206,0.18)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{reassignAsset.assetType}</span>
                  <Badge variant={STATUS_VARIANT[reassignAsset.status] ?? "outline"} className="text-[10px]">
                    {STATUS_LABEL[reassignAsset.status] ?? formatLabel(reassignAsset.status)}
                  </Badge>
                </div>
                {reassignAsset.model && (
                  <p className="text-xs text-muted-foreground">{reassignAsset.model}</p>
                )}
                {reassignAsset.serialNumber && (
                  <p className="text-xs text-muted-foreground font-mono">{reassignAsset.serialNumber}</p>
                )}
                {currentOwner && (
                  <p className="text-xs text-muted-foreground">
                    Currently: <span className="font-medium text-foreground">{employeeOptionLabel(currentOwner)}</span>
                  </p>
                )}
                {reassignAsset.employeeName && !currentOwner && (
                  <p className="text-xs text-muted-foreground">
                    Currently: <span className="font-medium text-foreground">{reassignAsset.employeeName}</span>
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Assign To *</Label>
                <Select
                  value={reassignEmployeeId}
                  onValueChange={(v) => setReassignEmployeeId(v ?? "")}
                >
                  <SelectTrigger className="w-full min-w-0 rounded-xl">
                    <SelectValue className="min-w-0 truncate" placeholder="Select new employee…">
                      {selectedReassignEmployee ? employeeOptionLabel(selectedReassignEmployee) : "Select new employee…"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="w-auto min-w-[var(--anchor-width)] max-w-[calc(100vw-3rem)]">
                    {employees
                      .filter((e) => e.id !== reassignAsset.employeeProfileId)
                      .map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {employeeOptionLabel(e)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Current owner is excluded from the list.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="reassign-charger"
                  checked={reassignCharger}
                  onChange={(e) => setReassignCharger(e.target.checked)}
                  className="h-4 w-4 rounded"
                />
                <Label htmlFor="reassign-charger">Charger included in reassignment</Label>
              </div>

              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea
                  placeholder="Handover notes, condition at reassignment, etc."
                  value={reassignNotes}
                  onChange={(e) => setReassignNotes(e.target.value)}
                  rows={2}
                  className="rounded-xl resize-none"
                />
              </div>

              <div
                className="rounded-xl px-3 py-2 text-xs"
                style={{ background: "rgba(144,141,206,0.06)", border: "1px solid rgba(144,141,206,0.14)" }}
              >
                This will mark the asset as <strong>Assigned</strong> to the new employee, update the assigned date, and log the reassignment.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignAsset(null)} disabled={reassigning}>
              Cancel
            </Button>
            <Button
              onClick={handleReassign}
              disabled={reassigning || !reassignEmployeeId}
              className="gap-2"
            >
              {reassigning && <Loader2 className="h-4 w-4 animate-spin" />}
              <ArrowRightLeft className="h-3.5 w-3.5" />
              Confirm Reassignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
