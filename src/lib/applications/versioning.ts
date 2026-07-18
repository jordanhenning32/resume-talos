import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  applicationVersions,
  type ApplicationVersion,
  type KnockoutReportShape,
  type RecruiterScreenerShape,
} from "@/db/schema";

export type VersionBoundReport =
  | Pick<RecruiterScreenerShape, "resumeVersionId">
  | Pick<KnockoutReportShape, "resumeVersionId">;

export type ApplicationVersionContent = {
  applicationId: string;
  resumeMarkdown: string | null;
  coverLetterMarkdown: string | null;
  citedFactIds: string[];
};

export function isVersionBoundReportFresh(
  report: VersionBoundReport | null | undefined,
  latestVersionId: string | null | undefined,
): boolean {
  if (!report) return false;
  return (report.resumeVersionId ?? null) === (latestVersionId ?? null);
}

export async function clearVersionBoundApplicationCaches(
  applicationId: string,
): Promise<void> {
  await db()
    .update(applications)
    .set({
      recruiterScreenerResult: null,
      recruiterScreenerAt: null,
      knockoutReport: null,
      knockoutReportAt: null,
      updatedAt: new Date(),
    })
    .where(eq(applications.id, applicationId));
}

export async function insertMajorApplicationVersion(
  content: ApplicationVersionContent,
): Promise<ApplicationVersion> {
  const inserted = await retryOnVersionUniqueViolation(async () => {
    const [row] = await db()
      .insert(applicationVersions)
      .values({
        applicationId: content.applicationId,
        versionNumber: sql<number>`(
          select coalesce(max(${applicationVersions.versionNumber}), 0) + 1
          from ${applicationVersions}
          where ${applicationVersions.applicationId} = ${content.applicationId}
        )`,
        iteration: 0,
        resumeMarkdown: content.resumeMarkdown,
        coverLetterMarkdown: content.coverLetterMarkdown,
        citedFactIds: content.citedFactIds,
      })
      .returning();
    return row;
  });

  await clearVersionBoundApplicationCaches(content.applicationId);
  return inserted;
}

export async function insertIterationApplicationVersion(
  content: ApplicationVersionContent & {
    versionNumber: number;
    iteration: number;
  },
): Promise<ApplicationVersion> {
  const [existing] = await db()
    .select({ id: applicationVersions.id })
    .from(applicationVersions)
    .where(
      and(
        eq(applicationVersions.applicationId, content.applicationId),
        eq(applicationVersions.versionNumber, content.versionNumber),
        eq(applicationVersions.iteration, content.iteration),
      ),
    )
    .limit(1);

  if (existing) {
    throw duplicateVersionError(content.versionNumber, content.iteration);
  }

  try {
    const [inserted] = await db()
      .insert(applicationVersions)
      .values({
        applicationId: content.applicationId,
        versionNumber: content.versionNumber,
        iteration: content.iteration,
        resumeMarkdown: content.resumeMarkdown,
        coverLetterMarkdown: content.coverLetterMarkdown,
        citedFactIds: content.citedFactIds,
      })
      .returning();

    await clearVersionBoundApplicationCaches(content.applicationId);
    return inserted;
  } catch (err) {
    if (isVersionUniqueViolation(err)) {
      throw duplicateVersionError(content.versionNumber, content.iteration);
    }
    throw err;
  }
}

async function retryOnVersionUniqueViolation<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isVersionUniqueViolation(err)) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

function duplicateVersionError(versionNumber: number, iteration: number): Error {
  return new Error(
    `Application version ${versionNumber}.${iteration} already exists. Refresh and rerun from the latest version.`,
  );
}

function isVersionUniqueViolation(err: unknown): boolean {
  const maybe = err as { code?: string; constraint?: string; message?: string };
  return (
    maybe.code === "23505" &&
    (maybe.constraint === "application_versions_app_version_iteration_unique" ||
      maybe.message?.includes(
        "application_versions_app_version_iteration_unique",
      ) === true)
  );
}
