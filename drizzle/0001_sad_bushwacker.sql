CREATE TYPE "public"."assignment_mode" AS ENUM('shared', 'individual');--> statement-breakpoint
DROP INDEX "occurrences_shared_once_idx";--> statement-breakpoint
DROP INDEX "occurrences_individual_once_idx";--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "assignment_mode" SET DEFAULT 'shared'::"public"."assignment_mode";--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "assignment_mode" SET DATA TYPE "public"."assignment_mode" USING "assignment_mode"::"public"."assignment_mode";--> statement-breakpoint
CREATE UNIQUE INDEX "occurrences_shared_no_date_once_idx" ON "task_occurrences" USING btree ("task_id") WHERE "task_occurrences"."responsibility_member_id" IS NULL AND "task_occurrences"."due_date" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "occurrences_individual_no_date_once_idx" ON "task_occurrences" USING btree ("task_id","responsibility_member_id") WHERE "task_occurrences"."responsibility_member_id" IS NOT NULL AND "task_occurrences"."due_date" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "occurrences_shared_once_idx" ON "task_occurrences" USING btree ("task_id","due_date") WHERE "task_occurrences"."responsibility_member_id" IS NULL AND "task_occurrences"."due_date" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "occurrences_individual_once_idx" ON "task_occurrences" USING btree ("task_id","due_date","responsibility_member_id") WHERE "task_occurrences"."responsibility_member_id" IS NOT NULL AND "task_occurrences"."due_date" IS NOT NULL;