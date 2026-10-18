CREATE TABLE "sports_river_lineups" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"body" text NOT NULL,
	"source" varchar(1000) NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"updated_by_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_river_lineups_body" CHECK (char_length(btrim("sports_river_lineups"."body")) BETWEEN 1 AND 4000),
	CONSTRAINT "sports_river_lineups_source" CHECK ("sports_river_lineups"."source" ~ '^https://')
);
--> statement-breakpoint
ALTER TABLE "sports_river_lineups" ADD CONSTRAINT "sports_river_lineups_event_family_fk" FOREIGN KEY ("family_id","event_id") REFERENCES "public"."sports_events"("family_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_river_lineups" ADD CONSTRAINT "sports_river_lineups_author_family_fk" FOREIGN KEY ("updated_by_member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
REVOKE ALL ON TABLE "sports_river_lineups" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE "sports_river_lineups" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE "sports_river_lineups" FROM authenticated; END IF;
END $$;
