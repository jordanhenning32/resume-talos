"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function PinFactToggle({
  factId,
  pinned,
}: {
  factId: string;
  pinned: boolean | string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isPinned = pinned === true || pinned === "true";

  function toggle() {
    startTransition(async () => {
      const res = await fetch(`/api/kb/facts/${factId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned: isPinned ? "false" : "true" }),
      });
      if (!res.ok) {
        toast.error("Could not update pin state.");
        return;
      }
      toast.success(isPinned ? "Fact unpinned." : "Fact pinned.");
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={toggle}
      disabled={pending}
      title={isPinned ? "Unpin fact" : "Pin fact"}
      aria-label={isPinned ? "Unpin fact" : "Pin fact"}
    >
      {isPinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
    </Button>
  );
}
