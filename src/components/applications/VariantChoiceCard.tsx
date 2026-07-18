"use client";

import { useTransition } from "react";
import { ArrowRight, Check, FileText } from "lucide-react";
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
import { selectVariantAction } from "@/app/applications/[id]/actions";

export type ResumeVariant = "long" | "short";

export function VariantChoiceCard({
  applicationId,
  current,
  recommendation,
  recommendationWhy,
}: {
  applicationId: string;
  current: ResumeVariant | null;
  recommendation: ResumeVariant;
  recommendationWhy: string;
}) {
  const [pending, startTransition] = useTransition();

  function pick(variant: ResumeVariant) {
    startTransition(async () => {
      try {
        await selectVariantAction(applicationId, variant);
        toast.success(`Selected ${variant === "long" ? "long" : "short"} variant.`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Card className={current ? "" : "border-primary/30"}>
      <CardHeader>
        <CardTitle>
          {current ? "Variant selected" : "Pick a resume variant"}
        </CardTitle>
        <CardDescription>
          {current
            ? "You can change this later by re-selecting before drafts begin."
            : `Talos recommends ${recommendation === "long" ? "Long" : "Short"} for this role. ${recommendationWhy}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <VariantTile
            variant="short"
            current={current}
            recommended={recommendation === "short"}
            pending={pending}
            onPick={pick}
            title="Short — one page"
            specs={[
              "~350-450 words",
              "5-7 bullets per recent role",
              "Tight skills + 1 highlighted project",
              "Best when the JD/culture rewards brevity (commercial tech, fast-moving startups, IC roles)",
            ]}
          />
          <VariantTile
            variant="long"
            current={current}
            recommended={recommendation === "long"}
            pending={pending}
            onPick={pick}
            title="Long — two pages"
            specs={[
              "~700-900 words",
              "Deeper bullets per role with metrics + context",
              "Room for early-career roles + military + projects + certifications",
              "Best for senior federal/exec roles and roles where breadth signals fit",
            ]}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function VariantTile({
  variant,
  current,
  recommended,
  pending,
  onPick,
  title,
  specs,
}: {
  variant: ResumeVariant;
  current: ResumeVariant | null;
  recommended: boolean;
  pending: boolean;
  onPick: (v: ResumeVariant) => void;
  title: string;
  specs: string[];
}) {
  const isSelected = current === variant;
  return (
    <div
      className={cn(
        "flex flex-col rounded-md border p-4 transition-colors",
        isSelected
          ? "border-primary bg-primary/5"
          : "border-border hover:bg-muted/30",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          <span className="font-medium">{title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {recommended && !isSelected && (
            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300">
              Recommended
            </Badge>
          )}
          {isSelected && (
            <Badge variant="outline" className="border-primary/40 bg-primary/10 text-[10px] text-primary">
              <Check className="mr-0.5 size-3" /> Selected
            </Badge>
          )}
        </div>
      </div>
      <ul className="mt-3 flex-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        {specs.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <Button
        size="sm"
        variant={isSelected ? "default" : "outline"}
        disabled={pending || isSelected}
        onClick={() => onPick(variant)}
        className="mt-4 gap-1.5"
      >
        {isSelected ? (
          <>
            <Check className="size-3.5" /> Selected
          </>
        ) : (
          <>
            Choose {variant === "long" ? "long" : "short"} <ArrowRight className="size-3.5" />
          </>
        )}
      </Button>
    </div>
  );
}
