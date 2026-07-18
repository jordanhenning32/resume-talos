import { Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { retrieveFacts } from "@/lib/agents/retriever";

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

/**
 * Shown at the top of the KB page when an applicant flowed in here via the
 * "Add facts" chip on the application detail page's coverage report. We
 * embed the skill, surface the top facts already in the KB, and let the user
 * decide whether to add more or rephrase what they have.
 */
export async function FocusedFactsCard({ focus }: { focus: string }) {
  const { facts } = await retrieveFacts({ query: focus, topK: 8 });
  const strong = facts.filter((f) => f.similarity >= 0.45);
  const hasStrong = strong.length > 0;

  return (
    <Card className="border-blue-500/30 bg-blue-500/5">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Search className="size-4" /> Adding facts about:
          <span className="rounded-md bg-blue-500/15 px-2 py-0.5 font-mono text-sm">
            {focus}
          </span>
        </CardTitle>
        <CardDescription>
          {hasStrong
            ? `${strong.length} fact${strong.length === 1 ? "" : "s"} in your KB already touch${strong.length === 1 ? "es" : ""} this. Skim them before adding more so you don't duplicate.`
            : "Nothing strongly relevant in your KB yet. Upload a document below, or add a manual fact via a document detail page."}
        </CardDescription>
      </CardHeader>
      {hasStrong && (
        <CardContent>
          <ul className="space-y-2">
            {strong.slice(0, 6).map((f) => (
              <li key={f.id} className="rounded-md border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline" className={FACT_TYPE_COLORS[f.factType] ?? ""}>
                    {f.factType}
                  </Badge>
                  {(f.metadata?.company as string | undefined) && (
                    <span className="text-muted-foreground">
                      {f.metadata?.company as string}
                      {(f.metadata?.role as string | undefined)
                        ? ` · ${f.metadata?.role as string}`
                        : ""}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-muted-foreground">
                    similarity {f.similarity.toFixed(2)}
                  </span>
                </div>
                <p className="mt-1.5 text-sm">{f.content}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
      <CardContent className={hasStrong ? "pt-0" : ""}>
        <p className="text-xs text-muted-foreground">
          <Plus className="mr-1 inline size-3" /> To add more, upload a document or URL in the form below — anything you ingest is auto-chunked, embedded, and mined for facts about <span className="font-medium">{focus}</span> and the rest of your background.
        </p>
      </CardContent>
    </Card>
  );
}
