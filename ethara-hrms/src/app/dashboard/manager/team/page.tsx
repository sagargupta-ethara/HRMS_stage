"use client";

import { useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getInitials } from "@/lib/utils";
import { Users, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { managerApi, type TeamMember } from "@/lib/api";

export default function ManagerTeamPage() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    managerApi.getTeam()
      .then(setTeam)
      .catch(() => toast.error("Failed to load team"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = team.filter((m) => {
    const q = search.toLowerCase();
    return !q || m.fullName.toLowerCase().includes(q) || m.etharaEmail.toLowerCase().includes(q) || (m.department || "").toLowerCase().includes(q);
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Users className="h-6 w-6 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">My Team ({team.length})</h1>
            <p className="text-sm text-muted-foreground">Employees reporting to you</p>
          </div>
        </div>
        <div className="relative w-full sm:w-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search team…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 w-full text-sm sm:w-56"
          />
        </div>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-3">
              <Users className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {team.length === 0 ? "No team members assigned yet" : "No results match your search"}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((m) => (
                <div key={m.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarFallback className="text-sm">{getInitials(m.fullName)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-3 gap-1">
                    <div>
                      <p className="text-sm font-medium">{m.fullName}</p>
                      <p className="text-xs text-muted-foreground">{m.etharaEmail}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Department</p>
                      <p className="text-xs font-medium">{m.department || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Designation</p>
                      <p className="text-xs font-medium">{m.designation || "—"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary" className="text-xs">{m.employeeCode}</Badge>
                    {m.bloodGroup && (
                      <Badge variant="outline" className="text-xs">{m.bloodGroup}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
