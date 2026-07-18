"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Plus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { addQuickFactsAction } from "@/app/applications/[id]/actions";

type Result =
  | null
  | {
      kind: "ok";
      status: "ingested" | "duplicate_document";
      factCount: number;
      chunkCount: number;
      duplicateFactCount: number;
      costUsd: number;
      skippedFacts?: SkippedFact[];
    }
  | { kind: "err"; message: string };

type SkippedFact = {
  content: string;
  factType: string;
  reason: "duplicate_existing" | "duplicate_in_batch";
  similarTo?: { id?: string; content: string; similarity: number };
};

const MIN_LENGTH = 20;
const MAX_LENGTH = 20_000;

export function TextIngestForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [employer, setEmployer] = useState("");
  const [role, setRole] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [result, setResult] = useState<Result>(null);
  const [pending, startTransition] = useTransition();

  const trimmedLen = text.trim().length;
  const minOK = trimmedLen >= MIN_LENGTH;

  function sectionContext(charEnd: number) {
    const company = employer.trim();
    if (!company) return undefined;
    return {
      company,
      role: role.trim() || undefined,
      startDate: startDate.trim() || undefined,
      endDate: endDate.trim() || undefined,
      charStart: 0,
      charEnd,
    };
  }

  function submit(mode: "default" | "force_overwrite" | "merge" = "default", overrideText?: string) {
    if (!minOK || pending) return;
    const snapshot = overrideText ?? text;
    setResult(null);
    startTransition(async () => {
      const r = await addQuickFactsAction({
        text: snapshot,
        mode,
        sectionContext: sectionContext(snapshot.length),
      });
      if (!r.ok) {
        setResult({ kind: "err", message: r.error });
        toast.error(`Add failed: ${r.error}`);
        return;
      }
      setResult({
        kind: "ok",
        status: r.status,
        factCount: r.factCount,
        chunkCount: r.chunkCount,
        duplicateFactCount: r.duplicateFactCount,
        costUsd: r.costUsd,
        skippedFacts: r.skippedFacts,
      });
      if (!r.skippedFacts || r.skippedFacts.length === 0) setText("");
      router.refresh();
      const cost = r.costUsd > 0 ? ` · $${r.costUsd.toFixed(4)}` : "";
      if (r.status === "duplicate_document") {
        toast.message(`Identical text was already ingested.${cost}`);
      } else if (r.factCount === 0) {
        toast.message(
          r.duplicateFactCount > 0
            ? `${r.duplicateFactCount} duplicate fact${r.duplicateFactCount === 1 ? "" : "s"} skipped — nothing new added${cost}.`
            : `No facts extracted from that text${cost}.`,
        );
      } else {
        toast.success(
          `Added ${r.factCount} new fact${r.factCount === 1 ? "" : "s"}${
            r.duplicateFactCount > 0
              ? ` (${r.duplicateFactCount} skipped as duplicates)`
              : ""
          }${cost}.`,
        );
      }
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor="text-ingest-input"
          className="block text-sm font-medium"
        >
          Paste or type facts about yourself
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          Free-form prose works fine — a paragraph about a role, a project, an
          expertise area. The text is chunked, embedded, and run through fact
          extraction. Duplicates against existing KB facts are skipped
          automatically.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <input
          value={employer}
          onChange={(e) => setEmployer(e.target.value)}
          placeholder="Employer"
          className="h-8 rounded-md border border-input bg-background px-2.5 text-sm"
          disabled={pending}
        />
        <input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="Role"
          className="h-8 rounded-md border border-input bg-background px-2.5 text-sm"
          disabled={pending}
        />
        <input
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          placeholder="Start"
          className="h-8 rounded-md border border-input bg-background px-2.5 text-sm"
          disabled={pending}
        />
        <input
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          placeholder="End"
          className="h-8 rounded-md border border-input bg-background px-2.5 text-sm"
          disabled={pending}
        />
      </div>
      <textarea
        id="text-ingest-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`e.g. As an SSA Branch Chief I owned the full SDLC artifact suite across the $200M+ Agile IT portfolio — business cases, project charters, requirements traceability matrices, user stories with INVEST acceptance criteria, sprint review artifacts, OKRs cascaded from agency strategy, release notes, RCA reports, and end-of-life sunset plans. Reviewed ~40 artifact packages per quarter with a 99% PMO acceptance rate.`}
        rows={8}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
        disabled={pending}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => submit()} disabled={!minOK || pending} size="sm" className="gap-1.5">
          {pending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Extracting facts…
            </>
          ) : (
            <>
              <Plus className="size-3.5" /> Add to knowledge base
            </>
          )}
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">
          {trimmedLen.toLocaleString()} / {MAX_LENGTH.toLocaleString()} chars
          {!minOK && trimmedLen > 0 && ` · need ${MIN_LENGTH}+`}
        </span>
      </div>
      {result && <ResultBanner result={result} onRetry={(content, mode) => submit(mode, content)} />}
    </div>
  );
}

