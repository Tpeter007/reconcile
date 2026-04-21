CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plaid_item_id" uuid NOT NULL,
	"plaid_account_id" text NOT NULL,
	"name" text NOT NULL,
	"mask" text,
	"type" text,
	"subtype" text,
	CONSTRAINT "bank_accounts_plaid_account_id_unique" UNIQUE("plaid_account_id")
);
--> statement-breakpoint
CREATE TABLE "plaid_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text NOT NULL,
	"item_id" text NOT NULL,
	"institution_name" text,
	"cursor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plaid_items_item_id_unique" UNIQUE("item_id")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"plaid_transaction_id" text NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"description" text NOT NULL,
	"merchant_name" text,
	"pending" boolean DEFAULT false NOT NULL,
	"raw_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_plaid_transaction_id_unique" UNIQUE("plaid_transaction_id")
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_plaid_item_id_plaid_items_id_fk" FOREIGN KEY ("plaid_item_id") REFERENCES "public"."plaid_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;