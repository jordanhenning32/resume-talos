import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { setupStatus, isFullyConfigured } from "@/lib/setup-status";
import { getWriterDirectives, type WriterDirectives } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const checks = setupStatus();
  const directives: WriterDirectives | null = isFullyConfigured()
    ? await getWriterDirectives()
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Model assignments, output folder, and environment status.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Environment</CardTitle>
          <CardDescription>
            Configured via{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              .env.local
            </code>
            . Restart the dev server after changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {checks.map((c) => (
              <li
                key={c.key}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div>
                  <div className="font-mono text-xs">{c.key}</div>
                  <div className="text-xs text-muted-foreground">{c.label}</div>
                </div>
                <Badge variant={c.ok ? "default" : "destructive"}>
                  {c.ok ? "configured" : "missing"}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {directives && (
        <Card>
          <CardHeader>
            <CardTitle>Writer directives</CardTitle>
            <CardDescription>
              Policies that the resume and cover-letter writers will follow.
              These are baked into the writer system prompts at draft time.
              Edit UI coming with the writer pipeline (step 3+).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {directives.personalSite && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Personal site funnel
                </h3>
                <div className="mt-1 rounded-md border bg-muted/30 p-3">
                  <div className="font-mono text-xs">
                    {directives.personalSite.label}
                  </div>
                  <p className="mt-2">
                    <span className="font-medium">Resume placement:</span>{" "}
                    {directives.personalSite.placement.resume}
                  </p>
                  <p className="mt-2">
                    <span className="font-medium">Cover letter placement:</span>{" "}
                    {directives.personalSite.placement.coverLetter}
                  </p>
                </div>
              </section>
            )}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Voice
              </h3>
              <ul className="mt-1 space-y-1">
                <li>
                  <span className="font-medium">Tense:</span>{" "}
                  {directives.voice.tense}
                </li>
                <li>
                  <span className="font-medium">Pronoun:</span>{" "}
                  {directives.voice.pronoun}
                </li>
                <li>
                  <span className="font-medium">Metrics bias:</span>{" "}
                  {directives.voice.metricsBias}
                </li>
              </ul>
            </section>
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Global rules
              </h3>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {directives.globalRules.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </section>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Models</CardTitle>
          <CardDescription>
            Per-role model assignments — override via env vars.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 text-sm sm:grid-cols-2">
            <ModelRow role="Writers + Orchestrator" envVar="MODEL_WRITER" />
            <ModelRow role="QC Reviewer A" envVar="MODEL_REVIEWER_A" />
            <ModelRow role="QC Reviewer B" envVar="MODEL_REVIEWER_B" />
            <ModelRow role="Market Research" envVar="MODEL_RESEARCH" />
            <ModelRow role="Verifier" envVar="MODEL_VERIFIER" />
            <ModelRow role="Fit Score + Retriever" envVar="MODEL_FIT_SCORE" />
            <ModelRow role="Screener Intelligence" envVar="MODEL_SCREENER" />
            <ModelRow role="Embeddings" envVar="EMBEDDING_MODEL" />
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function ModelRow({ role, envVar }: { role: string; envVar: string }) {
  const value = process.env[envVar];
  return (
    <li className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{role}</div>
      <div className="font-mono text-sm">{value ?? "(default)"}</div>
      <div className="mt-1 font-mono text-[10px] text-muted-foreground">
        {envVar}
      </div>
    </li>
  );
}
