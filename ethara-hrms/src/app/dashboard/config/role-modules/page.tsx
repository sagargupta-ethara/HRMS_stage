"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/shared/page-header";
import { cn, formatLabel, hasAssignedRole, moduleColorForKey, ROLE_LABELS } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { roleModulesApi, usersApi, type ModuleDef } from "@/lib/api";
import { Loader2, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const ROLE_ORDER = [
  "admin",
  "leadership",
  "hr",
  "ta",
  "employee",
  "vendor",
  "employee_referrer",
  "evaluator",
  "it_team",
  "compliance",
  "manager",
  "office_admin",
] as const;
const FULL_ACCESS_ROLES = new Set(["admin", "super_admin", "leadership"]);
type Mode = "role" | "user";
type UserRow = { id: string; name: string; email: string; role: string };

export default function RoleModulesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const isAdmin = hasAssignedRole(user, ["admin", "super_admin", "leadership"]);

  useEffect(() => {
    if (user && !isAdmin) router.replace("/dashboard");
  }, [user, isAdmin, router]);

  const [mode, setMode] = useState<Mode>("role");

  const { data: matrix, isLoading, refetch } = useQuery({
    queryKey: ["role-modules"],
    queryFn: () => roleModulesApi.matrix(),
    enabled: !!isAdmin,
  });
  const modules: ModuleDef[] = useMemo(() => matrix?.modules ?? [], [matrix]);
  const allModuleKeys = useMemo(() => modules.map((m) => m.key), [modules]);

  // ── By Role ──
  const roles = useMemo(() => {
    const available = new Set(Object.keys(matrix?.roles ?? {}));
    return ROLE_ORDER.filter((role) => available.has(role));
  }, [matrix]);
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string[]>>({});
  const activeRole = selectedRole || roles[0] || "";
  const selectedRoleIsFullAccess = mode === "role" && FULL_ACCESS_ROLES.has(activeRole);
  const roleEnabled = useMemo(() => {
    if (!activeRole) return new Set<string>();
    if (selectedRoleIsFullAccess) return new Set(allModuleKeys);
    return new Set(roleDrafts[activeRole] ?? matrix?.roles?.[activeRole] ?? []);
  }, [activeRole, allModuleKeys, matrix, roleDrafts, selectedRoleIsFullAccess]);

  // ── By User ──
  const { data: usersData } = useQuery({
    queryKey: ["users-for-modules"],
    queryFn: () => usersApi.list() as Promise<UserRow[]>,
    enabled: !!isAdmin && mode === "user",
  });
  const [userSearch, setUserSearch] = useState("");
  const users = useMemo(() => {
    const list = usersData ?? [];
    const q = userSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [usersData, userSearch]);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [userDrafts, setUserDrafts] = useState<Record<string, string[]>>({});
  const { data: userModules, refetch: refetchUser } = useQuery({
    queryKey: ["user-modules", selectedUser],
    queryFn: () => roleModulesApi.userModules(selectedUser),
    enabled: !!selectedUser,
  });
  const userEnabled = useMemo(
    () => new Set(userDrafts[selectedUser] ?? userModules?.enabled ?? []),
    [selectedUser, userDrafts, userModules],
  );
  const userHasOverride = userModules?.hasOverride ?? false;

  const [saving, setSaving] = useState(false);

  const enabled = mode === "role" ? roleEnabled : userEnabled;
  const toggle = (key: string) => {
    if (mode === "role") {
      if (!activeRole || selectedRoleIsFullAccess) return;
      setRoleDrafts((prev) => {
        const next = new Set(prev[activeRole] ?? matrix?.roles?.[activeRole] ?? []);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return { ...prev, [activeRole]: Array.from(next) };
      });
      return;
    }
    if (!selectedUser) return;
    setUserDrafts((prev) => {
      const next = new Set(prev[selectedUser] ?? userModules?.enabled ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [selectedUser]: Array.from(next) };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (mode === "role") {
        if (!activeRole) return;
        await roleModulesApi.setRole(activeRole, Array.from(roleEnabled));
        toast.success(`Updated modules for ${ROLE_LABELS[activeRole as keyof typeof ROLE_LABELS] ?? formatLabel(activeRole)}.`);
        await refetch();
      } else {
        if (!selectedUser) return;
        await roleModulesApi.setUser(selectedUser, Array.from(userEnabled));
        toast.success("Updated modules for this user.");
        await refetchUser();
      }
    } catch { toast.error("Failed to update module access."); }
    finally { setSaving(false); }
  };

  const handleResetUser = async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      await roleModulesApi.clearUser(selectedUser);
      toast.success("Reverted user to their role default.");
      setUserDrafts((prev) => {
        const next = { ...prev };
        delete next[selectedUser];
        return next;
      });
      await refetchUser();
    } catch { toast.error("Failed to reset."); }
    finally { setSaving(false); }
  };

  if (!isAdmin) return null;

  const subjectLabel = mode === "role"
    ? (ROLE_LABELS[activeRole as keyof typeof ROLE_LABELS] ?? formatLabel(activeRole))
    : (users.find((u) => u.id === selectedUser)?.name ?? "user");

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        icon={ShieldCheck}
        title="Module Access"
        description="Choose which modules each role — or a specific user — can see and use. Disabled modules are hidden from the menu and blocked on the server. Admins and Super Admins always have full access."
      />

      {/* Mode toggle */}
      <div className="flex gap-1 rounded-xl border border-border p-1 w-fit">
        {(["role", "user"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn("rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
              mode === m ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
          >
            {m === "role" ? "By Role" : "By User (ID-based)"}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr] lg:items-start">
          {/* Selector */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-2">
              {mode === "role" ? (
                <div className="max-h-[40vh] space-y-1 overflow-y-auto overscroll-contain pr-0.5 lg:max-h-none lg:overflow-visible">
                  {roles.map((r) => (
                    <button key={r} type="button" onClick={() => setSelectedRole(r)}
                      className={cn("w-full rounded-xl px-3 py-2 text-left text-sm transition-colors",
                        activeRole === r ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/40 text-muted-foreground")}>
                      {ROLE_LABELS[r as keyof typeof ROLE_LABELS] ?? formatLabel(r)}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  <input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search users…"
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary/50"
                  />
                  <div className="max-h-[55vh] space-y-1 overflow-y-auto overscroll-contain pr-0.5">
                    {users.map((u) => (
                      <button key={u.id} type="button" onClick={() => setSelectedUser(u.id)}
                        className={cn("w-full rounded-xl px-3 py-2 text-left transition-colors",
                          selectedUser === u.id ? "bg-primary/10 text-primary" : "hover:bg-muted/40")}>
                        <p className="text-sm font-medium truncate">{u.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? formatLabel(u.role)} · {u.email}
                        </p>
                      </button>
                    ))}
                    {users.length === 0 && <p className="p-3 text-xs text-muted-foreground">No users found.</p>}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Module checkboxes */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Modules for <span className="text-primary">{subjectLabel}</span></p>
                  {selectedRoleIsFullAccess && (
                    <p className="text-[11px] text-muted-foreground">
                      Full-access role: every module is always enabled.
                    </p>
                  )}
                  {mode === "user" && selectedUser && (
                    <p className="text-[11px] text-muted-foreground">
                      {userHasOverride ? "Custom per-user override active." : "Using role default (no override yet)."}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {mode === "user" && userHasOverride && (
                    <Button size="sm" variant="outline" className="rounded-xl gap-1.5 text-xs" onClick={handleResetUser} disabled={saving}>
                      <RotateCcw className="h-3.5 w-3.5" /> Reset to role
                    </Button>
                  )}
                  <Button size="sm" className="rounded-xl gap-1.5" onClick={handleSave}
                    disabled={saving || selectedRoleIsFullAccess || (mode === "role" ? !activeRole : !selectedUser)}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {modules.map((m) => {
                  const tone = moduleColorForKey(m.key);
                  const isEnabled = enabled.has(m.key);
                  return (
                    <label
                      key={m.key}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 hover:bg-muted/30",
                        isEnabled ? "border-primary/20 bg-primary/5" : "border-border",
                      )}
                    >
                      <Checkbox checked={isEnabled} disabled={selectedRoleIsFullAccess} onCheckedChange={() => toggle(m.key)} />
                      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tone.dot)} />
                      <span className={cn("text-sm", isEnabled && "font-medium text-foreground")}>{m.label}</span>
                    </label>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
