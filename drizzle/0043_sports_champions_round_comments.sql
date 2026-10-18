CREATE TABLE "sports_football_round_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"author_member_id" uuid NOT NULL,
	"body" varchar(2000) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"retired_at" timestamp with time zone,
	"retired_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_round_comments_body_length" CHECK (char_length(btrim("sports_football_round_comments"."body")) BETWEEN 1 AND 2000),
	CONSTRAINT "sports_round_comments_version" CHECK ("sports_football_round_comments"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "sports_football_round_comments" ADD CONSTRAINT "sports_football_round_comments_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_round_comments" ADD CONSTRAINT "sports_football_round_comments_retired_by_member_id_members_id_fk" FOREIGN KEY ("retired_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_round_comments" ADD CONSTRAINT "sports_round_comments_family_round_fk" FOREIGN KEY ("family_id","round_id") REFERENCES "public"."sports_football_rounds"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_round_comments" ADD CONSTRAINT "sports_round_comments_family_author_fk" FOREIGN KEY ("family_id","author_member_id") REFERENCES "public"."members"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sports_round_comments_thread_created_idx" ON "sports_football_round_comments" USING btree ("family_id","round_id","created_at","id");