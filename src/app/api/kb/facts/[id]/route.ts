import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { kbFacts } from "@/db/schema";
import { internalServerErrorResponse } from "@/lib/api/errors";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as
    | {
        company?: unknown;
        role?: unknown;
        startDate?: unknown;
        endDate?: unknown;
        pinned?: unknown;
      }
    | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const metaPatch: Record<string, string> = {};
  for (const key of ["company", "role", "startDate", "endDate"] as const) {
    const value = body[key];
    if (typeof value === "string" && value.trim().length > 0) {
      metaPatch[key] = value.trim();
    }
  }

  let pinned: "true" | "false" | undefined;
  if (body.pinned !== undefined) {
    if (body.pinned === true || body.pinned === "true") pinned = "true";
    else if (body.pinned === false || body.pinned === "false") pinned = "false";
    else return NextResponse.json({ error: "pinned must be true or false." }, { status: 400 });
  }

  let updated: typeof kbFacts.$inferSelect | undefined;
  try {
    [updated] = await db()
      .update(kbFacts)
      .set({
        ...(Object.keys(metaPatch).length > 0
          ? { metadata: sql`${kbFacts.metadata} || ${JSON.stringify(metaPatch)}::jsonb` }
          : {}),
        ...(pinned ? { pinned } : {}),
        updatedAt: new Date(),
      })
      .where(eq(kbFacts.id, id))
      .returning();
  } catch (err) {
    return internalServerErrorResponse("kb/facts PATCH", err);
  }

  if (!updated) {
    return NextResponse.json({ error: "fact not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, fact: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let deleted: Array<{ id: string }>;
  try {
    deleted = await db()
      .delete(kbFacts)
      .where(eq(kbFacts.id, id))
      .returning({ id: kbFacts.id });
  } catch (err) {
    return internalServerErrorResponse("kb/facts DELETE", err);
  }
  if (deleted.length === 0) {
    return NextResponse.json({ error: "fact not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, factId: deleted[0].id });
}
