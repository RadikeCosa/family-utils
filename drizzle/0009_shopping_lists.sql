CREATE TABLE "shopping_editors" (
	"list_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"brand" varchar(160),
	"quantity" varchar(100),
	"version" integer DEFAULT 1 NOT NULL,
	"purchased" boolean DEFAULT false NOT NULL,
	"purchased_by_member_id" uuid,
	"purchased_at" timestamp with time zone,
	"updated_by_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"owner_member_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"normalized_name" text NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN "shopping_revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shopping_editors" ADD CONSTRAINT "shopping_editors_list_id_shopping_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."shopping_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_editors" ADD CONSTRAINT "shopping_editors_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_list_id_shopping_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."shopping_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_purchased_by_member_id_members_id_fk" FOREIGN KEY ("purchased_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_updated_by_member_id_members_id_fk" FOREIGN KEY ("updated_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_owner_member_id_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_suggestions" ADD CONSTRAINT "shopping_suggestions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_editors_unique" ON "shopping_editors" USING btree ("list_id","member_id");--> statement-breakpoint
CREATE INDEX "shopping_items_list_idx" ON "shopping_items" USING btree ("list_id","created_at","id");--> statement-breakpoint
CREATE INDEX "shopping_lists_family_idx" ON "shopping_lists" USING btree ("family_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_suggestions_family_name_unique" ON "shopping_suggestions" USING btree ("family_id","normalized_name");