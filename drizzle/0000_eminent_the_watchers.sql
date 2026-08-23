CREATE TYPE "public"."import_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'cancelling', 'cancelled');--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"import_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"provider_id" varchar(255) NOT NULL,
	"status" "import_status" DEFAULT 'pending' NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"import_id" varchar(255) NOT NULL,
	"provider_id" varchar(255) NOT NULL,
	"transaction_id" varchar(255) NOT NULL,
	"account_id" varchar(255) NOT NULL,
	"merchant_id" varchar(255) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"description" text,
	"fingerprint" varchar(64) NOT NULL,
	"risk_score" integer NOT NULL,
	"risk_level" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rejections" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"import_id" varchar(255) NOT NULL,
	"line_number" integer NOT NULL,
	"reason" varchar(100) NOT NULL,
	"message" text NOT NULL,
	"raw_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejections" ADD CONSTRAINT "rejections_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_provider_transaction_idx" ON "transactions" USING btree ("provider_id","transaction_id");--> statement-breakpoint
CREATE INDEX "import_id_idx" ON "transactions" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "import_currency_idx" ON "transactions" USING btree ("import_id","currency");--> statement-breakpoint
CREATE INDEX "import_risk_level_idx" ON "transactions" USING btree ("import_id","risk_level");--> statement-breakpoint
CREATE INDEX "rejections_import_line_idx" ON "rejections" USING btree ("import_id","line_number");