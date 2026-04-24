import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// access_token stores `v1:<base64>` ciphertext produced by src/lib/crypto/tokens.ts.
export const plaidItems = pgTable("plaid_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  accessToken: text("access_token").notNull(),
  itemId: text("item_id").notNull().unique(),
  institutionName: text("institution_name"),
  cursor: text("cursor"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const bankAccounts = pgTable("bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  plaidItemId: uuid("plaid_item_id")
    .notNull()
    .references(() => plaidItems.id, { onDelete: "cascade" }),
  plaidAccountId: text("plaid_account_id").notNull().unique(),
  name: text("name").notNull(),
  mask: text("mask"),
  type: text("type"),
  subtype: text("subtype"),
});

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  bankAccountId: uuid("bank_account_id")
    .notNull()
    .references(() => bankAccounts.id, { onDelete: "cascade" }),
  plaidTransactionId: text("plaid_transaction_id").notNull().unique(),
  date: date("date").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  description: text("description").notNull(),
  merchantName: text("merchant_name"),
  pending: boolean("pending").notNull().default(false),
  rawJson: jsonb("raw_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  date: date("date").notNull(),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  account: text("account"),
  reference: text("reference"),
  source: text("source").notNull().default("csv_upload"),
  rawRow: jsonb("raw_row").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    bankTransactionId: uuid("bank_transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    ledgerEntryId: uuid("ledger_entry_id").references(() => ledgerEntries.id, {
      onDelete: "cascade",
    }),
    qboEntryId: uuid("qbo_entry_id").references(() => qboEntries.id, {
      onDelete: "cascade",
    }),
    method: text("method").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 })
      .notNull()
      .default("1.000"),
    state: text("state").notNull().default("proposed"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("matches_bank_transaction_id_unique")
      .on(t.bankTransactionId)
      .where(sql`state != 'rejected'`),
    uniqueIndex("matches_ledger_entry_id_unique")
      .on(t.ledgerEntryId)
      .where(sql`state != 'rejected' AND ledger_entry_id IS NOT NULL`),
    uniqueIndex("matches_qbo_entry_id_unique")
      .on(t.qboEntryId)
      .where(sql`state != 'rejected' AND qbo_entry_id IS NOT NULL`),
    check(
      "matches_exactly_one_counterparty",
      sql`(ledger_entry_id IS NOT NULL)::int + (qbo_entry_id IS NOT NULL)::int = 1`,
    ),
  ],
);

// access_token and refresh_token store `v1:<base64>` ciphertext produced by src/lib/crypto/tokens.ts.
export const qboConnections = pgTable(
  "qbo_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    realmId: text("realm_id").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }).notNull(),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("qbo_connections_user_id_unique").on(t.userId)],
);

export const qboEntries = pgTable(
  "qbo_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    qboConnectionId: uuid("qbo_connection_id")
      .notNull()
      .references(() => qboConnections.id, { onDelete: "cascade" }),
    qboEntityType: text("qbo_entity_type").notNull(),
    qboId: text("qbo_id").notNull(),
    date: date("date").notNull(),
    description: text("description").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    account: text("account"),
    reference: text("reference"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("qbo_entries_user_entity_qbo_id_unique").on(
      t.userId,
      t.qboEntityType,
      t.qboId,
    ),
  ],
);

export const llmLogs = pgTable("llm_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  purpose: text("purpose").notNull(),
  model: text("model").notNull(),
  prompt: jsonb("prompt").notNull(),
  response: jsonb("response").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  durationMs: integer("duration_ms").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PlaidItem = typeof plaidItems.$inferSelect;
export type BankAccount = typeof bankAccounts.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type Match = typeof matches.$inferSelect;
export type LlmLog = typeof llmLogs.$inferSelect;
export type QboConnection = typeof qboConnections.$inferSelect;
export type QboEntry = typeof qboEntries.$inferSelect;
