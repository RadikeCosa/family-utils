CREATE TABLE "library_companions" (
	"family_id" uuid NOT NULL,
	"contribution_id" uuid NOT NULL,
	"member_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"author_member_id" uuid NOT NULL,
	"body" text NOT NULL,
	"spoiler" boolean DEFAULT false NOT NULL,
	"experience_year" integer,
	"experience_month" integer,
	"experience_day" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_contributions_body_length" CHECK (char_length(btrim("library_contributions"."body")) BETWEEN 1 AND 5000),
	CONSTRAINT "library_contributions_version" CHECK ("library_contributions"."version" > 0),
	CONSTRAINT "library_contributions_experience" CHECK (
    ("library_contributions"."experience_year" IS NULL AND "library_contributions"."experience_month" IS NULL AND "library_contributions"."experience_day" IS NULL)
    OR ("library_contributions"."experience_year" BETWEEN 1 AND 9999 AND
      (("library_contributions"."experience_month" IS NULL AND "library_contributions"."experience_day" IS NULL) OR
       ("library_contributions"."experience_month" BETWEEN 1 AND 12 AND ("library_contributions"."experience_day" IS NULL OR
        CASE WHEN "library_contributions"."experience_year" BETWEEN 1 AND 9999 AND "library_contributions"."experience_month" BETWEEN 1 AND 12
        THEN "library_contributions"."experience_day" BETWEEN 1 AND extract(day from (make_date("library_contributions"."experience_year", "library_contributions"."experience_month", 1) + interval '1 month - 1 day'))
        ELSE false END)))) IS TRUE)
);
--> statement-breakpoint
CREATE TABLE "library_personal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" text,
	"rating" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_personal_status" CHECK ("library_personal"."status" IS NULL OR "library_personal"."status" IN ('pending', 'in_progress', 'finished')),
	CONSTRAINT "library_personal_rating" CHECK ("library_personal"."rating" IS NULL OR "library_personal"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "library_personal_version" CHECK ("library_personal"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "library_works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"title" text NOT NULL,
	"titulo_normalizado" text NOT NULL,
	"kind" text NOT NULL,
	"creator" text,
	"creador_normalizado" text DEFAULT '' NOT NULL,
	"year" integer,
	"reference_url" text,
	"created_by_member_id" uuid NOT NULL,
	"updated_by_member_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_works_title_length" CHECK (char_length(btrim("library_works"."title")) BETWEEN 1 AND 200),
	CONSTRAINT "library_works_creator_length" CHECK ("library_works"."creator" IS NULL OR char_length("library_works"."creator") BETWEEN 1 AND 200),
	CONSTRAINT "library_works_url" CHECK ("library_works"."reference_url" IS NULL OR (char_length("library_works"."reference_url") BETWEEN 1 AND 2048 AND "library_works"."reference_url" ~* '^https?://[^[:space:]]+$')),
	CONSTRAINT "library_works_year" CHECK ("library_works"."year" IS NULL OR "library_works"."year" BETWEEN 1 AND 9999),
	CONSTRAINT "library_works_kind" CHECK ("library_works"."kind" IN ('movie', 'series', 'book', 'music', 'art', 'video_game', 'tabletop_game')),
	CONSTRAINT "library_works_version" CHECK ("library_works"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN "library_revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "library_companions_unique" ON "library_companions" USING btree ("contribution_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "library_contributions_id_family_unique" ON "library_contributions" USING btree ("id","family_id");--> statement-breakpoint
CREATE INDEX "library_contributions_work_created_idx" ON "library_contributions" USING btree ("work_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "library_personal_work_member_unique" ON "library_personal" USING btree ("work_id","member_id");--> statement-breakpoint
CREATE INDEX "library_personal_member_status_idx" ON "library_personal" USING btree ("family_id","member_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "library_works_id_family_unique" ON "library_works" USING btree ("id","family_id");--> statement-breakpoint
CREATE INDEX "library_works_duplicate_idx" ON "library_works" USING btree ("family_id","kind","titulo_normalizado");--> statement-breakpoint
CREATE INDEX "library_works_family_created_idx" ON "library_works" USING btree ("family_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_id_family_unique" ON "members" USING btree ("id","family_id");--> statement-breakpoint
ALTER TABLE "library_companions" ADD CONSTRAINT "library_companions_contribution_id_family_id_library_contributions_id_family_id_fk" FOREIGN KEY ("contribution_id","family_id") REFERENCES "public"."library_contributions"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_companions" ADD CONSTRAINT "library_companions_member_id_family_id_members_id_family_id_fk" FOREIGN KEY ("member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_contributions" ADD CONSTRAINT "library_contributions_work_id_family_id_library_works_id_family_id_fk" FOREIGN KEY ("work_id","family_id") REFERENCES "public"."library_works"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_contributions" ADD CONSTRAINT "library_contributions_author_member_id_family_id_members_id_family_id_fk" FOREIGN KEY ("author_member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_personal" ADD CONSTRAINT "library_personal_work_id_family_id_library_works_id_family_id_fk" FOREIGN KEY ("work_id","family_id") REFERENCES "public"."library_works"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_personal" ADD CONSTRAINT "library_personal_member_id_family_id_members_id_family_id_fk" FOREIGN KEY ("member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_works" ADD CONSTRAINT "library_works_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_works" ADD CONSTRAINT "library_works_created_by_member_id_family_id_members_id_family_id_fk" FOREIGN KEY ("created_by_member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_works" ADD CONSTRAINT "library_works_updated_by_member_id_family_id_members_id_family_id_fk" FOREIGN KEY ("updated_by_member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE no action ON UPDATE no action;