"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { ledgerEntries } from "@/db/schema";
import { parseLedgerCsv, type ParseError } from "@/lib/csv/parse-ledger";

const MAX_BYTES = 5 * 1024 * 1024;

type UploadResult =
  | { ok: true; inserted: number; errors: ParseError[] }
  | { ok: false; error: string };

export async function uploadLedgerCsv(formData: FormData): Promise<UploadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "No file provided." };
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return { ok: false, error: "File must be a .csv." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "File exceeds 5 MB limit." };
  }

  try {
    const text = await file.text();
    const { entries, errors } = parseLedgerCsv(text);

    if (entries.length === 0) {
      return {
        ok: true,
        inserted: 0,
        errors,
      };
    }

    await db.insert(ledgerEntries).values(
      entries.map((e) => ({
        userId: user.id,
        date: e.date,
        description: e.description,
        amount: e.amount,
        account: e.account,
        reference: e.reference,
        rawRow: e.rawRow,
      })),
    );

    revalidatePath("/dashboard");
    return { ok: true, inserted: entries.length, errors };
  } catch (err) {
    console.error("uploadLedgerCsv failed", err);
    return { ok: false, error: "Could not process the uploaded file." };
  }
}
