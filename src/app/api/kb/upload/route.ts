import { NextResponse } from "next/server";
import { internalServerErrorResponse } from "@/lib/api/errors";
import { ingestDocument, type DocumentKind, type IngestMode } from "@/lib/kb/ingest";
import { fileTypeFromName } from "@/lib/kb/parsers";

export const runtime = "nodejs";
export const maxDuration = 300; // up to 5 min on Vercel Pro; safe locally

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid multipart body." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing 'file' field in form data." },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${file.size} bytes, max ${MAX_BYTES}).` },
      { status: 413 },
    );
  }

  const fileType = fileTypeFromName(file.name);
  if (!fileType) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.name}. Use PDF, DOCX, TXT, or MD.` },
      { status: 415 },
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const kindRaw = formData.get("kind");
  const kind: DocumentKind | undefined =
    typeof kindRaw === "string" && (kindRaw === "voice" || kindRaw === "facts")
      ? kindRaw
      : undefined;
  const modeRaw = formData.get("mode");
  const mode: IngestMode | undefined =
    typeof modeRaw === "string" &&
    (modeRaw === "default" || modeRaw === "force_overwrite" || modeRaw === "merge")
      ? modeRaw
      : undefined;

  try {
    const result = await ingestDocument({
      name: file.name,
      fileType,
      buffer,
      kind,
      mode,
    });
    return NextResponse.json(result);
  } catch (err) {
    return internalServerErrorResponse("kb/upload", err);
  }
}
