"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateApplicationStatusAction } from "@/app/applications/[id]/actions";
import {
  applicationStatusValues,
  type ApplicationStatus,
} from "@/db/schema";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  draft: "Draft",
  in_progress: "In progress",
  ready: "Ready",
  applied: "Applied",
  phone_screen: "Phone screen",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  ghosted: "Ghosted",
  withdrawn: "Withdrawn",
};

const STATUS_TRIGGER_COLORS: Record<ApplicationStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  ready: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  applied: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  phone_screen: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  interview: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  offer: "bg-green-500/10 text-green-700 dark:text-green-300",
  rejected: "bg-destructive/10 text-destructive",
  ghosted: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  withdrawn: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

export function StatusSelect({
  id,
  status,
  size = "sm",
}: {
  id: string;
  status: ApplicationStatus;
  size?: "sm" | "default";
}) {
  const [pending, startTransition] = useTransition();

  const onChange = (next: string | null) => {
    if (next === null || next === status) return;
    const nextStatus = next as ApplicationStatus;
    startTransition(async () => {
      const res = await updateApplicationStatusAction(id, nextStatus);
      if (!res.ok) {
        toast.error(`Status update failed: ${res.error}`);
      } else {
        toast.success(`Marked as ${STATUS_LABELS[nextStatus]}`);
      }
    });
  };

  return (
    <Select value={status} onValueChange={onChange} disabled={pending}>
      <SelectTrigger
        size={size}
        className={cn(
          "border-transparent text-[10px] font-medium uppercase tracking-wide",
          STATUS_TRIGGER_COLORS[status],
          pending && "opacity-60",
        )}
        aria-label="Change status"
      >
        <SelectValue placeholder="Status" />
      </SelectTrigger>
      <SelectContent>
        {applicationStatusValues.map((s) => (
          <SelectItem key={s} value={s}>
            {STATUS_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
