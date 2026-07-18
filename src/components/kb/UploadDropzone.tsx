"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { CheckCircle2, FileText, Loader2, UploadCloud, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DocKind = "facts" | "voice";
type IngestMode = "default" | "force_overwrite" | "merge";

type SkippedFact = {
  content: string;
  factType: string;
  reason: "duplicate_existing" | "duplicate_in_batch";
  similarTo?: { id?: string; content: string; similarity: number };
};

type UploadState =
  | { status: "idle" }
  | { status: "uploading"; fileName: string }
  | { status: "processing"; fileName: string }
  | {
      status: "done";
      fileName: string;
      chunkCount: number;
      factCount: number;
      duplicateFactCount: number;
      costUsd: number;
      warnings: string[];
      skippedFacts?: SkippedFact[];
    }
  | {
      status: "duplicate";
      fileName: string;
      existingName: string;
      existingDocumentId: string;
    }
  | { status: "error"; fileName: string; message: string };

export function UploadDropzone() {
  const router = useRouter();
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [kind, setKind] = useState<DocKind>("facts");
  const [lastFile, setLastFile] = useState<File | null>(null);

  const handleFile = useCallback(
    async (file: File, mode: IngestMode = "default") => {
      setLastFile(file);
      setState({ status: "uploading", fileName: file.name });
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      form.append("mode", mode);

      try {
        setState({ status: "processing", fileName: file.name });
        const res = await fetch("/api/kb/upload", {
          method: "POST",
          body: form,
        });
        const json = (await res.json()) as
          | {
              status: "ingested" | "duplicate_document";
              documentId: string;
              chunkCount: number;
              factCount: number;
              duplicateFactCount: number;
              costUsd: number;
              warnings: string[];
              skippedFacts?: SkippedFact[];
              duplicate?: { existingDocumentId: string; existingName: string };
            }
          | { error: string };

        if (!res.ok || "error" in json) {
          const message = "error" in json ? json.error : `HTTP ${res.status}`;
          setState({ status: "error", fileName: file.name, message });
          toast.error(`Upload failed: ${message}`);
          return;
        }

        if (json.status === "duplicate_document" && json.duplicate) {
          setState({
            status: "duplicate",
            fileName: file.name,
            existingName: json.duplicate.existingName,
            existingDocumentId: json.duplicate.existingDocumentId,
          });
          toast.info(
            `${file.name} is already in your KB as "${json.duplicate.existingName}".`,
          );
          return;
        }

        setState({
          status: "done",
          fileName: file.name,
          chunkCount: json.chunkCount,
          factCount: json.factCount,
          duplicateFactCount: json.duplicateFactCount,
          costUsd: json.costUsd,
          warnings: json.warnings,
          skippedFacts: json.skippedFacts,
        });
        const dupNote =
          json.duplicateFactCount > 0
            ? ` · ${json.duplicateFactCount} duplicates skipped`
            : "";
        toast.success(
          `${file.name}: ${json.factCount} new facts from ${json.chunkCount} chunks${dupNote} ($${json.costUsd.toFixed(3)})`,
        );
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: "error", fileName: file.name, message });
        toast.error(`Upload failed: ${message}`);
      }
    },
    [router, kind],
  );

  const onDrop = useCallback(
    (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      void handleFile(file);
    },
    [handleFile],
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } =
    useDropzone({
      onDrop,
      accept: {
        "application/pdf": [".pdf"],
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
          [".docx"],
        "text/plain": [".txt"],
        "text/markdown": [".md"],
      },
      maxFiles: 1,
      multiple: false,
      disabled:
        state.status === "uploading" || state.status === "processing",
      noClick: false,
    });

  const busy = state.status === "uploading" || state.status === "processing";

  return (
    <div className="space-y-3">
      <KindSelector value={kind} onChange={setKind} disabled={busy} />
      <div
        {...getRootProps()}
        className={cn(
          "rounded-md border-2 border-dashed px-6 py-12 text-center transition-colors",
          isDragActive && !isDragReject && "border-primary bg-primary/5",
          isDragReject && "border-destructive bg-destructive/5",
          busy && "cursor-not-allowed opacity-60",
          !busy && !isDragActive && "border-border hover:bg-muted/30 cursor-pointer",
        )}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-3">
          {busy ? (
            <Loader2 className="size-7 animate-spin text-muted-foreground" />
          ) : (
            <UploadCloud className="size-7 text-muted-foreground" />
          )}
          {state.status === "idle" && (
            <>
              <p className="text-sm font-medium">
                Drag a document here, or{" "}
                <span className="text-primary underline-offset-2 hover:underline">
                  click to browse
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                PDF, DOCX, TXT, or MD. Up to 25&nbsp;MB.
              </p>
            </>
          )}
          {state.status === "uploading" && (
            <p className="text-sm">Uploading <Mono>{state.fileName}</Mono>…</p>
          )}
          {state.status === "processing" && (
            <>
              <p className="text-sm">
                Processing <Mono>{state.fileName}</Mono>
              </p>
              <p className="text-xs text-muted-foreground">
                Parsing, chunking, embedding, extracting facts. This can take a
                minute for long documents.
              </p>
            </>
          )}
        </div>
      </div>

      {state.status === "done" && (
        <ResultBanner
          ok
          fileName={state.fileName}
          summary={`${state.factCount} new facts from ${state.chunkCount} chunks${
            state.duplicateFactCount > 0
              ? ` · ${state.duplicateFactCount} duplicate fact${state.duplicateFactCount === 1 ? "" : "s"} skipped`
              : ""
          } · $${state.costUsd.toFixed(3)}`}
          warnings={state.warnings}
        />
      )}

      {state.status === "done" && state.skippedFacts && state.skippedFacts.length > 0 && (
        <SkippedFactsBanner
          skippedFacts={state.skippedFacts}
          onRetry={(mode) => {
            if (lastFile) void handleFile(lastFile, mode);
          }}
        />
      )}

      {state.status === "duplicate" && (
        <ResultBanner
          ok
          variant="info"
          fileName={state.fileName}
          summary={`Already in your KB as "${state.existingName}" — nothing was added. Visit it from the document list below.`}
        />
      )}

      {state.status === "error" && (
        <ResultBanner ok={false} fileName={state.fileName} summary={state.message} />
      )}
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs">{children}</span>;
}

