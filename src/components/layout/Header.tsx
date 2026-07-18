import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CostMeter } from "@/components/CostMeter";
import { getDashboardStats } from "@/lib/dashboard-stats";
import { isFullyConfigured } from "@/lib/setup-status";

export async function Header() {
  const monthCost = isFullyConfigured()
    ? (await getDashboardStats()).monthCostUsd
    : 0;
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-4 border-b bg-background/80 px-8 backdrop-blur">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Multi-agent resume &amp; cover letter factory
        </h2>
      </div>
      <div className="flex items-center gap-3">
        <CostMeter monthCost={monthCost} />
        <Button render={<Link href="/applications/new" />} nativeButton={false} size="sm" className="gap-1.5">
          <Plus className="size-4" />
          New application
        </Button>
      </div>
    </header>
  );
}
