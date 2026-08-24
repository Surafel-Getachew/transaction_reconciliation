ALTER TABLE "imports" ADD COLUMN "owner_id" varchar(64);--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "imports_lease_idx" ON "imports" USING btree ("status","lease_expires_at");