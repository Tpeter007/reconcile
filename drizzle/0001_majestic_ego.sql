CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"account" text,
	"reference" text,
	"source" text DEFAULT 'csv_upload' NOT NULL,
	"raw_row" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
