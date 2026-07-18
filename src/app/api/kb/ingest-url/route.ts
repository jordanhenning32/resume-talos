import { NextResponse } from "next/server";
import { z } from "zod";
import { internalServerErrorResponse } from "@/lib/api/errors";
import { ingestSite, ingestUrl } from "@/lib/kb/url-ingest";

export const runtime = "nodejs";
export const maxDuration = 600; // crawling a site can take a few minutes

const BodySchema = z.object({
  url: z.string().url(),
  crawl: z.boolean().optional().default(false),
  kind: z.enum(["facts", "voice"]).optional(),
  mode: z.enum(["default", "force_overwrite", "merge"]).optional(),
  sectionContext: z
    .object({
      company: z.string(),
      role: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    })
    .optional(),
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
  const { url, crawl, kind, mode, sectionContext } = parsed.data;

  try {
    if (crawl) {
      const summary = await ingestSite(url, { kind, mode, sectionContext });
      return NextResponse.json({ mode: "crawl", ...summary });
    }
    const result = await ingestUrl(url, { kind, mode, sectionContext });
    if (result.status === "error") {
      return NextResponse.json({ mode: "single", ...result }, { status: 502 });
    }
    return NextResponse.json({ mode: "single", ...result });
  } catch (err) {
    return internalServerErrorResponse("kb/ingest-url", err);
  }
}
