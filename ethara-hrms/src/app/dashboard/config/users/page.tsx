"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn, formatLabel, getInitials, timeAgo, ROLE_LABELS } from "@/lib/utils";
import type { Role } from "@/types";
import { Shield, Plus, Search, Edit2, CheckCircle2, XCircle, Loader2, AlertTriangle, Check, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { usersApi } from "@/lib/api";

type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  roles?: Role[];
  isActive?: boolean;
  is_active?: boolean;
  lastLoginAt?: string;
  last_login_at?: string;
  createdAt?: string;
  created_at?: string;
};

type UserForm = { name: string; email: string; roles: Role[] };
type UserTab = "staff" | "employees" | "candidates";
const EMPTY_FORM: UserForm = { name: "", email: "", roles: ["hr"] };

const userRoles = (u: User): Role[] => (u.roles && u.roles.length ? u.roles : [u.role]);

const EDITABLE_ROLES: Role[] = ["super_admin", "admin", "leadership", "hr", "ta", "employee", "vendor", "employee_referrer", "evaluator", "it_team", "compliance", "candidate", "manager", "office_admin", "pl_tpm"];

const ROLE_COLORS: Record<Role, string> = {
  super_admin: "bg-destructive/10 text-destructive border-destructive/30",
  admin: "bg-primary/10 text-primary border-primary/30",
  leadership: "bg-indigo-500/10 text-indigo-500 border-indigo-500/30",
  hr: "bg-purple-500/10 text-purple-500 border-purple-500/30",
  ta: "bg-fuchsia-500/10 text-fuchsia-500 border-fuchsia-500/30",
  employee: "bg-teal-500/10 text-teal-500 border-teal-500/30",
  vendor: "bg-orange-500/10 text-orange-500 border-orange-500/30",
  employee_referrer: "bg-cyan-500/10 text-cyan-500 border-cyan-500/30",
  evaluator: "bg-success/10 text-success border-success/30",
  it_team: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
  compliance: "bg-lime-500/10 text-lime-600 border-lime-500/30",
  candidate: "bg-muted text-muted-foreground border-border",
  manager: "bg-violet-500/10 text-violet-600 border-violet-500/30",
  office_admin: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  pl_tpm: "bg-teal-500/10 text-teal-600 border-teal-500/30",
};

