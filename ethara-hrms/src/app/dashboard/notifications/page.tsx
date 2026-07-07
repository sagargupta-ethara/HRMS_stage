"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { cn, timeAgo } from "@/lib/utils";
import { Bell, CheckCircle2, AlertTriangle, FileText, Check, Loader2 } from "lucide-react";
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from "@/lib/queries";
import type { NotificationRecord } from "@/lib/api";

const MOCK_NOTIFS: NotificationRecord[] = [
  { id: "1", userId: "mock-admin", type: "action", title: "New application submitted", message: "Priya Nair applied for Senior Frontend Developer", isRead: false, createdAt: "2026-05-04T18:45:00Z", route: "/dashboard/candidates" },
  { id: "2", userId: "mock-admin", type: "warning", title: "SLA Breach Warning", message: "IT email creation for Amit Singh overdue by 3 days", isRead: false, createdAt: "2026-05-04T12:00:00Z", route: "/dashboard/escalations" },
  { id: "3", userId: "mock-admin", type: "info", title: "Evaluation completed", message: "Dr. Sanjay Patel completed evaluation for Priya Nair (Score: 82)", isRead: false, createdAt: "2026-05-04T22:30:00Z", route: "/dashboard/evaluations" },
  { id: "4", userId: "mock-admin", type: "success", title: "Contract signed", message: "Ananya Gupta signed the employment contract", isRead: true, createdAt: "2026-05-03T14:00:00Z", route: "/dashboard/contracts" },
  { id: "5", userId: "mock-admin", type: "info", title: "Resume screening completed", message: "5 candidates screened, 3 shortlisted, 2 rejected", isRead: true, createdAt: "2026-05-03T10:00:00Z", route: "/dashboard/candidates" },
  { id: "6", userId: "mock-admin", type: "action", title: "Selection form submitted", message: "Kavita Joshi submitted her selection form for review", isRead: true, createdAt: "2026-05-02T16:30:00Z", route: "/dashboard/selection-forms" },
  { id: "7", userId: "mock-admin", type: "success", title: "Ethara email created", message: "vikram.mehta@ethara.com created for Vikram Mehta", isRead: true, createdAt: "2026-05-02T11:00:00Z", route: "/dashboard/it-requests" },
  { id: "8", userId: "mock-admin", type: "warning", title: "Document verification needed", message: "PAN card for Rahul Sharma needs manual verification", isRead: true, createdAt: "2026-05-01T09:00:00Z", route: "/dashboard/documents" },
];

const typeColors: Record<string, string> = {
  action: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  error: "bg-destructive/10 text-destructive",
};

const typeIcons: Record<string, React.ElementType> = {
  action: FileText, info: Bell,
  success: CheckCircle2, warning: AlertTriangle, error: AlertTriangle,
};

export default function NotificationsPage() {
  const router = useRouter();
  const { data: apiNotifs, isLoading, isError } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const items: NotificationRecord[] = isError || !apiNotifs ? MOCK_NOTIFS : apiNotifs;
  const unread = items.filter((n) => !n.isRead).length;

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      <PageHeader
        title="Notifications"
        description={unread > 0 ? `${unread} unread notifications` : "All caught up!"}
        actions={
          unread > 0 ? (
            <Button variant="outline" size="sm" className="rounded-xl text-xs" onClick={() => markAllRead.mutate()}>
              <Check className="mr-1.5 h-3.5 w-3.5" /> Mark all read
            </Button>
          ) : undefined
        }
      />

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0 divide-y divide-border">
          {isLoading ? (
            <div className="py-16 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
            </div>
          ) : items.map((notification) => {
            const Icon = typeIcons[notification.type] ?? Bell;
            const route = notification.route ?? null;
            return (
              <div
                key={notification.id}
                onClick={() => {
                  if (!isError) markRead.mutate(notification.id);
                  if (route) router.push(route);
                }}
                className={cn(
                  "flex items-start gap-3 px-4 py-3.5 cursor-pointer transition-colors",
                  !notification.isRead ? "bg-primary/[0.03]" : "hover:bg-muted/20",
                  route && "hover:bg-primary/[0.05]"
                )}
              >
                <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl shrink-0", typeColors[notification.type] ?? "bg-muted text-muted-foreground")}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={cn("text-sm font-medium", !notification.isRead && "font-semibold")}>{notification.title}</p>
                    {!notification.isRead && <div className="h-2 w-2 rounded-full bg-primary shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{notification.message}</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">{timeAgo(notification.createdAt)}</p>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
