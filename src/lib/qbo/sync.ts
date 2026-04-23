import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { qboConnections, qboEntries } from "@/db/schema";
import { QboNotConnectedError } from "./errors";
import {
  getAuthorizedQboClient,
  type AuthorizedQboClient,
  type QboQueryResponse,
} from "./client";

type EntityType =
  | "Purchase"
  | "BillPayment"
  | "Deposit"
  | "Payment"
  | "SalesReceipt"
  | "JournalEntry";

type NormalizedRow = {
  qbo_entity_type: EntityType;
  qbo_id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: string; // signed, .toFixed(2)
  account: string;
  reference: string;
};

type EntityFailure = { entity: EntityType; error: string };

type Ref = { value?: string; name?: string };
type LineItem = {
  Description?: string;
  Amount?: number;
  DetailType?: string;
  AccountBasedExpenseLineDetail?: { AccountRef?: Ref };
  JournalEntryLineDetail?: {
    PostingType?: "Debit" | "Credit";
    AccountRef?: Ref;
  };
};

type PurchaseQbo = {
  Id: string;
  TxnDate: string;
  TotalAmt: number;
  PrivateNote?: string;
  DocNumber?: string;
  AccountRef?: Ref;
  Line?: LineItem[];
};

type BillPaymentQbo = {
  Id: string;
  TxnDate: string;
  TotalAmt: number;
  DocNumber?: string;
  VendorRef?: Ref;
};

type DepositQbo = {
  Id: string;
  TxnDate: string;
  TotalAmt: number;
  PrivateNote?: string;
  DocNumber?: string;
  DepositToAccountRef?: Ref;
};

type PaymentQbo = {
  Id: string;
  TxnDate: string;
  TotalAmt: number;
  DocNumber?: string;
  PaymentRefNum?: string;
  CustomerRef?: Ref;
  DepositToAccountRef?: Ref;
};

type SalesReceiptQbo = {
  Id: string;
  TxnDate: string;
  TotalAmt: number;
  DocNumber?: string;
  CustomerRef?: Ref;
  CustomerMemo?: { value?: string };
  DepositToAccountRef?: Ref;
};

type JournalEntryQbo = {
  Id: string;
  TxnDate: string;
  PrivateNote?: string;
  DocNumber?: string;
  Line?: LineItem[];
};

const BANK_LIKE_ACCOUNT_HINTS = [
  "checking",
  "savings",
  "bank",
  "cash",
  "money market",
  "credit card",
];

function thirtyDaysAgoISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}

function signed(amount: number, sign: 1 | -1): string {
  // Sign-normalize then fix to 2dp. Negative-zero collapses to "0.00".
  const v = Math.abs(amount) * sign;
  return (Object.is(v, -0) ? 0 : v).toFixed(2);
}

function looksBankLike(name: string | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return BANK_LIKE_ACCOUNT_HINTS.some((hint) => n.includes(hint));
}

function extractRows<T>(resp: QboQueryResponse, entity: EntityType): T[] {
  const qr = resp.QueryResponse;
  if (!qr) return [];
  const arr = qr[entity];
  if (!Array.isArray(arr)) return [];
  // PAGINATION TODO: cap at 100. Multi-page sync is deferred to a later
  // sync ticket (see ticket 6). Sandbox volumes don't approach this cap.
  return (arr as T[]).slice(0, 100);
}

// ---------------- per-entity normalizers ----------------

function normalizePurchase(p: PurchaseQbo): NormalizedRow | null {
  if (!p.Id || !p.TxnDate || p.TotalAmt == null) return null;
  const firstLineDesc = p.Line?.find((l) => l.Description)?.Description;
  const description =
    (p.PrivateNote && p.PrivateNote.trim()) ||
    (firstLineDesc && firstLineDesc.trim()) ||
    "Purchase";
  const account = p.AccountRef?.name ?? "";
  const reference = p.DocNumber ?? "";
  return {
    qbo_entity_type: "Purchase",
    qbo_id: p.Id,
    date: p.TxnDate,
    description,
    amount: signed(p.TotalAmt, 1),
    account,
    reference,
  };
}

