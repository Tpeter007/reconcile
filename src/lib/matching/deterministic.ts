import { and, eq, ne, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  ledgerEntries,
  matches,
  plaidItems,
  qboEntries,
  transactions,
} from "@/db/schema";

const METHOD = "deterministic_v1";
const MAX_DATE_DELTA_DAYS = 3;

type CounterpartySource = "ledger" | "qbo";

type Candidate = {
  id: string;
  source: CounterpartySource;
  date: string;
  amountCents: number;
  createdAt: Date;
};

type BankCandidate = {
  id: string;
  date: string;
  amountCents: number;
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
    })
    .from(transactions)
    .innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
    .innerJoin(plaidItems, eq(bankAccounts.plaidItemId, plaidItems.id))
    .where(
      and(
        eq(plaidItems.userId, userId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(matches)
            .where(
              and(
                eq(matches.bankTransactionId, transactions.id),
                ne(matches.state, "rejected"),
              ),
            ),
        ),
      ),
    );

  const ledgerRows = await db
    .select({
      id: ledgerEntries.id,
      date: ledgerEntries.date,
      amount: ledgerEntries.amount,
      createdAt: ledgerEntries.createdAt,
    })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(matches)
            .where(
              and(
                eq(matches.ledgerEntryId, ledgerEntries.id),
                ne(matches.state, "rejected"),
              ),
            ),
        ),
      ),
    );

  const qboRows = await db
    .select({
      id: qboEntries.id,
      date: qboEntries.date,
      amount: qboEntries.amount,
      createdAt: qboEntries.createdAt,
    })
    .from(qboEntries)
    .where(
      and(
        eq(qboEntries.userId, userId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(matches)
            .where(
              and(
                eq(matches.qboEntryId, qboEntries.id),
                ne(matches.state, "rejected"),
              ),
            ),
        ),
      ),
    );

  const bankCandidates: BankCandidate[] = bankRows.map((r) => ({
    id: r.id,
    date: r.date,
    amountCents: toCents(r.amount),
  }));
  const counterpartyCandidates: Candidate[] = [
    ...ledgerRows.map<Candidate>((r) => ({
      id: r.id,
      source: "ledger",
      date: r.date,
      amountCents: toCents(r.amount),
      createdAt: r.createdAt,
    })),
    ...qboRows.map<Candidate>((r) => ({
      id: r.id,
      source: "qbo",
      date: r.date,
      amountCents: toCents(r.amount),
      createdAt: r.createdAt,
    })),
  ];

  const usedByKey = new Set<string>();
  const toInsert: {
    userId: string;
    bankTransactionId: string;
    ledgerEntryId: string | null;
    qboEntryId: string | null;
    method: string;
    state: "confirmed";
  }[] = [];
  let skipped = 0;

  for (const bank of bankCandidates) {
    const candidates = counterpartyCandidates.filter((c) => {
      if (usedByKey.has(`${c.source}|${c.id}`)) return false;
      if (!sameDirection(c.amountCents, bank.amountCents)) return false;
      if (!sameMagnitude(c.amountCents, bank.amountCents)) return false;
      if (Math.abs(dateDiffDays(c.date, bank.date)) > MAX_DATE_DELTA_DAYS) {
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
      const created = a.createdAt.getTime() - b.createdAt.getTime();
      if (created !== 0) return created;
      // Prefer QBO over CSV when everything else ties.
      if (a.source === b.source) return 0;
      return a.source === "qbo" ? -1 : 1;
    });

    const pick = candidates[0];
    usedByKey.add(`${pick.source}|${pick.id}`);
    toInsert.push({
      userId,
      bankTransactionId: bank.id,
      ledgerEntryId: pick.source === "ledger" ? pick.id : null,
      qboEntryId: pick.source === "qbo" ? pick.id : null,
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
