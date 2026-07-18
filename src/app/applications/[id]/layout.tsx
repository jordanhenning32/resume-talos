import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ApplicationTabs } from "./_components/ApplicationTabs";
import { loadApp, STATUS_COLORS } from "./_lib";

export const dynamic = "force-dynamic";

export default async function ApplicationLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const app = await loadApp(id);
  if (!app) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            render={<Link href="/applications" />}
            nativeButton={false}
            variant="ghost"
            size="icon-sm"
            aria-label="Back to applications list"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{app.role}</h1>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Building2 className="size-4" /> {app.company}
              <Badge
                variant="outline"
                className={cn("text-[10px] uppercase", STATUS_COLORS[app.status])}
              >
                {app.status.replace(/_/g, " ")}
              </Badge>
            </p>
          </div>
        </div>
        {app.jdUrl && (
          <Button
            render={
              <a href={app.jdUrl} target="_blank" rel="noopener noreferrer" />
            }
            nativeButton={false}
            variant="outline"
            size="sm"
            className="gap-1.5"
          >
            <ExternalLink className="size-3.5" /> Original posting
          </Button>
        )}
      </div>

      <ApplicationTabs applicationId={app.id} />

      {children}
    </div>
  );
}
