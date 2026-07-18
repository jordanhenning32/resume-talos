"use client";

import { useState, useTransition } from "react";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  Search,
  Users,
  Target,
  Megaphone,
  Newspaper,
  Package,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  approveMarketResearchAction,
  runMarketResearchAction,
} from "@/app/applications/[id]/actions";
import type { MarketResearch } from "@/db/schema";

type Findings = NonNullable<MarketResearch["findings"]>;
type ToneProfile = NonNullable<MarketResearch["toneProfile"]>;
type Sources = NonNullable<MarketResearch["sources"]>;

export function MarketResearchGate({
  applicationId,
  companyName,
  research,
  isApproved,
}: {
  applicationId: string;
  companyName: string;
  research: MarketResearch | null;
  isApproved: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [edits, setEdits] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  function runResearch() {
    startTransition(async () => {
      const r = await runMarketResearchAction(applicationId);
      if (r.ok) {
        toast.success(
          r.cacheHit
            ? `Cache hit — reused recent research on ${companyName}.`
            : `Research complete · $${r.costUsd.toFixed(3)} spent.`,
        );
      } else {
        toast.error(`Research failed: ${r.error}`);
      }
    });
  }

  function approve() {
    startTransition(async () => {
      const r = await approveMarketResearchAction(
        applicationId,
        edits.trim() || undefined,
      );
      if (r.ok) {
        toast.success("Approved. Next step: writer drafts.");
      } else {
        toast.error(r.error);
      }
    });
  }

  if (isApproved && research) {
    return (
      <Card className="border-green-500/30 bg-green-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-300">
            <Check className="size-5" /> Market research approved
          </CardTitle>
          <CardDescription>
            {research.findings ? extractOverview(research.findings) : "Research complete."}{" "}
            The writer agents will use this when drafting.
          </CardDescription>
        </CardHeader>
        {research.userEdits && (
          <CardContent>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Your notes
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{research.userEdits}</p>
          </CardContent>
        )}
      </Card>
    );
  }

  // No research yet — kickoff card.
  if (!research) {
    return (
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="size-5" /> Run market research on {companyName}
          </CardTitle>
          <CardDescription>
            Gemini 2.5 Pro with Google grounding pulls mission, values, culture,
            recent news, leadership, and products. Then a second pass extracts a
            structured tone profile the cover letter writer will use. Cached for
            30 days per company so applying to multiple roles at the same employer
            costs $0 after the first run.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={runResearch}
            disabled={pending}
            className="gap-1.5"
            size="default"
          >
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Researching {companyName}…
              </>
            ) : (
              <>
                <Globe className="size-4" /> Research {companyName}
              </>
            )}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Typical run: 30-60 seconds. Cost: ~$0.05-0.20 depending on company complexity.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Research run but not approved yet — show findings + approval form.
  const findings = research.findings as Findings | null;
  const tone = research.toneProfile as ToneProfile | null;
  const sources = (research.sources as Sources | null) ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <Search className="size-4 text-muted-foreground" /> Research findings: {companyName}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={runResearch}
              disabled={pending}
              className="gap-1.5"
            >
              <RefreshCw className="size-3.5" /> Re-run
            </Button>
          </CardTitle>
          {findings?.overview && (
            <CardDescription className="text-foreground">
              {findings.overview}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-5 text-sm">
          {findings?.mission && (
            <Section icon={Target} title="Mission">
              <p>{findings.mission}</p>
            </Section>
          )}
          {findings?.values && findings.values.length > 0 && (
            <Section icon={Megaphone} title="Values">
              <ul className="list-disc space-y-1 pl-5">
                {findings.values.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </Section>
          )}
          {findings?.culture && (
            <Section icon={Users} title="Culture">
              <p>{findings.culture}</p>
            </Section>
          )}
          {findings?.recentNews && findings.recentNews.length > 0 && (
            <Section icon={Newspaper} title="Recent news">
              <ul className="space-y-2">
                {findings.recentNews.map((n, i) => (
                  <li key={i} className="rounded-md border bg-card px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium">{n.title}</span>
                      {n.date && (
                        <span className="text-xs text-muted-foreground">{n.date}</span>
                      )}
                    </div>
                    {n.summary && (
                      <p className="mt-1 text-xs text-muted-foreground">{n.summary}</p>
                    )}
                    {n.url && (
                      <a
                        href={n.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                      >
                        source <ExternalLink className="size-3" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {findings?.productsServices && findings.productsServices.length > 0 && (
            <Section icon={Package} title="Products / services">
              <div className="flex flex-wrap gap-1.5">
                {findings.productsServices.map((p) => (
                  <Badge key={p} variant="secondary" className="text-xs">
                    {p}
                  </Badge>
                ))}
              </div>
            </Section>
          )}
          {findings?.leadership && findings.leadership.length > 0 && (
            <Section icon={Users} title="Notable leadership">
              <ul className="list-disc space-y-1 pl-5">
                {findings.leadership.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </Section>
          )}
        </CardContent>
      </Card>

      {tone && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tone profile for cover letter</CardTitle>
            <CardDescription>
              Steers how the cover letter writer modulates voice for this company.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ToneSlider
              label="Formality"
              value={tone.formality}
              leftLabel="casual"
              rightLabel="formal"
            />
            <ToneSlider
              label="Technical density"
              value={tone.technicalDensity}
              leftLabel="plain language"
              rightLabel="technical"
            />
            <div className="flex flex-wrap gap-3 text-xs">
              <ToneBadge label="Mission emphasis" value={tone.missionEmphasis} />
              <ToneBadge label="Energy level" value={tone.energyLevel} />
            </div>
            {tone.notes && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <span className="font-semibold text-foreground">Writer notes: </span>
                {tone.notes}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {sources.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Sources ({sources.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs">
              {sources.map((s, i) => (
                <li key={i}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {s.title || s.url}
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {research.rawMarkdown && (
        <Card>
          <CardHeader>
            <button
              onClick={() => setShowRaw(!showRaw)}
              className="flex w-full items-center justify-between text-left text-sm"
            >
              <span className="font-semibold">Raw research brief</span>
              <ChevronDown
                className={cn("size-4 transition-transform", showRaw && "rotate-180")}
              />
            </button>
          </CardHeader>
          {showRaw && (
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs">{research.rawMarkdown}</pre>
            </CardContent>
          )}
        </Card>
      )}

      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle>Approve and continue</CardTitle>
          <CardDescription>
            Approving locks the tone profile and findings as inputs to the cover
            letter writer. Add notes below if you want to nudge the writer (e.g.
            &quot;lean harder into mission&quot;, &quot;match the energy of their careers page&quot;).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={edits}
            onChange={(e) => setEdits(e.target.value)}
            placeholder="Optional notes for the writer agent…"
            rows={3}
            disabled={pending}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={approve} disabled={pending} className="gap-1.5">
              <Check className="size-4" /> Approve and continue
            </Button>
            <Button
              variant="outline"
              onClick={runResearch}
              disabled={pending}
              className="gap-1.5"
            >
              <RefreshCw className="size-3.5" /> Re-run instead
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" /> {title}
      </h3>
      <div>{children}</div>
    </div>
  );
}

function ToneSlider({
  label,
  value,
  leftLabel,
  rightLabel,
}: {
  label: string;
  value: number;
  leftLabel: string;
  rightLabel: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] uppercase text-muted-foreground">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}

function ToneBadge({ label, value }: { label: string; value: string }) {
  const color =
    value === "high"
      ? "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30"
      : value === "medium"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
        : "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/30";
  return (
    <Badge variant="outline" className={color}>
      {label}: {value}
    </Badge>
  );
}

function extractOverview(findings: Findings): string {
  return (findings.overview as string | undefined) ?? "";
}
