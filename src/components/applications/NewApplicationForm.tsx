"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const STEPS = [
  "Analyzing job description (Opus)",
  "Retrieving relevant KB facts",
  "Scoring fit against your background (Haiku)",
];

export function NewApplicationForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"paste" | "url">("paste");
  const [jdText, setJdText] = useState("");
  const [jdUrl, setJdUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!submitting) return;
    const id = setInterval(() => setStepIndex((i) => (i + 1) % STEPS.length), 5000);
    return () => clearInterval(id);
  }, [submitting]);

  async function submit() {
    if (mode === "paste" && jdText.trim().length < 200) {
      toast.error("Paste the full JD body — at least 200 characters.");
      return;
    }
    if (mode === "url" && !jdUrl.trim()) {
      toast.error("Enter a JD URL.");
      return;
    }
    setSubmitting(true);
    setStepIndex(0);
    try {
      const body =
        mode === "paste"
          ? { mode: "paste", jdText: jdText.trim() }
          : { mode: "url", jdUrl: jdUrl.trim() };
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as
        | { applicationId: string; costUsd: number }
        | { error: string };
      if (!res.ok || "error" in json) {
        const message = "error" in json ? json.error : `HTTP ${res.status}`;
        toast.error(message);
        setSubmitting(false);
        return;
      }
      toast.success(`Analysis complete · $${json.costUsd.toFixed(3)} spent`);
      router.push(`/applications/${json.applicationId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Tabs value={mode} onValueChange={(v) => setMode(v as "paste" | "url")}>
        <TabsList>
          <TabsTrigger value="paste">Paste JD</TabsTrigger>
          <TabsTrigger value="url">From URL</TabsTrigger>
        </TabsList>

        <TabsContent value="paste" className="mt-4 space-y-2">
          <Label htmlFor="jd-text">Job description</Label>
          <Textarea
            id="jd-text"
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            placeholder="Paste the full job description body here — title, company, responsibilities, requirements, etc. The more complete the better."
            rows={16}
            disabled={submitting}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            {jdText.length} characters ({jdText.length >= 200 ? "✓" : `${200 - jdText.length} more needed`})
          </p>
        </TabsContent>

        <TabsContent value="url" className="mt-4 space-y-2">
          <Label htmlFor="jd-url">Job description URL</Label>
          <Input
            id="jd-url"
            type="url"
            placeholder="https://jobs.lever.co/company/abc123 or any Greenhouse/Workday/company careers URL"
            value={jdUrl}
            onChange={(e) => setJdUrl(e.target.value)}
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground">
            Talos will fetch the page and extract the main content. If the page is JS-rendered or
            behind auth, paste the JD text directly instead.
          </p>
        </TabsContent>
      </Tabs>

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={submitting} size="default">
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Working…
            </>
          ) : (
            <>
              {mode === "url" ? <Globe className="size-4" /> : <Send className="size-4" />}
              Analyze and score fit
            </>
          )}
        </Button>
        {submitting && (
          <p className="text-sm text-muted-foreground">
            Step {stepIndex + 1}/3 — {STEPS[stepIndex]}
          </p>
        )}
      </div>
      {submitting && (
        <p className="text-xs text-muted-foreground">
          Usually finishes in 15–30 seconds. Don&apos;t refresh — the next page
          shows the JD analysis, fit score, and the approval gate.
        </p>
      )}
    </div>
  );
}
