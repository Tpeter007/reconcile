CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bank_transaction_id" uuid NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	"method" text NOT NULL,
	"confidence" numeric(4, 3) DEFAULT '1.000' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_bank_transaction_id_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "matches_bank_transaction_id_unique" ON "matches" USING btree ("bank_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_ledger_entry_id_unique" ON "matches" USING btree ("ledger_entry_id");