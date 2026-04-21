"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runDeterministicMatching } from "@/lib/matching/deterministic";
import { runLlmMatching } from "@/lib/matching/llm";

type RunMatchingResult =
  | {
      ok: true;
      deterministic: { created: number; skipped: number };
      llm: { created: number; considered: number; below_threshold: number };
    }
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
    const deterministic = await runDeterministicMatching(user.id);
    const llm = await runLlmMatching(user.id);
    revalidatePath("/dashboard");
    return { ok: true, deterministic, llm };
  } catch (err) {
    console.error("runMatchingAction failed", err);
    return { ok: false, error: "Could not run matching." };
  }
}
