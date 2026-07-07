"use client";

import { ShieldCheck } from "lucide-react";

import { IdCardDetailsCard } from "@/components/employees/id-card-details-card";

export default function EmployeeIdCardPage() {
  return (
    <div className="space-y-4 overflow-x-hidden animate-fade-in">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <ShieldCheck className="h-5 w-5 text-primary" /> ID Card Details
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Provide the details printed on your employee ID card. Blood group is required.
        </p>
      </div>
      <IdCardDetailsCard mode="self" />
    </div>
  );
}
