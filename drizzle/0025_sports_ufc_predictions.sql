CREATE TABLE "sports_block_closures" (
	"event_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"block" varchar(32) NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sports_block_closures_block" CHECK ("sports_block_closures"."block" IN ('main','preliminaries','early_preliminaries'))
);
--> statement-breakpoint
CREATE TABLE "sports_fight_results" (
	"fight_id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"winner_id" uuid,
	"source" varchar(1000) NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"updated_by_member_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_fight_results_outcome" CHECK (("sports_fight_results"."outcome" = 'winner' AND "sports_fight_results"."winner_id" IS NOT NULL) OR ("sports_fight_results"."outcome" IN ('draw','no_contest','cancelled') AND "sports_fight_results"."winner_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sports_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"fight_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"winner_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sports_fights" ADD COLUMN "first_fighter_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "sports_fights" ADD COLUMN "second_fighter_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "sports_fights" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sports_block_closures" ADD CONSTRAINT "sports_block_closures_event_id_sports_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."sports_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_block_closures" ADD CONSTRAINT "sports_block_closures_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_fight_results" ADD CONSTRAINT "sports_fight_results_fight_id_sports_fights_id_fk" FOREIGN KEY ("fight_id") REFERENCES "public"."sports_fights"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_fight_results" ADD CONSTRAINT "sports_fight_results_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_fight_results" ADD CONSTRAINT "sports_fight_results_event_id_sports_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."sports_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_fight_results" ADD CONSTRAINT "sports_fight_results_updated_by_member_id_members_id_fk" FOREIGN KEY ("updated_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_predictions" ADD CONSTRAINT "sports_predictions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_predictions" ADD CONSTRAINT "sports_predictions_event_id_sports_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."sports_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_predictions" ADD CONSTRAINT "sports_predictions_fight_id_sports_fights_id_fk" FOREIGN KEY ("fight_id") REFERENCES "public"."sports_fights"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_predictions" ADD CONSTRAINT "sports_predictions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sports_block_closures_unique" ON "sports_block_closures" USING btree ("event_id","block");--> statement-breakpoint
CREATE UNIQUE INDEX "sports_predictions_member_fight_unique" ON "sports_predictions" USING btree ("family_id","member_id","fight_id");