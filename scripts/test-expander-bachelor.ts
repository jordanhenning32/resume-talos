import { buildSkillSearchPhrases } from "@/lib/agents/kb-gap-detector";

const bachelors = buildSkillSearchPhrases("bachelor's degree", [
  "undergraduate credential",
]);

for (const expected of [
  "bachelor's degree",
  "undergraduate credential",
  "Bachelor of Science",
  "Bachelor of Arts",
  "B.S. degree",
  "B.A. degree",
]) {
  if (!bachelors.includes(expected)) {
    throw new Error(
      `Expected bachelor's expansion to include "${expected}": ${JSON.stringify(bachelors)}`,
    );
  }
}

const mba = buildSkillSearchPhrases("Master of Business Administration", []);
for (const expected of ["MBA", "M.B.A.", "Master of Business Administration"]) {
  if (!mba.includes(expected)) {
    throw new Error(
      `Expected MBA expansion to include "${expected}": ${JSON.stringify(mba)}`,
    );
  }
}

console.log("PASS bachelor expansion adds deterministic credential search variants.");
