CREATE UNIQUE INDEX "meal_ideas_family_id_unique" ON "meal_ideas" USING btree ("family_id","id");--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"idea_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"quantity" varchar(100),
	"position" integer NOT NULL,
	CONSTRAINT "recipe_ingredients_position_check" CHECK ("recipe_ingredients"."position" >= 0 AND "recipe_ingredients"."position" < 100),
	CONSTRAINT "recipe_ingredients_name_check" CHECK (length(trim("recipe_ingredients"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "meal_ideas" ADD COLUMN "yield_text" varchar(100);--> statement-breakpoint
ALTER TABLE "meal_ideas" ADD COLUMN "preparation" text;--> statement-breakpoint
ALTER TABLE "meal_ideas" ADD COLUMN "updated_by_member_id" uuid;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_family_idea_fk" FOREIGN KEY ("family_id","idea_id") REFERENCES "public"."meal_ideas"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_ingredients_idea_order_idx" ON "recipe_ingredients" USING btree ("idea_id","position");--> statement-breakpoint
ALTER TABLE "meal_ideas" ADD CONSTRAINT "meal_ideas_updated_by_member_id_members_id_fk" FOREIGN KEY ("updated_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
