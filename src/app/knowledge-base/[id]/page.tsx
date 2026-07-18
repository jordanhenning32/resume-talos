import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft, FileText } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FactList } from "@/components/kb/FactList";
import { DeleteDocumentButton } from "@/components/kb/DeleteDocumentButton";
import {
  getDocumentById,
  listChunksForDocument,
  listFactsForDocument,
} from "@/lib/kb/queries";

export const dynamic = "force-dynamic";

export default async function DocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ needsAttribution?: string }>;
}) {
  const { id } = await params;
  const { needsAttribution } = await searchParams;
  const needsAttributionActive = needsAttribution === "1";
  const doc = await getDocumentById(id);
  if (!doc) notFound();

  const [chunks, facts] = await Promise.all([
    listChunksForDocument(id),
    listFactsForDocument(id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            render={<Link href={`/knowledge-base${needsAttributionActive ? "?needsAttribution=1" : ""}`} />}
            nativeButton={false}
            variant="ghost"
            size="icon-sm"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <FileText className="size-5 text-muted-foreground" />
              {doc.name}
            </h1>
            <p className="text-xs text-muted-foreground">
              <Badge variant="secondary" className="mr-2 text-[10px] uppercase">
                {doc.fileType}
              </Badge>
              {doc.byteSize ? `${(doc.byteSize / 1024).toFixed(1)} KB · ` : ""}
              uploaded {format(doc.uploadedAt, "PPpp")}
            </p>
          </div>
        </div>
        <DeleteDocumentButton id={doc.id} name={doc.name} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <SmallStat label="Chunks" value={chunks.length} />
        <SmallStat label="Facts" value={facts.length} />
        <SmallStat label="Characters" value={doc.rawContent.length} />
      </div>

      <Tabs defaultValue="facts">
        <TabsList>
          <TabsTrigger value="facts">Facts ({facts.length})</TabsTrigger>
          <TabsTrigger value="chunks">Chunks ({chunks.length})</TabsTrigger>
          <TabsTrigger value="raw">Raw text</TabsTrigger>
        </TabsList>

        <TabsContent value="facts" className="mt-4">
          <FactList documentId={id} needsAttribution={needsAttributionActive} />
        </TabsContent>

        <TabsContent value="chunks" className="mt-4">
          {chunks.length === 0 ? (
            <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              No chunks.
            </div>
          ) : (
            <ul className="space-y-3">
              {chunks.map((c) => (
                <li key={c.id} className="rounded-md border bg-card p-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-mono">chunk #{c.chunkIndex}</span>
                    {c.tokenCount ? (
                      <span>{c.tokenCount} tokens (approx)</span>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{c.content}</p>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="raw" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Raw extracted text</CardTitle>
              <CardDescription>
                What the parser produced before chunking.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px] rounded-md border bg-muted/30 p-4">
                <pre className="whitespace-pre-wrap text-xs font-mono text-foreground">
                  {doc.rawContent}
                </pre>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
