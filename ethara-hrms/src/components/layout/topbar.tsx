"use client";

import { useAuth } from "@/lib/auth-context";
import { apiErrorMessage } from "@/lib/api-errors";
import { canAccessSettingsForUser, cn, formatLabel, getAssignedRoles, ROLE_LABELS, getDefaultRouteForRole, getInitials, timeAgo } from "@/lib/utils";
import type { Role } from "@/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bell, Search, ChevronDown, CheckCheck, AlertTriangle, Info, CheckCircle2, XCircle,
  Settings, Lock, Loader2, User, LogOut, Pencil, X, Repeat, Check, Menu, Trash2,
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { notificationsApi, candidatesApi, employeesApi, authApi, type NotificationRecord } from "@/lib/api";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type SearchResult = {
  id: string;
  label: string;
  sublabel: string;
  href: string;
};

const NOTIF_ICONS = {
  info: Info,
  warning: AlertTriangle,
  success: CheckCircle2,
  error: XCircle,
  action: AlertTriangle,
};

const NOTIF_COLORS = {
  info: "text-blue-500",
  warning: "text-amber-500",
  success: "text-emerald-500",
  error: "text-red-500",
  action: "text-orange-500",
};

const MENU_ITEM_STYLE: React.CSSProperties = {
  color: "#C5CBE8",
};
const MENU_ITEM_HOVER = {
  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = "rgba(144,141,206,0.10)";
  },
  onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = "transparent";
  },
};
const PROFILE_INPUT_CLASSNAME = "h-10 rounded-xl";
const CANDIDATE_SEARCH_ROLES = new Set<Role>([
  "super_admin",
  "admin",
  "leadership",
  "hr",
  "ta",
  "it_team",
  "compliance",
  "office_admin",
  "vendor",
]);

