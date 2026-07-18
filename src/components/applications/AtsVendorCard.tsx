import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Server,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  detectAtsVendor,
  type AtsRiskLevel,
  type AtsVendorDetection,
} from "@/lib/agents/ats-vendor";
import { JdUrlPasteForm } from "./JdUrlPasteForm";

export function AtsVendorCard({
  applicationId,
  jdUrl,
}: {
  applicationId: string;
  jdUrl: string | null;
}) {
  const detection = detectAtsVendor(jdUrl);
  return (
    <AtsVendorCardInner
      applicationId={applicationId}
      detection={detection}
      jdUrl={jdUrl}
    />
  );
}

const RISK_STYLE: Record<
  AtsRiskLevel,
  { icon: typeof CheckCircle2; color: string; cardClass: string; label: string }
> = {
  low: {
    icon: CheckCircle2,
    color: "text-green-600 dark:text-green-400",
    cardClass: "border-green-500/20 bg-green-500/5",
    label: "Low risk",
  },
  medium: {
    icon: HelpCircle,
    color: "text-blue-600 dark:text-blue-400",
    cardClass: "border-blue-500/20 bg-blue-500/5",
    label: "Medium risk",
  },
  high: {
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-400",
    cardClass: "border-amber-500/30 bg-amber-500/5",
    label: "High risk",
  },
  critical: {
    icon: AlertOctagon,
    color: "text-destructive",
    cardClass: "border-destructive/40 bg-destructive/5",
    label: "Critical",
  },
};

function AtsVendorCardInner({
  applicationId,
  detection,
  jdUrl,
}: {
  applicationId: string;
  detection: AtsVendorDetection;
  jdUrl: string | null;
}) {
  const style = RISK_STYLE[detection.rules.riskLevel];
  const Icon = style.icon;
  const hasUrl = Boolean(jdUrl && jdUrl.trim());

  return (
    <Card className={cn("border", style.cardClass)}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="size-4" /> Target ATS: {detection.displayName}
          </CardTitle>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              style.color,
              "border-current/40",
            )}
          >
            <Icon className="size-3" /> {style.label}
          </span>
        </div>
        <CardDescription>
          {hasUrl && detection.confidence === "high"
            ? `Detected from JD URL (${detection.matchedDomain}). Vendor-specific quirks below — Resume Talos exporter follows them by default but you may want to verify on submission.`
            : hasUrl
              ? `Couldn't recognize the ATS from this URL (${detection.matchedDomain ?? "unknown host"}). Falling back to conservative single-column guidance.`
              : `No JD URL on this application yet. Paste one below to get vendor-specific guidance — or skip if you don't have it.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasUrl && (
          <JdUrlPasteForm applicationId={applicationId} />
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Layout advice:</span>
          <LayoutChip
            label="Classic"
            kind={
              detection.rules.recommendedLayouts.includes("classic")
                ? "good"
                : detection.rules.discouragedLayouts.includes("classic")
                  ? "bad"
                  : "neutral"
            }
          />
          <LayoutChip
            label="Executive"
            kind={
              detection.rules.recommendedLayouts.includes("executive")
                ? "good"
                : detection.rules.discouragedLayouts.includes("executive")
                  ? "bad"
                  : "neutral"
            }
          />
          <LayoutChip
            label="Modern Two-Column"
            kind={
              detection.rules.recommendedLayouts.includes("modern-two-column")
                ? "good"
                : detection.rules.discouragedLayouts.includes("modern-two-column")
                  ? "bad"
                  : "neutral"
            }
          />
        </div>
        <ul className="space-y-1.5 text-sm">
          {detection.rules.warnings.map((w, i) => (
            <li key={i} className="leading-snug">
              <span className="font-medium">{w.rule}.</span>{" "}
              <span className="text-muted-foreground">{w.why}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function LayoutChip({
  label,
  kind,
}: {
  label: string;
  kind: "good" | "bad" | "neutral";
}) {
  const cls =
    kind === "good"
      ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300"
      : kind === "bad"
        ? "border-destructive/40 bg-destructive/10 text-destructive line-through decoration-current/60"
        : "border-border bg-muted/40 text-muted-foreground";
  const prefix = kind === "good" ? "✓ " : kind === "bad" ? "✗ " : "? ";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] tabular-nums",
        cls,
      )}
    >
      {prefix}
      {label}
    </span>
  );
}
