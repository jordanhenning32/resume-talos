"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function AttributeFactForm({ factId }: { factId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [employer, setEmployer] = useState("");
  const [role, setRole] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  if (!open) {
    return (
      <Button type="button" size="xs" variant="outline" onClick={() => setOpen(true)}>
        Attribute...
      </Button>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!employer.trim()) {
      setError("Employer is required.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch(`/api/kb/facts/${factId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ company: employer, role, startDate, endDate }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <input className="h-8 rounded-md border bg-background px-2 text-sm" required placeholder="Employer" value={employer} onChange={(e) => setEmployer(e.target.value)} disabled={pending} />
        <input className="h-8 rounded-md border bg-background px-2 text-sm" placeholder="Role" value={role} onChange={(e) => setRole(e.target.value)} disabled={pending} />
        <input className="h-8 rounded-md border bg-background px-2 text-sm" placeholder="Start" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={pending} />
        <input className="h-8 rounded-md border bg-background px-2 text-sm" placeholder="End" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={pending} />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="xs" disabled={pending}>Save</Button>
        <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
      </div>
    </form>
  );
}
