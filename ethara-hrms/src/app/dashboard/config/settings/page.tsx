"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Settings, Save, RefreshCw, Shield, Clock, Mail, Globe, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { canAccessSettingsForUser, getDefaultRouteForRole } from "@/lib/utils";
import { adminSettingsApi } from "@/lib/api";

// Each field maps to a unique key stored in the DB under namespace "system"
const SECTIONS = [
  {
    title: "General",
    icon: Globe,
    namespace: "system",
    fields: [
      { key: "companyName",   label: "Company Name",   type: "text",   defaultValue: "Ethara Pvt Ltd" },
      { key: "supportEmail",  label: "Support Email",  type: "email",  defaultValue: "hr@ethara.com" },
      { key: "timezone",      label: "Timezone",       type: "text",   defaultValue: "Asia/Kolkata (IST +5:30)" },
    ],
  },
  {
    title: "SLA Configuration",
    icon: Clock,
    namespace: "sla",
    fields: [
      { key: "screeningSLA",   label: "Resume Screening SLA (hours)",  type: "number", defaultValue: "48" },
      { key: "evaluationSLA",  label: "Evaluation SLA (hours)",        type: "number", defaultValue: "72" },
      { key: "contractSLA",    label: "Contract Signing SLA (days)",   type: "number", defaultValue: "5" },
      { key: "itSetupSLA",     label: "IT Email Setup SLA (hours)",    type: "number", defaultValue: "24" },
      { key: "complianceSLA",  label: "Compliance Forms SLA (days)",   type: "number", defaultValue: "7" },
    ],
  },
  {
    title: "Email Notifications",
    icon: Mail,
    namespace: "email",
    fields: [
      { key: "fromEmail", label: "From Email",  type: "email",  defaultValue: "noreply@ethara.com" },
      { key: "smtpHost",  label: "SMTP Host",   type: "text",   defaultValue: "smtp.sendgrid.net" },
      { key: "smtpPort",  label: "SMTP Port",   type: "number", defaultValue: "587" },
    ],
  },
  {
    title: "Security",
    icon: Shield,
    namespace: "security",
    fields: [
      { key: "sessionTimeout",    label: "Session Timeout (minutes)", type: "number", defaultValue: "480" },
      { key: "maxLoginAttempts",  label: "Max Login Attempts",        type: "number", defaultValue: "5" },
      { key: "jwtExpiry",         label: "JWT Expiry (minutes)",      type: "number", defaultValue: "60" },
    ],
  },
];

// Build a flat defaults map used as fallback before the DB responds
const DEFAULTS: Record<string, string> = {};
SECTIONS.forEach((s) => s.fields.forEach((f) => { DEFAULTS[f.key] = f.defaultValue; }));

export default function SettingsPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [values, setValues] = useState<Record<string, string>>(DEFAULTS);
  // Track what was last persisted so we know what's actually dirty
  const savedRef = useRef<Record<string, string>>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user && !canAccessSettingsForUser(user)) {
      router.replace(getDefaultRouteForRole(user.role));
    }
  }, [router, user]);

  // Load persisted values from the backend on mount
  useEffect(() => {
    if (!user || !canAccessSettingsForUser(user)) return;

    let cancelled = false;
    const load = async () => {
      try {
        const records = await adminSettingsApi.list();
        if (cancelled) return;

        // Merge DB values over defaults — only override keys we know about
        const merged = { ...DEFAULTS };
        records.forEach((r) => {
          if (r.key in merged && r.value !== null && r.value !== undefined) {
            merged[r.key] = String(r.value);
          }
        });

        setValues(merged);
        savedRef.current = { ...merged };
      } catch {
        // Network / auth failure — stay on defaults, user can still save
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [user]);

  const handleSave = async () => {
    setSaving(true);
    const errors: string[] = [];

    // Only upsert keys whose value actually changed since last save
    const allFields = SECTIONS.flatMap((s) =>
      s.fields.map((f) => ({ key: f.key, namespace: s.namespace }))
    );

    for (const { key, namespace } of allFields) {
      if (values[key] === savedRef.current[key]) continue; // unchanged — skip
      try {
        await adminSettingsApi.upsert({ key, value: values[key], namespace });
        savedRef.current[key] = values[key];
      } catch {
        errors.push(key);
      }
    }

    setSaving(false);

    if (errors.length === 0) {
      toast.success("Settings saved successfully.");
    } else {
      toast.error(`Some settings could not be saved: ${errors.join(", ")}`);
    }
  };

  if (!user || !canAccessSettingsForUser(user)) return null;

  return (
    <div className="space-y-4 overflow-x-hidden animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
            <Settings className="h-6 w-6 text-primary" /> System Settings
          </h1>
          <p className="text-muted-foreground">Configure platform-wide settings and SLA thresholds</p>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:items-center">
          <Badge variant="outline" className="text-xs text-success border-success/30">
            <span className="h-1.5 w-1.5 rounded-full bg-success mr-1.5 inline-block" />
            System Healthy
          </Badge>
          <Button className="h-9 rounded-xl text-xs" onClick={handleSave} disabled={saving || loading}>
            {saving ? (
              <span className="flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Saving...</span>
            ) : (
              <span className="flex items-center gap-1.5"><Save className="h-3.5 w-3.5" /> Save Changes</span>
            )}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <Card key={section.title} className="border-0 shadow-sm">
                <CardHeader className="px-4 pb-3 pt-4 sm:px-6 sm:pt-6">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="h-4 w-4 text-primary" />
                    {section.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {section.fields.map((field) => (
                      <div key={field.key} className="space-y-1.5">
                        <Label className="text-xs font-medium text-muted-foreground">{field.label}</Label>
                        <Input
                          type={field.type}
                          value={values[field.key] ?? ""}
                          onChange={(e) => setValues((p) => ({ ...p, [field.key]: e.target.value }))}
                          className="rounded-xl h-9 text-sm"
                        />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