export function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { user, profile, logout, refreshUser, syncAuthSession, switchRole } = useAuth();
  const router = useRouter();
  const [switchingRole, setSwitchingRole] = useState<Role | null>(null);
  const canShowCandidateSearch = user ? CANDIDATE_SEARCH_ROLES.has(user.role) : false;

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHasResults, setSearchHasResults] = useState<boolean | null>(null);

  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [notifSheetOpen, setNotifSheetOpen] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const [profileOpen, setProfileOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [changePassOpen, setChangePassOpen] = useState(false);

  // Avatar photo: fetch the employee's uploaded passport photo (authenticated blob)
  // so the top-bar trigger and profile dialog show the real image, not just initials.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarOwnerId, setAvatarOwnerId] = useState<string | null>(null);
  const profilePhotoEndpoint =
    profile?.type === "employee"
      ? profile.profilePhotoEndpoint ?? user?.profilePhotoEndpoint ?? null
      : user?.profilePhotoEndpoint ?? null;
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    if (!user) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setAvatarUrl(null);
      setAvatarOwnerId(null);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    if (!profilePhotoEndpoint) {
      if (avatarOwnerId && avatarOwnerId !== user.id) {
        setAvatarUrl(null);
        setAvatarOwnerId(null);
      }
      return;
    }
    employeesApi
      .getBlobFromEndpoint(profilePhotoEndpoint)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setAvatarUrl(objectUrl);
        setAvatarOwnerId(user.id);
      })
      .catch(() => {
        if (active && avatarOwnerId && avatarOwnerId !== user.id) {
          setAvatarUrl(null);
          setAvatarOwnerId(null);
        }
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [avatarOwnerId, profilePhotoEndpoint, user]);

  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editPersonalEmail, setEditPersonalEmail] = useState("");
  const [editEmployeeCode, setEditEmployeeCode] = useState("");
  const [editDepartment, setEditDepartment] = useState("");
  const [editDesignation, setEditDesignation] = useState("");
  const [editGender, setEditGender] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [cpStep, setCpStep] = useState<"request" | "verify">("request");
  const [cpOtp, setCpOtp] = useState("");
  const [cpDevCode, setCpDevCode] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [cpSending, setCpSending] = useState(false);
  const [changingPass, setChangingPass] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const employeeProfile = profile?.type === "employee" ? profile : null;
  const isEmployeeProfile = Boolean(employeeProfile);

  useEffect(() => {
    notificationsApi.list().then(setNotifications).catch(() => {});
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [menuOpen]);

  const resetEditProfileState = () => {
    setEditName("");
    setEditPhone("");
    setEditPersonalEmail("");
    setEditEmployeeCode("");
    setEditDepartment("");
    setEditDesignation("");
    setEditGender("");
  };

  const openEditProfile = () => {
    if (user) {
      setEditName((employeeProfile?.fullName ?? user.name) ?? "");
      setEditPhone((employeeProfile?.phone ?? user.phone) ?? "");
      if (employeeProfile) {
        setEditPersonalEmail(employeeProfile.personalEmail ?? "");
        setEditEmployeeCode(employeeProfile.employeeCode ?? "");
        setEditDepartment(employeeProfile.department ?? "");
        setEditDesignation(employeeProfile.designation ?? "");
        setEditGender(employeeProfile.gender ?? "");
      } else {
        setEditPersonalEmail("");
        setEditEmployeeCode("");
        setEditDepartment("");
        setEditDesignation("");
        setEditGender("");
      }
    }
    setMenuOpen(false);
    setEditProfileOpen(true);
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch {}
  };

  const handleNotificationClick = async (n: NotificationRecord) => {
    setNotifSheetOpen(false);
    if (!n.isRead) {
      try {
        await notificationsApi.markRead(n.id);
        setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      } catch {}
    }
    const route = n.route ?? null;
    if (route) router.push(route);
  };

  const handleRemoveNotification = async (id: string) => {
    const previous = notifications;
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    try {
      await notificationsApi.remove(id);
    } catch {
      setNotifications(previous);
      toast.error("Could not remove notification.");
    }
  };

  const handleClearAllNotifications = async () => {
    const previous = notifications;
    setNotifications([]);
    try {
      await notificationsApi.clearAll();
    } catch {
      setNotifications(previous);
      toast.error("Could not clear notifications.");
    }
  };

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setSearchHasResults(null);
      return;
    }
    setSearchLoading(true);
    try {
      const results = await candidatesApi.list({ search: query, limit: 5 });
      const candidates: SearchResult[] = (results.data ?? []).map(
        (c: { id: string; fullName: string; candidateCode: string; position?: { title?: string } }) => ({
          id: c.id,
          label: c.fullName,
          sublabel: `${c.candidateCode} · ${c.position?.title ?? "No position"}`,
          href: `/dashboard/candidates/${c.id}`,
        })
      );
      setSearchResults(candidates);
      setSearchHasResults(candidates.length > 0);
    } catch {
      setSearchResults([]);
      setSearchHasResults(false);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canShowCandidateSearch) return;
    const timer = setTimeout(() => handleSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [canShowCandidateSearch, searchQuery, handleSearch]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) { toast.error("Name is required."); return; }
    setSavingProfile(true);
    try {
      if (isEmployeeProfile) {
        if (!editPersonalEmail.trim()) { toast.error("Personal email is required."); return; }
        if (!editEmployeeCode.trim()) { toast.error("Employee code is required."); return; }
        if (!editDepartment.trim()) { toast.error("Department is required."); return; }
        if (!editDesignation.trim()) { toast.error("Designation is required."); return; }
        if (!editGender.trim()) { toast.error("Gender is required."); return; }
        if (editPhone.replace(/\D/g, "").length !== 10) { toast.error("Phone must be a valid 10-digit Indian mobile number."); return; }

        const payload = new FormData();
        payload.append("fullName", editName.trim());
        payload.append("phone", editPhone.replace(/\D/g, "").slice(0, 10));
        payload.append("personalEmail", editPersonalEmail.trim().toLowerCase());
        payload.append("employeeCode", editEmployeeCode.trim().toUpperCase());
        payload.append("department", editDepartment.trim());
        payload.append("designation", editDesignation.trim());
        payload.append("gender", editGender.trim());
        await employeesApi.updateMyProfile(payload);
      } else {
        await authApi.updateProfile({ name: editName.trim(), phone: editPhone.trim() || undefined });
      }
      await refreshUser();
      toast.success("Profile updated.");
      setEditProfileOpen(false);
      resetEditProfileState();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to update profile.";
      toast.error(msg);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleRequestOtp = async () => {
    setCpSending(true);
    try {
      const result = await authApi.requestChangePasswordOtp();
      setCpStep("verify");
      setCpDevCode(result.developmentCode ?? null);
      toast.success(result.message || "OTP sent to your registered email.");
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, "Failed to send OTP."));
    } finally {
      setCpSending(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cpOtp.trim()) { toast.error("Enter the OTP sent to your email."); return; }
    if (newPassword !== confirmPassword) { toast.error("Passwords do not match."); return; }
    if (newPassword.length < 8) { toast.error("Password must be at least 8 characters."); return; }
    setChangingPass(true);
    try {
      const result = await authApi.confirmChangePasswordOtp(cpOtp.trim(), newPassword);
      if (result.user) {
        syncAuthSession(result as Parameters<typeof syncAuthSession>[0]);
      } else {
        await refreshUser();
      }
      toast.success("Password changed successfully.");
      setChangePassOpen(false);
      setCpStep("request"); setCpOtp(""); setCpDevCode(null); setNewPassword(""); setConfirmPassword("");
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, "Invalid verification code. Please try again."));
    } finally {
      setChangingPass(false);
    }
  };

  const handleLogout = () => {
    setMenuOpen(false);
    logout();
  };

  const handleSwitchRole = async (role: Role) => {
    setMenuOpen(false);
    if (!user || role === user.role) return;
    setSwitchingRole(role);
    try {
      await switchRole(role);
      router.push(getDefaultRouteForRole(role));
      toast.success(`Switched to ${ROLE_LABELS[role]}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Couldn't switch role. Please try again.";
      toast.error(msg);
    } finally {
      // Hold the transition briefly so the new dashboard has time to mount.
      setTimeout(() => setSwitchingRole(null), 500);
    }
  };

  if (!user) return null;

  const assignedRoles = getAssignedRoles(user);
  const hasMultipleRoles = assignedRoles.length > 1;

  const showDropdown = canShowCandidateSearch && searchOpen && searchQuery.trim() && (searchLoading || searchHasResults !== null);
  const effectiveChangePassOpen = changePassOpen || Boolean(user.mustChangePassword);
  const canShowSettings = canAccessSettingsForUser(user);
  const separationRoles = new Set<Role>(["super_admin", "admin", "leadership", "hr", "ta", "employee", "employee_referrer", "manager"]);
  const staffSeparationRoles = new Set<Role>(["super_admin", "admin", "leadership", "hr", "ta", "manager"]);
  const canShowSeparation = assignedRoles.some((role) => separationRoles.has(role));
  const separationHref =
    !assignedRoles.some((role) => staffSeparationRoles.has(role)) &&
    (assignedRoles.includes("employee") || assignedRoles.includes("employee_referrer"))
      ? "/dashboard/employee/separation"
      : "/dashboard/separation";
  const switchingOverlay = switchingRole && typeof document !== "undefined"
    ? createPortal(
        <div
          className="fixed inset-0 z-[100] flex min-h-dvh items-center justify-center p-6"
          style={{
            background: "rgba(8,8,16,0.82)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            animation: "fadeIn 0.2s ease both",
          }}
        >
          <div className="flex flex-col items-center gap-5 text-center" style={{ animation: "fadeIn 0.25s ease both" }}>
            <div className="relative h-12 w-12">
              <div
                className="absolute inset-0 rounded-full animate-spin"
                style={{ background: "conic-gradient(from 0deg, #ED00ED, #908DCE, transparent)", padding: "2px" }}
              >
                <div className="h-full w-full rounded-full" style={{ background: "rgba(8,8,16,1)" }} />
              </div>
              <Repeat className="absolute inset-0 m-auto h-4 w-4" style={{ color: "#ED00ED" }} />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>
                Switching to {ROLE_LABELS[switchingRole] ?? formatLabel(switchingRole)}
              </p>
              <p className="mt-1 text-xs" style={{ color: "rgba(144,141,206,0.7)" }}>
                Loading your workspace…
              </p>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
    <header
      className="sticky top-0 z-30 flex h-16 items-center justify-between gap-2 px-4 lg:px-6"
      style={{
        background: "rgba(8,8,16,0.88)",
        backdropFilter: "blur(28px) saturate(1.6)",
        WebkitBackdropFilter: "blur(28px) saturate(1.6)",
        borderBottom: "1px solid rgba(144,141,206,0.14)",
      }}
    >
      <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0 relative">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open navigation menu"
          className="lg:hidden flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors"
          style={{
            color: "rgba(197,203,232,0.6)",
            background: "rgba(144,141,206,0.07)",
            border: "1px solid rgba(144,141,206,0.18)",
          }}
        >
          <Menu className="h-5 w-5" />
        </button>
        {canShowCandidateSearch && (
          <div
            className={cn("flex min-w-0 max-w-[calc(100vw-7rem)] items-center gap-2 rounded-xl transition-all duration-300", searchOpen ? "w-[calc(100vw-6.5rem)] sm:w-80" : "w-36 sm:w-64")}
            style={{
              background: "rgba(144,141,206,0.07)",
              border: searchOpen ? "1px solid rgba(237,0,237,0.35)" : "1px solid rgba(144,141,206,0.18)",
              boxShadow: searchOpen ? "0 0 16px rgba(237,0,237,0.08)" : "none",
            }}
          >
            <Search className="h-4 w-4 ml-3 shrink-0" style={{ color: "rgba(197,203,232,0.45)" }} />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search candidates, positions..."
              className="min-w-0 flex-1 truncate bg-transparent py-2.5 pr-3 text-[16px] focus:outline-none sm:text-sm"
              style={{ color: "#C5CBE8" }}
              value={searchQuery}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="mr-2 transition-colors"
                style={{ color: "rgba(197,203,232,0.4)" }}
                onClick={() => { setSearchQuery(""); setSearchResults([]); setSearchHasResults(null); }}
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {showDropdown && (
          <div
            className="absolute top-full left-0 z-50 mt-2 w-[min(20rem,calc(100vw-1rem))] overflow-hidden rounded-xl"
            style={{
              background: "rgba(8,8,16,0.98)",
              backdropFilter: "blur(24px)",
              border: "1px solid rgba(144,141,206,0.22)",
              boxShadow: "0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(237,0,237,0.08)",
            }}
          >
            {searchLoading ? (
              <div className="flex items-center gap-2.5 p-4 text-sm" style={{ color: "rgba(197,203,232,0.5)" }}>
                <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#ED00ED" }} />
                Searching...
              </div>
            ) : searchHasResults === false ? (
              <div className="p-5 text-sm text-center" style={{ color: "rgba(197,203,232,0.45)" }}>
                No results for &ldquo;{searchQuery}&rdquo;
              </div>
            ) : (
              <div className="py-1">
                <p className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: "rgba(237,0,237,0.6)" }}>
                  Candidates
                </p>
                {searchResults.map((result) => (
                  <button
                    key={result.id}
                    className="w-full min-w-0 overflow-hidden px-4 py-2.5 text-left transition-colors"
                    style={{ color: "#C5CBE8" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(237,0,237,0.07)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    onMouseDown={() => {
                      router.push(result.href);
                      setSearchQuery(""); setSearchResults([]); setSearchHasResults(null);
                    }}
                  >
                    <p className="truncate text-sm font-medium">{result.label}</p>
                    <p className="mt-0.5 line-clamp-2 break-words text-xs" style={{ color: "rgba(144,141,206,0.6)" }}>{result.sublabel}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Sheet open={notifSheetOpen} onOpenChange={setNotifSheetOpen}>
          <SheetTrigger
            render={
              <button
                className="h-9 w-9 flex items-center justify-center rounded-xl relative transition-all duration-200"
                style={{ color: "rgba(197,203,232,0.5)" }}
              />
            }
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ background: "linear-gradient(135deg, #ED00ED 0%, #908DCE 100%)", boxShadow: "0 0 8px rgba(237,0,237,0.5)" }}
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </SheetTrigger>
          <SheetContent
            side="right"
            showCloseButton={false}
            className="w-80 p-0 flex flex-col border-l"
            style={{ background: "rgba(8,8,16,0.99)", backdropFilter: "blur(28px)", borderColor: "rgba(144,141,206,0.18)" }}
          >
            <SheetHeader className="border-b px-4 py-3 shrink-0" style={{ borderColor: "rgba(144,141,206,0.14)" }}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <SheetTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: "#C5CBE8" }}>
                    <Bell className="h-4 w-4" style={{ color: "#ED00ED" }} />
                    Notifications
                    {unreadCount > 0 && (
                      <span className="text-[9px] h-4 w-4 flex items-center justify-center rounded-full font-bold text-white" style={{ background: "linear-gradient(135deg, #ED00ED, #908DCE)" }}>
                        {unreadCount}
                      </span>
                    )}
                  </SheetTitle>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {notifications.length > 0 && (
                    <button
                      onClick={handleClearAllNotifications}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-[10px] transition-colors"
                      style={{ color: "rgba(144,141,206,0.75)", background: "rgba(144,141,206,0.08)" }}
                    >
                      <Trash2 className="h-3 w-3" /> Clear all
                    </button>
                  )}
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-[10px] transition-colors"
                      style={{ color: "rgba(144,141,206,0.75)", background: "rgba(144,141,206,0.08)" }}
                    >
                      <CheckCheck className="h-3 w-3" /> Mark all read
                    </button>
                  )}
                  <SheetClose
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0"
                        style={{ color: "rgba(197,203,232,0.6)" }}
                      />
                    }
                  >
                    <X className="h-4 w-4" />
                    <span className="sr-only">Close notifications</span>
                  </SheetClose>
                </div>
              </div>
            </SheetHeader>
            <ScrollArea className="flex-1 min-h-0">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16" style={{ color: "rgba(197,203,232,0.35)" }}>
                  <Bell className="h-8 w-8 opacity-20 mb-2" />
                  <p className="text-sm">No notifications</p>
                </div>
              ) : (
                <div>
                  {notifications.map((n) => {
                    const Icon = NOTIF_ICONS[n.type] ?? Info;
                    const iconColor = NOTIF_COLORS[n.type] ?? "text-[rgba(197,203,232,0.5)]";
                    const hasRoute = !!n.route;
                    return (
                      <div
                        key={n.id}
                        className={cn(
                          "group/notification relative w-full border-b px-4 py-3 pr-10 text-left transition-colors last:border-0",
                          !n.isRead && "bg-[rgba(237,0,237,0.04)]",
                          hasRoute && "hover:bg-[rgba(237,0,237,0.06)]"
                        )}
                        style={{ borderColor: "rgba(144,141,206,0.10)" }}
                      >
                        <button
                          type="button"
                          onClick={() => void handleNotificationClick(n)}
                          className="flex w-full gap-3 text-left"
                          aria-label={`Open notification: ${n.title}`}
                        >
                          <div className={cn("mt-0.5 shrink-0", iconColor)}><Icon className="h-4 w-4" /></div>
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-sm font-medium" style={{ color: n.isRead ? "rgba(197,203,232,0.65)" : "#C5CBE8" }}>{n.title}</p>
                            <p className="mt-0.5 line-clamp-2 text-xs" style={{ color: "rgba(197,203,232,0.4)" }}>{n.message}</p>
                            <p className="mt-1 text-[10px]" style={{ color: "rgba(197,203,232,0.25)" }}>{timeAgo(n.createdAt)}</p>
                          </div>
                        </button>
                        {!n.isRead && (
                          <div className="absolute right-4 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full" style={{ background: "#ED00ED", boxShadow: "0 0 6px rgba(237,0,237,0.6)" }} />
                        )}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleRemoveNotification(n.id);
                          }}
                          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full opacity-70 transition-all hover:bg-white/10 hover:opacity-100 focus-visible:opacity-100"
                          style={{ color: "rgba(197,203,232,0.58)" }}
                          aria-label={`Remove notification: ${n.title}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </SheetContent>
        </Sheet>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2.5 rounded-xl px-3 py-1.5 transition-all duration-200 focus:outline-none"
            style={{
              background: menuOpen ? "rgba(144,141,206,0.12)" : "rgba(144,141,206,0.07)",
              border: menuOpen ? "1px solid rgba(237,0,237,0.28)" : "1px solid rgba(144,141,206,0.18)",
            }}
          >
            <Avatar className="h-7 w-7 shrink-0 overflow-hidden">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={user.name} className="h-full w-full object-cover object-center" />}
              <AvatarFallback
                className="text-xs font-bold"
                style={{ background: "rgba(237,0,237,0.15)", color: "#ED00ED", border: "1px solid rgba(237,0,237,0.25)" }}
              >
                {getInitials(user.name)}
              </AvatarFallback>
            </Avatar>
            <div className="hidden md:block text-left">
              <p className="text-sm font-medium leading-none" style={{ color: "#C5CBE8" }}>{user.name}</p>
              <p className="text-[10px] mt-0.5" style={{ color: "rgba(144,141,206,0.6)" }}>{user.email}</p>
            </div>
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform duration-200", menuOpen && "rotate-180")}
              style={{ color: "rgba(144,141,206,0.5)" }}
            />
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 top-full mt-2 w-60 rounded-xl overflow-hidden z-50"
              style={{
                background: "rgba(8,8,16,0.99)",
                backdropFilter: "blur(24px)",
                border: "1px solid rgba(144,141,206,0.22)",
                boxShadow: "0 16px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(237,0,237,0.06)",
              }}
            >
              <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(144,141,206,0.12)" }}>
                <p className="truncate text-sm font-medium" style={{ color: "#C5CBE8" }}>{user.name}</p>
                <p className="text-xs mt-0.5 truncate" style={{ color: "rgba(144,141,206,0.6)" }}>{user.email}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider"
                    style={{ background: "rgba(237,0,237,0.12)", border: "1px solid rgba(237,0,237,0.25)", color: "#ED00ED" }}
                  >
                    {ROLE_LABELS[user.role]}
                  </span>
                  {user.isActive && (
                    <span
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider"
                      style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)", color: "#22c55e" }}
                    >
                      Active
                    </span>
                  )}
                </div>
              </div>

              {hasMultipleRoles && (
                <div className="border-b py-1.5 px-2" style={{ borderColor: "rgba(144,141,206,0.12)" }}>
                  <p className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: "rgba(237,0,237,0.65)" }}>
                    <Repeat className="h-3 w-3" /> Switch Role
                  </p>
                  {assignedRoles.map((r) => {
                    const isActive = r === user.role;
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => handleSwitchRole(r)}
                        disabled={isActive || switchingRole !== null}
                        className="w-full flex items-center justify-between gap-2 px-2 py-2 rounded-lg text-xs text-left transition-colors disabled:cursor-default"
                        style={{ color: "#C5CBE8", background: isActive ? "rgba(237,0,237,0.10)" : "transparent" }}
                        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "rgba(144,141,206,0.10)"; }}
                        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                      >
                        <span className="font-medium">{ROLE_LABELS[r] ?? formatLabel(r)}</span>
                        {isActive ? (
                          <Check className="h-3.5 w-3.5 shrink-0" style={{ color: "#ED00ED" }} />
                        ) : switchingRole === r ? (
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" style={{ color: "#908DCE" }} />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="py-1">
                {[
                  {
                    icon: User, label: "View Profile",
                    onClick: () => { setMenuOpen(false); setProfileOpen(true); },
                  },
                  {
                    icon: Pencil, label: "Edit Profile",
                    onClick: openEditProfile,
                  },
                  {
                    icon: Lock, label: "Change Password",
                    onClick: () => { setMenuOpen(false); setChangePassOpen(true); },
                  },
                  ...(canShowSeparation
                    ? [{
                        icon: LogOut, label: "Separation",
                        onClick: () => { setMenuOpen(false); router.push(separationHref); },
                      }]
                    : []),
                  ...(canShowSettings
                    ? [{
                        icon: Settings, label: "Settings",
                        onClick: () => { setMenuOpen(false); router.push("/dashboard/config/settings"); },
                      }]
                    : []),
                ].map(({ icon: Icon, label, onClick }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={onClick}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-left transition-colors"
                    style={MENU_ITEM_STYLE}
                    {...MENU_ITEM_HOVER}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: "#908DCE" }} />
                    {label}
                  </button>
                ))}
              </div>

              <div className="border-t py-1" style={{ borderColor: "rgba(144,141,206,0.12)" }}>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-left transition-colors"
                  style={{ color: "#f87171" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <LogOut className="h-3.5 w-3.5 shrink-0" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-sm overflow-y-auto rounded-2xl sm:w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5 text-primary" /> My Profile
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-14 w-14 shrink-0 overflow-hidden">
                {avatarUrl && <AvatarImage src={avatarUrl} alt={user.name} className="h-full w-full object-cover object-center" />}
                <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{user.name}</p>
                <p className="break-all text-sm text-muted-foreground">{user.email}</p>
                <Badge variant="outline" className="text-[10px] mt-1">{ROLE_LABELS[user.role]}</Badge>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Status</p>
                <p className={cn("font-medium mt-0.5", user.isActive ? "text-success" : "text-destructive")}>
                  {user.isActive ? "Active" : "Inactive"}
                </p>
              </div>
              {user.phone && (
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Phone</p>
                  <p className="mt-0.5 break-words font-medium">{user.phone}</p>
                </div>
              )}
              {user.lastLoginAt && (
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Last Login</p>
                  <p className="font-medium mt-0.5">{timeAgo(user.lastLoginAt)}</p>
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Member Since</p>
                <p className="font-medium mt-0.5">{timeAgo(user.createdAt)}</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="w-full rounded-xl text-xs sm:w-auto" onClick={() => { setProfileOpen(false); openEditProfile(); }}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit Profile
            </Button>
            <Button variant="outline" size="sm" className="w-full rounded-xl text-xs sm:w-auto" onClick={() => { setProfileOpen(false); setChangePassOpen(true); }}>
              <Lock className="h-3.5 w-3.5 mr-1.5" /> Change Password
            </Button>
            <DialogClose render={<Button size="sm" className="w-full rounded-xl text-xs sm:w-auto" />}>Close</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editProfileOpen} onOpenChange={(open) => { setEditProfileOpen(open); if (!open) resetEditProfileState(); }}>
        <DialogContent
          className="w-[calc(100vw-1rem)] max-w-lg overflow-visible p-0 sm:w-full"
        >
          <DialogHeader className="border-b px-4 py-4 text-left sm:px-5">
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" /> Edit Profile
            </DialogTitle>
            <DialogDescription>
              Update your name and phone number.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveProfile} className="flex flex-col">
            <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Full Name *</Label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Your full name"
                  className={PROFILE_INPUT_CLASSNAME}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Phone Number{isEmployeeProfile ? " *" : ""}</Label>
                <Input
                  value={editPhone}
                  onChange={(e) =>
                    setEditPhone(
                      isEmployeeProfile ? e.target.value.replace(/\D/g, "").slice(0, 10) : e.target.value
                    )
                  }
                  placeholder={isEmployeeProfile ? "9876543210" : "+91 XXXXX XXXXX"}
                  inputMode={isEmployeeProfile ? "numeric" : "tel"}
                  maxLength={isEmployeeProfile ? 10 : undefined}
                  className={PROFILE_INPUT_CLASSNAME}
                  required={isEmployeeProfile}
                />
              </div>
            </div>
            <DialogFooter className="mx-0 mb-0 gap-2 rounded-b-2xl border-t bg-popover px-4 py-4 sm:px-5">
              <DialogClose render={<Button type="button" variant="outline" size="sm" className="w-full rounded-xl text-xs sm:w-auto" />}>Cancel</DialogClose>
              <Button type="submit" size="sm" className="w-full rounded-xl text-xs sm:w-auto" disabled={savingProfile || !editName.trim()}>
                {savingProfile ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving…</> : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={effectiveChangePassOpen} onOpenChange={(open) => {
        if (!open && user?.mustChangePassword) return;
        setChangePassOpen(open);
        if (!open) { setCpStep("request"); setCpOtp(""); setCpDevCode(null); setNewPassword(""); setConfirmPassword(""); }
      }}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-md overflow-y-auto rounded-2xl sm:w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-primary" /> Change Password
            </DialogTitle>
            <DialogDescription>
              {user?.mustChangePassword
                ? "You signed in with a temporary password. Change it now to continue."
                : "Enter your current password and choose a new one."}
            </DialogDescription>
          </DialogHeader>
          {cpStep === "request" ? (
            <div className="space-y-4">
              <div
                className="rounded-xl p-3 text-sm"
                style={{ background: "rgba(144,141,206,0.07)", border: "1px solid rgba(144,141,206,0.18)" }}
              >
                <p className="text-muted-foreground text-xs">
                  We will send a one-time verification code to <strong className="text-foreground">{user?.email}</strong>.
                  Enter it on the next screen to set your new password.
                </p>
              </div>
              <DialogFooter>
                {!user?.mustChangePassword && (
                  <DialogClose render={<Button type="button" variant="outline" size="sm" className="w-full rounded-xl text-xs sm:w-auto" />}>Cancel</DialogClose>
                )}
                <Button
                  size="sm"
                  className="w-full rounded-xl text-xs sm:w-auto"
                  disabled={cpSending}
                  onClick={handleRequestOtp}
                >
                  {cpSending ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Sending…</> : "Send Verification Code"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div
                className="rounded-xl px-3 py-2.5 text-xs"
                style={{ background: "rgba(144,141,206,0.07)", border: "1px solid rgba(144,141,206,0.18)", color: "rgba(197,203,232,0.65)" }}
              >
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-400" />
                  <div className="min-w-0 space-y-1">
                    <p className="leading-relaxed">
                      OTP sent to <span className="break-all text-foreground">{user?.email}</span>
                    </p>
                    {cpDevCode && (
                      <p className="font-mono font-bold text-primary">Dev code: {cpDevCode}</p>
                    )}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Verification Code (OTP)</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={cpOtp}
                  onChange={(e) => setCpOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="6-digit OTP"
                  className="rounded-xl h-10 font-mono tracking-widest"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">New Password</Label>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Minimum 8 characters" className="rounded-xl h-10" minLength={8} required />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Confirm New Password</Label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className={cn("rounded-xl h-10", confirmPassword && newPassword !== confirmPassword && "border-destructive")}
                  required
                />
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-xs text-destructive">Passwords do not match</p>
                )}
              </div>
              <DialogFooter className="gap-2 sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full rounded-xl text-xs sm:w-auto"
                  onClick={() => { setCpStep("request"); setCpOtp(""); setCpDevCode(null); }}
                >
                  Resend OTP
                </Button>
                <Button type="submit" size="sm" className="w-full rounded-xl text-xs sm:w-auto" disabled={changingPass || !cpOtp || !newPassword || newPassword !== confirmPassword}>
                  {changingPass ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Changing…</> : "Change Password"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

    </header>
    {switchingOverlay}
    </>
  );
}
