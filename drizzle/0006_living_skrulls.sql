DROP INDEX "matches_ledger_entry_id_unique";--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "ledger_entry_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "qbo_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_qbo_entry_id_qbo_entries_id_fk" FOREIGN KEY ("qbo_entry_id") REFERENCES "public"."qbo_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "matches_qbo_entry_id_unique" ON "matches" USING btree ("qbo_entry_id") WHERE state != 'rejected' AND qbo_entry_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "matches_ledger_entry_id_unique" ON "matches" USING btree ("ledger_entry_id") WHERE state != 'rejected' AND ledger_entry_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_exactly_one_counterparty" CHECK ((ledger_entry_id IS NOT NULL)::int + (qbo_entry_id IS NOT NULL)::int = 1);