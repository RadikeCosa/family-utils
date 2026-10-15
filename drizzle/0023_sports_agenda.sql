ALTER TABLE "sports_events" ADD COLUMN "city" varchar(160);--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "country" varchar(160);--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "event_type" varchar(16);--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_event_type" CHECK ("sports_events"."event_type" IS NULL OR ("sports_events"."kind" = 'ufc_card' AND "sports_events"."event_type" IN ('numerado','fight_night','otro')));