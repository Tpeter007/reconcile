CREATE TABLE "qbo_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"realm_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"access_token_expires_at" timestamp with time zone NOT NULL,
	"refresh_token_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qbo_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"qbo_connection_id" uuid NOT NULL,
	"qbo_entity_type" text NOT NULL,
	"qbo_id" text NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"account" text,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qbo_entries" ADD CONSTRAINT "qbo_entries_qbo_connection_id_qbo_connections_id_fk" FOREIGN KEY ("qbo_connection_id") REFERENCES "public"."qbo_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "qbo_connections_user_id_unique" ON "qbo_connections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qbo_entries_user_entity_qbo_id_unique" ON "qbo_entries" USING btree ("user_id","qbo_entity_type","qbo_id");