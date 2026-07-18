import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });

import { runQcLoopForApplication } from "@/lib/applications/qc-loop";

async function main() {
  const appId = process.argv[2] ?? "NQP2fHmUoerjbEEvsuXrw";
  const maxIterations = readMaxIterationsArg();
  console.log(
    `Running QC loop for application ${appId}${maxIterations ? ` with maxIterations=${maxIterations}` : ""}...`,
  );
  const startedAt = Date.now();
  const result = await runQcLoopForApplication(
    appId,
    maxIterations ? { maxIterations } : undefined,
  );
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n=== QC Loop Outcome (${elapsedSec}s) ===`);
  console.log(`Status:         ${result.status}`);
  console.log(`Iterations:     ${result.iterationsRun}`);
  console.log(`Cost (USD):     $${result.costUsd.toFixed(4)}`);
  console.log(`Reason:         ${result.reason}`);
  console.log(`Final version:  v${result.finalVersion.versionNumber}.${result.finalVersion.iteration}  (id=${result.finalVersion.id})`);
}

function readMaxIterationsArg(): number | undefined {
  const maxIndex = process.argv.indexOf("--max-iterations");
  if (maxIndex >= 0) {
    const parsed = Number(process.argv[maxIndex + 1]);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    throw new Error("--max-iterations must be a positive integer");
  }
  return undefined;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
