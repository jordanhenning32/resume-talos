"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Globe, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { KindSelector } from "./UploadDropzone";

type DocKind = "facts" | "voice";

type SingleResult =
  | {
      mode: "single";
      url: string;
      status: "ingested";
      result: {
        chunkCount: number;
        factCount: number;
        duplicateFactCount: number;
        costUsd: number;
        skippedFacts?: SkippedFact[];
      };
    }
  | {
      mode: "single";
      url: string;
      status: "duplicate_document";
      existingName: string;
      existingDocumentId: string;
    }
  | { mode: "single"; url: string; status: "empty"; reason: string }
  | { mode: "single"; url: string; status: "error"; message: string };

type CrawlSummary = {
  mode: "crawl";
  seedUrl: string;
  totalUrlsDiscovered: number;
  totalIngested: number;
  totalDuplicates: number;
  totalErrors: number;
  totalFactsAdded: number;
  totalCostUsd: number;
  perUrl: Array<
    | { url: string; status: "ingested"; result: { factCount: number; duplicateFactCount: number; costUsd: number } }
    | { url: string; status: "duplicate_document"; existingName: string }
    | { url: string; status: "empty"; reason: string }
    | { url: string; status: "error"; message: string }
  >;
};

type ApiResult = SingleResult | CrawlSummary | { error: string };
type SkippedFact = {
  content: string;
  factType: string;
  reason: "duplicate_existing" | "duplicate_in_batch";
  similarTo?: { id?: string; content: string; similarity: number };
};

type FormState =
  | { status: "idle" }
  | { status: "fetching"; url: string; crawl: boolean }
  | { status: "done"; result: SingleResult | CrawlSummary }
  | { status: "error"; message: string };

export function UrlIngestForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [crawl, setCrawl] = useState(false);
  const [kind, setKind] = useState<DocKind>("facts");
  const [employer, setEmployer] = useState("");
  const [role, setRole] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [state, setState] = useState<FormState>({ status: "idle" });

  function sectionContext() {
    const company = employer.trim();
    if (!company) return undefined;
    return {
      company,
      role: role.trim() || undefined,
      startDate: startDate.trim() || undefined,
      endDate: endDate.trim() || undefined,
    };
  }

  async function submit(mode: "default" | "force_overwrite" | "merge" = "default") {
    if (!url) {
      toast.error("Enter a URL first.");
      return;
    }
    setState({ status: "fetching", url, crawl });
    try {
      const res = await fetch("/api/kb/ingest-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, crawl, kind, mode, sectionContext: sectionContext() }),
      });
      const json = (await res.json()) as ApiResult;
      if (!res.ok || "error" in json) {
        const message = "error" in json ? json.error : `HTTP ${res.status}`;
        setState({ status: "error", message });
        toast.error(`Ingest failed: ${message}`);
        return;
      }
      setState({ status: "done", result: json });
      if (json.mode === "single") {
        if (json.status === "ingested") {
          toast.success(
            `${json.url}: ${json.result.factCount} facts ($${json.result.costUsd.toFixed(3)})`,
          );
        } else if (json.status === "duplicate_document") {
          toast.info(`Already in KB as "${json.existingName}"`);
        } else if (json.status === "empty") {
          toast.warning(`Empty: ${json.reason}`);
        } else {
          toast.error(json.message);
        }
      } else {
        toast.success(
          `Crawled ${json.totalUrlsDiscovered} pages — ${json.totalIngested} ingested, ${json.totalDuplicates} duplicates, ${json.totalFactsAdded} facts ($${json.totalCostUsd.toFixed(3)})`,
        );
      }
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ status: "error", message });
      toast.error(`Ingest failed: ${message}`);
    }
  }

  const busy = state.status === "fetching";

  return (
    <div className="space-y-4">
      <KindSelector value={kind} onChange={setKind} disabled={busy} />
      <div className="space-y-2">
        <Label htmlFor="url-input">URL</Label>
        <div className="flex gap-2">
          <Input
            id="url-input"
            type="url"
            placeholder="https://jordanhenning.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
          />
          <Button onClick={() => submit()} disabled={busy || !url}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {crawl ? "Crawling…" : "Fetching…"}
              </>
            ) : (
              <>
                <Globe className="size-4" />
                {crawl ? "Crawl site" : "Fetch page"}
              </>
            )}
          </Button>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Input placeholder="Employer" value={employer} onChange={(e) => setEmployer(e.target.value)} disabled={busy} />
        <Input placeholder="Role" value={role} onChange={(e) => setRole(e.target.value)} disabled={busy} />
        <Input placeholder="Start" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={busy} />
        <Input placeholder="End" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={busy} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={crawl}
          onChange={(e) => setCrawl(e.target.checked)}
          disabled={busy}
          className="size-4 rounded border-border accent-primary"
        />
        <span>
          Crawl the whole site (uses sitemap.xml, or harvests same-origin links from the seed page; capped at 30 pages)
        </span>
      </label>

      {state.status === "done" && state.result.mode === "single" && (
        <SingleResultBanner result={state.result} onRetry={submit} />
      )}
      {state.status === "done" && state.result.mode === "crawl" && (
        <CrawlResultBanner summary={state.result} />
      )}
      {state.status === "error" && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <XCircle className="mt-0.5 size-4 shrink-0" />
          {state.message}
        </div>
      )}
    </div>
  );
}

