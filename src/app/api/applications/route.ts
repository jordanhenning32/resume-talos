import { NextResponse } from "next/server";
import { z } from "zod";
import { createAndAnalyzeApplication } from "@/lib/applications/create";
import { internalServerErrorResponse } from "@/lib/api/errors";

export const runtime = "nodejs";
export const maxDuration = 300;

const BodySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("paste"),
    jdText: z.string().min(200),
  }),
  z.object({
    mode: z.literal("url"),
    jdUrl: z.string().url(),
  }),
]);

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
  try {
    const result = await createAndAnalyzeApplication(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    return internalServerErrorResponse("applications POST", err);
  }
}
