DO $$ BEGIN
  CREATE TYPE "public"."identity_kind" AS ENUM('google', 'anonymous');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

ALTER TABLE "member_devices" ADD COLUMN IF NOT EXISTS "identity_kind" "identity_kind" DEFAULT 'anonymous' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_occurrences" ADD COLUMN IF NOT EXISTS "generation_date" date;--> statement-breakpoint
ALTER TABLE "task_occurrences" ADD COLUMN IF NOT EXISTS "title_snapshot" varchar(160);--> statement-breakpoint
ALTER TABLE "task_occurrences" ADD COLUMN IF NOT EXISTS "description_snapshot" text;--> statement-breakpoint
ALTER TABLE "task_occurrences" ADD COLUMN IF NOT EXISTS "scheduled_time_snapshot" time;--> statement-breakpoint
ALTER TABLE "task_occurrences" ADD COLUMN IF NOT EXISTS "assignment_mode_snapshot" "assignment_mode";--> statement-breakpoint
ALTER TABLE "task_occurrences" ADD COLUMN IF NOT EXISTS "assignee_ids_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "task_occurrences" ADD COLUMN IF NOT EXISTS "carry_policy_snapshot" "carry_policy" DEFAULT 'expires_daily' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_occurrences" ADD COLUMN IF NOT EXISTS "carry_forward" boolean DEFAULT false NOT NULL;--> statement-breakpoint

UPDATE "member_devices" AS device
SET "identity_kind" = CASE WHEN auth."is_anonymous" THEN 'anonymous'::"identity_kind" ELSE 'google'::"identity_kind" END
FROM "user" AS auth
WHERE auth.id = device.auth_user_id;--> statement-breakpoint

UPDATE "task_occurrences" AS occurrence
SET "generation_date" = COALESCE(occurrence."generation_date", occurrence."due_date"),
    "title_snapshot" = task."title",
    "description_snapshot" = task."description",
    "scheduled_time_snapshot" = task."scheduled_time",
    "assignment_mode_snapshot" = task."assignment_mode",
    "assignee_ids_snapshot" = COALESCE((
      SELECT jsonb_agg(to_jsonb(assignment.member_id::text) ORDER BY assignment.member_id)
      FROM "task_assignees" AS assignment
      WHERE assignment.task_id = task.id
    ), '[]'::jsonb),
    "carry_policy_snapshot" = task."carry_policy",
    "carry_forward" = task."carry_policy" = 'carry_forward'
FROM "tasks" AS task
WHERE occurrence.task_id = task.id AND occurrence.title_snapshot IS NULL;--> statement-breakpoint

ALTER TABLE "task_occurrences" ALTER COLUMN "title_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "task_occurrences" ALTER COLUMN "assignment_mode_snapshot" SET NOT NULL;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "task_occurrences"
    WHERE status = 'open' AND carry_forward = true
    GROUP BY task_id, responsibility_member_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Ambiguous open carry-forward occurrences; review rows before migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "member_devices"
    WHERE identity_kind = 'google' AND revoked_at IS NULL
    GROUP BY member_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Multiple active Google identities for a family profile; review before migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "account"
    WHERE provider_id = 'google'
    GROUP BY provider_id, account_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate Google provider identities; review before migration';
  END IF;
END $$;--> statement-breakpoint

DROP INDEX IF EXISTS "occurrences_shared_once_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "occurrences_individual_once_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "occurrences_shared_no_date_once_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "occurrences_individual_no_date_once_idx";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "account_google_identity_unique_idx"
  ON "account" USING btree ("provider_id", "account_id") WHERE "provider_id" = 'google';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "member_devices_one_google_identity_per_member_idx"
  ON "member_devices" USING btree ("member_id") WHERE "identity_kind" = 'google' AND "revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "occurrences_shared_generation_once_idx"
  ON "task_occurrences" USING btree ("task_id", "generation_date")
  WHERE "responsibility_member_id" IS NULL AND "generation_date" IS NOT NULL AND "status" <> 'archived';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "occurrences_individual_generation_once_idx"
  ON "task_occurrences" USING btree ("task_id", "generation_date", "responsibility_member_id")
  WHERE "responsibility_member_id" IS NOT NULL AND "generation_date" IS NOT NULL AND "status" <> 'archived';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "occurrences_shared_no_date_once_idx"
  ON "task_occurrences" USING btree ("task_id")
  WHERE "responsibility_member_id" IS NULL AND "generation_date" IS NULL AND "status" <> 'archived';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "occurrences_individual_no_date_once_idx"
  ON "task_occurrences" USING btree ("task_id", "responsibility_member_id")
  WHERE "responsibility_member_id" IS NOT NULL AND "generation_date" IS NULL AND "status" <> 'archived';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "occurrences_shared_open_carry_once_idx"
  ON "task_occurrences" USING btree ("task_id")
  WHERE "responsibility_member_id" IS NULL AND "status" = 'open' AND "carry_forward" = true;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "occurrences_individual_open_carry_once_idx"
  ON "task_occurrences" USING btree ("task_id", "responsibility_member_id")
  WHERE "responsibility_member_id" IS NOT NULL AND "status" = 'open' AND "carry_forward" = true;
