"use client";

import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { detectAtsVendor } from "@/lib/agents/ats-vendor";
import { updateApplicationJdUrlAction } from "@/app/applications/[id]/actions";

export function JdUrlPasteForm({ applicationId }: { applicationId: string }) {
  const [url, setUrl] = useState("");
  const [pending, startTransition] = useTransition();

  // Live preview of what vendor would be detected as the user types,
  // so they see the value before committing.
  const preview = url.trim().length > 0 ? detectAtsVendor(url) : null;

  function submit() {
    if (pending) return;
    const trimmed = url.trim();
    if (trimmed.length === 0) {
      toast.error("Paste a URL first.");
      return;
    }
    startTransition(async () => {
      const r = await updateApplicationJdUrlAction(applicationId, trimmed);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("JD URL saved — vendor guidance updated.");
      setUrl("");
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-3">
      <label htmlFor="jd-url-paste" className="text-xs font-medium">
        Job posting URL
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="jd-url-paste"
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="https://jobs.lever.co/company/abc123 — or any Workday / Greenhouse / careers URL"
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
          disabled={pending}
        />
        <Button
          onClick={submit}
          disabled={pending || url.trim().length === 0}
          size="sm"
          className="gap-1.5 sm:shrink-0"
        >
          {pending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Save className="size-3.5" /> Save URL
            </>
          )}
        </Button>
      </div>
      {preview && (
        <p className="text-xs text-muted-foreground">
          Will detect:{" "}
          <span className="font-medium text-foreground">{preview.displayName}</span>
          {preview.confidence === "high" && preview.matchedDomain
            ? ` (${preview.matchedDomain})`
            : preview.confidence === "low"
              ? " — host not recognized, will fall back to conservative guidance"
              : ""}
        </p>
      )}
    </div>
  );
}
