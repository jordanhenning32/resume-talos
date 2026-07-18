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
import { ExportGate } from "@/components/applications/ExportGate";
import { QuestionnaireHelperCard } from "@/components/applications/QuestionnaireHelperCard";
import { loadApp, loadLatestVersion } from "../_lib";

export const dynamic = "force-dynamic";

export default async function ApplicationSubmitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Parallel — no dependency between app and latest-version loads.
  const [app, latestVersion] = await Promise.all([
    loadApp(id),
    loadLatestVersion(id),
  ]);
  if (!app) return null;

  if (app.status === "withdrawn") {
    return <WithdrawnNotice />;
  }

  return (
    <div className="space-y-6">
      {latestVersion ? (
        <ExportGate
          applicationId={app.id}
          latestVersion={latestVersion}
          jdUrl={app.jdUrl ?? null}
        />
      ) : (
        <NoDraftsNotice id={app.id} />
      )}
      {/* The questionnaire helper works even without drafts — it grounds in
          the JD + KB directly, so the user can pre-stage answers before any
          resume exists. Always renderable. */}
      <QuestionnaireHelperCard applicationId={app.id} />
    </div>
  );
}

function NoDraftsNotice({ id }: { id: string }) {
  return (
    <Card className="border-blue-500/20 bg-blue-500/5">
      <CardHeader>
        <CardTitle>No drafts to export yet</CardTitle>
        <CardDescription>
          Export needs a generated resume + cover letter. Head to the Draft
          tab to produce them. You can still prep screening-question answers
          below — those run against the JD + KB and don&apos;t need drafts.
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
          Submit actions are disabled because this application has been
          withdrawn.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
