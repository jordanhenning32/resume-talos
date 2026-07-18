import { splitCompoundSkill } from "@/lib/agents/kb-gap-detector";

const CASES = [
  "Jira and Confluence proficiency",
  "Tableau / Power BI",
  "SQL & Python",
  "Microsoft Office and Google Workspace",
  "research and development",
  "monitoring and evaluation",
  "Smartsheet MS Project",
  "Agile, Scrum, and Kanban",
  "bachelor's degree",
  "executive communication",
];

for (const c of CASES) {
  const variants = splitCompoundSkill(c);
  console.log(`"${c}"`);
  if (variants.length === 0) {
    console.log("   (no split)");
  } else {
    for (const v of variants) console.log(`   → ${v}`);
  }
}

const jira = splitCompoundSkill("Jira and Confluence proficiency");
const research = splitCompoundSkill("research and development");
if (!jira.includes("Jira proficiency") || !jira.includes("Confluence proficiency")) {
  throw new Error("Expected Jira/Confluence compound skill to split into proficiency variants.");
}
if (research.length !== 0) {
  throw new Error("Expected idiomatic phrase 'research and development' not to split.");
}
console.log("\nPASS compound skill splitter matched expected split/no-split cases.");
