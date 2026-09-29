CREATE TYPE "public"."meal_attendance_status" AS ENUM('present', 'absent');--> statement-breakpoint
CREATE TYPE "public"."meal_type" AS ENUM('lunch', 'dinner');--> statement-breakpoint
CREATE TABLE "meal_attendance" (
	"slot_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" "meal_attendance_status",
	"updated_by_member_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_selections" (
	"slot_id" uuid PRIMARY KEY NOT NULL,
	"suggestion_id" uuid,
	"confirmed_by_member_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"meal_date" date NOT NULL,
	"meal_type" "meal_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_id" uuid NOT NULL,
	"author_member_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"note" varchar(1000),
	"version" integer DEFAULT 1 NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN "menus_revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_attendance" ADD CONSTRAINT "meal_attendance_slot_id_meal_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."meal_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_attendance" ADD CONSTRAINT "meal_attendance_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_attendance" ADD CONSTRAINT "meal_attendance_updated_by_member_id_members_id_fk" FOREIGN KEY ("updated_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_selections" ADD CONSTRAINT "meal_selections_slot_id_meal_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."meal_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_selections" ADD CONSTRAINT "meal_selections_suggestion_id_meal_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."meal_suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_selections" ADD CONSTRAINT "meal_selections_confirmed_by_member_id_members_id_fk" FOREIGN KEY ("confirmed_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_slots" ADD CONSTRAINT "meal_slots_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_suggestions" ADD CONSTRAINT "meal_suggestions_slot_id_meal_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."meal_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_suggestions" ADD CONSTRAINT "meal_suggestions_author_member_id_members_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meal_attendance_pk" ON "meal_attendance" USING btree ("slot_id","member_id");--> statement-breakpoint
CREATE INDEX "meal_attendance_member_idx" ON "meal_attendance" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_slots_family_date_type_unique" ON "meal_slots" USING btree ("family_id","meal_date","meal_type");--> statement-breakpoint
CREATE INDEX "meal_slots_family_date_idx" ON "meal_slots" USING btree ("family_id","meal_date");--> statement-breakpoint
CREATE INDEX "meal_suggestions_slot_created_idx" ON "meal_suggestions" USING btree ("slot_id","created_at");
