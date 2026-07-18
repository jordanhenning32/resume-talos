import { resolveDuplicate } from "@/lib/kb/ingest";

type Case = {
  name: string;
  existing: { id: string; userAdded?: string | null; pinned?: string | null };
  opts: { mode: "default" | "force_overwrite" | "merge"; userFacts: boolean };
  expect: "supersede" | "merge" | "skip";
};

const extracted = { id: "x1", userAdded: "false", pinned: "false" };
const userFact = { id: "u1", userAdded: "true", pinned: "false" };
const pinnedFact = { id: "p1", userAdded: "false", pinned: "true" };
const hardcodedPinned = { id: "K-kTU3yyhi4hVsyxWwuS7", userAdded: "false", pinned: "false" };

const cases: Case[] = [
  // The core guarantee: a force_overwrite re-upload must NOT delete a user fact.
  { name: "user fact survives force_overwrite re-upload", existing: userFact, opts: { mode: "force_overwrite", userFacts: false }, expect: "skip" },
  { name: "pinned fact survives force_overwrite", existing: pinnedFact, opts: { mode: "force_overwrite", userFacts: false }, expect: "skip" },
  { name: "pinned fact survives merge", existing: pinnedFact, opts: { mode: "merge", userFacts: false }, expect: "skip" },
  { name: "hardcoded-pinned id survives force_overwrite", existing: hardcodedPinned, opts: { mode: "force_overwrite", userFacts: false }, expect: "skip" },

  // A manual add wins over a colliding machine-extracted fact...
  { name: "user add supersedes extracted dupe", existing: extracted, opts: { mode: "default", userFacts: true }, expect: "supersede" },
  // ...but does not duplicate an existing user fact.
  { name: "user add skips existing user dupe", existing: userFact, opts: { mode: "default", userFacts: true }, expect: "skip" },

  // Existing (non-user) behavior preserved.
  { name: "force_overwrite supersedes extracted", existing: extracted, opts: { mode: "force_overwrite", userFacts: false }, expect: "supersede" },
  { name: "merge merges extracted", existing: extracted, opts: { mode: "merge", userFacts: false }, expect: "merge" },
  { name: "default skips (existing wins)", existing: extracted, opts: { mode: "default", userFacts: false }, expect: "skip" },
];

let failed = 0;
for (const c of cases) {
  const got = resolveDuplicate(c.existing, c.opts);
  if (got !== c.expect) {
    failed++;
    console.error(`FAIL: ${c.name} — expected ${c.expect}, got ${got}`);
  }
}

if (failed > 0) {
  throw new Error(`${failed} case(s) failed.`);
}
console.log(`PASS user-facts protection: ${cases.length} cases — re-upload never deletes user/pinned facts; manual adds supersede extracted dupes.`);