export default function UsersConfigPage() {
  const qc = useQueryClient();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<UserTab>("staff");
  const [form, setForm] = useState<UserForm>(EMPTY_FORM);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const data = await usersApi.list();
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      setError("Unable to load users.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUsers();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const isEmployeeRole = (r: string) => r === "employee" || r === "employee_referrer";
  const isCandidateRole = (r: string) => r === "candidate";
  const isStaffRole = (r: string) => r !== "candidate" && !isEmployeeRole(r);
  const inTab = (r: string) =>
    tab === "employees" ? isEmployeeRole(r) : tab === "candidates" ? isCandidateRole(r) : isStaffRole(r);
  const tabCounts = {
    staff: users.filter((u) => isStaffRole(u.role as string)).length,
    employees: users.filter((u) => isEmployeeRole(u.role as string)).length,
    candidates: users.filter((u) => isCandidateRole(u.role as string)).length,
  };
  const tabLabels: Record<UserTab, string> = {
    staff: "Staff",
    employees: "Employees",
    candidates: "Candidates",
  };
  const filtered = users
    .filter((u) => inTab(u.role as string))
    .filter((u) =>
      !search ||
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.role.toLowerCase().includes(search.toLowerCase())
    );

  const handleAdd = async () => {
    if (!form.name.trim() || !form.email.trim()) { toast.error("Name and email are required."); return; }
    if (!form.roles.length) { toast.error("Select at least one role."); return; }
    setSaving(true);
    try {
      await usersApi.create({ name: form.name, email: form.email, role: form.roles[0], roles: form.roles });
      toast.success("User created successfully.");
      setForm(EMPTY_FORM);
      setAddOpen(false);
      qc.invalidateQueries({ queryKey: ["users"] });
      await loadUsers();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Failed to create user.");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    if (!form.name.trim() || !form.email.trim()) { toast.error("Name and email are required."); return; }
    if (!form.roles.length) { toast.error("Select at least one role."); return; }
    setSaving(true);
    try {
      // Keep the currently-active role first when it is still assigned, so the
      // user's primary role does not change unexpectedly on edit.
      const orderedRoles = form.roles.includes(editTarget.role)
        ? [editTarget.role, ...form.roles.filter((r) => r !== editTarget.role)]
        : form.roles;
      await usersApi.update(editTarget.id, { name: form.name, email: form.email, role: orderedRoles[0], roles: orderedRoles });
      toast.success("User updated.");
      setEditOpen(false);
      setEditTarget(null);
      qc.invalidateQueries({ queryKey: ["users"] });
      await loadUsers();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Failed to update user.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (u: User) => {
    const isActive = u.isActive ?? u.is_active ?? true;
    try {
      await usersApi.update(u.id, { isActive: !isActive });
      toast.success(`User ${isActive ? "deactivated" : "activated"}.`);
      qc.invalidateQueries({ queryKey: ["users"] });
      await loadUsers();
    } catch {
      toast.error("Failed to update user status.");
    }
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    setResetting(true);
    try {
      const result = await usersApi.resetPassword(resetTarget.id);
      toast.success(`Temporary password emailed to ${result.email}.`);
      setResetTarget(null);
      qc.invalidateQueries({ queryKey: ["users"] });
      await loadUsers();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Failed to reset password.");
    } finally {
      setResetting(false);
    }
  };

  const renderUserActions = (u: User, mobile = false) => {
    const isActive = u.isActive ?? u.is_active ?? true;
    return (
      <div className={cn(
        mobile
          ? "grid grid-cols-1 gap-2"
          : "flex items-center justify-end gap-2 whitespace-nowrap"
      )}>
        <Dialog
          open={editOpen && editTarget?.id === u.id}
          onOpenChange={(o) => { setEditOpen(o); if (!o) setEditTarget(null); }}
        >
          <DialogTrigger
            render={
              <Button
                variant={mobile ? "outline" : "ghost"}
                size={mobile ? "sm" : "icon"}
                className={cn(mobile ? "h-9 rounded-lg text-xs" : "h-9 w-9 rounded-lg")}
              />
            }
            onClick={() => { setEditTarget(u); setForm({ name: u.name, email: u.email, roles: userRoles(u) }); }}
          >
            {mobile ? (
              <span className="inline-flex items-center gap-1.5">
                <Edit2 className="h-3.5 w-3.5" />
                Edit
              </span>
            ) : (
              <Edit2 className="h-3.5 w-3.5" />
            )}
          </DialogTrigger>
          <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <DialogHeader><DialogTitle>Edit User</DialogTitle></DialogHeader>
            <UserFormFields form={form} onChange={setForm} roles={EDITABLE_ROLES} />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" className="rounded-xl text-xs" onClick={() => { setEditOpen(false); setEditTarget(null); }}>Cancel</Button>
              <Button className="rounded-xl text-xs" disabled={saving} onClick={handleEdit}>
                {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Saving...</> : "Save Changes"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Button
          variant="outline"
          size="sm"
          className={cn(mobile ? "h-9 rounded-lg text-xs" : "h-9 rounded-lg px-3 text-xs")}
          onClick={() => setResetTarget(u)}
          title="Reset password"
          aria-label={`Reset password for ${u.name}`}
        >
          <span className="inline-flex items-center gap-1.5">
            <KeyRound className="h-3.5 w-3.5 text-primary" />
            Reset password
          </span>
        </Button>
        <Button
          variant={mobile ? "outline" : "ghost"}
          size={mobile ? "sm" : "icon"}
          className={cn(mobile ? "h-9 rounded-lg text-xs" : "h-9 w-9 rounded-lg")}
          onClick={() => handleToggle(u)}
        >
          {isActive ? (
            <span className="inline-flex items-center gap-1.5">
              <XCircle className="h-3.5 w-3.5 text-destructive" />
              {mobile ? "Deactivate" : null}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              {mobile ? "Activate" : null}
            </span>
          )}
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-4 overflow-x-hidden animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
            <Shield className="h-6 w-6 text-primary" /> Users & Roles
          </h1>
          <p className="text-muted-foreground">Manage platform users and access roles</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger render={<Button size="sm" className="rounded-xl text-xs" />}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Invite User
          </DialogTrigger>
          <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <DialogHeader><DialogTitle>Invite New User</DialogTitle></DialogHeader>
            <UserFormFields form={form} onChange={setForm} roles={EDITABLE_ROLES} />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" className="rounded-xl text-xs" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button className="rounded-xl text-xs" disabled={saving} onClick={handleAdd}>
                {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Saving...</> : "Create User"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />{error}
          </CardContent>
        </Card>
      )}

      <div className="flex w-full max-w-full gap-1 overflow-x-auto rounded-xl border border-border p-1 sm:w-fit">
        {([["staff", "Staff"], ["employees", "Employees"], ["candidates", "Candidates"]] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
              tab === k ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label} ({tabCounts[k]})
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder={`Search ${tabLabels[tab].toLowerCase()}...`} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 rounded-xl h-10" />
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="space-y-3 p-4 sm:hidden">
            {isLoading ? (
              <div className="py-12 text-center">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No users found</div>
            ) : filtered.map((u) => {
              const isActive = u.isActive ?? u.is_active ?? true;
              const lastLogin = u.lastLoginAt ?? u.last_login_at;
              return (
                <div key={u.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarFallback className="bg-primary/10 text-primary text-xs">{getInitials(u.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-semibold">{u.name}</p>
                      <p className="break-all text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-muted-foreground">Roles</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {userRoles(u).map((r, idx) => (
                          <Badge
                            key={r}
                            variant="outline"
                            className={cn("border text-xs", ROLE_COLORS[r] ?? "")}
                            title={idx === 0 ? "Primary role" : undefined}
                          >
                            {ROLE_LABELS[r] ?? formatLabel(r)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Status</p>
                      <Badge variant={isActive ? "outline" : "secondary"} className={cn("mt-1 text-xs", isActive ? "text-success border-success/30" : "")}>
                        {isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="col-span-2">
                      <p className="text-muted-foreground">Last Login</p>
                      <p className="mt-1">{lastLogin ? timeAgo(lastLogin) : "Never"}</p>
                    </div>
                  </div>

                  <div className="mt-4">
                    {renderUserActions(u, true)}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[1040px] table-fixed text-sm">
              <colgroup>
                <col className="w-[31%]" />
                <col className="w-[25%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["User", "Role", "Status", "Last Login", "Actions"].map((h) => (
                    <th key={h} className={cn("py-3 px-4 text-xs font-semibold text-muted-foreground", h === "Actions" ? "text-right" : "text-left")}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={5} className="py-12 text-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" /></td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={5} className="py-10 text-center text-sm text-muted-foreground">No users found</td></tr>
                ) : filtered.map((u) => {
                  const isActive = u.isActive ?? u.is_active ?? true;
                  const lastLogin = u.lastLoginAt ?? u.last_login_at;
                  return (
                    <tr key={u.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors group">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">{getInitials(u.name)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{u.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap items-center gap-1">
                          {userRoles(u).map((r, idx) => (
                            <Badge
                              key={r}
                              variant="outline"
                              className={cn("text-xs border", ROLE_COLORS[r] ?? "")}
                              title={idx === 0 ? "Primary role" : undefined}
                            >
                              {ROLE_LABELS[r] ?? formatLabel(r)}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={isActive ? "outline" : "secondary"} className={cn("text-xs", isActive ? "text-success border-success/30" : "")}>
                          {isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">
                        {lastLogin ? timeAgo(lastLogin) : "Never"}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {renderUserActions(u)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={Boolean(resetTarget)}
        onOpenChange={(open) => { if (!open) setResetTarget(null); }}
        title="Reset user password?"
        description={
          resetTarget ? (
            <span>
              A new temporary password will be generated for {resetTarget.name} and emailed to{" "}
              <span className="font-medium text-foreground">{resetTarget.email}</span>. Their current sessions will be revoked.
            </span>
          ) : undefined
        }
        confirmLabel="Reset & email"
        loading={resetting}
        onConfirm={handleResetPassword}
      />
    </div>
  );
}

function UserFormFields({ form, onChange, roles }: { form: UserForm; onChange: (f: UserForm) => void; roles: Role[] }) {
  return (
    <div className="space-y-4 mt-2">
      <div className="space-y-1.5">
        <Label className="text-sm">Full Name *</Label>
        <Input placeholder="Priya Sharma" value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} className="rounded-xl" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-sm">Email *</Label>
        <Input type="email" placeholder="priya@ethara.ai" value={form.email} onChange={(e) => onChange({ ...form, email: e.target.value })} className="rounded-xl" />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Roles</Label>
          <span className="text-[11px] text-muted-foreground">
            {form.roles.length} selected · assign one or more
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {roles.map((r) => {
            const selected = form.roles.includes(r);
            return (
              <button
                key={r}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  const next = selected
                    ? form.roles.filter((x) => x !== r)
                    : [...form.roles, r];
                  // Always keep at least one role selected.
                  onChange({ ...form, roles: next.length ? next : form.roles });
                }}
                className={cn(
                  "flex items-center justify-between gap-2 p-2.5 rounded-xl border text-xs font-medium text-left transition-all",
                  selected ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-muted/30"
                )}
              >
                <span>{ROLE_LABELS[r]}</span>
                {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          The first selected role is the user&apos;s primary role. Users with more than one role can switch between them from their dashboard.
        </p>
      </div>
    </div>
  );
}
