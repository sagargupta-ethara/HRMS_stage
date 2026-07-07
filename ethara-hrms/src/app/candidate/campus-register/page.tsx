"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { campusApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { ArrowLeft, GraduationCap, Loader2 } from "lucide-react";

function errMsg(e: unknown): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Something went wrong";
}

export default function CampusRegisterPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [form, setForm] = useState({ fullName: "", personalEmail: "", phone: "", password: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    campusApi.config().then((c) => setEnabled(c.enabled)).catch(() => setEnabled(false));
  }, []);

  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    const email = form.personalEmail.trim().toLowerCase();
    if (!form.fullName.trim() || !email || !form.phone.trim() || form.password.length < 8) {
      toast.error("Fill all fields. Password must be at least 8 characters.");
      return;
    }
    if (!/^[6-9]\d{9}$/.test(form.phone.replace(/\s/g, ""))) {
      toast.error("Enter a valid 10-digit mobile number.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("fullName", form.fullName.trim());
      fd.append("personalEmail", email);
      fd.append("phone", form.phone.trim());
      fd.append("password", form.password);
      await campusApi.register(fd);
      await login(email, form.password);
      toast.success("Welcome! Your assessment will appear here once it's assigned.");
      router.push("/portal/my-assessments");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (enabled === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (enabled === false) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6">
        <Image
          src="/logo.png"
          alt="Ethara.AI"
          width={128}
          height={36}
          priority
          className="object-contain"
          style={{ width: "auto", height: "auto" }}
        />
        <Card className="w-full max-w-md">
          <CardContent className="px-6 py-4">
            <EmptyState
              icon={GraduationCap}
              title="Campus drive is closed"
              description="Campus drive registration isn't open right now. Please check back later or reach out to your campus coordinator."
              action={
                <Link href="/login" className="text-sm font-medium text-primary hover:underline">
                  Back to login
                </Link>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Link href="/login" className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary">
            <ArrowLeft className="size-4" /> Back to login
          </Link>
          <CardTitle className="flex items-center gap-2"><GraduationCap className="size-5" /> Campus Drive registration</CardTitle>
          <p className="text-sm text-muted-foreground">Quick sign-up — you&apos;ll take a short assessment first. Full details come later only if you clear it.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1"><Label>Full name</Label>
            <Input value={form.fullName} onChange={(e) => set("fullName", e.target.value)} autoFocus /></div>
          <div className="space-y-1"><Label>Email</Label>
            <Input type="email" value={form.personalEmail} onChange={(e) => set("personalEmail", e.target.value)} /></div>
          <div className="space-y-1"><Label>Mobile number</Label>
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit mobile" /></div>
          <div className="space-y-1"><Label>Create a password</Label>
            <Input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} placeholder="At least 8 characters" /></div>
          <Button className="w-full" onClick={submit} disabled={busy || enabled === null}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} Register & continue
          </Button>
          <p className="text-center text-xs text-muted-foreground">Already registered? <Link href="/login" className="text-primary">Sign in</Link></p>
        </CardContent>
      </Card>
    </div>
  );
}
