CREATE UNIQUE INDEX "sports_fights_family_id_id_unique" ON "sports_fights" USING btree ("family_id","id");
--> statement-breakpoint
CREATE TABLE "sports_ufc_odds" (
  "family_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "fight_id" uuid NOT NULL,
  "first_decimal_odds" numeric(9, 4) NOT NULL,
  "second_decimal_odds" numeric(9, 4) NOT NULL,
  "bookmaker" varchar(120) NOT NULL,
  "source" varchar(1000) NOT NULL,
  "reference_at" timestamp with time zone NOT NULL,
  "updated_by_member_id" uuid NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sports_ufc_odds_pk" PRIMARY KEY("fight_id"),
  CONSTRAINT "sports_ufc_odds_event_family_fk" FOREIGN KEY ("family_id","event_id") REFERENCES "sports_events"("family_id","id") ON DELETE CASCADE,
  CONSTRAINT "sports_ufc_odds_fight_family_fk" FOREIGN KEY ("family_id","fight_id") REFERENCES "sports_fights"("family_id","id") ON DELETE CASCADE,
  CONSTRAINT "sports_ufc_odds_updated_by_family_fk" FOREIGN KEY ("updated_by_member_id","family_id") REFERENCES "members"("id","family_id") ON DELETE RESTRICT,
  CONSTRAINT "sports_ufc_odds_decimal_check" CHECK ("first_decimal_odds" > 1 AND "second_decimal_odds" > 1)
);
--> statement-breakpoint
CREATE INDEX "sports_ufc_odds_family_event_idx" ON "sports_ufc_odds" USING btree ("family_id","event_id");
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "sports_ufc_odds" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON TABLE "sports_ufc_odds" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON TABLE "sports_ufc_odds" FROM authenticated; END IF;
END $$;