function ResultBanner({
  result,
  onRetry,
}: {
  result: NonNullable<Result>;
  onRetry: (content: string, mode: "force_overwrite" | "merge") => void;
}) {
  if (result.kind === "err") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        <XCircle className="size-4 shrink-0 mt-0.5" />
        <span>{result.message}</span>
      </div>
    );
  }
  if (result.kind === "ok" && result.skippedFacts && result.skippedFacts.length > 0) {
    return <SkippedFactsBanner skippedFacts={result.skippedFacts} onRetry={onRetry} />;
  }
  if (result.status === "duplicate_document") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-sm text-blue-700 dark:text-blue-300">
        <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
        <span>Identical text was already in the KB — nothing new added.</span>
      </div>
    );
  }
  const cost = result.costUsd > 0 ? ` · $${result.costUsd.toFixed(4)}` : "";
  if (result.factCount === 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
        <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
        <span>
          {result.duplicateFactCount > 0
            ? `All ${result.duplicateFactCount} extracted fact${result.duplicateFactCount === 1 ? "" : "s"} were duplicates of existing KB facts${cost}.`
            : `No facts extracted from that text${cost}.`}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2 text-sm text-green-700 dark:text-green-400">
      <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
      <span>
        Added {result.factCount} new fact{result.factCount === 1 ? "" : "s"} from {result.chunkCount} chunk{result.chunkCount === 1 ? "" : "s"}
        {result.duplicateFactCount > 0
          ? ` · ${result.duplicateFactCount} duplicate${result.duplicateFactCount === 1 ? "" : "s"} skipped`
          : ""}
        {cost}.
      </span>
    </div>
  );
}

function SkippedFactsBanner({
  skippedFacts,
  onRetry,
}: {
  skippedFacts: SkippedFact[];
  onRetry: (content: string, mode: "force_overwrite" | "merge") => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
      <div className="font-medium text-amber-800 dark:text-amber-200">
        {skippedFacts.length} duplicate fact{skippedFacts.length === 1 ? "" : "s"} skipped
      </div>
      {skippedFacts.map((f, i) => (
        <div key={i} className="flex flex-col gap-2 border-t border-amber-500/20 pt-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">{f.factType}</div>
            <div>{f.content}</div>
            {f.similarTo && <div>Similar to {f.similarTo.id ?? "batch fact"} ({f.similarTo.similarity.toFixed(2)})</div>}
          </div>
          <div className="flex shrink-0 gap-1">
            <Button type="button" size="xs" variant="ghost">
              Keep
            </Button>
            <Button type="button" size="xs" variant="outline" onClick={() => onRetry(f.content, "force_overwrite")}>
              Use new
            </Button>
            <Button type="button" size="xs" onClick={() => onRetry(f.content, "merge")}>
              Merge
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
