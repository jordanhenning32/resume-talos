"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileCheck2,
  FilePenLine,
  Pencil,
  Send,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = {
  key: string;
  label: string;
  hrefSuffix: string;
  icon: LucideIcon;
};

const TABS: Tab[] = [
  { key: "overview", label: "Overview", hrefSuffix: "", icon: FileCheck2 },
  { key: "draft", label: "Draft", hrefSuffix: "/draft", icon: FilePenLine },
  { key: "edit", label: "Edit", hrefSuffix: "/edit", icon: Pencil },
  { key: "screening", label: "Screening", hrefSuffix: "/screening", icon: ShieldAlert },
  { key: "submit", label: "Submit", hrefSuffix: "/submit", icon: Send },
];

export function ApplicationTabs({ applicationId }: { applicationId: string }) {
  const pathname = usePathname();
  const basePath = `/applications/${applicationId}`;

  function isActive(suffix: string): boolean {
    const href = basePath + suffix;
    if (suffix === "") {
      // Overview is exact match on the base path.
      return pathname === href || pathname === `${href}/`;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav
      className="flex flex-wrap items-center gap-1 rounded-md border bg-card p-1"
      aria-label="Application sections"
    >
      {TABS.map((t) => {
        const active = isActive(t.hrefSuffix);
        const Icon = t.icon;
        return (
          <Link
            key={t.key}
            href={`${basePath}${t.hrefSuffix}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
