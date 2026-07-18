import { NextResponse } from "next/server";
import { nanoid } from "nanoid";

export const INTERNAL_ERROR_MESSAGE =
  "An unexpected error occurred. Check the server logs for details.";

export function internalServerErrorResponse(scope: string, err: unknown) {
  const errorId = nanoid(10);
  console.error(`[${scope}] ${errorId}:`, err);
  return NextResponse.json(
    { error: INTERNAL_ERROR_MESSAGE, errorId },
    { status: 500 },
  );
}
