CREATE TABLE "sports_football_results" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"home_goals" integer NOT NULL,
	"away_goals" integer NOT NULL,
	"source" varchar(1000) NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"updated_by_member_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_football_results_score" CHECK ("sports_football_results"."home_goals" >= 0 AND "sports_football_results"."away_goals" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sports_football_results" ADD CONSTRAINT "sports_football_results_event_id_sports_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."sports_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_results" ADD CONSTRAINT "sports_football_results_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_results" ADD CONSTRAINT "sports_football_results_updated_by_member_id_members_id_fk" FOREIGN KEY ("updated_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;