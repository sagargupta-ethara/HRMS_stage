"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { formatLabel, getInitials } from "@/lib/utils";
import {
  CheckCircle2, ChevronLeft, ChevronRight, Loader2,
  RefreshCw, Search, UserCog, X,
} from "lucide-react";
import { toast } from "sonner";
import { employeesApi, type EmployeeRecord, type ManagerUser } from "@/lib/api";

const ROLE_LABELS: Record<string, string> = {
  manager: "Manager",
  hr: "HR",
  ta: "Talent Acquisition",
  admin: "Super Admin",
  super_admin: "Super Admin",
  leadership: "Leadership",
};

const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  manager: "default",
  hr: "secondary",
  ta: "secondary",
  employee: "outline",
  admin: "outline",
  super_admin: "outline",
  leadership: "outline",
};

const UNASSIGNED = "__unassigned__";
const ALL_EMPLOYEES = "__all_employees__";
const PAGE_SIZE = 20;

export default function ManagerMappingPage() {
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [managers, setManagers] = useState<ManagerUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterManager, setFilterManager] = useState<string>(ALL_EMPLOYEES);
  const [page, setPage] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedSearch(val); setPage(1); }, 300);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [empList, mgrList] = await Promise.all([
        employeesApi.list({ search: debouncedSearch || undefined }),
        employeesApi.listManagers(),
      ]);
      setEmployees(empList);
      setManagers(mgrList);
    } catch {
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadData]);

  const handleAssign = async (employee: EmployeeRecord, newManagerId: string | null) => {
    setSavingId(employee.id);
    try {
      if (newManagerId) {
        await employeesApi.assignManager(employee.id, newManagerId);
        const mgr = managers.find((m) => m.id === newManagerId);
        setEmployees((prev) =>
          prev.map((e) =>
            e.id === employee.id
              ? { ...e, managerId: newManagerId, managerName: mgr?.name ?? null, managerEmail: mgr?.email ?? null }
              : e
          )
        );
        toast.success(`${employee.name} assigned to ${mgr?.name ?? "manager"}`);
      } else {
        await employeesApi.removeManager(employee.id);
        setEmployees((prev) =>
          prev.map((e) =>
            e.id === employee.id
              ? { ...e, managerId: null, managerName: null, managerEmail: null }
              : e
          )
        );
        toast.success(`Manager removed from ${employee.name}`);
      }
    } catch {
      toast.error("Failed to update manager assignment");
    } finally {
      setSavingId(null);
    }
  };

  const filtered = employees.filter((e) => {
    if (filterManager === "__unassigned__") return !e.managerId;
    if (filterManager !== ALL_EMPLOYEES && filterManager !== "") {
      return e.managerId === filterManager;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const assignedCount = employees.filter((e) => e.managerId).length;
  const unassignedCount = employees.length - assignedCount;
  const activeCount = employees.filter((e) => e.isActive).length;

  const managerGroups = managers.map((m) => ({
    ...m,
    count: employees.filter((e) => e.managerId === m.id).length,
  }));

  return (
    <div className="space-y-5 overflow-x-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <UserCog className="h-6 w-6 text-muted-foreground" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">Manager Mapping</h1>
            <p className="text-sm text-muted-foreground">
              Assign reporting managers to employees
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={loadData} className="w-fit gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">{employees.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Total Employees</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{activeCount} active</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-success">{assignedCount}</p>
            <p className="text-xs text-muted-foreground mt-1">Manager Assigned</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-warning">{unassignedCount}</p>
            <p className="text-xs text-muted-foreground mt-1">Unassigned</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">{managers.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Available Managers</p>
          </CardContent>
        </Card>
      </div>

      {managerGroups.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Manager Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
              {managerGroups.map((m) => (
                <div
                  key={m.id}
                  className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 transition-colors hover:bg-muted/60 sm:w-auto"
                  onClick={() => { setFilterManager(m.id); setPage(1); }}
                >
                  <Avatar className="h-8 w-8 shrink-0 sm:h-6 sm:w-6">
                    <AvatarFallback className="text-[10px]">{getInitials(m.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 sm:flex-none">
                    <p className="truncate text-xs font-medium">{m.name}</p>
                    <p className="text-[10px] text-muted-foreground">{m.count} employee{m.count !== 1 ? "s" : ""}</p>
                  </div>
                  <Badge variant={ROLE_VARIANT[m.role] ?? "outline"} className="shrink-0 text-[10px]">
                    {ROLE_LABELS[m.role] ?? formatLabel(m.role)}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <CardTitle className="text-sm">
              Employees
              <span className="ml-2 font-normal text-muted-foreground">
                ({filtered.length} of {employees.length})
              </span>
            </CardTitle>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
              <div className="relative w-full sm:w-auto">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search employees…"
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="h-9 w-full pl-8 text-sm sm:h-8 sm:w-52"
                />
              </div>
              <Select
                value={filterManager}
                onValueChange={(v) => { setFilterManager(v ?? ALL_EMPLOYEES); setPage(1); }}
              >
                <SelectTrigger className="h-9 w-full text-xs sm:h-8 sm:w-48">
                  <SelectValue placeholder="Filter by manager">
                    {(value) => {
                      if (!value || value === ALL_EMPLOYEES) return "All employees";
                      if (value === UNASSIGNED) return "Unassigned only";
                      return managers.find((manager) => manager.id === value)?.name ?? "Filter by manager";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_EMPLOYEES} label="All employees">All employees</SelectItem>
                  <SelectItem value={UNASSIGNED} label="Unassigned only">Unassigned only</SelectItem>
                  <Separator className="my-1" />
                  {managers.map((m) => (
                    <SelectItem key={m.id} value={m.id} label={m.name}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : paged.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-3">
              <UserCog className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No employees found</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {paged.map((emp) => (
                <div key={emp.id} className="flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-muted/20 sm:flex-row sm:items-center sm:gap-4 sm:py-3">
                  <div className="flex min-w-0 items-start gap-3 sm:flex-1">
                    <Avatar className="h-10 w-10 shrink-0 sm:h-9 sm:w-9">
                      <AvatarFallback className="text-xs">{getInitials(emp.name)}</AvatarFallback>
                    </Avatar>

                    <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-3 md:gap-1">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="break-words text-sm font-medium sm:truncate">{emp.name}</p>
                          {emp.accessLevel === "imported" ? (
                            <Badge variant="secondary" className="text-[10px]">Pending activation</Badge>
                          ) : emp.isActive ? (
                            <Badge variant="outline" className="border-success/30 bg-success/10 text-[10px] text-success">Active</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">Inactive</Badge>
                          )}
                        </div>
                        <p className="break-all text-xs text-muted-foreground sm:truncate">{emp.etharaEmail}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="break-words text-xs text-muted-foreground">{emp.department || "—"}</p>
                        <p className="break-words text-xs font-medium">{emp.designation || "—"}</p>
                      </div>
                      <div className="min-w-0">
                        {emp.managerId ? (
                          <div className="flex items-start gap-1.5">
                            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                            <div className="min-w-0">
                              <p className="break-words text-xs font-medium sm:truncate">{emp.managerName}</p>
                              <p className="break-all text-[10px] text-muted-foreground sm:truncate">{emp.managerEmail}</p>
                            </div>
                          </div>
                        ) : (
                          <p className="flex items-center gap-1 text-xs text-warning">
                            <X className="h-3 w-3" /> Unassigned
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0">
                    {savingId === emp.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : emp.accessLevel === "imported" ? (
                      <Badge variant="outline" className="h-8 justify-center text-xs sm:w-48">
                        Stored on activation
                      </Badge>
                    ) : (
                      <Select
                        value={emp.managerId ?? ""}
                        onValueChange={(v) => handleAssign(emp, v === "__remove__" ? null : v || null)}
                      >
                        <SelectTrigger className="h-9 w-full text-xs sm:h-8 sm:w-48">
                          <SelectValue placeholder="Assign manager…">
                            {(value) => {
                              if (!value) return "Assign manager…";
                              return managers.find((manager) => manager.id === value)?.name ?? emp.managerName ?? "Assign manager…";
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__remove__" label="Remove assignment">
                            <span className="text-muted-foreground">Remove assignment</span>
                          </SelectItem>
                          <Separator className="my-1" />
                          {managers.map((m) => (
                            <SelectItem key={m.id} value={m.id} label={m.name}>
                              <div className="flex items-center gap-2">
                                <span>{m.name}</span>
                                <Badge variant={ROLE_VARIANT[m.role] ?? "outline"} className="text-[10px] py-0">
                                  {ROLE_LABELS[m.role] ?? formatLabel(m.role)}
                                </Badge>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <>
              <Separator />
              <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {page} of {totalPages} · {filtered.length} employees
                </p>
                <div className="flex gap-2 sm:justify-end">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
