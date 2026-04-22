"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import {
  bankAccounts,
  ledgerEntries,
  matches,
  plaidItems,
  transactions,
} from "@/db/schema";

type ActionResult = { ok: true } | { ok: false; error: string };

async function getUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function acceptMatch(matchId: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  const rows = await db
    .select({ id: matches.id, userId: matches.userId, state: matches.state })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  const row = rows[0];

  if (!row) return { ok: false, error: "Match not found." };
  if (row.userId !== userId) return { ok: false, error: "Not your match." };
  if (row.state !== "proposed") {
    return { ok: false, error: `Match is already ${row.state}.` };
  }

  try {
    await db
      .update(matches)
      .set({ state: "confirmed" })
      .where(eq(matches.id, matchId));
  } catch (err) {
    console.error("acceptMatch update failed", err);
    return { ok: false, error: "Could not accept match." };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}

export async function rejectMatch(matchId: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  const rows = await db
    .select({ id: matches.id, userId: matches.userId, state: matches.state })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  const row = rows[0];

  if (!row) return { ok: false, error: "Match not found." };
  if (row.userId !== userId) return { ok: false, error: "Not your match." };
  if (row.state !== "proposed") {
    return { ok: false, error: `Match is already ${row.state}.` };
  }

  try {
    await db
      .update(matches)
      .set({ state: "rejected" })
      .where(eq(matches.id, matchId));
  } catch (err) {
    console.error("rejectMatch update failed", err);
    return { ok: false, error: "Could not reject match." };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}

export async function unmatchConfirmed(matchId: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  const rows = await db
    .select({ id: matches.id, userId: matches.userId, state: matches.state })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  const row = rows[0];

  if (!row) return { ok: false, error: "Match not found." };
  if (row.userId !== userId) return { ok: false, error: "Not your match." };
  if (row.state !== "confirmed") {
    return { ok: false, error: `Match is not confirmed (${row.state}).` };
  }

  try {
    await db.delete(matches).where(eq(matches.id, matchId));
  } catch (err) {
    console.error("unmatchConfirmed delete failed", err);
    return { ok: false, error: "Could not unmatch." };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}

export async function createManualMatch(
  bankTransactionId: string,
  ledgerEntryId: string,
): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  const bankOwner = await db
    .select({ id: transactions.id })
    .from(transactions)
    .innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
    .innerJoin(plaidItems, eq(bankAccounts.plaidItemId, plaidItems.id))
    .where(
      and(
        eq(transactions.id, bankTransactionId),
        eq(plaidItems.userId, userId),
      ),
    )
    .limit(1);
  if (bankOwner.length === 0) {
    return { ok: false, error: "Bank transaction not found." };
  }

  const ledgerOwner = await db
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(
      and(eq(ledgerEntries.id, ledgerEntryId), eq(ledgerEntries.userId, userId)),
    )
    .limit(1);
  if (ledgerOwner.length === 0) {
    return { ok: false, error: "Ledger entry not found." };
  }

  const existingBank = await db
    .select({ id: matches.id })
    .from(matches)
    .where(
      and(
        eq(matches.bankTransactionId, bankTransactionId),
        ne(matches.state, "rejected"),
      ),
    )
    .limit(1);
  if (existingBank.length > 0) {
    return {
      ok: false,
      error: "This bank transaction is already matched.",
    };
  }

  const existingLedger = await db
    .select({ id: matches.id })
    .from(matches)
    .where(
      and(
        eq(matches.ledgerEntryId, ledgerEntryId),
        ne(matches.state, "rejected"),
      ),
    )
    .limit(1);
  if (existingLedger.length > 0) {
    return {
      ok: false,
      error: "This ledger entry is already matched.",
    };
  }

  try {
    await db.insert(matches).values({
      userId,
      bankTransactionId,
      ledgerEntryId,
      method: "manual_v1",
      confidence: "1.000",
      state: "confirmed",
      createdBy: userId,
    });
  } catch (err) {
    console.error("createManualMatch insert failed", err);
    return {
      ok: false,
      error: "Could not create match — it may have just been matched elsewhere.",
    };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
