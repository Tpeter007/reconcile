"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runDeterministicMatching } from "@/lib/matching/deterministic";

type RunMatchingResult =
  | { ok: true; created: number; skipped: number }
  | { ok: false; error: string };

export async function runMatchingAction(): Promise<RunMatchingResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Not authenticated." };
  }

  try {
    const { created, skipped } = await runDeterministicMatching(user.id);
    revalidatePath("/dashboard");
    return { ok: true, created, skipped };
  } catch (err) {
    console.error("runMatchingAction failed", err);
    return { ok: false, error: "Could not run matching." };
  }
}
