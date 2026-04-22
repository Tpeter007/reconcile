import Anthropic from "@anthropic-ai/sdk";
import { and, eq, ne, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  ledgerEntries,
  llmLogs,
  matches,
  plaidItems,
  transactions,
} from "@/db/schema";

const METHOD = "llm_v1";
const MODEL = "claude-sonnet-4-5-20250929";
const PURPOSE = "matching_v1";
const CONFIDENCE_THRESHOLD = 0.7;
const MAX_ROWS_PER_SIDE = 50;
const MAX_OUTPUT_TOKENS = 2048;

type BankRow = {
  id: string;
  date: string;
  description: string;
  amount: string;
  mask: string | null;
  createdAt: Date;
};

type LedgerRow = {
  id: string;
  date: string;
  description: string;
  amount: string;
  account: string | null;
  reference: string | null;
  createdAt: Date;
};

type ProposedPair = {
  bank_transaction_id: string;
  ledger_entry_id: string;
  confidence: number;
  rationale: string;
};

const SYSTEM_PROMPT =
  "You are a bookkeeping assistant matching bank transactions against ledger entries. A match means both rows refer to the same underlying financial event. Return only high-confidence matches. Prefer recall lower than precision.";

const CLOSING_INSTRUCTION =
  "Using the `propose_matches` tool, return pairs where both rows refer to the same real-world transaction. Confidence 0-1. Amount magnitudes must match. Money-flow direction (debit vs credit) must match. Date gap should generally be ≤7 days. Do not force matches when uncertain — omit the pair.";

const TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    pairs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          bank_transaction_id: { type: "string" },
          ledger_entry_id: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string" },
        },
        required: [
          "bank_transaction_id",
          "ledger_entry_id",
          "confidence",
          "rationale",
        ],
      },
    },
  },
  required: ["pairs"],
};

function isProposedPair(value: unknown): value is ProposedPair {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.bank_transaction_id === "string" &&
    typeof v.ledger_entry_id === "string" &&
    typeof v.confidence === "number" &&
    typeof v.rationale === "string"
  );
}

function buildUserMessage(
  bankRows: BankRow[],
  ledgerRows: LedgerRow[],
): string {
  const bankPayload = bankRows.map((r) => ({
    id: r.id,
    date: r.date,
    description: r.description,
    amount: Number(r.amount),
    account_mask: r.mask,
  }));
  const ledgerPayload = ledgerRows.map((r) => ({
    id: r.id,
    date: r.date,
    description: r.description,
    amount: Number(r.amount),
    account: r.account,
    reference: r.reference,
  }));

  return [
    "Match these bank transactions against the ledger entries. Both lists are JSON arrays.",
    "",
    "bank_transactions:",
    "```json",
    JSON.stringify(bankPayload, null, 2),
    "```",
    "",
    "ledger_entries:",
    "```json",
    JSON.stringify(ledgerPayload, null, 2),
    "```",
    "",
    CLOSING_INSTRUCTION,
  ].join("\n");
}

