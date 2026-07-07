"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { cn, timeAgo } from "@/lib/utils";
import { Bell, CheckCircle2, Info, FileText, Shield } from "lucide-react";

const notifications = [
  { id: "1", type: "success" as const, title: "Resume Screening Passed!", message: "Your resume scored 87/100. You have been shortlisted for the technical evaluation round.", time: "2026-05-02T09:00:00Z", read: true, icon: CheckCircle2, route: "/portal/dashboard" },
  { id: "2", type: "success" as const, title: "Evaluation Completed", message: "Your technical evaluation has been completed successfully. Congratulations!", time: "2026-05-03T16:00:00Z", read: true, icon: CheckCircle2, route: "/portal/dashboard" },
  { id: "3", type: "warning" as const, title: "Contract Awaiting Signature", message: "Your offer letter is ready. Please sign it before May 9, 2026 to confirm your acceptance.", time: "2026-05-04T14:00:00Z", read: false, icon: FileText, route: "/portal/contract" },
  { id: "5", type: "info" as const, title: "Welcome to Ethara HRMS!", message: "Your account has been activated. Complete your profile to get started with the onboarding process.", time: "2026-05-01T08:00:00Z", read: true, icon: Info, route: "/portal/dashboard" },
  { id: "6", type: "info" as const, title: "Compliance Forms Available", message: "Your statutory compliance forms (EPF, Gratuity, ESIC) are now available. Please complete them at your earliest.", time: "2026-05-04T16:00:00Z", read: false, icon: Shield, route: "/portal/compliance" },
];

const typeConfig = {
  success: { bg: "bg-success/5 border-success/20", icon: "text-success", dot: "bg-success" },
  warning: { bg: "bg-warning/5 border-warning/20", icon: "text-warning", dot: "bg-warning" },
  info: { bg: "bg-primary/5 border-primary/20", icon: "text-primary", dot: "bg-primary" },
  error: { bg: "bg-destructive/5 border-destructive/20", icon: "text-destructive", dot: "bg-destructive" },
};

export default function PortalNotificationsPage() {
  const router = useRouter();
  const [notifs, setNotifs] = useState(notifications);

  const unread = notifs.filter((n) => !n.read).length;

  const markRead = (id: string) => setNotifs((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
  const markAllRead = () => setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <PageHeader
        icon={Bell}
        title="Notifications"
        description="Stay updated on your application progress"
        actions={
          unread > 0 ? (
            <Button variant="ghost" size="sm" className="rounded-xl text-xs" onClick={markAllRead}>
              Mark all read
            </Button>
          ) : null
        }
      />

      {unread > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <Bell className="h-4 w-4 text-primary" />
          <p className="text-sm text-primary font-medium">{unread} unread notification{unread > 1 ? "s" : ""}</p>
        </div>
      )}

      <div className="space-y-2">
        {notifs.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="You're all caught up"
            description="New updates about your application will show up here."
          />
        ) : notifs.map((n) => {
          const cfg = typeConfig[n.type];
          const Icon = n.icon;
          return (
            <div
              key={n.id}
              className={cn(
                "relative rounded-xl border p-4 transition-all cursor-pointer hover:shadow-sm",
                n.read ? "bg-card border-border" : cn(cfg.bg, "border")
              )}
              onClick={() => {
                markRead(n.id);
                if (n.route) router.push(n.route);
              }}
            >
              {!n.read && (
                <div className={cn("absolute top-4 right-4 h-2 w-2 rounded-full", cfg.dot)} />
              )}
              <div className="flex items-start gap-3 pr-4">
                <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", n.read ? "bg-muted" : cfg.bg.split(" ")[0])}>
                  <Icon className={cn("h-4.5 w-4.5", n.read ? "text-muted-foreground" : cfg.icon)} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn("text-sm font-semibold", !n.read && "text-foreground")}>{n.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.message}</p>
                  <p className="text-[10px] text-muted-foreground mt-1.5">{timeAgo(n.time)}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
