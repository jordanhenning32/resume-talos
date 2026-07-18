import Link from "next/link";
import { unstable_cache } from "next/cache";
import { ArrowLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AtsCoverageCard } from "@/components/applications/AtsCoverageCard";
import { RecruiterScreenerCard } from "@/components/applications/RecruiterScreenerCard";
import { combineAtsReports } from "@/lib/agents/ats-simulator";
import { computeScreeningSimilarity } from "@/lib/agents/screening-similarity";
import { isVersionBoundReportFresh } from "@/lib/applications/versioning";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";
import type { RecruiterScreenerShape } from "@/db/schema";
import { loadApp, loadLatestVersion } from "../_lib";

export const dynamic = "force-dynamic";

/**
 * Memoize the screening-similarity embedding call by version id. The
 * embedding inputs (JD text + resume markdown + cover markdown) only change
 * when the user generates a new draft, so we can safely cache per-version.
 * First navigation to a given version's Screening tab pays the OpenAI
 * round-trip (~500ms-1s); subsequent navigations to the same version are
 * served from the Next.js data cache.
 */
const getCachedScreeningSimilarity = unstable_cache(
  async (
    versionId: string,
    jdText: string,
    resumeMarkdown: string,
    coverLetterMarkdown: string | null,
  ) => {
    void versionId; // included only as part of the cache key
    return computeScreeningSimilarity({
      jdText,
      resumeMarkdown,
      coverLetterMarkdown,
    });
  },
  ["screening-similarity"],
  { revalidate: 3600 },
);

export default async function ApplicationScreeningPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Run app + latest-version fetches in parallel. Both only need id, no
  // dependency. React.cache dedupes against the layout's app load.
  const [app, latestVersion] = await Promise.all([
    loadApp(id),
    loadLatestVersion(id),
  ]);
  if (!app) return null;

  const analysis = (app.jdAnalysis as JdAnalysis | null) ?? null;

  if (app.status === "withdrawn") {
    return <WithdrawnNotice />;
  }

  if (!analysis) {
    return (
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader>
          <CardTitle>JD analysis missing</CardTitle>
          <CardDescription>
            Screening checks need a JD analysis to compare the resume against.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!latestVersion?.resumeMarkdown) {
    return <NoDraftsNotice id={app.id} />;
  }

  // ATS scan — deterministic regex over the latest resume + cover-letter
  // markdown. Pure string ops, sub-50ms, no LLM cost. Both docs are scanned
  // because most AI screeners read each one separately.
  const atsReport = combineAtsReports({
    resumeMarkdown: latestVersion.resumeMarkdown,
    coverLetterMarkdown: latestVersion.coverLetterMarkdown ?? "",
    mustHaveSkills: analysis.mustHaveSkills,
    niceToHaveSkills: analysis.niceToHaveSkills,
    keyLanguagePatterns: analysis.keyLanguagePatterns,
    jdRoleTitle: analysis.roleTitle,
  });

  // Semantic similarity — embedding-based defense against AI-powered ATS.
  // Cached by version id; repeated tab navigations are served from cache.
  const screeningSimilarity = app.jdText
    ? await getCachedScreeningSimilarity(
        latestVersion.id,
        app.jdText,
        latestVersion.resumeMarkdown,
        latestVersion.coverLetterMarkdown,
      )
    : null;

  const recruiterResult =
    (app.recruiterScreenerResult as unknown as RecruiterScreenerShape | null) ??
    null;
  const freshRecruiterResult = isVersionBoundReportFresh(
    recruiterResult,
    latestVersion.id,
  )
    ? recruiterResult
    : null;

  return (
    <div className="space-y-6">
      <AtsCoverageCard report={atsReport} similarity={screeningSimilarity} />
      <RecruiterScreenerCard
        applicationId={app.id}
        result={freshRecruiterResult}
        computedAt={freshRecruiterResult ? (app.recruiterScreenerAt ?? null) : null}
      />
    </div>
  );
}

function NoDraftsNotice({ id }: { id: string }) {
  return (
    <Card className="border-blue-500/20 bg-blue-500/5">
      <CardHeader>
        <CardTitle>No drafts yet</CardTitle>
        <CardDescription>
          AI-screening defense runs against the latest resume + cover letter.
          Generate them on the Draft tab first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          render={<Link href={`/applications/${id}/draft`} />}
          nativeButton={false}
          size="sm"
          className="gap-1.5"
        >
          <ArrowLeft className="size-3.5" /> Open Draft tab
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
          Screening checks are disabled because this application has been
          withdrawn.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
