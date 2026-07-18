import {
  getQcStopBlockingItems,
  shouldApproveQcStop,
} from "@/lib/applications/qc-loop";

const deterministicHigh = {
  priority: "high" as const,
};
const consolidatedLow = {
  priority: "low" as const,
};

const blockingItems = getQcStopBlockingItems({
  consolidatedItems: [consolidatedLow],
  deterministicItems: [deterministicHigh],
});

if (blockingItems.length !== 1 || blockingItems[0] !== deterministicHigh) {
  throw new Error(
    `Expected deterministic high-priority feedback to block QC stop: ${JSON.stringify(blockingItems)}`,
  );
}

if (
  shouldApproveQcStop({
    reviewAOverall: 96,
    reviewBOverall: 94,
    consolidatedItems: [consolidatedLow],
    deterministicItems: [deterministicHigh],
  })
) {
  throw new Error("Expected deterministic high-priority feedback to prevent approval.");
}

if (
  !shouldApproveQcStop({
    reviewAOverall: 96,
    reviewBOverall: 94,
    consolidatedItems: [consolidatedLow],
    deterministicItems: [],
  })
) {
  throw new Error("Expected high reviewer scores with no high-priority feedback to approve.");
}

console.log("PASS QC stop gate includes deterministic high-priority feedback.");
