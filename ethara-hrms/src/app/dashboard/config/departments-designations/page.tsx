"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ElementType } from "react";
import { AlertCircle, Briefcase, Building2, Check, ChevronDown, Loader2, Plus, ReceiptText, RefreshCw, Save, Search, Trash2, UserCheck, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { employeesApi, reimbursementsApi, usersApi, type DepartmentAdminRef, type ReimbursementConfig } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  EMPLOYEE_DEPARTMENT_OPTIONS,
  EMPLOYEE_DESIGNATION_OPTIONS,
  formatDropdownOptionLabel,
  mergeEmployeeReferenceOptions,
} from "@/lib/employee-profile-options";
import { cn, getDefaultRouteForRole, hasAssignedRole } from "@/lib/utils";
import type { Role } from "@/types";

const MANAGER_ROLES = new Set<Role>(["admin", "super_admin", "leadership", "hr"]);
const HEAD_EXCLUDED_ROLES = new Set<Role>(["candidate", "vendor"]);
const DEFAULT_REIMBURSEMENT_CATEGORIES = [
  "Urgent Project Purchases",
  "Food & Logistics",
  "Transportation",
  "Other",
] as const;
const DEFAULT_REIMBURSEMENT_CONFIG: ReimbursementConfig = {
  categories: [...DEFAULT_REIMBURSEMENT_CATEGORIES],
  approvalRules: "Reporting manager approval followed by HR/Office admin approval.",
  expenseLimit: null,
  defaultCurrency: "INR",
};

type ConfigUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role: Role;
  isActive?: boolean;
  is_active?: boolean;
};

function normalizeDepartmentAdminIds(
  refs: Record<string, DepartmentAdminRef | DepartmentAdminRef[] | null> | undefined,
  departments: string[],
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const department of departments) {
    const value = refs?.[department];
    if (Array.isArray(value)) {
      result[department] = value.map((item) => item.id).filter(Boolean);
    } else {
      result[department] = value?.id ? [value.id] : [];
    }
  }
  return result;
}

function departmentAdminPayload(departments: string[], departmentAdmins: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(departments.map((department) => [department, departmentAdmins[department] ?? []]));
}

function normalizeOptions(values: string[], fallback: readonly string[]): string[] {
  return mergeEmployeeReferenceOptions(values, fallback);
}

function normalizeCategoryOptions(values: string[]): string[] {
  const merged: string[] = [];
  for (const value of [...DEFAULT_REIMBURSEMENT_CATEGORIES, ...values]) {
    const trimmed = value.trim();
    if (!trimmed || merged.some((item) => item.toLowerCase() === trimmed.toLowerCase())) continue;
    merged.push(trimmed);
  }
  return merged;
}

function isLockedReimbursementCategory(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return DEFAULT_REIMBURSEMENT_CATEGORIES.some((category) => category.toLowerCase() === normalized);
}

