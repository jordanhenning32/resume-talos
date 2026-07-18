"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteApplicationAction } from "@/app/applications/[id]/actions";

export function DeleteApplicationButton({
  id,
  role,
  company,
}: {
  id: string;
  role: string;
  company: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground opacity-60 transition-opacity hover:bg-destructive/10 hover:text-destructive hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={`Delete ${role} at ${company}`}
            title="Delete application"
          />
        }
      >
        <Trash2 className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this application?</DialogTitle>
          <DialogDescription>
            Permanently removes{" "}
            <span className="font-medium">{role}</span> at{" "}
            <span className="font-medium">{company}</span> along with every
            version, QC review, and agent-run record. KB facts and market
            research are NOT affected. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const r = await deleteApplicationAction(id);
                if (!r.ok) {
                  toast.error(`Delete failed: ${r.error}`);
                  return;
                }
                toast.success(`Deleted ${role} at ${company}.`);
                setOpen(false);
                router.refresh();
              });
            }}
          >
            {pending ? "Deleting…" : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