function normalizeBillPayment(b: BillPaymentQbo): NormalizedRow | null {
  if (!b.Id || !b.TxnDate || b.TotalAmt == null) return null;
  const vendor = b.VendorRef?.name ?? "vendor";
  return {
    qbo_entity_type: "BillPayment",
    qbo_id: b.Id,
    date: b.TxnDate,
    description: `Bill payment to ${vendor}`,
    amount: signed(b.TotalAmt, 1),
    account: `Bill payment: ${vendor}`,
    reference: b.DocNumber ?? "",
  };
}

function normalizeDeposit(d: DepositQbo): NormalizedRow | null {
  if (!d.Id || !d.TxnDate || d.TotalAmt == null) return null;
  const account = d.DepositToAccountRef?.name ?? "";
  const description =
    (d.PrivateNote && d.PrivateNote.trim()) ||
    (account ? `Deposit to ${account}` : "Deposit");
  return {
    qbo_entity_type: "Deposit",
    qbo_id: d.Id,
    date: d.TxnDate,
    description,
    amount: signed(d.TotalAmt, -1),
    account,
    reference: d.DocNumber ?? "",
  };
}

function normalizePayment(p: PaymentQbo): NormalizedRow | null {
  if (!p.Id || !p.TxnDate || p.TotalAmt == null) return null;
  const customer = p.CustomerRef?.name ?? "customer";
  const account = p.DepositToAccountRef?.name ?? "Undeposited Funds";
  return {
    qbo_entity_type: "Payment",
    qbo_id: p.Id,
    date: p.TxnDate,
    description: `Payment from ${customer}`,
    amount: signed(p.TotalAmt, -1),
    account,
    reference: p.PaymentRefNum || p.DocNumber || "",
  };
}

function normalizeSalesReceipt(s: SalesReceiptQbo): NormalizedRow | null {
  if (!s.Id || !s.TxnDate || s.TotalAmt == null) return null;
  const customer = s.CustomerRef?.name ?? "customer";
  const memo = s.CustomerMemo?.value?.trim();
  const description = memo || `Sales receipt: ${customer}`;
  const account = s.DepositToAccountRef?.name ?? "Undeposited Funds";
  return {
    qbo_entity_type: "SalesReceipt",
    qbo_id: s.Id,
    date: s.TxnDate,
    description,
    amount: signed(s.TotalAmt, -1),
    account,
    reference: s.DocNumber ?? "",
  };
}

function normalizeJournalEntry(j: JournalEntryQbo): NormalizedRow | null {
  if (!j.Id || !j.TxnDate || !Array.isArray(j.Line)) return null;
  const lines = j.Line.filter(
    (l) => l.DetailType === "JournalEntryLineDetail" && l.JournalEntryLineDetail,
  );
  if (lines.length === 0) return null;

  // Find the bank/cash line that anchors money flow.
  const bankLine = lines.find((l) =>
    looksBankLike(l.JournalEntryLineDetail?.AccountRef?.name),
  );
  if (!bankLine) return null; // Not a reconcilable event.

  const debits = lines
    .filter((l) => l.JournalEntryLineDetail?.PostingType === "Debit")
    .reduce((s, l) => s + Number(l.Amount ?? 0), 0);

  // bank debited = money in (negative); bank credited = money out (positive).
  const sign: 1 | -1 =
    bankLine.JournalEntryLineDetail?.PostingType === "Debit" ? -1 : 1;

  const categoryLine = lines.find((l) => {
    const name = l.JournalEntryLineDetail?.AccountRef?.name?.toLowerCase() ?? "";
    if (!name) return false;
    if (looksBankLike(name)) return false;
    if (name.includes("receivable")) return false;
    if (name.includes("payable")) return false;
    return true;
  });

  const account = categoryLine?.JournalEntryLineDetail?.AccountRef?.name ?? "";
  const description = (j.PrivateNote && j.PrivateNote.trim()) || "Journal entry";

  return {
    qbo_entity_type: "JournalEntry",
    qbo_id: j.Id,
    date: j.TxnDate,
    description,
    amount: signed(debits, sign),
    account,
    reference: j.DocNumber ?? "",
  };
}

