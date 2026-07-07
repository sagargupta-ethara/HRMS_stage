"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { EvaluationView } from "@/components/employee-evaluation/evaluation-view";

export default function EmployeeEvaluationDetailPage() {
  const params = useParams<{ employeeId: string }>();
  const employeeId = String(params.employeeId || "");

  return (
    <div className="space-y-4 overflow-x-hidden animate-fade-in">
      <Link href="/dashboard/employee-evaluation" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Employee Evaluation
      </Link>

      <EvaluationView employeeId={employeeId} />
    </div>
  );
}
