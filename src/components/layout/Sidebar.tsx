"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase,
  Database,
  LayoutDashboard,
  Settings as SettingsIcon,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/applications", label: "Applications", icon: Briefcase },
  { href: "/knowledge-base", label: "Knowledge Base", icon: Database },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-2 border-b px-5">
        <div className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground">
          <Shield className="size-5" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-semibold tracking-tight">Resume Talos</span>
          <span className="text-xs text-muted-foreground">
            bronze guardian
          </span>
        </div>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Quality gates</p>
        <ul className="mt-1 space-y-0.5">
          <li>• Fit ≥ threshold</li>
          <li>• Both reviewers &gt; 90</li>
          <li>• Verifier passes</li>
        </ul>
      </div>
    </aside>
  );
}
