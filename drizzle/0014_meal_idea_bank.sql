CREATE TABLE "meal_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"author_member_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"note" varchar(1000),
	"meal_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"packed_suitable" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meal_suggestions" ADD COLUMN "catalog_idea_id" uuid;--> statement-breakpoint
ALTER TABLE "meal_ideas" ADD CONSTRAINT "meal_ideas_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_ideas" ADD CONSTRAINT "meal_ideas_author_member_id_members_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meal_ideas_family_idx" ON "meal_ideas" USING btree ("family_id","archived_at");--> statement-breakpoint
ALTER TABLE "meal_suggestions" ADD CONSTRAINT "meal_suggestions_catalog_idea_id_meal_ideas_id_fk" FOREIGN KEY ("catalog_idea_id") REFERENCES "public"."meal_ideas"("id") ON DELETE no action ON UPDATE no action;