function OptionEditor({
  title,
  description,
  icon: Icon,
  values,
  fallback,
  onChange,
  normalize = normalizeOptions,
  addPlaceholder,
  lockedPredicate = () => false,
  lockedTitle = "Remove option",
}: {
  title: string;
  description: string;
  icon: ElementType;
  values: string[];
  fallback: readonly string[];
  onChange: (values: string[]) => void;
  normalize?: (values: string[], fallback: readonly string[]) => string[];
  addPlaceholder?: string;
  lockedPredicate?: (value: string) => boolean;
  lockedTitle?: string;
}) {
  const [draft, setDraft] = useState("");
  const normalized = useMemo(() => normalize(values, fallback), [fallback, normalize, values]);

  const commitValues = (nextValues: string[]) => {
    onChange(normalize(nextValues, fallback));
  };

  const addValue = () => {
    const next = draft.trim();
    if (!next) return;
    if (normalized.some((value) => value.toLowerCase() === next.toLowerCase())) {
      toast.error(`${next} already exists.`);
      return;
    }
    commitValues([...normalized.filter((value) => !lockedPredicate(value)), next, ...normalized.filter(lockedPredicate)]);
    setDraft("");
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="h-4 w-4 text-primary" />
              {title}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <Badge variant="outline" className="shrink-0 text-xs">
            {normalized.length} options
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addValue();
              }
            }}
            placeholder={addPlaceholder ?? `Add ${title.toLowerCase().slice(0, -1)}`}
            className="h-10 rounded-lg"
          />
          <Button type="button" className="h-10 rounded-lg" onClick={addValue}>
            <Plus className="mr-2 h-4 w-4" />
            Add
          </Button>
        </div>

        <div className="space-y-2">
          {normalized.map((value, index) => {
            const locked = lockedPredicate(value);
            return (
              <div key={`${value}-${index}`} className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <div className="space-y-1">
                  <Label className="sr-only">{title} option</Label>
                  <Input
                    value={value}
                    disabled={locked}
                    onChange={(event) => {
                      const next = [...normalized];
                      next[index] = event.target.value;
                      commitValues(next);
                    }}
                    className={cn("h-9 rounded-lg", locked && "text-muted-foreground")}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Shown as {formatDropdownOptionLabel(value)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={locked}
                  onClick={() => commitValues(normalized.filter((_, itemIndex) => itemIndex !== index))}
                  title={locked ? lockedTitle : "Remove option"}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function DepartmentHeadMultiSelect({
  department,
  options,
  selectedIds,
  onChange,
}: {
  department: string;
  options: ConfigUser[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedHeads = useMemo(
    () => selectedIds.map((id) => options.find((item) => item.id === id)).filter((item): item is ConfigUser => Boolean(item)),
    [options, selectedIds],
  );
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((item) =>
      [item.name, item.email, item.role]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const toggle = (id: string) => {
    onChange(
      selectedIdSet.has(id)
        ? selectedIds.filter((selectedId) => selectedId !== id)
        : [...selectedIds, id],
    );
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={`Department heads for ${department}`}
        className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border border-input bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            {selectedHeads.length ? `${selectedHeads.length} selected` : "Unassigned"}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {selectedHeads.length
              ? selectedHeads.map((item) => item.email || item.name).join(", ")
              : "Search by name or email"}
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-full min-w-[min(480px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg">
          <div className="border-b border-border p-2">
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search users or emails"
                  className="h-9 rounded-lg pl-9"
                  autoFocus
                />
              </div>
              {selectedHeads.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-lg"
                  title="Clear department heads"
                  onClick={() => onChange([])}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto p-1.5">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No matching users
              </div>
            ) : (
              filteredOptions.map((item) => {
                const selected = selectedIdSet.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/40",
                      selected && "bg-primary/10 text-primary",
                    )}
                    onClick={() => toggle(item.id)}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
                      )}
                    >
                      {selected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {item.name || item.email}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.email}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {formatDropdownOptionLabel(item.role)}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DepartmentsDesignationsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [departments, setDepartments] = useState<string[]>(() => normalizeOptions([], EMPLOYEE_DEPARTMENT_OPTIONS));
  const [designations, setDesignations] = useState<string[]>(() => normalizeOptions([], EMPLOYEE_DESIGNATION_OPTIONS));
  const [reimbursementCategories, setReimbursementCategories] = useState<string[]>(() => normalizeCategoryOptions([]));
  const [departmentAdmins, setDepartmentAdmins] = useState<Record<string, string[]>>({});
  const [users, setUsers] = useState<ConfigUser[]>([]);
  const [savedDepartments, setSavedDepartments] = useState<string[]>([]);
  const [savedDesignations, setSavedDesignations] = useState<string[]>([]);
  const [savedReimbursementCategories, setSavedReimbursementCategories] = useState<string[]>([]);
  const [savedDepartmentAdmins, setSavedDepartmentAdmins] = useState<Record<string, string[]>>({});
  const [reimbursementConfig, setReimbursementConfig] = useState<ReimbursementConfig>(DEFAULT_REIMBURSEMENT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const canManage = hasAssignedRole(user, [...MANAGER_ROLES]);
  const canManageReimbursements = hasAssignedRole(user, ["admin", "super_admin", "leadership"]);
  const dirty = JSON.stringify(departments) !== JSON.stringify(savedDepartments)
    || JSON.stringify(designations) !== JSON.stringify(savedDesignations)
    || JSON.stringify(departmentAdminPayload(departments, departmentAdmins)) !== JSON.stringify(departmentAdminPayload(savedDepartments, savedDepartmentAdmins))
    || (canManageReimbursements && JSON.stringify(reimbursementCategories) !== JSON.stringify(savedReimbursementCategories));

  useEffect(() => {
    if (user && !hasAssignedRole(user, [...MANAGER_ROLES])) {
      router.replace(getDefaultRouteForRole(user.role));
    }
  }, [router, user]);

  const loadOptions = useCallback(async () => {
    setLoading(true);
    try {
      const [options, reimbursementOptions, userData] = await Promise.all([
        employeesApi.referenceOptionsAdmin(),
        reimbursementsApi.config(),
        usersApi.list(),
      ]);
      const nextDepartments = normalizeOptions(options.departments, EMPLOYEE_DEPARTMENT_OPTIONS);
      const nextDesignations = normalizeOptions(options.designations, EMPLOYEE_DESIGNATION_OPTIONS);
      const nextCategories = normalizeCategoryOptions(reimbursementOptions.categories || []);
      const nextDepartmentAdmins = normalizeDepartmentAdminIds(options.departmentAdmins, nextDepartments);
      setDepartments(nextDepartments);
      setDesignations(nextDesignations);
      setReimbursementCategories(nextCategories);
      setDepartmentAdmins(nextDepartmentAdmins);
      setUsers(Array.isArray(userData) ? userData as ConfigUser[] : []);
      setSavedDepartments(nextDepartments);
      setSavedDesignations(nextDesignations);
      setSavedReimbursementCategories(nextCategories);
      setSavedDepartmentAdmins(nextDepartmentAdmins);
      setReimbursementConfig(reimbursementOptions);
    } catch {
      toast.error("Could not load dropdown options.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canManage) return;
    const timer = window.setTimeout(() => void loadOptions(), 0);
    return () => window.clearTimeout(timer);
  }, [canManage, loadOptions]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const [saved, savedReimbursementConfig] = await Promise.all([
        employeesApi.updateReferenceOptions({
          departments,
          designations,
          departmentAdmins: departmentAdminPayload(departments, departmentAdmins),
        }),
        canManageReimbursements
          ? reimbursementsApi.updateConfig({
              ...reimbursementConfig,
              categories: reimbursementCategories,
            })
          : Promise.resolve(reimbursementConfig),
      ]);
      const nextDepartments = normalizeOptions(saved.departments, EMPLOYEE_DEPARTMENT_OPTIONS);
      const nextDesignations = normalizeOptions(saved.designations, EMPLOYEE_DESIGNATION_OPTIONS);
      const nextCategories = normalizeCategoryOptions(savedReimbursementConfig.categories || []);
      const nextDepartmentAdmins = normalizeDepartmentAdminIds(saved.departmentAdmins, nextDepartments);
      setDepartments(nextDepartments);
      setDesignations(nextDesignations);
      setReimbursementCategories(nextCategories);
      setDepartmentAdmins(nextDepartmentAdmins);
      setSavedDepartments(nextDepartments);
      setSavedDesignations(nextDesignations);
      setSavedReimbursementCategories(nextCategories);
      setSavedDepartmentAdmins(nextDepartmentAdmins);
      setReimbursementConfig(savedReimbursementConfig);
      toast.success("Dropdown options saved.");
    } catch {
      toast.error("Could not save dropdown options.");
    } finally {
      setSaving(false);
    }
  };

  const headOptions = useMemo(
    () =>
      users
        .filter((item) => (item.isActive ?? item.is_active ?? true) && !HEAD_EXCLUDED_ROLES.has(item.role))
        .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "")),
    [users],
  );
  const headById = useMemo(() => new Map(headOptions.map((item) => [item.id, item])), [headOptions]);

  if (!canManage) return null;

  return (
    <div className="space-y-4 overflow-x-hidden animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
            <Building2 className="h-6 w-6 text-primary" />
            Departments & Designations
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage employee registration, detail-form, and reimbursement dropdown values.
          </p>
        </div>
        <div className="grid gap-2 sm:flex sm:items-center">
          <Button variant="outline" className="h-9 rounded-lg text-xs" onClick={() => void loadOptions()} disabled={loading || saving}>
            <RefreshCw className={cn("mr-2 h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button className="h-9 rounded-lg text-xs" onClick={handleSave} disabled={loading || saving || !dirty}>
            {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
            Save Changes
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        Newly saved values are available automatically in employee registration, employee detail forms, and reimbursement requests.
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs defaultValue="employee-dropdowns" className="gap-4">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="employee-dropdowns" className="min-w-fit px-3">
              <Building2 className="h-4 w-4" />
              Employee Dropdowns
            </TabsTrigger>
            <TabsTrigger value="department-heads" className="min-w-fit px-3">
              <UserCheck className="h-4 w-4" />
              Department Heads
            </TabsTrigger>
            {canManageReimbursements && (
              <TabsTrigger value="reimbursement-categories" className="min-w-fit px-3">
                <ReceiptText className="h-4 w-4" />
                Reimbursement Categories
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="employee-dropdowns">
            <div className="grid gap-4 xl:grid-cols-2">
              <OptionEditor
                title="Departments"
                description="Department dropdown values for employee records."
                icon={Building2}
                values={departments}
                fallback={EMPLOYEE_DEPARTMENT_OPTIONS}
                onChange={setDepartments}
                addPlaceholder="Add department"
              />
              <OptionEditor
                title="Designations"
                description="Designation dropdown values for employee records."
                icon={Briefcase}
                values={designations}
                fallback={EMPLOYEE_DESIGNATION_OPTIONS}
                onChange={setDesignations}
                addPlaceholder="Add designation"
              />
            </div>
          </TabsContent>

          <TabsContent value="department-heads">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserCheck className="h-4 w-4 text-primary" />
                  Department Heads
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3">
                  {departments.map((department) => {
                    const selectedIds = departmentAdmins[department] ?? [];
                    const selectedHeads = selectedIds
                      .map((id) => headById.get(id))
                      .filter((item): item is ConfigUser => Boolean(item));
                    return (
                      <div key={department} className="grid gap-2 rounded-lg border border-border bg-muted/10 p-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(280px,1fr)] lg:items-center">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{formatDropdownOptionLabel(department)}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {selectedHeads.length
                              ? selectedHeads.map((item) => `${item.name || item.email} (${item.email || item.role})`).join(", ")
                              : "No heads assigned"}
                          </p>
                        </div>
                        <DepartmentHeadMultiSelect
                          department={department}
                          options={headOptions}
                          selectedIds={selectedIds}
                          onChange={(ids) =>
                            setDepartmentAdmins((current) => ({
                              ...current,
                              [department]: ids,
                            }))
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {canManageReimbursements && (
            <TabsContent value="reimbursement-categories">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)]">
                <OptionEditor
                  title="Reimbursement Categories"
                  description="Category dropdown values used when employees submit reimbursement requests."
                  icon={ReceiptText}
                  values={reimbursementCategories}
                  fallback={DEFAULT_REIMBURSEMENT_CATEGORIES}
                  normalize={(values) => normalizeCategoryOptions(values)}
                  lockedPredicate={isLockedReimbursementCategory}
                  lockedTitle="Default category cannot be removed"
                  onChange={setReimbursementCategories}
                  addPlaceholder="Add reimbursement category"
                />
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base">Dropdown Preview</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {reimbursementCategories.map((category) => (
                      <div
                        key={category}
                        className="flex min-h-10 items-center rounded-lg border border-border bg-muted/20 px-3 text-sm"
                      >
                        <span className="truncate">{category}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
