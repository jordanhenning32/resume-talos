"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileDown,
  FileText,
  Folder,
  Loader2,
  Mail,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  addQuickFactsAction,
  exportApplicationAction,
  fixSectionHeadersAction,
  runVerifierAction,
  suggestVerifierFixAction,
} from "@/app/applications/[id]/actions";
import type {
  VerifierFix,
  VerifierFixResult,
} from "@/lib/agents/verifier-fix-suggester";
import type { ParseabilityAutoFix } from "@/lib/applications/export";
import {
  adviceForLayout,
  detectAtsVendor,
} from "@/lib/agents/ats-vendor";
import {
  LAYOUTS,
  type LayoutDescriptor,
  type LayoutId,
} from "@/lib/export/layouts/types";
import type { ApplicationVersion } from "@/db/schema";

type VerifierIssue = {
  claim: string;
  reason: string;
  severity: string;
};

export function ExportGate({
  applicationId,
  latestVersion,
  jdUrl,
}: {
  applicationId: string;
  latestVersion: ApplicationVersion;
  jdUrl: string | null;
}) {
  const vendorDetection = detectAtsVendor(jdUrl);
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<LayoutId>("executive");
  const [showIssues, setShowIssues] = useState(true);
  const [lastExport, setLastExport] = useState<{
    folder: string;
    paths: { resumePdf: string; resumeDocx: string; coverPdf: string; coverDocx: string };
    requestedLayout: LayoutId;
    layout: LayoutId;
    parseabilityAutoFix: ParseabilityAutoFix;
    parseability: import("@/lib/export/parseability").ParseabilityReport;
  } | null>(null);

  const verifierStatus = latestVersion.verifierPassed; // "pending" | "true" | "false"
  const issues = (latestVersion.verifierIssues as VerifierIssue[] | null) ?? [];
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const alreadyExported = Boolean(
    latestVersion.resumePdfPath && latestVersion.resumeDocxPath,
  );

  function runVerifier() {
    startTransition(async () => {
      const r = await runVerifierAction(applicationId);
      if (!r.ok) {
        toast.error(`Verifier failed: ${r.error}`);
        return;
      }
      if (r.passed) {
        toast.success(`Groundedness verified · $${r.costUsd.toFixed(3)}`);
      } else {
        toast.warning(
          `Verifier found ${r.criticalCount} critical, ${r.warningCount} warning${r.warningCount === 1 ? "" : "s"}`,
        );
      }
    });
  }

  function doExport(override: boolean = false) {
    startTransition(async () => {
      const r = await exportApplicationAction(applicationId, chosen, override);
      if (!r.ok) {
        toast.error(`Export failed: ${r.error}`);
        return;
      }
      setLastExport({
        folder: r.folder,
        paths: r.paths,
        requestedLayout: r.requestedLayout,
        layout: r.layout,
        parseabilityAutoFix: r.parseabilityAutoFix,
        parseability: r.parseability,
      });
      if (r.layout !== chosen) {
        setChosen(r.layout);
      }
      const v = r.parseability.verdict;
      const layoutLabel = layoutName(r.layout);
      if (r.parseabilityAutoFix.applied) {
        toast.success(
          r.parseabilityAutoFix.trimChanges
            ? `Auto-trimmed resume to page limit and exported ${layoutLabel}`
            : `Auto-fixed PDF parse and exported ${layoutLabel}`,
        );
      } else if (v === "clean") {
        toast.success(`Exported ${layoutLabel} - parseability clean`);
      } else if (v === "warning") {
        toast.warning(`Exported ${layoutLabel} - parseability warnings; see details`);
      } else {
        toast.error(`Exported ${layoutLabel} - PDF parse is BROKEN. ATS may misread. See details below.`);
      }
    });
  }

  // ─── State: verifier not yet run ──────────────────────────────
  if (verifierStatus === "pending") {
    return (
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" /> Verify groundedness before export
          </CardTitle>
          <CardDescription>
            The Groundedness Verifier (Haiku 4.5) reads every material claim in your
            resume and cover letter and confirms each one traces to a cited KB fact.
            Hard gate — exports are blocked until this passes (or you override).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={runVerifier} disabled={pending} className="gap-1.5">
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Verifying…
              </>
            ) : (
              <>
                <ShieldCheck className="size-4" /> Run verifier
              </>
            )}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Typical: 10-30 seconds · ~$0.02-0.10.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ─── State: verifier failed (has criticals) ───────────────────
  const verifierPassed = verifierStatus === "true";

  return (
    <div className="space-y-4">
      <Card
        className={cn(
          verifierPassed
            ? "border-green-500/30 bg-green-500/5"
            : "border-amber-500/30 bg-amber-500/5",
        )}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {verifierPassed ? (
              <>
                <Check className="size-5 text-green-600 dark:text-green-400" /> Groundedness verified
              </>
            ) : (
              <>
                <AlertTriangle className="size-5 text-amber-600 dark:text-amber-400" /> Verifier flagged issues
              </>
            )}
          </CardTitle>
          <CardDescription>
            {verifierPassed
              ? "Every material claim ties to a cited KB fact. Pick a layout and export."
              : `${criticalCount} critical · ${warningCount} warning${warningCount === 1 ? "" : "s"}. Address them upstream (regenerate drafts after fixing KB facts) or override and export anyway.`}
          </CardDescription>
        </CardHeader>
        {!verifierPassed && issues.length > 0 && (
          <CardContent>
            <button
              onClick={() => setShowIssues(!showIssues)}
              className="flex w-full items-center justify-between text-left text-sm"
            >
              <span className="font-semibold">View {issues.length} flagged claim{issues.length === 1 ? "" : "s"}</span>
              <ChevronDown className={cn("size-4 transition-transform", showIssues && "rotate-180")} />
            </button>
            {showIssues && (
              <ul className="mt-3 space-y-2 text-sm">
                {issues.map((i, idx) => (
                  <VerifierIssueRow
                    key={idx}
                    applicationId={applicationId}
                    issue={i}
                  />
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={runVerifier} disabled={pending} variant="outline" size="sm">
                Re-run verifier
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pick a layout</CardTitle>
          <CardDescription>
            Three modern templates. Each produces both a DOCX and a PDF.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {LAYOUTS.map((layout) => (
              <LayoutTile
                key={layout.id}
                layout={layout}
                selected={chosen === layout.id}
                onPick={() => setChosen(layout.id)}
              />
            ))}
          </div>
          {(() => {
            const advice = adviceForLayout(vendorDetection, chosen);
            if (!advice.discouraged && advice.recommended) {
              return (
                <p className="text-xs text-green-700 dark:text-green-400">
                  ✓ {vendorDetection.displayName} parses this layout cleanly.
                </p>
              );
            }
            if (advice.discouraged) {
              return (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                  <span>{advice.reason}</span>
                </div>
              );
            }
            if (advice.reason) {
              return (
                <p className="text-xs text-muted-foreground">? {advice.reason}</p>
              );
            }
            return null;
          })()}
        </CardContent>
      </Card>

      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileDown className="size-5" /> Export {LAYOUTS.find((l) => l.id === chosen)?.name}
          </CardTitle>
          <CardDescription>
            Writes <span className="font-mono text-xs">resume.docx</span>,{" "}
            <span className="font-mono text-xs">resume.pdf</span>,{" "}
            <span className="font-mono text-xs">cover-letter.docx</span>,{" "}
            <span className="font-mono text-xs">cover-letter.pdf</span>, and{" "}
            <span className="font-mono text-xs">metadata.json</span> to your{" "}
            <span className="font-mono text-xs">OUTPUT_ROOT</span> folder.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => doExport(false)}
              disabled={pending || (!verifierPassed && !alreadyExported)}
              className="gap-1.5"
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              Export
            </Button>
            {!verifierPassed && (
              <Button
                onClick={() => doExport(true)}
                disabled={pending}
                variant="outline"
                className="gap-1.5"
              >
                <X className="size-4" /> Override and export anyway
              </Button>
            )}
          </div>
          {lastExport && (
            <>
              <ExportedFiles folder={lastExport.folder} paths={lastExport.paths} />
              <ParseabilityAutoFixNotice autoFix={lastExport.parseabilityAutoFix} />
              <ParseabilityPanel
                applicationId={applicationId}
                report={lastExport.parseability}
              />
            </>
          )}
          {alreadyExported && !lastExport && (
            <ExportedFiles
              folder={folderOf(latestVersion.resumePdfPath ?? "")}
              paths={{
                resumePdf: latestVersion.resumePdfPath ?? "",
                resumeDocx: latestVersion.resumeDocxPath ?? "",
                coverPdf: latestVersion.coverLetterPdfPath ?? "",
                coverDocx: latestVersion.coverLetterDocxPath ?? "",
              }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LayoutTile({
  layout,
  selected,
  onPick,
}: {
  layout: LayoutDescriptor;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      onClick={onPick}
      className={cn(
        "rounded-md border p-4 text-left transition-colors",
        selected
          ? "border-primary bg-primary/5 ring-2 ring-primary/20"
          : "border-border bg-card hover:bg-muted/30",
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">{layout.name}</span>
        <Badge variant="outline" className="text-[10px]">
          {layout.badge}
        </Badge>
      </div>
      <LayoutPreview id={layout.id} />
      <p className="mt-3 text-xs text-muted-foreground">{layout.blurb}</p>
      {selected && (
        <Badge
          variant="outline"
          className="mt-2 border-primary/40 bg-primary/10 text-[10px] text-primary"
        >
          <Check className="mr-0.5 size-3" /> Selected
        </Badge>
      )}
    </button>
  );
}

/** Tiny SVG-based visual hints — not pixel-accurate, just an aesthetic preview. */
function LayoutPreview({ id }: { id: LayoutId }) {
  const stroke = "#777";
  const fill = "#f5f5f5";
  if (id === "classic") {
    return (
      <svg viewBox="0 0 200 130" className="h-32 w-full rounded-sm border bg-white">
        <text x="100" y="20" fontSize="14" fontFamily="Georgia" fontWeight="bold" textAnchor="middle">JORDAN HENNING</text>
        <text x="100" y="30" fontSize="6" fontFamily="Georgia" textAnchor="middle" fill={stroke}>jordanhenning.com · email · phone</text>
        <line x1="20" y1="36" x2="180" y2="36" stroke="#111" strokeWidth="0.7" />
        <text x="20" y="48" fontSize="7" fontFamily="Georgia" fontWeight="bold">SUMMARY</text>
        <rect x="20" y="52" width="160" height="3" fill={fill} />
        <rect x="20" y="57" width="155" height="3" fill={fill} />
        <text x="20" y="72" fontSize="7" fontFamily="Georgia" fontWeight="bold">EXPERIENCE</text>
        <rect x="20" y="78" width="120" height="3" fill="#444" />
        <rect x="20" y="83" width="160" height="2.5" fill={fill} />
        <rect x="20" y="88" width="158" height="2.5" fill={fill} />
        <rect x="20" y="96" width="120" height="3" fill="#444" />
        <rect x="20" y="101" width="160" height="2.5" fill={fill} />
      </svg>
    );
  }
  if (id === "executive") {
    return (
      <svg viewBox="0 0 200 130" className="h-32 w-full rounded-sm border bg-white">
        <text x="20" y="22" fontSize="16" fontFamily="Helvetica" fontWeight="bold" fill="#1a365d">Jordan Henning</text>
        <text x="180" y="22" fontSize="6" fontFamily="Helvetica" textAnchor="end" fill={stroke}>jordanhenning.com · email</text>
        <rect x="20" y="28" width="160" height="1.5" fill="#1a365d" />
        <text x="20" y="42" fontSize="7" fontFamily="Helvetica" fontWeight="bold" fill="#1a365d">SUMMARY</text>
        <line x1="20" y1="44" x2="180" y2="44" stroke="#888" strokeWidth="0.3" />
        <rect x="20" y="48" width="160" height="3" fill={fill} />
        <rect x="20" y="53" width="155" height="3" fill={fill} />
        <text x="20" y="68" fontSize="7" fontFamily="Helvetica" fontWeight="bold" fill="#1a365d">EXPERIENCE</text>
        <line x1="20" y1="70" x2="180" y2="70" stroke="#888" strokeWidth="0.3" />
        <text x="20" y="80" fontSize="6.5" fontFamily="Helvetica" fontWeight="bold">CGO · Quadratic Digital</text>
        <text x="180" y="80" fontSize="5.5" fontFamily="Helvetica" textAnchor="end" fill={stroke} fontStyle="italic">2023–Present</text>
        <rect x="22" y="84" width="156" height="2.5" fill={fill} />
        <rect x="22" y="89" width="158" height="2.5" fill={fill} />
        <rect x="22" y="94" width="155" height="2.5" fill={fill} />
        <text x="20" y="106" fontSize="6.5" fontFamily="Helvetica" fontWeight="bold">Branch Chief · SSA</text>
        <text x="180" y="106" fontSize="5.5" fontFamily="Helvetica" textAnchor="end" fill={stroke} fontStyle="italic">2022–2025</text>
        <rect x="22" y="110" width="156" height="2.5" fill={fill} />
      </svg>
    );
  }
  // Modern Two-Column
  return (
    <svg viewBox="0 0 200 130" className="h-32 w-full rounded-sm border bg-white">
      <rect x="0" y="0" width="60" height="130" fill="#f4f6f8" />
      <text x="6" y="16" fontSize="9" fontFamily="Helvetica" fontWeight="bold" fill="#0f4c5c">Jordan</text>
      <text x="6" y="25" fontSize="9" fontFamily="Helvetica" fontWeight="bold" fill="#0f4c5c">Henning</text>
      <rect x="6" y="29" width="14" height="1.5" fill="#0f4c5c" />
      <text x="6" y="40" fontSize="5.5" fontFamily="Helvetica" fontWeight="bold" fill="#0f4c5c">CONTACT</text>
      <rect x="6" y="44" width="48" height="2" fill={fill} />
      <rect x="6" y="48" width="44" height="2" fill={fill} />
      <text x="6" y="62" fontSize="5.5" fontFamily="Helvetica" fontWeight="bold" fill="#0f4c5c">SKILLS</text>
      <rect x="6" y="66" width="48" height="2" fill={fill} />
      <rect x="6" y="70" width="44" height="2" fill={fill} />
      <rect x="6" y="74" width="46" height="2" fill={fill} />
      <text x="6" y="92" fontSize="5.5" fontFamily="Helvetica" fontWeight="bold" fill="#0f4c5c">CERTIFICATIONS</text>
      <rect x="6" y="96" width="48" height="2" fill={fill} />
      <rect x="6" y="100" width="44" height="2" fill={fill} />
      <text x="66" y="20" fontSize="7" fontFamily="Helvetica" fontWeight="bold" fill="#0f4c5c">SUMMARY</text>
      <rect x="66" y="24" width="128" height="2.5" fill={fill} />
      <rect x="66" y="29" width="124" height="2.5" fill={fill} />
      <rect x="66" y="34" width="120" height="2.5" fill={fill} />
      <text x="66" y="48" fontSize="7" fontFamily="Helvetica" fontWeight="bold" fill="#0f4c5c">EXPERIENCE</text>
      <text x="66" y="58" fontSize="6" fontFamily="Helvetica" fontWeight="bold">CGO · Quadratic Digital</text>
      <rect x="68" y="62" width="125" height="2.5" fill={fill} />
      <rect x="68" y="67" width="120" height="2.5" fill={fill} />
      <text x="66" y="80" fontSize="6" fontFamily="Helvetica" fontWeight="bold">Branch Chief · SSA</text>
      <rect x="68" y="84" width="125" height="2.5" fill={fill} />
      <rect x="68" y="89" width="120" height="2.5" fill={fill} />
      <rect x="68" y="94" width="122" height="2.5" fill={fill} />
    </svg>
  );
}

function folderOf(p: string): string {
  if (!p) return "";
  return p.replace(/[\\/][^\\/]+$/, "");
}

function layoutName(layoutId: LayoutId): string {
  return LAYOUTS.find((layout) => layout.id === layoutId)?.name ?? layoutId;
}

function ParseabilityAutoFixNotice({
  autoFix,
}: {
  autoFix: ParseabilityAutoFix;
}) {
  if (!autoFix.message) return null;

  const finalLayout = layoutName(autoFix.finalLayout);
  const requestedLayout = layoutName(autoFix.requestedLayout);
  const title = autoFix.trimChanges
    ? autoFix.applied
      ? "Resume length auto-fixed"
      : "Resume length auto-fix attempted"
    : autoFix.applied
      ? "PDF parse auto-fixed"
      : "PDF parse auto-fix attempted";

  return (
    <div
      className={cn(
        "rounded-md border p-3 text-sm",
        autoFix.applied
          ? "border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-300"
          : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
      )}
    >
      <div className="flex items-center gap-2">
        <Wand2 className="size-4" />
        <span className="font-medium">{title}</span>
        <span className="ml-auto font-mono text-xs opacity-80">
          {requestedLayout === finalLayout
            ? finalLayout
            : `${requestedLayout} -> ${finalLayout}`}
        </span>
      </div>
      <p className="mt-1 text-xs opacity-85">{autoFix.message}</p>
      {autoFix.trimChanges && (
        <p className="mt-1 text-xs opacity-85">
          Removed {autoFix.trimChanges.removedBullets} bullet
          {autoFix.trimChanges.removedBullets === 1 ? "" : "s"}
          {autoFix.trimChanges.removedRoles > 0
            ? `, ${autoFix.trimChanges.removedRoles} role${
                autoFix.trimChanges.removedRoles === 1 ? "" : "s"
              }`
            : ""}
          {autoFix.trimChanges.removedSections > 0
            ? `, ${autoFix.trimChanges.removedSections} section${
                autoFix.trimChanges.removedSections === 1 ? "" : "s"
              }`
            : ""}
          . Word count {autoFix.trimChanges.wordCountBefore}
          {" -> "}
          {autoFix.trimChanges.wordCountAfter}.
        </p>
      )}
    </div>
  );
}

function ExportedFiles({
  folder,
  paths,
}: {
  folder: string;
  paths: { resumePdf: string; resumeDocx: string; coverPdf: string; coverDocx: string };
}) {
  const files = [
    { label: "resume.pdf", path: paths.resumePdf, Icon: FileText },
    { label: "resume.docx", path: paths.resumeDocx, Icon: FileText },
    { label: "cover-letter.pdf", path: paths.coverPdf, Icon: Mail },
    { label: "cover-letter.docx", path: paths.coverDocx, Icon: Mail },
  ];

  return (
    <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3 text-sm">
      <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
        <Folder className="size-4" />
        <span className="font-medium">Files written:</span>
      </div>
      <p className="mt-1 font-mono text-xs text-muted-foreground">{folder}</p>
      <ul className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
        {files.map(({ label, path, Icon }) => (
          <li
            key={label}
            title={path || undefined}
            className={cn(
              "flex items-center gap-1.5",
              !path && "text-muted-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {label}
            {!path && <span className="font-mono opacity-70">(missing)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ParseabilityPanel({
  report,
  applicationId,
}: {
  report: import("@/lib/export/parseability").ParseabilityReport;
  applicationId: string;
}) {
  const [fixPending, startFix] = useTransition();

  const verdictStyle =
    report.verdict === "clean"
      ? "border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-300"
      : report.verdict === "warning"
        ? "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"
        : "border-destructive/40 bg-destructive/5 text-destructive";
  const verdictLabel =
    report.verdict === "clean"
      ? "PDF parses cleanly"
      : report.verdict === "warning"
        ? "PDF parses with warnings"
        : "PDF parse is BROKEN";

  const hasHeaderIssue = report.artifacts.some(
    (a) =>
      a.kind === "non_canonical_section_header" ||
      a.kind === "missing_canonical_section",
  );
  const hasPageOverflow = report.artifacts.some(
    (a) => a.kind === "page_overflow",
  );

  function runHeaderFix() {
    startFix(async () => {
      const r = await fixSectionHeadersAction(applicationId);
      if (!r.ok) {
        toast.error(`Header fix failed: ${r.error}`);
        return;
      }
      if (r.changes.length === 0) {
        toast.message(
          "Nothing to rename — no deterministically-fixable headers found. (Custom headers like 'My Journey' require manual edit.)",
        );
        return;
      }
      toast.success(
        `Renamed ${r.changes.length} header${r.changes.length === 1 ? "" : "s"} · saved as v${r.versionNumber}.0. Re-export to see the new parseability.`,
      );
    });
  }

  return (
    <div className={cn("rounded-md border p-3 text-sm", verdictStyle)}>
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4" />
        <span className="font-medium">{verdictLabel}</span>
        <span className="ml-auto font-mono text-xs opacity-80">
          {Math.round(report.contentCoverage * 100)}% coverage · {report.pageCount} page{report.pageCount === 1 ? "" : "s"}
        </span>
      </div>
      <p className="mt-1 text-xs opacity-80">
        Re-extracted the rendered PDF via the same parser an ATS would use.
        {report.verdict === "broken" &&
          " Consider picking a different layout — most ATS will misread this."}
        {report.verdict === "warning" &&
          " Some ATS may still parse fine, but stricter scanners might trip."}
      </p>
      {!report.sectionOrder.inOrder && (
        <p className="mt-2 font-mono text-xs opacity-90">
          Sections in source: [{report.sectionOrder.sourceOrder.join(" → ")}]
          <br />
          Sections found by parser: [{report.sectionOrder.extractedOrder.join(" → ")}]
        </p>
      )}
      {report.artifacts.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {report.artifacts.map((a, i) => (
            <li key={i}>
              <span className="rounded border border-current/30 px-1 py-0.5 font-mono text-[10px] uppercase">
                {a.kind.replace(/_/g, " ")}
              </span>{" "}
              <span className="opacity-90">{a.detail}</span>
            </li>
          ))}
        </ul>
      )}

      {(hasHeaderIssue || hasPageOverflow) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-current/20 pt-2 text-xs">
          <span className="font-medium opacity-90">Fix:</span>
          {hasHeaderIssue && (
            <Button
              onClick={runHeaderFix}
              disabled={fixPending}
              size="sm"
              variant="outline"
              className="gap-1.5"
            >
              {fixPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Renaming…
                </>
              ) : (
                <>
                  <Wand2 className="size-3.5" /> Rename non-canonical headers
                </>
              )}
            </Button>
          )}
          {hasPageOverflow && (
            <Button
              render={
                <Link href={`/applications/${applicationId}/edit`} />
              }
              nativeButton={false}
              size="sm"
              variant="outline"
              className="gap-1.5"
            >
              <Pencil className="size-3.5" /> Trim in Edit tab
            </Button>
          )}
          <span className="opacity-70">
            Each fix saves as a new version; re-export to refresh this panel.
          </span>
        </div>
      )}
    </div>
  );
}

const FIX_KIND_LABEL: Record<VerifierFix["kind"], string> = {
  soften: "Soften claim",
  drop: "Drop claim",
  add_kb_fact: "Add KB fact",
};

const FIX_KIND_BADGE: Record<VerifierFix["kind"], string> = {
  soften: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  drop: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  add_kb_fact: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
};

const CONFIDENCE_LABEL: Record<VerifierFix["confidence"], string> = {
  high: "high",
  medium: "medium",
  low: "low",
};

function VerifierIssueRow({
  applicationId,
  issue,
}: {
  applicationId: string;
  issue: VerifierIssue;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<VerifierFixResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function suggestFix() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const r = await suggestVerifierFixAction(
        applicationId,
        issue.claim,
        issue.reason,
      );
      if (!r.ok) {
        setError(r.error);
        toast.error(`Suggest-fix failed: ${r.error}`);
        return;
      }
      setResult(r.result);
      toast.success(
        `Suggested ${r.result.fixes.length} fix${r.result.fixes.length === 1 ? "" : "es"} · ${r.result.factsRetrieved} KB facts retrieved · $${r.result.costUsd.toFixed(4)}`,
      );
    });
  }

  return (
    <li
      className={cn(
        "rounded-md border bg-card p-3",
        issue.severity === "critical" && "border-destructive/30",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Badge
          variant="outline"
          className={cn(
            issue.severity === "critical"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
          )}
        >
          {issue.severity}
        </Badge>
        {!result && (
          <Button
            onClick={suggestFix}
            disabled={pending}
            variant="outline"
            size="sm"
            className="gap-1.5"
          >
            {pending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Thinking…
              </>
            ) : (
              <>
                <Sparkles className="size-3.5" /> Suggest a fix
              </>
            )}
          </Button>
        )}
      </div>
      <p className="mt-1 italic">&ldquo;{issue.claim}&rdquo;</p>
      <p className="mt-1 text-xs text-muted-foreground">{issue.reason}</p>

      {error && (
        <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            Root cause:{" "}
            <span className="font-medium">
              {result.rootCause.replace(/_/g, " ")}
            </span>{" "}
            · grounded in {result.factsRetrieved} retrieved fact{result.factsRetrieved === 1 ? "" : "s"}
          </p>
          {result.fixes.map((fix, i) => (
            <FixSuggestion
              key={i}
              applicationId={applicationId}
              fix={fix}
            />
          ))}
        </div>
      )}
    </li>
  );
}

function FixSuggestion({
  applicationId,
  fix,
}: {
  applicationId: string;
  fix: VerifierFix;
}) {
  const [copied, setCopied] = useState(false);
  const [addingFact, startAddingFact] = useTransition();

  async function copyText() {
    if (!fix.suggestedText) return;
    try {
      await navigator.clipboard.writeText(fix.suggestedText);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't access clipboard");
    }
  }

  function addToKb() {
    if (!fix.suggestedText) return;
    startAddingFact(async () => {
      const r = await addQuickFactsAction({
        text: fix.suggestedText!,
        applicationId,
      });
      if (!r.ok) {
        toast.error(`Add failed: ${r.error}`);
        return;
      }
      toast.success(
        `Added ${r.factCount} new fact${r.factCount === 1 ? "" : "s"} · re-run verifier to recheck`,
      );
    });
  }

  return (
    <div className="rounded-md border bg-background/60 p-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            FIX_KIND_BADGE[fix.kind],
          )}
        >
          {FIX_KIND_LABEL[fix.kind]}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          confidence: {CONFIDENCE_LABEL[fix.confidence]}
        </span>
        <span className="font-medium">{fix.title}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{fix.explanation}</p>
      {fix.locationHint && (
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          In resume: &ldquo;{fix.locationHint}&rdquo;
        </p>
      )}
      {fix.suggestedText && (
        <div className="mt-2 rounded border border-border/60 bg-background p-2">
          <p className="whitespace-pre-wrap font-mono text-xs">
            {fix.suggestedText}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={copyText} variant="ghost" size="sm" className="gap-1.5">
              {copied ? (
                <>
                  <Check className="size-3 text-green-600" /> Copied
                </>
              ) : (
                <>
                  <Copy className="size-3" /> Copy
                </>
              )}
            </Button>
            {(fix.kind === "soften" || fix.kind === "drop") && (
              <Button
                render={
                  <Link href={`/applications/${applicationId}/edit`} />
                }
                nativeButton={false}
                variant="outline"
                size="sm"
                className="gap-1.5"
              >
                <Pencil className="size-3" /> Apply in Edit tab
              </Button>
            )}
            {fix.kind === "add_kb_fact" && (
              <Button
                onClick={addToKb}
                disabled={addingFact}
                variant="outline"
                size="sm"
                className="gap-1.5"
              >
                {addingFact ? (
                  <>
                    <Loader2 className="size-3 animate-spin" /> Adding…
                  </>
                ) : (
                  <>
                    <Plus className="size-3" /> Add to KB
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