function SingleResultBanner({
  result,
  onRetry,
}: {
  result: SingleResult;
  onRetry: (mode: "default" | "force_overwrite" | "merge") => void;
}) {
  if (result.status === "ingested") {
    const r = result.result;
    return (
      <div className="space-y-2">
        <Banner ok>
          <span className="font-mono text-xs">{result.url}</span>
          <span>
            — {r.factCount} new facts from {r.chunkCount} chunks
            {r.duplicateFactCount > 0
              ? `, ${r.duplicateFactCount} duplicate${r.duplicateFactCount === 1 ? "" : "s"} skipped`
              : ""}{" "}
            · ${r.costUsd.toFixed(3)}
          </span>
        </Banner>
        {r.skippedFacts && r.skippedFacts.length > 0 && (
          <SkippedFactsBanner skippedFacts={r.skippedFacts} onRetry={onRetry} />
        )}
      </div>
    );
  }
  if (result.status === "duplicate_document") {
    return (
      <Banner variant="info">
        Already in your KB as &ldquo;{result.existingName}&rdquo;.
      </Banner>
    );
  }
  if (result.status === "empty") {
    return <Banner variant="warn">Empty page: {result.reason}</Banner>;
  }
  return <Banner ok={false}>Fetch failed: {result.message}</Banner>;
}

function CrawlResultBanner({ summary }: { summary: CrawlSummary }) {
  return (
    <div className="space-y-2">
      <Banner ok>
        <strong>Crawl complete.</strong>{" "}
        {summary.totalIngested} ingested · {summary.totalDuplicates} duplicates ·{" "}
        {summary.totalErrors} errors · {summary.totalFactsAdded} new facts · $
        {summary.totalCostUsd.toFixed(3)}
      </Banner>
      <details className="rounded-md border bg-card">
        <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
          Per-page detail ({summary.perUrl.length})
        </summary>
        <ul className="divide-y text-xs">
          {summary.perUrl.map((p, i) => (
            <li key={i} className="flex items-start gap-2 px-3 py-2">
              <StatusDot status={p.status} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono">{p.url}</div>
                <div className="text-muted-foreground">
                  {p.status === "ingested"
                    ? `${p.result.factCount} facts, ${p.result.duplicateFactCount} dupes skipped, $${p.result.costUsd.toFixed(3)}`
                    : p.status === "duplicate_document"
                      ? `duplicate of "${p.existingName}"`
                      : p.status === "empty"
                        ? p.reason
                        : p.message}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function SkippedFactsBanner({
  skippedFacts,
  onRetry,
}: {
  skippedFacts: SkippedFact[];
  onRetry: (mode: "default" | "force_overwrite" | "merge") => void;
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
            <Button type="button" size="xs" variant="outline" onClick={() => onRetry("force_overwrite")}>
              Use new
            </Button>
            <Button type="button" size="xs" onClick={() => onRetry("merge")}>
              Merge
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Banner({
  ok = true,
  variant,
  children,
}: {
  ok?: boolean;
  variant?: "info" | "warn";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-4 py-3 text-sm",
        variant === "info" &&
          "border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300",
        variant === "warn" &&
          "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
        !variant &&
          (ok
            ? "border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-300"
            : "border-destructive/30 bg-destructive/5 text-destructive"),
      )}
    >
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0" />
      )}
      <div className="flex-1">{children}</div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "ingested"
      ? "bg-green-500"
      : status === "duplicate_document"
        ? "bg-blue-500"
        : status === "empty"
          ? "bg-amber-500"
          : "bg-red-500";
  return <span className={cn("mt-1 size-2 shrink-0 rounded-full", color)} />;
}
