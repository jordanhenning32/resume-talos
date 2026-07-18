import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { FileText, ChevronRight, Mic } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { listDocuments, type DocumentRow } from "@/lib/kb/queries";

export async function DocumentList({ needsAttribution = false }: { needsAttribution?: boolean }) {
  const docs = await listDocuments({ needsAttribution });
  if (docs.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
        {needsAttribution
          ? "No documents have facts that need attribution."
          : "No documents yet -- drop one in the box above to start your KB."}
      </div>
    );
  }
  return (
    <ul className="divide-y rounded-md border">
      {docs.map((d) => (
        <DocumentRowItem key={d.id} doc={d} needsAttribution={needsAttribution} />
      ))}
    </ul>
  );
}

function DocumentRowItem({
  doc,
  needsAttribution,
}: {
  doc: DocumentRow;
  needsAttribution: boolean;
}) {
  return (
    <li>
      <Link
        href={`/knowledge-base/${doc.id}${needsAttribution ? "?needsAttribution=1" : ""}`}
        className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/40"
      >
        {doc.kind === "voice" ? (
          <Mic className="size-4 shrink-0 text-blue-600 dark:text-blue-400" />
        ) : (
          <FileText className="size-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{doc.name}</span>
            <Badge variant="secondary" className="text-[10px] uppercase">
              {doc.fileType}
            </Badge>
            {doc.kind === "voice" && (
              <Badge
                variant="outline"
                className="border-blue-500/30 bg-blue-500/5 text-[10px] uppercase text-blue-700 dark:text-blue-300"
              >
                voice
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {doc.chunkCount} chunk{doc.chunkCount === 1 ? "" : "s"} ·{" "}
            {doc.kind === "voice" ? (
              <span>style anchor</span>
            ) : (
              <>
                {doc.factCount} fact{doc.factCount === 1 ? "" : "s"}
                {needsAttribution ? ` (${doc.missingAttributionCount} unattributed)` : ""}
              </>
            )}{" "}
            · {doc.byteSize ? `${(doc.byteSize / 1024).toFixed(1)} KB` : "—"} ·
            uploaded {formatDistanceToNow(doc.uploadedAt, { addSuffix: true })}
          </div>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}
