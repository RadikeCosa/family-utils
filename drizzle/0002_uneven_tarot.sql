ALTER TYPE "public"."occurrence_status" ADD VALUE 'missed' BEFORE 'archived';--> statement-breakpoint
ALTER TABLE "audit_events" ALTER COLUMN "actor_member_id" DROP NOT NULL;