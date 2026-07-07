"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCreateApAssessment } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";

export default function NewAssessmentPage() {
  const router = useRouter();
  const create = useCreateApAssessment();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const submit = async () => {
    if (!title.trim()) return;
    const created = await create.mutateAsync({ title: title.trim(), description: description || null });
    router.push(`/dashboard/assessment-platform/${created.id}/edit`);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back
      </button>
      <Card>
        <CardHeader><CardTitle>New assessment</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Backend Developer Test" autoFocus />
          </div>
          <div className="space-y-1">
            <Label>Description (optional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
            <Button onClick={submit} disabled={!title.trim() || create.isPending}>Create & build</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
