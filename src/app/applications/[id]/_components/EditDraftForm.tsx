"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FilePenLine, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { saveManualEditAction } from "@/app/applications/[id]/actions";

export function EditDraftForm({
  applicationId,
  initialResumeMarkdown,
  initialCoverLetterMarkdown,
  hasExistingDrafts,
  currentVersionLabel,
}: {
  applicationId: string;
  initialResumeMarkdown: string;
  initialCoverLetterMarkdown: string;
  hasExistingDrafts: boolean;
  currentVersionLabel: string | null;
}) {
  const router = useRouter();
  const [resume, setResume] = useState(initialResumeMarkdown);
  const [cover, setCover] = useState(initialCoverLetterMarkdown);
  const [pending, startTransition] = useTransition();

  const resumeDirty = resume !== initialResumeMarkdown;
  const coverDirty = cover !== initialCoverLetterMarkdown;
  const anyDirty = resumeDirty || coverDirty;
  const canSubmit = resume.trim().length >= 40 && anyDirty && !pending;

  function submit() {
    if (!canSubmit) return;
    const resumeSnapshot = resume;
    const coverSnapshot = cover;
    startTransition(async () => {
      const r = await saveManualEditAction(
        applicationId,
        resumeSnapshot,
        coverSnapshot,
      );
      if (!r.ok) {
        toast.error(`Save failed: ${r.error}`);
        return;
      }
      toast.success(
        `Saved as v${r.versionNumber}.0 — Screening tab will re-evaluate.`,
      );
      router.push(`/applications/${applicationId}/screening`);
      router.refresh();
    });
  }

  function reset() {
    setResume(initialResumeMarkdown);
    setCover(initialCoverLetterMarkdown);
  }

  return (
    <div className="space-y-4">
      {!hasExistingDrafts && (
        <p className="rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
          No auto-generated drafts on this application yet. You can still
          paste a manually-written resume below and run it through the
          screening checks — Resume Talos will treat it as v1.0.
        </p>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="resume-md" className="text-sm font-medium">
            Resume (markdown)
          </label>
          <span className="text-xs tabular-nums text-muted-foreground">
            {resume.trim().length.toLocaleString()} chars
            {resumeDirty && " · modified"}
          </span>
        </div>
        <textarea
          id="resume-md"
          value={resume}
          onChange={(e) => setResume(e.target.value)}
          rows={20}
          spellCheck={false}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
          placeholder={`# Your Name\nCity, ST · you@example.com · 555-555-0100 · yoursite.com\n\n## Summary\n...\n\n## Experience\n\n### Title · Company · 2023 – Present\n- ...`}
          disabled={pending}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="cover-md" className="text-sm font-medium">
            Cover letter (markdown) <span className="text-muted-foreground">— optional</span>
          </label>
          <span className="text-xs tabular-nums text-muted-foreground">
            {cover.trim().length.toLocaleString()} chars
            {coverDirty && " · modified"}
          </span>
        </div>
        <textarea
          id="cover-md"
          value={cover}
          onChange={(e) => setCover(e.target.value)}
          rows={12}
          spellCheck={false}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
          placeholder="(Leave blank if you only edited the resume.)"
          disabled={pending}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={submit} disabled={!canSubmit} size="sm" className="gap-1.5">
          {pending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <FilePenLine className="size-3.5" /> Save &amp; re-evaluate
              <ArrowRight className="size-3.5" />
            </>
          )}
        </Button>
        {anyDirty && !pending && (
          <Button
            onClick={reset}
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={pending}
          >
            <RotateCcw className="size-3.5" /> Revert to {currentVersionLabel ?? "original"}
          </Button>
        )}
        {!anyDirty && currentVersionLabel && (
          <span className="text-xs text-muted-foreground">
            Loaded from {currentVersionLabel}. Edit to enable save.
          </span>
        )}
      </div>
    </div>
  );
}
