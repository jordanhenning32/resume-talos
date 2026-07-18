import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { factTypeValues, kbFacts } from "@/db/schema";
import { internalServerErrorResponse } from "@/lib/api/errors";
import { embedText } from "@/lib/models/embed";

export const runtime = "nodejs";

const BodySchema = z.object({
  factType: z.enum(factTypeValues),
  content: z.string().min(8).max(800),
  evidenceQuote: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { factType, content, evidenceQuote, metadata } = parsed.data;
  try {
    const { embedding, costUsd } = await embedText(content);
    const [row] = await db()
      .insert(kbFacts)
      .values({
        factType,
        content,
        evidenceQuote: evidenceQuote ?? null,
        embedding,
        userAdded: "true",
        metadata: metadata ?? {},
      })
      .returning({ id: kbFacts.id });
    return NextResponse.json({ factId: row.id, costUsd });
  } catch (err) {
    return internalServerErrorResponse("kb/facts", err);
  }
}
