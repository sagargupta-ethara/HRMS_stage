"use client";

import { FileText } from "lucide-react";

import { GeneralApplicationsCard } from "@/components/dashboard/general-applications-card";

export default function ApplicationsPage() {
  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight" style={{ color: "#C5CBE8" }}>
          <FileText className="h-6 w-6 text-primary" />
          Resume Database
        </h1>
        <p className="mt-1 text-sm" style={{ color: "rgba(197,203,232,0.50)" }}>
          Resumes from the careers page and employee referrals.
        </p>
      </div>

      <GeneralApplicationsCard />
    </div>
  );
}
