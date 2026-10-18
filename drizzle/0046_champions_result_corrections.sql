CREATE TABLE "sports_football_result_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"previous_home_goals" integer NOT NULL,
	"previous_away_goals" integer NOT NULL,
	"new_home_goals" integer NOT NULL,
	"new_away_goals" integer NOT NULL,
	"previous_source" varchar(1000) NOT NULL,
	"new_source" varchar(1000) NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"actor_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_football_result_corrections_score" CHECK ("sports_football_result_corrections"."previous_home_goals" >= 0 AND "sports_football_result_corrections"."previous_away_goals" >= 0 AND "sports_football_result_corrections"."new_home_goals" >= 0 AND "sports_football_result_corrections"."new_away_goals" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sports_football_result_corrections" ADD CONSTRAINT "sports_football_result_corrections_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_result_corrections" ADD CONSTRAINT "sports_football_result_corrections_event_fk" FOREIGN KEY ("family_id","event_id") REFERENCES "public"."sports_events"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_result_corrections" ADD CONSTRAINT "sports_football_result_corrections_actor_fk" FOREIGN KEY ("actor_member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE no action ON UPDATE no action;