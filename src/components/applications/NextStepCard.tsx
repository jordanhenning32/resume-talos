import { ArrowRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function NextStepCard({
  title,
  description,
  badge,
}: {
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <Card className="border-dashed bg-muted/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
          <ArrowRight className="size-4" /> Next: {title}
          {badge && (
            <span className="rounded-md border bg-card px-1.5 py-0.5 text-[10px] uppercase text-foreground">
              {badge}
            </span>
          )}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        Step in progress will replace this card with its own gate when it ships.
      </CardContent>
    </Card>
  );
}
