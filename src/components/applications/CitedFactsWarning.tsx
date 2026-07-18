"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { rederiveCitedFactsAction } from "@/app/applications/[id]/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function CitedFactsWarning({
  versionId,
  citedFactIdsCount,
}: {
  versionId: string;
  citedFactIdsCount: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  if (!versionId || citedFactIdsCount >= 10) return null;

  function rederive() {
    setError(null);
    startTransition(async () => {
      const result = await rederiveCitedFactsAction(versionId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            Only {citedFactIdsCount} cited facts on this version (&lt; 10 threshold). Citations may be incomplete.
            {error && <div className="mt-1 text-xs text-destructive">{error}</div>}
          </div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={rederive} disabled={isPending}>
          {isPending && <Loader2 className="size-3.5 animate-spin" />}
          Re-derive citations
        </Button>
      </CardContent>
    </Card>
  );
}
