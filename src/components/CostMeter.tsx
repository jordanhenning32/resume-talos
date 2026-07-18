import { DollarSign } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Placeholder for the cost meter — will read from `agent_runs` table once
// applications start producing data.
export function CostMeter({
  monthCost = 0,
  sessionCost = 0,
}: {
  monthCost?: number;
  sessionCost?: number;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<div />}
        className="flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs text-muted-foreground"
      >
        <DollarSign className="size-3.5" />
        <span className="font-mono tabular-nums">{monthCost.toFixed(2)}</span>
        <span className="text-[10px] uppercase tracking-wide">/ month</span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-0.5 text-xs">
          <div>Session: ${sessionCost.toFixed(4)}</div>
          <div>Month-to-date: ${monthCost.toFixed(4)}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
