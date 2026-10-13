CREATE TABLE "meal_daily_plans" (
	"slot_id" uuid PRIMARY KEY NOT NULL,
	"plan" jsonb NOT NULL,
	"original" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meal_daily_plans" ADD CONSTRAINT "meal_daily_plans_slot_id_meal_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."meal_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_daily_plans" ADD CONSTRAINT "meal_daily_plans_updated_by_member_id_members_id_fk" FOREIGN KEY ("updated_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;