export async function runLlmMatching(
  userId: string,
): Promise<{
  created: number;
  considered: number;
  below_threshold: number;
  excluded_rejected: number;
}> {
  const bankRowsAll: BankRow[] = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      amount: transactions.amount,
      mask: bankAccounts.mask,
      createdAt: transactions.createdAt,
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

  const ledgerRowsAll: LedgerRow[] = await db
    .select({
      id: ledgerEntries.id,
      date: ledgerEntries.date,
      description: ledgerEntries.description,
      amount: ledgerEntries.amount,
      account: ledgerEntries.account,
      reference: ledgerEntries.reference,
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

  const rejectedRows = await db
    .select({
      bankTransactionId: matches.bankTransactionId,
      ledgerEntryId: matches.ledgerEntryId,
    })
    .from(matches)
    .where(and(eq(matches.userId, userId), eq(matches.state, "rejected")));
  const rejectedKeys = new Set(
    rejectedRows.map((r) => `${r.bankTransactionId}|${r.ledgerEntryId}`),
  );

  if (bankRowsAll.length === 0 || ledgerRowsAll.length === 0) {
    return {
      created: 0,
      considered: 0,
      below_threshold: 0,
      excluded_rejected: 0,
    };
  }

  // TODO(ticket-4): batch or summarize when either side exceeds 50 rows
  // instead of truncating to the most recent.
  const sortByDateDesc = (a: { date: string }, b: { date: string }) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  const bankRows = [...bankRowsAll]
    .sort(sortByDateDesc)
    .slice(0, MAX_ROWS_PER_SIDE);
  const ledgerRows = [...ledgerRowsAll]
    .sort(sortByDateDesc)
    .slice(0, MAX_ROWS_PER_SIDE);

  const bankIds = new Set(bankRows.map((r) => r.id));
  const ledgerIds = new Set(ledgerRows.map((r) => r.id));

  const userMessage = buildUserMessage(bankRows, ledgerRows);

  const messages = [
    {
      role: "user" as const,
      content: userMessage,
    },
  ];

  const tools = [
    {
      name: "propose_matches",
      description:
        "Return the list of bank-transaction / ledger-entry pairs you believe refer to the same real-world transaction.",
      input_schema: TOOL_INPUT_SCHEMA,
    },
  ];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const durationMs = 0;
    await db.insert(llmLogs).values({
      userId,
      purpose: PURPOSE,
      model: MODEL,
      prompt: { system: SYSTEM_PROMPT, messages, tools },
      response: {},
      durationMs,
      error: "ANTHROPIC_API_KEY is not set",
    });
    return {
      created: 0,
      considered: 0,
      below_threshold: 0,
      excluded_rejected: 0,
    };
  }

  const client = new Anthropic({ apiKey });
  const started = Date.now();

  let response: Anthropic.Message | null = null;
  let errorMessage: string | null = null;

  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      tools,
      tool_choice: { type: "tool", name: "propose_matches" },
      messages,
    });
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const durationMs = Date.now() - started;

  try {
    await db.insert(llmLogs).values({
      userId,
      purpose: PURPOSE,
      model: MODEL,
      prompt: { system: SYSTEM_PROMPT, messages, tools },
      response: response ? response.content : {},
      inputTokens: response?.usage?.input_tokens ?? null,
      outputTokens: response?.usage?.output_tokens ?? null,
      durationMs,
      error: errorMessage,
    });
  } catch (err) {
    console.error("runLlmMatching failed to write llm_logs", err);
  }

  if (!response || errorMessage) {
    return { created: 0, considered: 0, below_threshold: 0, excluded_rejected: 0 };
  }

  const toolBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === "propose_matches",
  );

  if (!toolBlock) {
    return { created: 0, considered: 0, below_threshold: 0, excluded_rejected: 0 };
  }

  const input = toolBlock.input as { pairs?: unknown } | undefined;
  const rawPairs = Array.isArray(input?.pairs) ? input.pairs : [];
  const proposed: ProposedPair[] = rawPairs.filter(isProposedPair);

  // Only consider pairs whose IDs belong to the loaded unmatched sets.
  const validByIds = proposed.filter(
    (p) => bankIds.has(p.bank_transaction_id) && ledgerIds.has(p.ledger_entry_id),
  );

  // Drop pairs the user has previously rejected so the LLM can't re-propose them.
  const excludedRejected = validByIds.filter((p) =>
    rejectedKeys.has(`${p.bank_transaction_id}|${p.ledger_entry_id}`),
  ).length;
  const valid = validByIds.filter(
    (p) => !rejectedKeys.has(`${p.bank_transaction_id}|${p.ledger_entry_id}`),
  );

  const considered = valid.length;

  const belowThresholdCount = valid.filter(
    (p) => p.confidence < CONFIDENCE_THRESHOLD,
  ).length;

  const eligible = valid
    .filter((p) => p.confidence >= CONFIDENCE_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence);

  const claimedBank = new Set<string>();
  const claimedLedger = new Set<string>();
  const toInsert: ProposedPair[] = [];
  for (const pair of eligible) {
    if (claimedBank.has(pair.bank_transaction_id)) continue;
    if (claimedLedger.has(pair.ledger_entry_id)) continue;
    claimedBank.add(pair.bank_transaction_id);
    claimedLedger.add(pair.ledger_entry_id);
    toInsert.push(pair);
  }

  let created = 0;
  for (const pair of toInsert) {
    try {
      const confidence = Math.min(
        0.999,
        Math.max(0, Number(pair.confidence)),
      ).toFixed(3);
      const inserted = await db
        .insert(matches)
        .values({
          userId,
          bankTransactionId: pair.bank_transaction_id,
          ledgerEntryId: pair.ledger_entry_id,
          method: METHOD,
          confidence,
          state: "proposed",
        })
        .onConflictDoNothing()
        .returning({ id: matches.id });
      created += inserted.length;
    } catch (err) {
      console.error("runLlmMatching insert skipped", err);
    }
  }

  return {
    created,
    considered,
    below_threshold: belowThresholdCount,
    excluded_rejected: excludedRejected,
  };
}
