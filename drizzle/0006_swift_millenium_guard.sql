DO $$ BEGIN
  CREATE TYPE "public"."access_method" AS ENUM('google', 'code');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "access_method" "access_method" DEFAULT 'code' NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "google_email" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "access_codes" ADD COLUMN IF NOT EXISTS "consumed_by_auth_user_id" text;--> statement-breakpoint
UPDATE "members" AS target
SET "access_method" = 'google',
    "google_email" = (
      SELECT lower(auth.email)
      FROM "member_devices" AS linked
      JOIN "user" AS auth ON auth.id = linked.auth_user_id
      WHERE linked.member_id = target.id
        AND linked.revoked_at IS NULL
        AND auth.is_anonymous = false
        AND auth.email_verified = true
      ORDER BY linked.created_at ASC
      LIMIT 1
    )
WHERE target.role = 'administrator' AND target.google_email IS NULL
  AND EXISTS (
    SELECT 1 FROM "member_devices" AS linked
    JOIN "user" AS auth ON auth.id = linked.auth_user_id
    WHERE linked.member_id = target.id
      AND linked.revoked_at IS NULL
      AND auth.is_anonymous = false
      AND auth.email_verified = true
  );--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "members_google_email_unique_idx" ON "members" USING btree (lower("google_email")) WHERE "google_email" IS NOT NULL;
