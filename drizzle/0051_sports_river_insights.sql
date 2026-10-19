CREATE TABLE "sports_river_insights" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"statistics" jsonb,
	"curiosities" jsonb,
	"updated_by_member_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sports_river_insights" ADD CONSTRAINT "sports_river_insights_event_family_fk" FOREIGN KEY ("family_id","event_id") REFERENCES "public"."sports_events"("family_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_river_insights" ADD CONSTRAINT "sports_river_insights_author_family_fk" FOREIGN KEY ("updated_by_member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
REVOKE ALL ON TABLE "sports_river_insights" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE "sports_river_insights" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE "sports_river_insights" FROM authenticated; END IF;
END $$;
