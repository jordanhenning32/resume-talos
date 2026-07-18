import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NewApplicationForm } from "@/components/applications/NewApplicationForm";
import { isFullyConfigured } from "@/lib/setup-status";

export default function NewApplicationPage() {
  const configured = isFullyConfigured();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New application</h1>
        <p className="text-sm text-muted-foreground">
          Paste a job description or a posting URL. Talos will analyze it,
          score your fit against your KB, and ask you to approve before any
          resume or cover letter is drafted.
        </p>
      </div>

      {!configured ? (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="text-amber-700 dark:text-amber-400">
              Setup incomplete
            </CardTitle>
            <CardDescription>
              Configure your API keys + database first. See the Dashboard.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Job description</CardTitle>
            <CardDescription>
              The JD Analyzer agent reads the posting and extracts requirements,
              skills, seniority signal, and key language patterns. The Fit
              Scorer then grounds in your KB to score how well you match.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NewApplicationForm />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
