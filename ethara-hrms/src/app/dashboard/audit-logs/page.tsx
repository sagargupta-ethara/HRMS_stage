"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatDateTime, formatLabel, ROLE_LABELS } from "@/lib/utils";
import type { Role } from "@/types";
import { History, Search, Filter, Download, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { auditLogsApi } from "@/lib/api";

type AuditLog = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  performedBy?: string;
  performed_by?: string;
  performedByName?: string;
  performed_by_name?: string;
  performedByRole?: string;
  performed_by_role?: string;
  ipAddress?: string;
  ip_address?: string;
  createdAt?: string;
  created_at?: string;
};

const entityColors: Record<string, string> = {
  candidate: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  resume_screening: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  evaluation: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  selection_form: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  document: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  ocr: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  escalation: "bg-red-500/10 text-red-600 dark:text-red-400",
  user: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
  contract: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  compliance_form: "bg-green-500/10 text-green-600 dark:text-green-400",
  it_request: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
};

const entityFilterLabels: Record<string, string> = {
  all: "All Entities",
  candidate: "Candidate",
  evaluation: "Evaluation",
  document: "Document",
  selection_form: "Selection Form",
  contract: "Contract",
  compliance_form: "Compliance",
  it_request: "IT Request",
  escalation: "Escalation",
  user: "User",
};

const PAGE_SIZE = 20;

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");

  const loadLogs = async (p: number, entityType: string) => {
    setIsLoading(true);
    try {
      const data = await auditLogsApi.list({
        entityType: entityType !== "all" ? entityType : undefined,
        page: p,
        limit: PAGE_SIZE,
      });
      setLogs(data.data ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setLogs([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
    void loadLogs(1, entityFilter);
  }, [entityFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLogs(page, entityFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const filtered = search
    ? logs.filter((log) => {
        const q = search.toLowerCase();
        return (
          log.action.toLowerCase().includes(q) ||
          (log.performedByName ?? log.performed_by_name ?? "").toLowerCase().includes(q) ||
          log.entityId.toLowerCase().includes(q)
        );
      })
    : logs;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <History className="h-6 w-6 text-primary" />
            Audit Logs
          </h1>
          <p className="text-muted-foreground">Complete audit trail of all system actions</p>
        </div>
        <Button variant="outline" size="sm" className="rounded-xl text-xs">
          <Download className="mr-1.5 h-3.5 w-3.5" /> Export Logs
        </Button>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search actions, users, entity IDs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 rounded-xl h-10"
              />
            </div>
            <Select value={entityFilter} onValueChange={(v) => setEntityFilter(v ?? "all")}>
              <SelectTrigger className="w-full sm:w-44 rounded-xl h-10">
                <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue>
                  {(value) => entityFilterLabels[String(value ?? "all")] ?? "All Entities"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entities</SelectItem>
                <SelectItem value="candidate">Candidate</SelectItem>
                <SelectItem value="evaluation">Evaluation</SelectItem>
                <SelectItem value="document">Document</SelectItem>
                <SelectItem value="selection_form">Selection Form</SelectItem>
                <SelectItem value="contract">Contract</SelectItem>
                <SelectItem value="compliance_form">Compliance</SelectItem>
                <SelectItem value="it_request">IT Request</SelectItem>
                <SelectItem value="escalation">Escalation</SelectItem>
                <SelectItem value="user">User</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((log) => {
                const name = log.performedByName ?? log.performed_by_name ?? log.performedBy ?? log.performed_by ?? "System";
                const role = log.performedByRole ?? log.performed_by_role ?? "system";
                const ip = log.ipAddress ?? log.ip_address;
                const ts = log.createdAt ?? log.created_at;
                return (
                  <div key={log.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
                    <div className="flex flex-col items-center mt-1">
                      <div className="h-2 w-2 rounded-full bg-primary" />
                      <div className="w-0.5 flex-1 bg-border mt-1" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {formatLabel(log.action)}
                          </p>
                          <Badge
                            variant="outline"
                            className={cn("text-[9px] px-1.5 py-0 shrink-0", entityColors[log.entityType] ?? "")}
                          >
                            {formatLabel(log.entityType)}
                          </Badge>
                        </div>
                        {ts && (
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                            {formatDateTime(ts)}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
                        <span>by <span className="font-medium text-foreground">{name}</span></span>
                        <Badge variant="secondary" className="text-[9px] px-1 py-0">{ROLE_LABELS[role as Role] ?? formatLabel(role)}</Badge>
                        <span className="font-mono text-[10px] break-all">{log.entityId}</span>
                        {ip && <span className="font-mono text-[10px] break-all">IP: {ip}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="py-16 text-center text-muted-foreground">
                  <History className="h-10 w-10 mx-auto opacity-30 mb-2" />
                  <p className="font-medium">No logs found</p>
                </div>
              )}
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Page {page} of {totalPages} · {total} total
              </p>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === totalPages} onClick={() => setPage(page + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
