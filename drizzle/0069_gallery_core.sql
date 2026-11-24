CREATE TYPE "public"."gallery_drawing_status" AS ENUM('pending', 'processing', 'ready', 'failed', 'archived');--> statement-breakpoint
CREATE TABLE "gallery_collection_drawings" (
	"family_id" uuid NOT NULL,
	"owner_member_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"drawing_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gallery_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"owner_member_id" uuid NOT NULL,
	"title" varchar(120) NOT NULL,
	"description" varchar(500) DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_collections_title_nonempty" CHECK (length(btrim("gallery_collections"."title")) BETWEEN 1 AND 120),
	CONSTRAINT "gallery_collections_description_length" CHECK (length("gallery_collections"."description") <= 500),
	CONSTRAINT "gallery_collections_version" CHECK ("gallery_collections"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "gallery_drawings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"author_member_id" uuid NOT NULL,
	"status" "gallery_drawing_status" DEFAULT 'pending' NOT NULL,
	"original_name" varchar(255) NOT NULL,
	"original_sha256" varchar(64),
	"original_bytes" bigint NOT NULL,
	"pending_path" text,
	"source_mime_type" varchar(32) NOT NULL,
	"width" integer,
	"height" integer,
	"display_path" text,
	"thumbnail_path" text,
	"display_bytes" bigint,
	"thumbnail_bytes" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_drawings_hash_format" CHECK ("gallery_drawings"."original_sha256" IS NULL OR "gallery_drawings"."original_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "gallery_drawings_input_bytes" CHECK ("gallery_drawings"."original_bytes" > 0 AND "gallery_drawings"."original_bytes" <= 26214400),
	CONSTRAINT "gallery_drawings_mime" CHECK ("gallery_drawings"."source_mime_type" IN ('image/png','image/jpeg')),
	CONSTRAINT "gallery_drawings_dimensions" CHECK (("gallery_drawings"."width" IS NULL AND "gallery_drawings"."height" IS NULL) OR ("gallery_drawings"."width" BETWEEN 1 AND 40000000 AND "gallery_drawings"."height" BETWEEN 1 AND 40000000 AND "gallery_drawings"."width"::bigint * "gallery_drawings"."height" <= 40000000)),
	CONSTRAINT "gallery_drawings_derived_paths" CHECK (("gallery_drawings"."status" <> 'ready' OR ("gallery_drawings"."display_path" IS NOT NULL AND "gallery_drawings"."thumbnail_path" IS NOT NULL AND "gallery_drawings"."display_bytes" > 0 AND "gallery_drawings"."thumbnail_bytes" > 0 AND "gallery_drawings"."width" IS NOT NULL AND "gallery_drawings"."height" IS NOT NULL))),
	CONSTRAINT "gallery_drawings_version" CHECK ("gallery_drawings"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "gallery_guest_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"session_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_guest_sessions_session_hash_unique" UNIQUE("session_hash"),
	CONSTRAINT "gallery_guest_sessions_hash" CHECK ("gallery_guest_sessions"."session_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "gallery_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"owner_member_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "gallery_invitations_token_hash" CHECK ("gallery_invitations"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN "gallery_revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_collections_id_family_owner_unique" ON "gallery_collections" USING btree ("id","family_id","owner_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_drawings_id_family_author_unique" ON "gallery_drawings" USING btree ("id","family_id","author_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_invitations_id_family_collection_unique" ON "gallery_invitations" USING btree ("id","family_id","collection_id");--> statement-breakpoint
ALTER TABLE "gallery_collection_drawings" ADD CONSTRAINT "gallery_collection_drawings_collection_id_family_id_owner_member_id_gallery_collections_id_family_id_owner_member_id_fk" FOREIGN KEY ("collection_id","family_id","owner_member_id") REFERENCES "public"."gallery_collections"("id","family_id","owner_member_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_collection_drawings" ADD CONSTRAINT "gallery_collection_drawings_drawing_id_family_id_owner_member_id_gallery_drawings_id_family_id_author_member_id_fk" FOREIGN KEY ("drawing_id","family_id","owner_member_id") REFERENCES "public"."gallery_drawings"("id","family_id","author_member_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_collections" ADD CONSTRAINT "gallery_collections_owner_member_id_family_id_members_id_family_id_fk" FOREIGN KEY ("owner_member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_drawings" ADD CONSTRAINT "gallery_drawings_author_member_id_family_id_members_id_family_id_fk" FOREIGN KEY ("author_member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_guest_sessions" ADD CONSTRAINT "gallery_guest_sessions_invitation_id_family_id_collection_id_gallery_invitations_id_family_id_collection_id_fk" FOREIGN KEY ("invitation_id","family_id","collection_id") REFERENCES "public"."gallery_invitations"("id","family_id","collection_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_invitations" ADD CONSTRAINT "gallery_invitations_collection_id_family_id_owner_member_id_gallery_collections_id_family_id_owner_member_id_fk" FOREIGN KEY ("collection_id","family_id","owner_member_id") REFERENCES "public"."gallery_collections"("id","family_id","owner_member_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_invitations" ADD CONSTRAINT "gallery_invitations_created_by_member_id_family_id_members_id_family_id_fk" FOREIGN KEY ("created_by_member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_collection_drawings_unique" ON "gallery_collection_drawings" USING btree ("collection_id","drawing_id");--> statement-breakpoint
CREATE INDEX "gallery_collection_drawings_page_idx" ON "gallery_collection_drawings" USING btree ("collection_id","created_at","drawing_id");--> statement-breakpoint
CREATE INDEX "gallery_collections_owner_page_idx" ON "gallery_collections" USING btree ("family_id","owner_member_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_drawings_family_hash_unique" ON "gallery_drawings" USING btree ("family_id","original_sha256") WHERE "gallery_drawings"."original_sha256" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gallery_drawings_author_page_idx" ON "gallery_drawings" USING btree ("family_id","author_member_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "gallery_guest_sessions_invitation_idx" ON "gallery_guest_sessions" USING btree ("invitation_id","expires_at");--> statement-breakpoint
CREATE INDEX "gallery_invitations_owner_active_idx" ON "gallery_invitations" USING btree ("family_id","owner_member_id","created_at" DESC NULLS LAST);
