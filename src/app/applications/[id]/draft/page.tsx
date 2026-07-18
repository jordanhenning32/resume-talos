import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { VariantChoiceCard } from "@/components/applications/VariantChoiceCard";
import { MarketResearchGate } from "@/components/applications/MarketResearchGate";
import { DraftsGate } from "@/components/applications/DraftsGate";
import { QcGate } from "@/components/applications/QcGate";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";
import type { ResumeVariant } from "@/db/schema";
import {
  loadAllVersions,
  loadApp,
  loadLatestVersion,
  loadMarketResearch,
  parseFitScore,
  recommendVariant,
} from "../_lib";

export const dynamic = "force-dynamic";

export default async function ApplicationDraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Run app + latest-version in parallel — they only need `id`, no
  // dependency between them. The layout has already cached app via
  // React.cache, so this is a no-op fetch when the layout ran first.
  const [app, latestVersion] = await Promise.all([
    loadApp(id),
    loadLatestVersion(id),
  ]);
  if (!app) return null;

  const analysis = (app.jdAnalysis as JdAnalysis | null) ?? null;
  const fit = parseFitScore(app);
  const variantRec = recommendVariant(analysis?.seniorityLevel ?? "unspecified");
  // Market research + all-versions also independent — run in parallel.
  const [research, allVersions] = await Promise.all([
    loadMarketResearch(app.marketResearchId ?? null),
    latestVersion ? loadAllVersions(app.id) : Promise.resolve([]),
  ]);

  if (app.status === "withdrawn") {
    return <WithdrawnNotice />;
  }

  if (!fit) {
    return <NoFitNotice id={app.id} />;
  }

  if (app.fitApproved !== "true") {
    return <ApproveFitFirstNotice id={app.id} />;
  }

  return (
    <div className="space-y-6">
      <VariantChoiceCard
        applicationId={app.id}
        current={(app.variant as ResumeVariant | null) ?? null}
        recommendation={variantRec.variant}
        recommendationWhy={variantRec.why}
      />
      {app.variant && (
        <MarketResearchGate
          applicationId={app.id}
          companyName={app.company}
          research={research}
          isApproved={app.marketResearchApproved === "true"}
        />
      )}
      {app.marketResearchApproved === "true" && app.variant && (
        <DraftsGate
          applicationId={app.id}
          variant={app.variant as "long" | "short"}
          latestVersion={latestVersion}
        />
      )}
      {latestVersion && (
        <QcGate applicationId={app.id} versions={allVersions} />
      )}
    </div>
  );
}

function NoFitNotice({ id }: { id: string }) {
  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader>
        <CardTitle>Analysis incomplete</CardTitle>
        <CardDescription>
          Fit score data is missing from this application. Open the Overview tab
          to investigate.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          render={<Link href={`/applications/${id}`} />}
          nativeButton={false}
          variant="outline"
          size="sm"
          className="gap-1.5"
        >
          <ArrowLeft className="size-3.5" /> Back to Overview
        </Button>
      </CardContent>
    </Card>
  );
}

function ApproveFitFirstNotice({ id }: { id: string }) {
  return (
    <Card className="border-blue-500/20 bg-blue-500/5">
      <CardHeader>
        <CardTitle>Approve fit first</CardTitle>
        <CardDescription>
          The Draft step is gated behind fit approval. Review the fit score on
          the Overview tab and decide whether to proceed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          render={<Link href={`/applications/${id}`} />}
          nativeButton={false}
          size="sm"
          className="gap-1.5"
        >
          <ArrowLeft className="size-3.5" /> Open Overview
        </Button>
      </CardContent>
    </Card>
  );
}

function WithdrawnNotice() {
  return (
    <Card className="border-zinc-500/30 bg-zinc-500/5">
      <CardHeader>
        <CardTitle>Application withdrawn</CardTitle>
        <CardDescription>
          Draft actions are disabled because this application has been
          withdrawn. Change the status from the list page if you want to
          resume work.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
