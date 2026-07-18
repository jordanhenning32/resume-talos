"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  HelpCircle,
  Loader2,
  MessageSquareText,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { runQuestionnaireHelperAction } from "@/app/applications/[id]/actions";
import type {
  AnswerConfidence,
  QuestionAnswer,
  QuestionnaireResult,
} from "@/lib/agents/questionnaire-helper";

const CONFIDENCE_STYLE: Record<
  AnswerConfidence,
  {
    icon: typeof CheckCircle2;
    label: string;
    color: string;
    rowClass: string;
  }
> = {
  high: {
    icon: CheckCircle2,
    label: "high",
    color: "text-green-600 dark:text-green-400",
    rowClass: "border-green-500/30",
  },
  medium: {
    icon: HelpCircle,
    label: "medium",
    color: "text-blue-600 dark:text-blue-400",
    rowClass: "border-blue-500/30",
  },
  low: {
    icon: AlertTriangle,
    label: "low",
    color: "text-amber-600 dark:text-amber-400",
    rowClass: "border-amber-500/30",
  },
  needs_user_input: {
    icon: XCircle,
    label: "needs user input",
    color: "text-destructive",
    rowClass: "border-destructive/40",
  },
};

export function QuestionnaireHelperCard({
  applicationId,
}: {
  applicationId: string;
}) {
  const [raw, setRaw] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<QuestionnaireResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmedLen = raw.trim().length;
  const canSubmit = trimmedLen >= 8 && !pending;

  function submit() {
    if (!canSubmit) return;
    const snapshot = raw;
    setError(null);
    startTransition(async () => {
      const r = await runQuestionnaireHelperAction(applicationId, snapshot);
      if (!r.ok) {
        setError(r.error);
        toast.error(`Questionnaire helper failed: ${r.error}`);
        return;
      }
      setResult(r.result);
      const counts = countByConfidence(r.result.answers);
      toast.success(
        `Generated ${r.result.answers.length} answer${r.result.answers.length === 1 ? "" : "s"} · ${counts.high} high · ${counts.medium} medium · ${counts.needs_user_input + counts.low} need review · $${r.result.costUsd.toFixed(3)}`,
      );
    });
  }

  return (
    <Card className="border-blue-500/20 bg-blue-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareText className="size-4" /> Screening questions
        </CardTitle>
        <CardDescription>
          Most ATS systems hit you with 5-20 questions AFTER you upload the
          resume. Paste them here and get KB-grounded answers with confidence
          flags so you don&apos;t get filtered out on the salary or sponsorship
          field. Salary and EEO questions are deferred to you on purpose.
          Typical run: 30-90s, $0.05-0.10.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={`Paste the screening questions from the ATS form here. Numbered or blank-line-separated works best.

Examples of what to paste:
1. Are you a U.S. citizen?
2. Do you require sponsorship?
3. Years of federal experience: 0-4 / 5-9 / 10-14 / 15+
4. Describe in 100 words a time you owned P&L for a federal portfolio.
5. Desired salary range?
6. Self-ID (voluntary): protected veteran, disability, race/ethnicity`}
          rows={8}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
          disabled={pending}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={submit} disabled={!canSubmit} size="sm" className="gap-1.5">
            {pending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Generating…
              </>
            ) : (
              <>
                <ClipboardCheck className="size-3.5" /> Generate answers
              </>
            )}
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            {trimmedLen} chars{!canSubmit && trimmedLen > 0 && trimmedLen < 8 && " (need 8+)"}
          </span>
          {result && (
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {result.factsRetrieved} KB facts retrieved · ${result.costUsd.toFixed(4)}
            </span>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {result && result.answers.length > 0 && (
          <ul className="space-y-3 pt-2">
            {result.answers.map((a, i) => (
              <AnswerRow key={i} answer={a} index={i + 1} />
            ))}
          </ul>
        )}

        {result && result.generalNotes.length > 0 && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-sm">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Cross-cutting notes
            </p>
            <ul className="space-y-1.5">
              {result.generalNotes.map((n, i) => (
                <li key={i} className="text-sm leading-snug">
                  · {n}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AnswerRow({
  answer,
  index,
}: {
  answer: QuestionAnswer;
  index: number;
}) {
  const style = CONFIDENCE_STYLE[answer.confidence];
  const Icon = style.icon;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(answer.suggestedAnswer);
      setCopied(true);
      toast.success("Answer copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't access clipboard");
    }
  }

  return (
    <li className={cn("rounded-md border bg-background/40 p-3", style.rowClass)}>
      <div className="flex flex-wrap items-start gap-2">
        <Icon className={cn("mt-0.5 size-4 shrink-0", style.color)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              Q{index}
            </span>
            <span
              className={cn(
                "rounded border border-current/30 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                style.color,
              )}
            >
              {style.label}
            </span>
            <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {answer.questionType.replace(/_/g, " ")}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium leading-snug">
            {answer.question}
          </p>
          <div className="mt-2 rounded border border-border/60 bg-background p-2 text-sm leading-relaxed">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 whitespace-pre-wrap">{answer.suggestedAnswer}</p>
              <Button
                onClick={copy}
                variant="ghost"
                size="icon-sm"
                title="Copy answer"
                className="shrink-0"
              >
                {copied ? (
                  <CheckCircle2 className="size-3.5 text-green-600" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs italic text-muted-foreground">
            {answer.groundingNotes}
          </p>
          {answer.warnings.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {answer.warnings.map((w, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300"
                >
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

function countByConfidence(
  answers: QuestionAnswer[],
): Record<AnswerConfidence, number> {
  const out: Record<AnswerConfidence, number> = {
    high: 0,
    medium: 0,
    low: 0,
    needs_user_input: 0,
  };
  for (const a of answers) out[a.confidence]++;
  return out;
}