// ---------------- per-entity sync helpers ----------------

async function syncEntity<T>(
  client: AuthorizedQboClient,
  entity: EntityType,
  cutoff: string,
  normalize: (raw: T) => NormalizedRow | null,
): Promise<{ rows: NormalizedRow[]; truncated: boolean }> {
  const sql = `SELECT * FROM ${entity} WHERE TxnDate >= '${cutoff}'`;
  const resp = await client.query(sql);
  const raws = extractRows<T>(resp, entity);
  const truncated = raws.length === 100;
  const rows: NormalizedRow[] = [];
  for (const raw of raws) {
    const n = normalize(raw);
    if (n) rows.push(n);
  }
  return { rows, truncated };
}

async function upsertRows(
  userId: string,
  qboConnectionId: string,
  rows: NormalizedRow[],
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const r of rows) {
    const existing = await db
      .select({ id: qboEntries.id })
      .from(qboEntries)
      .where(
        and(
          eq(qboEntries.userId, userId),
          eq(qboEntries.qboEntityType, r.qbo_entity_type),
          eq(qboEntries.qboId, r.qbo_id),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(qboEntries)
        .set({
          qboConnectionId,
          date: r.date,
          description: r.description,
          amount: r.amount,
          account: r.account,
          reference: r.reference,
          updatedAt: new Date(),
        })
        .where(eq(qboEntries.id, existing[0].id));
      updated++;
    } else {
      await db.insert(qboEntries).values({
        userId,
        qboConnectionId,
        qboEntityType: r.qbo_entity_type,
        qboId: r.qbo_id,
        date: r.date,
        description: r.description,
        amount: r.amount,
        account: r.account,
        reference: r.reference,
      });
      created++;
    }
  }

  return { created, updated };
}

// ---------------- public entry point ----------------

export type SyncResult = {
  created: number;
  updated: number;
  by_type: Record<string, number>;
  failures: EntityFailure[];
};

export async function syncQboEntries(userId: string): Promise<SyncResult> {
  const [conn] = await db
    .select({ id: qboConnections.id })
    .from(qboConnections)
    .where(eq(qboConnections.userId, userId))
    .limit(1);
  if (!conn) throw new QboNotConnectedError();

  const client = await getAuthorizedQboClient(userId);
  const cutoff = thirtyDaysAgoISO();

  let created = 0;
  let updated = 0;
  const by_type: Record<string, number> = {};
  const failures: EntityFailure[] = [];

  type Job = {
    entity: EntityType;
    run: () => Promise<{ rows: NormalizedRow[] }>;
  };

  const jobs: Job[] = [
    {
      entity: "Purchase",
      run: () => syncEntity<PurchaseQbo>(client, "Purchase", cutoff, normalizePurchase),
    },
    {
      entity: "BillPayment",
      run: () =>
        syncEntity<BillPaymentQbo>(client, "BillPayment", cutoff, normalizeBillPayment),
    },
    {
      entity: "Deposit",
      run: () => syncEntity<DepositQbo>(client, "Deposit", cutoff, normalizeDeposit),
    },
    {
      entity: "Payment",
      run: () => syncEntity<PaymentQbo>(client, "Payment", cutoff, normalizePayment),
    },
    {
      entity: "SalesReceipt",
      run: () =>
        syncEntity<SalesReceiptQbo>(
          client,
          "SalesReceipt",
          cutoff,
          normalizeSalesReceipt,
        ),
    },
    {
      entity: "JournalEntry",
      run: () =>
        syncEntity<JournalEntryQbo>(
          client,
          "JournalEntry",
          cutoff,
          normalizeJournalEntry,
        ),
    },
  ];

  for (const job of jobs) {
    try {
      const { rows } = await job.run();
      const counts = await upsertRows(userId, conn.id, rows);
      created += counts.created;
      updated += counts.updated;
      by_type[job.entity] = rows.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      console.error("[qbo] entity sync failed", {
        userId,
        entity: job.entity,
        error: message,
      });
      failures.push({ entity: job.entity, error: message });
    }
  }

  return { created, updated, by_type, failures };
}
