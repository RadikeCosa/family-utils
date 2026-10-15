CREATE TYPE "public"."sports_event_kind" AS ENUM('football_match', 'ufc_card');--> statement-breakpoint
CREATE TABLE "sports_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"author_member_id" uuid NOT NULL,
	"context_kind" varchar(20) NOT NULL,
	"context_event_id" uuid,
	"context_date" date,
	"body" varchar(2000) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"retired_at" timestamp with time zone,
	"retired_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_comments_context_shape" CHECK (
    ("sports_comments"."context_kind" = 'football_day' AND "sports_comments"."context_event_id" IS NULL AND "sports_comments"."context_date" IS NOT NULL)
    OR ("sports_comments"."context_kind" = 'river_match' AND "sports_comments"."context_event_id" IS NOT NULL AND "sports_comments"."context_date" IS NOT NULL)
    OR ("sports_comments"."context_kind" = 'ufc_card' AND "sports_comments"."context_event_id" IS NOT NULL AND "sports_comments"."context_date" IS NULL)),
	CONSTRAINT "sports_comments_body_length" CHECK (char_length(btrim("sports_comments"."body")) BETWEEN 1 AND 2000),
	CONSTRAINT "sports_comments_version" CHECK ("sports_comments"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "sports_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"kind" "sports_event_kind" NOT NULL,
	"title" varchar(160) NOT NULL,
	"competition" varchar(120),
	"first_participant" varchar(120),
	"second_participant" varchar(120),
	"event_date" date NOT NULL,
	"starts_at" timestamp with time zone,
	"channel" varchar(160),
	"status" varchar(20) DEFAULT 'scheduled' NOT NULL,
	"result" varchar(160),
	"preliminary_starts_at" timestamp with time zone,
	"main_card_starts_at" timestamp with time zone,
	"card_status" varchar(20),
	"is_current" boolean DEFAULT false NOT NULL,
	"manually_edited" boolean DEFAULT true NOT NULL,
	"external_reference" varchar(200),
	"prediction_close_mode" varchar(12),
	"created_by_member_id" uuid NOT NULL,
	"updated_by_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_events_status" CHECK ("sports_events"."status" IN ('scheduled', 'postponed', 'completed', 'cancelled')),
	CONSTRAINT "sports_events_card_status" CHECK ("sports_events"."card_status" IS NULL OR "sports_events"."card_status" IN ('upcoming', 'finalized')),
	CONSTRAINT "sports_events_prediction_close_mode" CHECK ("sports_events"."prediction_close_mode" IS NULL OR "sports_events"."prediction_close_mode" IN ('event', 'block', 'fight')),
	CONSTRAINT "sports_events_kind_shape" CHECK (
    ("sports_events"."kind" = 'football_match' AND "sports_events"."competition" IS NOT NULL AND "sports_events"."first_participant" IS NOT NULL AND "sports_events"."second_participant" IS NOT NULL AND "sports_events"."is_current" = false AND "sports_events"."card_status" IS NULL)
    OR ("sports_events"."kind" = 'ufc_card' AND "sports_events"."competition" IS NULL AND "sports_events"."first_participant" IS NULL AND "sports_events"."second_participant" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sports_fights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"bout_order" integer NOT NULL,
	"first_fighter" varchar(120) NOT NULL,
	"second_fighter" varchar(120) NOT NULL,
	"bout_block" varchar(16) NOT NULL,
	"is_main_event" boolean DEFAULT false NOT NULL,
	"result" varchar(16),
	"external_reference" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_fights_bout_order" CHECK ("sports_fights"."bout_order" > 0),
	CONSTRAINT "sports_fights_bout_block" CHECK ("sports_fights"."bout_block" IN ('preliminaries', 'main')),
	CONSTRAINT "sports_fights_result" CHECK ("sports_fights"."result" IS NULL OR "sports_fights"."result" IN ('first', 'second', 'draw', 'no_contest', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "sports_comments" ADD CONSTRAINT "sports_comments_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_comments" ADD CONSTRAINT "sports_comments_author_member_id_members_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_comments" ADD CONSTRAINT "sports_comments_context_event_id_sports_events_id_fk" FOREIGN KEY ("context_event_id") REFERENCES "public"."sports_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_comments" ADD CONSTRAINT "sports_comments_retired_by_member_id_members_id_fk" FOREIGN KEY ("retired_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_updated_by_member_id_members_id_fk" FOREIGN KEY ("updated_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_fights" ADD CONSTRAINT "sports_fights_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_fights" ADD CONSTRAINT "sports_fights_event_id_sports_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."sports_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sports_comments_family_context_created_idx" ON "sports_comments" USING btree ("family_id","context_kind","context_date","context_event_id","created_at");--> statement-breakpoint
CREATE INDEX "sports_events_family_date_idx" ON "sports_events" USING btree ("family_id","kind","event_date");--> statement-breakpoint
CREATE UNIQUE INDEX "sports_events_one_current_ufc_card_idx" ON "sports_events" USING btree ("family_id") WHERE "sports_events"."kind" = 'ufc_card' AND "sports_events"."is_current" = true;--> statement-breakpoint
CREATE INDEX "sports_fights_family_event_order_idx" ON "sports_fights" USING btree ("family_id","event_id","bout_order");--> statement-breakpoint
CREATE UNIQUE INDEX "sports_fights_one_main_event_idx" ON "sports_fights" USING btree ("event_id") WHERE "sports_fights"."is_main_event" = true;