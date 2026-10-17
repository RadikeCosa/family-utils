CREATE TABLE "sports_football_event_sources" (
	"family_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"external_id" varchar(200) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_football_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"reference" varchar(80) NOT NULL,
	"name" varchar(120) NOT NULL,
	"original_from" date NOT NULL,
	"original_through" date NOT NULL,
	CONSTRAINT "sports_football_rounds_window" CHECK ("sports_football_rounds"."original_from" <= "sports_football_rounds"."original_through")
);
--> statement-breakpoint
CREATE TABLE "sports_football_seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"competition" varchar(40) NOT NULL,
	"name" varchar(40) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_football_team_sources" (
	"family_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"external_id" varchar(200) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_football_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "football_category" varchar(16) DEFAULT 'river';
--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "season_id" uuid;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "round_id" uuid;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "first_team_id" uuid;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "second_team_id" uuid;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "tie_reference" varchar(200);
--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "next_round_id" uuid;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "next_slot" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_event_sources_reference_unique" ON "sports_football_event_sources" USING btree ("family_id","provider","external_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_event_sources_provider_unique" ON "sports_football_event_sources" USING btree ("family_id","event_id","provider");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_rounds_family_id_unique" ON "sports_football_rounds" USING btree ("family_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_rounds_season_id_unique" ON "sports_football_rounds" USING btree ("family_id","season_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_rounds_reference_unique" ON "sports_football_rounds" USING btree ("family_id","season_id","reference");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_seasons_family_id_unique" ON "sports_football_seasons" USING btree ("family_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_seasons_name_unique" ON "sports_football_seasons" USING btree ("family_id","competition","name");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_team_sources_reference_unique" ON "sports_football_team_sources" USING btree ("family_id","provider","external_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_team_sources_provider_unique" ON "sports_football_team_sources" USING btree ("family_id","team_id","provider");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_teams_family_id_unique" ON "sports_football_teams" USING btree ("family_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_teams_name_unique" ON "sports_football_teams" USING btree ("family_id","name");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_events_family_id_unique" ON "sports_events" USING btree ("family_id","id");
--> statement-breakpoint
CREATE INDEX "sports_events_family_category_date_idx" ON "sports_events" USING btree ("family_id","football_category","event_date");
--> statement-breakpoint
-- Column default preserves old football inserts. Normalize old UFC inserts too.
UPDATE sports_events SET football_category=NULL WHERE kind='ufc_card';
--> statement-breakpoint
CREATE FUNCTION sports_normalize_football_category() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'ufc_card' THEN NEW.football_category := NULL; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sports_events_football_category_default BEFORE INSERT ON sports_events
FOR EACH ROW EXECUTE FUNCTION sports_normalize_football_category();
--> statement-breakpoint
ALTER TABLE "sports_football_event_sources" ADD CONSTRAINT "sports_football_event_sources_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_football_event_sources" ADD CONSTRAINT "sports_event_sources_family_event_fk" FOREIGN KEY ("family_id","event_id") REFERENCES "public"."sports_events"("family_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_football_rounds" ADD CONSTRAINT "sports_football_rounds_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_football_rounds" ADD CONSTRAINT "sports_rounds_family_season_fk" FOREIGN KEY ("family_id","season_id") REFERENCES "public"."sports_football_seasons"("family_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_football_seasons" ADD CONSTRAINT "sports_football_seasons_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_football_team_sources" ADD CONSTRAINT "sports_football_team_sources_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_football_team_sources" ADD CONSTRAINT "sports_team_sources_family_team_fk" FOREIGN KEY ("family_id","team_id") REFERENCES "public"."sports_football_teams"("family_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_football_teams" ADD CONSTRAINT "sports_football_teams_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_family_season_fk" FOREIGN KEY ("family_id","season_id") REFERENCES "public"."sports_football_seasons"("family_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_family_round_fk" FOREIGN KEY ("family_id","round_id") REFERENCES "public"."sports_football_rounds"("family_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_round_season_fk" FOREIGN KEY ("family_id","season_id","round_id") REFERENCES "public"."sports_football_rounds"("family_id","season_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_first_team_fk" FOREIGN KEY ("family_id","first_team_id") REFERENCES "public"."sports_football_teams"("family_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_second_team_fk" FOREIGN KEY ("family_id","second_team_id") REFERENCES "public"."sports_football_teams"("family_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_next_round_fk" FOREIGN KEY ("family_id","next_round_id") REFERENCES "public"."sports_football_rounds"("family_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_football_category" CHECK (("sports_events"."kind" = 'football_match' AND "sports_events"."football_category" IS NOT NULL AND "sports_events"."football_category" IN ('river','champions')) OR ("sports_events"."kind" = 'ufc_card' AND "sports_events"."football_category" IS NULL));
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_champions_shape" CHECK ("sports_events"."football_category" IS DISTINCT FROM 'champions' OR ("sports_events"."season_id" IS NOT NULL AND "sports_events"."round_id" IS NOT NULL AND "sports_events"."first_team_id" IS NOT NULL AND "sports_events"."second_team_id" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_football_metadata" CHECK ("sports_events"."kind" = 'football_match' OR ("sports_events"."season_id" IS NULL AND "sports_events"."round_id" IS NULL AND "sports_events"."first_team_id" IS NULL AND "sports_events"."second_team_id" IS NULL AND "sports_events"."tie_reference" IS NULL AND "sports_events"."next_round_id" IS NULL AND "sports_events"."next_slot" IS NULL));
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_distinct_teams" CHECK ("sports_events"."first_team_id" IS NULL OR "sports_events"."second_team_id" IS NULL OR "sports_events"."first_team_id" <> "sports_events"."second_team_id");
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_next_slot" CHECK ("sports_events"."next_slot" IS NULL OR ("sports_events"."next_slot" > 0 AND "sports_events"."next_round_id" IS NOT NULL));
--> statement-breakpoint
-- Preserve provider identities without changing legacy identifiers or payloads.
INSERT INTO sports_football_event_sources(family_id,event_id,provider,external_id)
SELECT family_id,id,source_provider,external_reference FROM sports_events
WHERE kind='football_match' AND source_provider IS NOT NULL AND external_reference IS NOT NULL;
--> statement-breakpoint
-- Keep the legacy provider pair and the multi-provider identity map in sync.
CREATE FUNCTION sports_sync_football_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'football_match' AND NEW.source_provider IS NOT NULL AND NEW.external_reference IS NOT NULL THEN
    INSERT INTO sports_football_event_sources(family_id,event_id,provider,external_id)
    VALUES(NEW.family_id,NEW.id,NEW.source_provider,NEW.external_reference)
    ON CONFLICT(family_id,event_id,provider) DO UPDATE SET external_id=excluded.external_id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sports_events_source_identity AFTER INSERT OR UPDATE OF source_provider, external_reference ON sports_events
FOR EACH ROW EXECUTE FUNCTION sports_sync_football_source();
