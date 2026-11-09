-- User-requested removal of Dónde verla. Historical migrations stay immutable.
-- Only availability data and its own audit entries are removed.
UPDATE families SET library_revision=library_revision+1
WHERE id IN (SELECT family_id FROM streaming_platforms);
--> statement-breakpoint
DELETE FROM audit_events WHERE entity_type IN ('streaming_platform','library_availability');
--> statement-breakpoint
DROP TABLE "library_availability_operations";
--> statement-breakpoint
DROP TABLE "library_availability_proposals";
--> statement-breakpoint
DROP TABLE "library_streaming_offers";
--> statement-breakpoint
DROP TABLE "library_platform_checks";
--> statement-breakpoint
DROP TABLE "streaming_platform_aliases";
--> statement-breakpoint
DROP TABLE "streaming_platforms";
--> statement-breakpoint
DROP FUNCTION availability_offer_guard();
--> statement-breakpoint
DROP FUNCTION availability_platform_guard();
--> statement-breakpoint
DROP FUNCTION availability_proposal_immutable();
--> statement-breakpoint
DROP FUNCTION availability_check_offer_dates();
--> statement-breakpoint
DROP FUNCTION availability_channel_valid(jsonb);
--> statement-breakpoint
DROP FUNCTION availability_urls_valid(text[],boolean);
