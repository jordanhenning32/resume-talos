import { Badge } from "@/components/ui/badge";
import { listFactsForDocument } from "@/lib/kb/queries";
import { AttributeFactForm } from "./AttributeFactForm";
import { PinFactToggle } from "./PinFactToggle";

const FACT_TYPE_COLORS: Record<string, string> = {
  achievement: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  skill: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  role: "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30",
  education: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  certification: "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30",
  project: "bg-pink-500/10 text-pink-700 dark:text-pink-300 border-pink-500/30",
  story: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30",
  metric: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
  tool: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
  responsibility: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30",
  context: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/30",
};

export async function FactList({
  documentId,
  needsAttribution,
}: {
  documentId: string;
  needsAttribution?: boolean;
}) {
  const facts = await listFactsForDocument(documentId);
  const displayFacts = needsAttribution
    ? facts.filter((f) => !hasCompany(f.metadata))
    : facts;
  if (facts.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
        No facts extracted from this document.
      </div>
    );
  }
  if (displayFacts.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
        No facts need attribution in this document.
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {displayFacts.map((f) => (
        <li key={f.id} className="rounded-md border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={FACT_TYPE_COLORS[f.factType] ?? ""}
            >
              {f.factType}
            </Badge>
            {f.metadata?.company && (
              <span className="text-xs text-muted-foreground">
                {f.metadata.company}
                {f.metadata.role ? ` · ${f.metadata.role}` : ""}
              </span>
            )}
            {(f.metadata?.startDate || f.metadata?.endDate) && (
              <span className="text-xs text-muted-foreground">
                {f.metadata.startDate ?? "?"}
                {" – "}
                {f.metadata.endDate ?? "?"}
              </span>
            )}
            <PinFactToggle factId={f.id} pinned={String(f.pinned ?? "false")} />
          </div>
          <p className="mt-2 text-sm">{f.content}</p>
          {f.evidenceQuote && (
            <blockquote className="mt-2 border-l-2 border-muted-foreground/30 pl-3 text-xs italic text-muted-foreground">
              &ldquo;{f.evidenceQuote}&rdquo;
            </blockquote>
          )}
          {!hasCompany(f.metadata) && <AttributeFactForm factId={f.id} />}
          {f.metadata?.tags && f.metadata.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {f.metadata.tags.map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px]">
                  {t}
                </Badge>
              ))}
            </div>
          )}
          {f.metadata?.metrics && f.metadata.metrics.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {f.metadata.metrics.map((m, i) => (
                <span
                  key={i}
                  className="rounded-md border bg-muted/40 px-2 py-0.5 text-[11px] font-mono"
                >
                  <span className="text-muted-foreground">{m.label}:</span>{" "}
                  {m.value}
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function hasCompany(metadata: { company?: unknown } | null | undefined): boolean {
  return typeof metadata?.company === "string" && metadata.company.trim().length > 0;
}
