import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EditDraftForm } from "../_components/EditDraftForm";
import { loadApp, loadLatestVersion } from "../_lib";

export const dynamic = "force-dynamic";

export default async function ApplicationEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [app, latestVersion] = await Promise.all([
    loadApp(id),
    loadLatestVersion(id),
  ]);
  if (!app) return null;

  if (app.status === "withdrawn") {
    return (
      <Card className="border-zinc-500/30 bg-zinc-500/5">
        <CardHeader>
          <CardTitle>Application withdrawn</CardTitle>
          <CardDescription>
            Manual edits are disabled because this application has been
            withdrawn.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Manual edit</CardTitle>
          <CardDescription>
            Paste or edit the resume and (optionally) cover-letter markdown
            below, then click <b>Save &amp; re-evaluate</b>. The result is
            saved as a new version (v{(latestVersion?.versionNumber ?? 0) + 1}.0)
            so the previous version stays in history. The Screening tab
            re-runs its ATS keyword + semantic similarity checks against the
            new content automatically. Re-run knockout and recruiter sims
            from their cards when you want those refreshed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EditDraftForm
            applicationId={app.id}
            initialResumeMarkdown={latestVersion?.resumeMarkdown ?? ""}
            initialCoverLetterMarkdown={
              latestVersion?.coverLetterMarkdown ?? ""
            }
            hasExistingDrafts={Boolean(latestVersion)}
            currentVersionLabel={
              latestVersion
                ? `v${latestVersion.versionNumber}.${latestVersion.iteration}`
                : null
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
