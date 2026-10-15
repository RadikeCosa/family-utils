CREATE TABLE "sports_formations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"body" varchar(500) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_formations_body" CHECK (char_length(btrim("sports_formations"."body")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "sports_weeks" (
	"family_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"no_ufc_event" boolean DEFAULT false NOT NULL,
	"updated_by_member_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sports_comments" DROP CONSTRAINT "sports_comments_context_event_id_sports_events_id_fk";
--> statement-breakpoint
ALTER TABLE "sports_fights" DROP CONSTRAINT "sports_fights_event_id_sports_events_id_fk";
--> statement-breakpoint
DROP INDEX "sports_events_one_current_ufc_card_idx";--> statement-breakpoint
ALTER TABLE "sports_events" ALTER COLUMN "event_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "venue" varchar(200);--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sports_formations" ADD CONSTRAINT "sports_formations_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_formations" ADD CONSTRAINT "sports_formations_event_id_sports_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."sports_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_formations" ADD CONSTRAINT "sports_formations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_weeks" ADD CONSTRAINT "sports_weeks_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_weeks" ADD CONSTRAINT "sports_weeks_updated_by_member_id_members_id_fk" FOREIGN KEY ("updated_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sports_formations_family_event_member_unique" ON "sports_formations" USING btree ("family_id","event_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sports_weeks_family_week_unique" ON "sports_weeks" USING btree ("family_id","week_start");--> statement-breakpoint
ALTER TABLE "sports_comments" ADD CONSTRAINT "sports_comments_context_event_id_sports_events_id_fk" FOREIGN KEY ("context_event_id") REFERENCES "public"."sports_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_fights" ADD CONSTRAINT "sports_fights_event_id_sports_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."sports_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_ufc_date" CHECK ("sports_events"."kind" <> 'ufc_card' OR "sports_events"."event_date" IS NOT NULL);