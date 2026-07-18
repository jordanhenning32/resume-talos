import { countFactsMissingCompany } from "@/lib/kb/queries";

export async function NeedsAttributionFilter({ isActive = false }: { isActive?: boolean }) {
  const count = await countFactsMissingCompany();
  if (count === 0) return null;
  return (
    <a
      href={isActive ? "/knowledge-base" : "?needsAttribution=1"}
      className={
        isActive
          ? "inline-flex items-center gap-1.5 rounded-full border border-amber-600 bg-amber-500 px-3 py-1 text-xs font-medium text-white hover:bg-amber-600"
          : "inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
      }
    >
      Needs attribution ({count})
    </a>
  );
}
