DROP INDEX "matches_bank_transaction_id_unique";--> statement-breakpoint
DROP INDEX "matches_ledger_entry_id_unique";--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "state" text DEFAULT 'proposed' NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "created_by" uuid;--> statement-breakpoint
UPDATE "matches" SET "state" = 'confirmed' WHERE "method" = 'deterministic_v1';--> statement-breakpoint
UPDATE "matches" SET "state" = 'proposed' WHERE "method" = 'llm_v1';--> statement-breakpoint
CREATE UNIQUE INDEX "matches_bank_transaction_id_unique" ON "matches" USING btree ("bank_transaction_id") WHERE state != 'rejected';--> statement-breakpoint
CREATE UNIQUE INDEX "matches_ledger_entry_id_unique" ON "matches" USING btree ("ledger_entry_id") WHERE state != 'rejected';