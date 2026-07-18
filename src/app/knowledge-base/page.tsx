import { Suspense } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TextIngestForm } from "@/components/kb/TextIngestForm";
import { UploadDropzone } from "@/components/kb/UploadDropzone";
import { UrlIngestForm } from "@/components/kb/UrlIngestForm";
import { DocumentList } from "@/components/kb/DocumentList";
import { FocusedFactsCard } from "@/components/kb/FocusedFactsCard";
import { NeedsAttributionFilter } from "@/components/kb/NeedsAttributionFilter";
import { getKbStats } from "@/lib/kb/queries";
import { isFullyConfigured } from "@/lib/setup-status";

export const dynamic = "force-dynamic";

export default async function KnowledgeBasePage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string | string[]; needsAttribution?: string }>;
}) {
  const configured = isFullyConfigured();
  const { focus: focusParam, needsAttribution } = await searchParams;
  const needsAttributionActive = needsAttribution === "1";
  const focus = Array.isArray(focusParam)
    ? focusParam[0]
    : (focusParam ?? null);
  const trimmedFocus = focus?.trim() ?? null;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Knowledge Base
        </h1>
        <p className="text-sm text-muted-foreground">
          Your professional history — uploaded documents, extracted facts, and
          curated entries. Everything Talos writes is grounded here.
        </p>
        <Suspense fallback={null}>
          <NeedsAttributionFilter isActive={needsAttributionActive} />
        </Suspense>
      </div>

      {!configured && <NotConfiguredNotice />}

      {configured && trimmedFocus && (
        <Suspense
          fallback={
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Searching for facts on &ldquo;{trimmedFocus}&rdquo;…
                </CardTitle>
              </CardHeader>
            </Card>
          }
        >
          <FocusedFactsCard focus={trimmedFocus} />
        </Suspense>
      )}

      {configured && (
        <Card>
          <CardHeader>
            <CardTitle>Add to your knowledge base</CardTitle>
            <CardDescription>
              Type facts in directly, upload a file, or pull pages from the
              web. Everything gets chunked, embedded, and mined for structured
              facts. Duplicates are automatically skipped.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="text">
              <TabsList>
                <TabsTrigger value="text">Type text</TabsTrigger>
                <TabsTrigger value="file">Upload file</TabsTrigger>
                <TabsTrigger value="url">From URL</TabsTrigger>
              </TabsList>
              <TabsContent value="text" className="mt-4">
                <TextIngestForm />
              </TabsContent>
              <TabsContent value="file" className="mt-4">
                <UploadDropzone />
              </TabsContent>
              <TabsContent value="url" className="mt-4">
                <UrlIngestForm />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      <Suspense fallback={<StatsSkeleton />}>
        {configured ? <Stats /> : null}
      </Suspense>

      {configured && (
        <Card>
          <CardHeader>
            <CardTitle>Documents</CardTitle>
            <CardDescription>
              Click any document to inspect its chunks and the facts Talos
              pulled from it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<ListSkeleton />}>
              <DocumentList needsAttribution={needsAttributionActive} />
            </Suspense>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function Stats() {
  const stats = await getKbStats();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard label="Documents" value={stats.documents} />
      <StatCard label="Chunks" value={stats.chunks} />
      <StatCard label="Facts" value={stats.facts} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

function NotConfiguredNotice() {
  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader>
        <CardTitle className="text-amber-700 dark:text-amber-400">
          Setup needed
        </CardTitle>
        <CardDescription>
          Fill in <code className="rounded bg-muted px-1.5 py-0.5 text-xs">.env.local</code>{" "}
          first — the upload pipeline needs database + model API access.
          See the Dashboard for what&apos;s missing.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
