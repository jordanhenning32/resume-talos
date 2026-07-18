"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteDocument } from "@/lib/kb/queries";

export async function deleteDocumentAction(id: string) {
  await deleteDocument(id);
  revalidatePath("/knowledge-base");
  redirect("/knowledge-base");
}
