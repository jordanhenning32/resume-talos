"use client";

import { useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, Loader2, Mail, RefreshCw, Send } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { generateDraftsAction } from "@/app/applications/[id]/actions";
import type { ApplicationVersion } from "@/db/schema";

export function DraftsGate({
  applicationId,
  variant,
  latestVersion,
}: {
  applicationId: string;
  variant: "long" | "short";
  latestVersion: ApplicationVersion | null;
}) {
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<"side" | "tabs">("tabs");

  function run() {
    startTransition(async () => {
      const r = await generateDraftsAction(applicationId);
      if (r.ok) {
        toast.success(
          `Draft v${r.versionNumber} ready · $${r.costUsd.toFixed(3)} spent`,
        );
      } else {
        toast.error(`Draft generation failed: ${r.error}`);
      }
    });
  }

  if (!latestVersion) {
    return (
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="size-5" /> Generate resume + cover letter drafts
          </CardTitle>
          <CardDescription>
            The Retriever pulls relevant KB facts; the Resume Writer and Cover
            Letter Writer (both Opus 4.7) draft in parallel. Each draft is
            grounded in cited fact ids the Verifier will check downstream.
            Variant: <strong>{variant}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={run} disabled={pending} className="gap-1.5" size="default">
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Drafting (90-120s)…
              </>
            ) : (
              <>
                <Send className="size-4" /> Generate drafts
              </>
            )}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Typical cost: ~$0.50-1.30 (two Opus calls + retrieval embeddings).
          </p>
        </CardContent>
      </Card>
    );
  }

  const resumeMd = latestVersion.resumeMarkdown ?? "(no resume content)";
  const coverMd = latestVersion.coverLetterMarkdown ?? "(no cover letter content)";
  const cited = (latestVersion.citedFactIds as string[] | null) ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4 text-muted-foreground" /> Drafts
            <Badge variant="secondary" className="text-[10px]">
              v{latestVersion.versionNumber}
            </Badge>
            <Badge variant="outline" className="text-[10px] uppercase">
              {variant}
            </Badge>
          </CardTitle>
          <CardDescription>
            {cited.length} KB facts cited across both documents. Iteration{" "}
            {latestVersion.iteration} · created{" "}
            {new Date(latestVersion.createdAt).toLocaleString()}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setView(view === "tabs" ? "side" : "tabs")}
          >
            {view === "tabs" ? "Side-by-side" : "Tabbed"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={run}
            disabled={pending}
            className="gap-1.5"
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Regenerate (v{latestVersion.versionNumber + 1})
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {view === "tabs" ? (
          <Tabs defaultValue="resume">
            <TabsList>
              <TabsTrigger value="resume" className="gap-1.5">
                <FileText className="size-3.5" /> Resume
              </TabsTrigger>
              <TabsTrigger value="cover" className="gap-1.5">
                <Mail className="size-3.5" /> Cover letter
              </TabsTrigger>
            </TabsList>
            <TabsContent value="resume" className="mt-3">
              <DraftPanel markdown={resumeMd} />
            </TabsContent>
            <TabsContent value="cover" className="mt-3">
              <DraftPanel markdown={coverMd} />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <FileText className="size-3.5" /> Resume
              </h3>
              <DraftPanel markdown={resumeMd} dense />
            </div>
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Mail className="size-3.5" /> Cover letter
              </h3>
              <DraftPanel markdown={coverMd} dense />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DraftPanel({
  markdown,
  dense = false,
}: {
  markdown: string;
  dense?: boolean;
}) {
  return (
    <ScrollArea
      className={cn(
        "rounded-md border bg-card p-4",
        dense ? "h-[520px]" : "h-[640px]",
      )}
    >
      <div className="prose prose-sm dark:prose-invert max-w-none [&_h1]:mt-0 [&_h2]:mt-6 [&_h3]:mt-4">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </div>
    </ScrollArea>
  );
}
