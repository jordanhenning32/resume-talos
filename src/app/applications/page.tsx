import Link from "next/link";
import { desc } from "drizzle-orm";
import { formatDistanceToNow } from "date-fns";
import { Briefcase, Building2, ChevronRight, Plus } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteApplicationButton } from "@/components/applications/DeleteApplicationButton";
import { StatusSelect } from "@/components/applications/StatusSelect";
import { db } from "@/db";
import { applications, type ApplicationStatus } from "@/db/schema";
import { isFullyConfigured } from "@/lib/setup-status";

export const dynamic = "force-dynamic";
const APPLICATION_LIST_LIMIT = 100;

export default async function ApplicationsPage() {
  const configured = isFullyConfigured();
  const rows = configured
      ? await db()
        .select()
        .from(applications)
        .orderBy(desc(applications.createdAt))
        .limit(APPLICATION_LIST_LIMIT)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Applications</h1>
          <p className="text-sm text-muted-foreground">
            Every job you&apos;ve tailored documents for. Outcomes feed the learning loop.
          </p>
        </div>
        <Button
          render={<Link href="/applications/new" />}
          nativeButton={false}
          size="sm"
          className="gap-1.5"
        >
          <Plus className="size-4" /> New application
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No applications yet</CardTitle>
            <CardDescription>
              Start one to see it here with its fit score, status, and generated documents.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/applications/new" />} nativeButton={false}>
              Start your first application
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((app) => (
            <ApplicationRow key={app.id} app={app} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ApplicationRow({
  app,
}: {
  app: typeof applications.$inferSelect;
}) {
  return (
    <li className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
      <Briefcase className="size-4 shrink-0 text-muted-foreground" />
      <Link
        href={`/applications/${app.id}`}
        className="min-w-0 flex-1"
        aria-label={`Open ${app.role} at ${app.company}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium group-hover:underline">
            {app.role}
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Building2 className="size-3" /> {app.company}
          </span>
          {app.fitApproved === "true" && (
            <Badge
              variant="outline"
              className="border-green-500/30 bg-green-500/5 text-[10px] text-green-700 dark:text-green-300"
            >
              fit approved
            </Badge>
          )}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {app.fitScore != null && (
            <span className="font-mono mr-3">
              fit {Math.round(app.fitScore)}/100
            </span>
          )}
          updated {formatDistanceToNow(app.statusUpdatedAt, { addSuffix: true })}
        </div>
      </Link>
      <StatusSelect id={app.id} status={app.status as ApplicationStatus} />
      <DeleteApplicationButton id={app.id} role={app.role} company={app.company} />
      <Link
        href={`/applications/${app.id}`}
        aria-hidden
        tabIndex={-1}
        className="text-muted-foreground"
      >
        <ChevronRight className="size-4 shrink-0" />
      </Link>
    </li>
  );
}
