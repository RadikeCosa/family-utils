CREATE TYPE "public"."meal_group_kind" AS ENUM('home', 'packed', 'shared');--> statement-breakpoint
CREATE TYPE "public"."meal_participation" AS ENUM('home', 'packed', 'away', 'unknown');--> statement-breakpoint
CREATE TABLE "meal_distributions" (
	"slot_id" uuid PRIMARY KEY NOT NULL,
	"participants" jsonb NOT NULL,
	"adjusted" boolean DEFAULT false NOT NULL,
	"updated_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_exceptions" (
	"slot_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" "meal_participation" NOT NULL,
	"group_id" uuid,
	"updated_by_member_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_id" uuid NOT NULL,
	"kind" "meal_group_kind" NOT NULL,
	"name" varchar(80) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"follows_home" boolean DEFAULT false NOT NULL,
	"suggestion_id" uuid,
	"confirmed_by_member_id" uuid,
	"confirmed_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"meal_type" "meal_type" NOT NULL,
	"starts_on" date NOT NULL,
	"name" varchar(80) DEFAULT 'Rutina habitual' NOT NULL,
	"weekdays" jsonb NOT NULL,
	"updated_by_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meal_distributions" ADD CONSTRAINT "meal_distributions_slot_id_meal_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."meal_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_distributions" ADD CONSTRAINT "meal_distributions_updated_by_member_id_members_id_fk" FOREIGN KEY ("updated_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_exceptions" ADD CONSTRAINT "meal_exceptions_slot_id_meal_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."meal_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_exceptions" ADD CONSTRAINT "meal_exceptions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_exceptions" ADD CONSTRAINT "meal_exceptions_group_id_meal_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."meal_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_exceptions" ADD CONSTRAINT "meal_exceptions_updated_by_member_id_members_id_fk" FOREIGN KEY ("updated_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_groups" ADD CONSTRAINT "meal_groups_slot_id_meal_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."meal_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_groups" ADD CONSTRAINT "meal_groups_suggestion_id_meal_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."meal_suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_groups" ADD CONSTRAINT "meal_groups_confirmed_by_member_id_members_id_fk" FOREIGN KEY ("confirmed_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_routines" ADD CONSTRAINT "meal_routines_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_routines" ADD CONSTRAINT "meal_routines_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_routines" ADD CONSTRAINT "meal_routines_updated_by_member_id_members_id_fk" FOREIGN KEY ("updated_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meal_exceptions_unique" ON "meal_exceptions" USING btree ("slot_id","member_id");--> statement-breakpoint
CREATE INDEX "meal_groups_slot_idx" ON "meal_groups" USING btree ("slot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_groups_default_unique" ON "meal_groups" USING btree ("slot_id","kind") WHERE "meal_groups"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "meal_routines_version_unique" ON "meal_routines" USING btree ("member_id","meal_type","starts_on");--> statement-breakpoint
CREATE INDEX "meal_routines_family_idx" ON "meal_routines" USING btree ("family_id","starts_on");--> statement-breakpoint
INSERT INTO meal_groups (slot_id,kind,name,is_default,suggestion_id,confirmed_by_member_id,confirmed_at,version,created_at,updated_at)
SELECT s.id, CASE WHEN s.meal_type IN ('lunch','dinner') THEN 'home'::meal_group_kind ELSE 'shared'::meal_group_kind END,
       CASE WHEN s.meal_type IN ('lunch','dinner') THEN 'Casa' ELSE 'Compartido' END,
       true, sel.suggestion_id, sel.confirmed_by_member_id, sel.confirmed_at, coalesce(sel.version,0),s.created_at,s.updated_at
FROM meal_slots s LEFT JOIN meal_selections sel ON sel.slot_id=s.id;
--> statement-breakpoint
INSERT INTO meal_distributions (slot_id,participants,created_at,updated_at)
SELECT s.id, coalesce(jsonb_agg(jsonb_build_object(
  'memberId',m.id,'status',CASE WHEN a.status='present' THEN 'home' WHEN a.status='absent' THEN 'away' ELSE 'unknown' END,
  'groupId',CASE WHEN a.status='present' THEN g.id ELSE NULL END,
  'updatedByMemberId',a.updated_by_member_id,'updatedAt',a.updated_at
) ORDER BY m.created_at) FILTER (WHERE m.id IS NOT NULL),'[]'::jsonb),sel.confirmed_at,sel.updated_at
FROM meal_slots s JOIN meal_selections sel ON sel.slot_id=s.id AND sel.suggestion_id IS NOT NULL
JOIN meal_groups g ON g.slot_id=s.id AND g.kind='home'
LEFT JOIN members m ON m.family_id=s.family_id AND m.archived_at IS NULL
LEFT JOIN meal_attendance a ON a.slot_id=s.id AND a.member_id=m.id
WHERE s.meal_type IN ('lunch','dinner')
GROUP BY s.id,sel.confirmed_at,sel.updated_at;
--> statement-breakpoint
INSERT INTO meal_exceptions (slot_id,member_id,status,group_id,updated_by_member_id,updated_at)
SELECT a.slot_id,a.member_id,CASE WHEN a.status='present' THEN 'home'::meal_participation ELSE 'away'::meal_participation END,
       CASE WHEN a.status='present' THEN g.id ELSE NULL END,a.updated_by_member_id,a.updated_at
FROM meal_attendance a JOIN meal_slots s ON s.id=a.slot_id JOIN meal_groups g ON g.slot_id=s.id AND g.kind='home'
WHERE a.status IS NOT NULL AND s.meal_type IN ('lunch','dinner')
AND NOT EXISTS (SELECT 1 FROM meal_distributions d WHERE d.slot_id=s.id);
--> statement-breakpoint
UPDATE families SET menus_revision=menus_revision+1;
