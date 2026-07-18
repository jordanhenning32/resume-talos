import {
  FitScoreSchema,
  isFitScoreSchemaFailure,
} from "@/lib/agents/fit-scorer";

const parsed = FitScoreSchema.parse({
  overall: 92,
  dimensions: [
    {
      name: "Required experience match",
      score: 95,
      reasoning: "The candidate directly matches the required domain and delivery scope.",
    },
    {
      name: "Skill alignment",
      score: 90,
      reasoning: "The candidate has grounded evidence for the important technical skills.",
    },
    {
      name: "Seniority match",
      score: 92,
      reasoning: "The candidate's leadership level aligns with the role expectations.",
    },
    {
      name: "Domain/industry alignment",
      score: 93,
      reasoning: "The candidate has direct federal benefits technology experience.",
    },
  ],
  topStrengths: [
    "Direct federal benefits technology delivery experience.",
    "Grounded evidence for product leadership and stakeholder management.",
  ],
  topGaps: [],
  reasoning:
    "The candidate is a strong fit because the required domain, seniority, and delivery expectations are all supported by the available facts. No material gaps are evident from this synthetic score object.",
  recommendation: "strong_proceed",
});

if (parsed.topGaps.length !== 0) {
  throw new Error("Expected fit score schema to allow empty topGaps.");
}

if (
  !isFitScoreSchemaFailure(
    new Error("No object generated: response did not match schema."),
  )
) {
  throw new Error("Expected schema-generation error to trigger fit scorer fallback.");
}

if (isFitScoreSchemaFailure(new Error("network unavailable"))) {
  throw new Error("Expected unrelated errors to bypass fit scorer fallback.");
}

console.log("PASS fit scorer schema allows no-gap scores and detects schema retry errors.");
