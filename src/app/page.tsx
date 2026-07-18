import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  Database,
  FileText,
  Sparkles,
  XCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setupStatus, isFullyConfigured } from "@/lib/setup-status";
import { getDashboardStats } from "@/lib/dashboard-stats";

export const dynamic = "force-dynamic";

export default async function Home() {
  const checks = setupStatus();
  const allOk = checks.every((c) => c.ok);
  const stats = isFullyConfigured()
    ? await getDashboardStats()
    : { applications: 0, inProgress: 0, facts: 0, monthCostUsd: 0 };

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-amber-600 dark:text-amber-400" />
          <h1 className="text-3xl font-semibold tracking-tight">Welcome to Resume Talos</h1>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          A multi-agent factory that drafts, reviews, and grounds resumes and
          cover letters in your actual experience — gated by quality thresholds
          and AI screener intelligence.
        </p>
      </header>

      {!allOk && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <XCircle className="size-5" /> Setup incomplete
            </CardTitle>
            <CardDescription>
              Resume Talos needs API keys and a database connection before it can run.
              Copy{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                .env.local.example
              </code>{" "}
              to{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                .env.local
              </code>{" "}
              and fill in the values.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {checks.map((c) => (
                <li key={c.key} className="flex items-center gap-2">
                  {c.ok ? (
                    <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
                  ) : (
                    <XCircle className="size-4 text-amber-600 dark:text-amber-400" />
                  )}
                  <span className="font-mono text-xs">{c.key}</span>
                  <span className="text-muted-foreground">— {c.label}</span>
                  {c.hint && !c.ok && (
                    <a
                      href={c.hint}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary underline-offset-2 hover:underline"
                    >
                      get one
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Applications" value={String(stats.applications)} icon={Briefcase} />
        <MetricCard label="In-progress" value={String(stats.inProgress)} icon={FileText} />
        <MetricCard label="KB facts" value={String(stats.facts)} icon={Database} />
        <MetricCard
          label="Spend (month)"
          value={`$${stats.monthCostUsd.toFixed(2)}`}
          icon={Sparkles}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent applications</CardTitle>
              <CardDescription>
                Tailored resumes and cover letters you&apos;ve generated.
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              render={<Link href="/applications" />}
              nativeButton={false}
              className="gap-1"
            >
              View all <ArrowRight className="size-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
              No applications yet. Start one to see it here.
              <div className="mt-3">
                <Button render={<Link href="/applications/new" />} nativeButton={false} size="sm">
                  Start a new application
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>How Talos works</CardTitle>
            <CardDescription>The 10-step quality-gated pipeline.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm">
              <Step n={1} label="Analyze the job description" />
              <Step n={2} label="Score fit (you approve)" />
              <Step n={3} label="Pick long or short resume" />
              <Step n={4} label="Research company (you approve)" />
              <Step n={5} label="Retrieve grounded KB content" />
              <Step n={6} label="Draft resume + cover letter" />
              <Step n={7} label="Screener + dual QC review" />
              <Step n={8} label="Iterate up to 3× until ≥ 90" />
              <Step n={9} label="Groundedness verify" />
              <Step n={10} label="Export DOCX + PDF" />
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-1">
        <CardDescription>{label}</CardDescription>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function Step({ n, label }: { n: number; label: string }) {
  return (
    <li className="flex items-center gap-2.5">
      <Badge variant="secondary" className="size-5 justify-center p-0 text-[10px] font-mono">
        {n}
      </Badge>
      <span>{label}</span>
    </li>
  );
}
