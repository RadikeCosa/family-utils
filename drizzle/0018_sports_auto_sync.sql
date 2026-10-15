CREATE TABLE "sports_auto_sync_settings" (
	"family_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_sync_state" (
	"family_id" uuid NOT NULL,
	"category" varchar(16) NOT NULL,
	"last_success_at" timestamp with time zone,
	"covered_through" date,
	"last_attempt_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"attempt_token" uuid,
	"lease_until" timestamp with time zone,
	"last_error" varchar(120),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_sync_state_category" CHECK ("sports_sync_state"."category" IN ('river', 'ufc')),
	CONSTRAINT "sports_sync_state_failures" CHECK ("sports_sync_state"."consecutive_failures" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "source_provider" varchar(40);--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "automatic_data" jsonb;--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "manual_overrides" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "automatic_fights" jsonb;--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "manual_fights" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "source_absent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sports_auto_sync_settings" ADD CONSTRAINT "sports_auto_sync_settings_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_sync_state" ADD CONSTRAINT "sports_sync_state_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sports_sync_state_family_category_unique" ON "sports_sync_state" USING btree ("family_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "sports_events_source_reference_unique_idx" ON "sports_events" USING btree ("family_id","kind","source_provider","external_reference") WHERE "sports_events"."external_reference" IS NOT NULL AND "sports_events"."source_provider" IS NOT NULL;