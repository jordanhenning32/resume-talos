import { format } from "date-fns";
import { desc, eq } from "drizzle-orm";
import { Briefcase, Building2, MapPin, Sparkles } from "lucide-react";
import { db } from "@/db";
import { applicationVersions } from "@/db/schema";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FitApprovalCard } from "@/components/applications/FitApprovalCard";
import { KbCoverageCard } from "@/components/applications/KbCoverageCard";
import { KnockoutCard } from "@/components/applications/KnockoutCard";
import { AtsVendorCard } from "@/components/applications/AtsVendorCard";
import { CitedFactsWarning } from "@/components/applications/CitedFactsWarning";
import {
  PipelineProgress,
  pipelineStepForApplication,
} from "@/components/applications/PipelineProgress";
import { cn } from "@/lib/utils";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";
import type { FitScore } from "@/lib/agents/fit-scorer";
import { isVersionBoundReportFresh } from "@/lib/applications/versioning";
import { loadApp, parseFitScore, showCoverageFor } from "./_lib";

export const dynamic = "force-dynamic";

export default async function ApplicationOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const app = await loadApp(id);
  // Layout already calls notFound() if missing; this just guards types.
  if (!app) return null;

  const [latestVersion] = await db()
    .select({ id: applicationVersions.id, citedFactIds: applicationVersions.citedFactIds })
    .from(applicationVersions)
    .where(eq(applicationVersions.applicationId, app.id))
    .orderBy(desc(applicationVersions.versionNumber), desc(applicationVersions.iteration))
    .limit(1);
  const citedCount = Array.isArray(latestVersion?.citedFactIds)
    ? (latestVersion.citedFactIds as string[]).length
    : 0;

  const analysis = (app.jdAnalysis as JdAnalysis | null) ?? null;
  const fit = parseFitScore(app);
  const pipelineStep = pipelineStepForApplication(app);
  const showCoverage = showCoverageFor(app, analysis);

  const kbGapReport = showCoverage
    ? ((app.kbGapReport as unknown as import("@/db/schema").KbGapReportShape | null) ?? null)
    : null;
  const kbGapReportAt = showCoverage ? (app.kbGapReportAt ?? null) : null;

  const rawKnockoutReport = showCoverage
    ? ((app.knockoutReport as unknown as import("@/db/schema").KnockoutReportShape | null) ?? null)
    : null;
  const knockoutReport =
    rawKnockoutReport &&
    isVersionBoundReportFresh(rawKnockoutReport, latestVersion?.id ?? null)
      ? rawKnockoutReport
      : null;
  const knockoutReportAt = knockoutReport ? (app.knockoutReportAt ?? null) : null;

  return (
    <div className="space-y-6">
      <PipelineProgress currentStep={pipelineStep} />
      <CitedFactsWarning
        versionId={latestVersion?.id ?? ""}
        citedFactIdsCount={citedCount}
      />

      {fit ? (
        <>
          <FitScoreCard fit={fit} />
          {analysis && <AnalysisCard analysis={analysis} />}
          <AtsVendorCard applicationId={app.id} jdUrl={app.jdUrl ?? null} />
          {showCoverage && (
            <KbCoverageCard
              applicationId={app.id}
              report={kbGapReport}
              computedAt={kbGapReportAt}
            />
          )}
          {showCoverage && (
            <KnockoutCard
              applicationId={app.id}
              report={knockoutReport}
              computedAt={knockoutReportAt}
            />
          )}
          <StrengthsGapsCard fit={fit} />
          <ReasoningCard fit={fit} />
          {app.status !== "withdrawn" && (
            <FitApprovalCard
              applicationId={app.id}
              overallScore={fit.overall}
              alreadyApproved={app.fitApproved === "true"}
              recommendation={fit.recommendation ?? "unknown"}
            />
          )}
        </>
      ) : (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader>
            <CardTitle>Analysis incomplete</CardTitle>
            <CardDescription>
              Fit score data is missing from this application. Try cancelling
              and creating a fresh one.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Raw job description</CardTitle>
          <CardDescription>
            What the analyzer read (after URL extraction if applicable).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-72 rounded-md border bg-muted/30 p-4">
            <pre className="whitespace-pre-wrap text-xs font-mono">
              {app.jdText}
            </pre>
          </ScrollArea>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Created {format(app.createdAt, "PPpp")} · Updated{" "}
        {format(app.updatedAt, "PPpp")}
      </p>
    </div>
  );
}

function FitScoreCard({ fit }: { fit: FitScore }) {
  const colorClass =
    fit.overall >= 85
      ? "text-green-600 dark:text-green-400"
      : fit.overall >= 70
        ? "text-blue-600 dark:text-blue-400"
        : fit.overall >= 55
          ? "text-amber-600 dark:text-amber-400"
          : "text-destructive";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Sparkles className="size-5 text-muted-foreground" /> Fit score
          </span>
          <span className={cn("text-5xl font-semibold tabular-nums", colorClass)}>
            {fit.overall}
            <span className="text-xl text-muted-foreground">/100</span>
          </span>
        </CardTitle>
        <CardDescription>
          <RecommendationBadge recommendation={fit.recommendation} />
        </CardDescription>
      </CardHeader>
      {fit.dimensions.length > 0 && (
        <CardContent>
          <div className="space-y-3">
            {fit.dimensions.map((d) => (
              <div key={d.name}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{d.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {d.score}/100
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      d.score >= 85
                        ? "bg-green-500"
                        : d.score >= 70
                          ? "bg-blue-500"
                          : d.score >= 55
                            ? "bg-amber-500"
                            : "bg-destructive",
                    )}
                    style={{ width: `${d.score}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{d.reasoning}</p>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function AnalysisCard({ analysis }: { analysis: JdAnalysis }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">JD analysis</CardTitle>
        <CardDescription>{analysis.oneSentenceSummary}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <Meta
            icon={Briefcase}
            label="Seniority"
            value={analysis.seniorityLevel.replace(/_/g, " ")}
          />
          <Meta
            icon={Building2}
            label="Function"
            value={analysis.teamFunction ?? "—"}
          />
          <Meta
            icon={MapPin}
            label="Location"
            value={
              analysis.locationMode === "unspecified"
                ? "—"
                : `${analysis.locationMode}${analysis.primaryLocation ? ` · ${analysis.primaryLocation}` : ""}`
            }
          />
        </div>
        <Tabs defaultValue="must-have">
          <TabsList>
            <TabsTrigger value="must-have">
              Must-have ({analysis.mustHaveSkills.length})
            </TabsTrigger>
            <TabsTrigger value="nice-to-have">
              Nice-to-have ({analysis.niceToHaveSkills.length})
            </TabsTrigger>
            <TabsTrigger value="signals">
              Success signals ({analysis.successSignals.length})
            </TabsTrigger>
            <TabsTrigger value="language">
              Key language ({analysis.keyLanguagePatterns.length})
            </TabsTrigger>
            <TabsTrigger value="responsibilities">
              Responsibilities ({analysis.responsibilities.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="must-have" className="mt-3">
            <BadgeList items={analysis.mustHaveSkills} />
          </TabsContent>
          <TabsContent value="nice-to-have" className="mt-3">
            <BadgeList items={analysis.niceToHaveSkills} muted />
          </TabsContent>
          <TabsContent value="signals" className="mt-3">
            <BulletList items={analysis.successSignals} />
          </TabsContent>
          <TabsContent value="language" className="mt-3">
            <BadgeList items={analysis.keyLanguagePatterns} muted />
          </TabsContent>
          <TabsContent value="responsibilities" className="mt-3">
            <BulletList items={analysis.responsibilities} />
          </TabsContent>
        </Tabs>

        {analysis.redFlags.length > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              Red flags noted
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              {analysis.redFlags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StrengthsGapsCard({ fit }: { fit: FitScore }) {
  if (fit.topStrengths.length === 0 && fit.topGaps.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base text-green-700 dark:text-green-400">
            Top strengths
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {fit.topStrengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base text-amber-700 dark:text-amber-400">
            Top gaps
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {fit.topGaps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function ReasoningCard({ fit }: { fit: FitScore }) {
  if (!fit.reasoning) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reasoning</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed">{fit.reasoning}</p>
      </CardContent>
    </Card>
  );
}

function Meta({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="mt-0.5 text-sm font-medium capitalize">{value}</div>
    </div>
  );
}

function BadgeList({ items, muted }: { items: string[]; muted?: boolean }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">(none)</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <Badge key={s} variant={muted ? "outline" : "secondary"} className="text-xs">
          {s}
        </Badge>
      ))}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">(none)</p>;
  }
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ul>
  );
}

function RecommendationBadge({
  recommendation,
}: {
  recommendation: FitScore["recommendation"];
}) {
  const map = {
    strong_proceed: {
      label: "Strong fit",
      cls: "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30",
    },
    proceed: {
      label: "Solid fit",
      cls: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
    },
    borderline: {
      label: "Borderline",
      cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    },
    pass: {
      label: "Material misalignment",
      cls: "bg-destructive/10 text-destructive border-destructive/30",
    },
  } as const;
  const c = map[recommendation as keyof typeof map] ?? map.borderline;
  return (
    <Badge variant="outline" className={cn(c.cls)}>
      {c.label}
    </Badge>
  );
}
