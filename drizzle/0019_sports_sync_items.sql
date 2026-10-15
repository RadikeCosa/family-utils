CREATE TABLE "sports_sync_item_state" (
	"family_id" uuid NOT NULL,
	"category" varchar(16) NOT NULL,
	"external_reference" varchar(200) NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" varchar(120),
	CONSTRAINT "sports_sync_item_state_category" CHECK ("sports_sync_item_state"."category" = 'ufc'),
	CONSTRAINT "sports_sync_item_state_failures" CHECK ("sports_sync_item_state"."consecutive_failures" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sports_sync_item_state" ADD CONSTRAINT "sports_sync_item_state_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sports_sync_item_state_unique" ON "sports_sync_item_state" USING btree ("family_id","category","external_reference");