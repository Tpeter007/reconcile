import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  ledgerEntries,
  matches,
  plaidItems,
  transactions,
} from "@/db/schema";

const METHOD = "deterministic_v1";
const MAX_DATE_DELTA_DAYS = 3;

type Candidate = {
  id: string;
  date: string;
  amountCents: number;
  createdAt: Date;
};

function toCents(amount: string): number {
  return Math.round(Number(amount) * 100);
}

function dateDiffDays(a: string, b: string): number {
  const aMs = Date.UTC(
    Number(a.slice(0, 4)),
    Number(a.slice(5, 7)) - 1,
    Number(a.slice(8, 10)),
  );
  const bMs = Date.UTC(
    Number(b.slice(0, 4)),
    Number(b.slice(5, 7)) - 1,
    Number(b.slice(8, 10)),
  );
  return Math.round((aMs - bMs) / (24 * 60 * 60 * 1000));
}

function sameDirection(a: number, b: number): boolean {
  return Math.sign(a) === Math.sign(b);
}

function sameMagnitude(a: number, b: number): boolean {
  return Math.abs(a) === Math.abs(b);
}

export async function runDeterministicMatching(
  userId: string,
): Promise<{ created: number; skipped: number }> {
  const bankRows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
    .innerJoin(plaidItems, eq(bankAccounts.plaidItemId, plaidItems.id))
    .leftJoin(matches, eq(matches.bankTransactionId, transactions.id))
    .where(and(eq(plaidItems.userId, userId), isNull(matches.id)));

  const ledgerRows = await db
    .select({
      id: ledgerEntries.id,
      date: ledgerEntries.date,
      amount: ledgerEntries.amount,
      createdAt: ledgerEntries.createdAt,
    })
    .from(ledgerEntries)
    .leftJoin(matches, eq(matches.ledgerEntryId, ledgerEntries.id))
    .where(and(eq(ledgerEntries.userId, userId), isNull(matches.id)));

  const bankCandidates: Candidate[] = bankRows.map((r) => ({
    id: r.id,
    date: r.date,
    amountCents: toCents(r.amount),
    createdAt: r.createdAt,
  }));
  const ledgerCandidates: Candidate[] = ledgerRows.map((r) => ({
    id: r.id,
    date: r.date,
    amountCents: toCents(r.amount),
    createdAt: r.createdAt,
  }));

  const usedLedger = new Set<string>();
  const toInsert: {
    userId: string;
    bankTransactionId: string;
    ledgerEntryId: string;
    method: string;
    state: "confirmed";
  }[] = [];
  let skipped = 0;

  for (const bank of bankCandidates) {
    const candidates = ledgerCandidates.filter((l) => {
      if (usedLedger.has(l.id)) return false;
      if (!sameDirection(l.amountCents, bank.amountCents)) return false;
      if (!sameMagnitude(l.amountCents, bank.amountCents)) return false;
      if (Math.abs(dateDiffDays(l.date, bank.date)) > MAX_DATE_DELTA_DAYS) {
        return false;
      }
      return true;
    });

    if (candidates.length === 0) {
      skipped++;
      continue;
    }

    candidates.sort((a, b) => {
      const aDelta = Math.abs(dateDiffDays(a.date, bank.date));
      const bDelta = Math.abs(dateDiffDays(b.date, bank.date));
      if (aDelta !== bDelta) return aDelta - bDelta;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const pick = candidates[0];
    usedLedger.add(pick.id);
    toInsert.push({
      userId,
      bankTransactionId: bank.id,
      ledgerEntryId: pick.id,
      method: METHOD,
      state: "confirmed",
    });
  }

  if (toInsert.length === 0) {
    return { created: 0, skipped };
  }

  try {
    const inserted = await db
      .insert(matches)
      .values(toInsert)
      .onConflictDoNothing()
      .returning({ id: matches.id });
    return { created: inserted.length, skipped };
  } catch (err) {
    console.error("runDeterministicMatching insert failed", err);
    return { created: 0, skipped };
  }
}