export function KindSelector({
  value,
  onChange,
  disabled,
}: {
  value: DocKind;
  onChange: (k: DocKind) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset
      className={cn(
        "rounded-md border p-3 text-sm",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Document kind
      </legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label
          className={cn(
            "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 transition-colors",
            value === "facts"
              ? "border-primary bg-primary/5"
              : "border-border hover:bg-muted/40",
          )}
        >
          <input
            type="radio"
            name="doc-kind"
            value="facts"
            checked={value === "facts"}
            onChange={() => onChange("facts")}
            className="mt-0.5"
          />
          <div className="min-w-0">
            <div className="font-medium">Facts (default)</div>
            <div className="text-xs text-muted-foreground">
              Resumes, job histories, achievements. Talos parses, embeds, and
              mines structured claims it can cite.
            </div>
          </div>
        </label>
        <label
          className={cn(
            "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 transition-colors",
            value === "voice"
              ? "border-blue-500/40 bg-blue-500/5"
              : "border-border hover:bg-muted/40",
          )}
        >
          <input
            type="radio"
            name="doc-kind"
            value="voice"
            checked={value === "voice"}
            onChange={() => onChange("voice")}
            className="mt-0.5"
          />
          <div className="min-w-0">
            <div className="font-medium">Voice sample</div>
            <div className="text-xs text-muted-foreground">
              LinkedIn essays, blog posts, interview transcripts. Used as style
              anchors so the cover letter sounds like you. No fact extraction.
            </div>
          </div>
        </label>
      </div>
    </fieldset>
  );
}

function ResultBanner({
  ok,
  fileName,
  summary,
  warnings = [],
  variant,
}: {
  ok: boolean;
  fileName: string;
  summary: string;
  warnings?: string[];
  variant?: "info";
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border px-4 py-3 text-sm",
        variant === "info"
          ? "border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300"
          : ok
            ? "border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-300"
            : "border-destructive/30 bg-destructive/5 text-destructive",
      )}
    >
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0" />
      )}
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <FileText className="size-3.5" />
          <span className="font-mono text-xs">{fileName}</span>
        </div>
        <div className="mt-0.5 text-foreground">{summary}</div>
        {warnings.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              {warnings.length} warning{warnings.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => window.location.reload()}
        className="shrink-0"
      >
        Upload another
      </Button>
    </div>
  );
}

function SkippedFactsBanner({
  skippedFacts,
  onRetry,
}: {
  skippedFacts: SkippedFact[];
  onRetry: (mode: "force_overwrite" | "merge") => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
      <div className="font-medium text-amber-800 dark:text-amber-200">
        {skippedFacts.length} duplicate fact{skippedFacts.length === 1 ? "" : "s"} skipped
      </div>
      {skippedFacts.map((f, i) => (
        <div key={i} className="flex flex-col gap-2 border-t border-amber-500/20 pt-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">{f.factType}</div>
            <div>{f.content}</div>
            {f.similarTo && <div>Similar to {f.similarTo.id ?? "batch fact"} ({f.similarTo.similarity.toFixed(2)})</div>}
          </div>
          <div className="flex shrink-0 gap-1">
            <Button type="button" size="xs" variant="ghost">
              Keep
            </Button>
            <Button type="button" size="xs" variant="outline" onClick={() => onRetry("force_overwrite")}>
              Use new
            </Button>
            <Button type="button" size="xs" onClick={() => onRetry("merge")}>
              Merge
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
