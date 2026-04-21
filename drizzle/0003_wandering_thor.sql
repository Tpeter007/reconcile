CREATE TABLE "llm_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"prompt" jsonb NOT NULL,
	"response" jsonb NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"duration_ms" integer NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
