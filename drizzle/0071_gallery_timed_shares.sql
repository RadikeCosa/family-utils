CREATE TABLE "gallery_share_drawings" (
	"share_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"author_member_id" uuid NOT NULL,
	"drawing_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_share_drawings_position" CHECK ("gallery_share_drawings"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "gallery_share_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"share_id" uuid NOT NULL,
	"session_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_share_sessions_session_hash_unique" UNIQUE("session_hash"),
	CONSTRAINT "gallery_share_sessions_hash" CHECK ("gallery_share_sessions"."session_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "gallery_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"collection_id" uuid,
	"collection_owner_member_id" uuid,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_shares_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "gallery_shares_scope_owner" CHECK (("gallery_shares"."collection_id" IS NULL AND "gallery_shares"."collection_owner_member_id" IS NULL) OR ("gallery_shares"."collection_id" IS NOT NULL AND "gallery_shares"."collection_owner_member_id" IS NOT NULL)),
	CONSTRAINT "gallery_shares_token_hash" CHECK ("gallery_shares"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_shares_id_family_unique" ON "gallery_shares" USING btree ("id","family_id");
--> statement-breakpoint
ALTER TABLE "gallery_share_drawings" ADD CONSTRAINT "gallery_share_drawings_share_id_family_id_gallery_shares_id_family_id_fk" FOREIGN KEY ("share_id","family_id") REFERENCES "public"."gallery_shares"("id","family_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_share_drawings" ADD CONSTRAINT "gallery_share_drawings_drawing_id_family_id_author_member_id_gallery_drawings_id_family_id_author_member_id_fk" FOREIGN KEY ("drawing_id","family_id","author_member_id") REFERENCES "public"."gallery_drawings"("id","family_id","author_member_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_share_sessions" ADD CONSTRAINT "gallery_share_sessions_share_id_family_id_gallery_shares_id_family_id_fk" FOREIGN KEY ("share_id","family_id") REFERENCES "public"."gallery_shares"("id","family_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_shares" ADD CONSTRAINT "gallery_shares_created_by_member_id_family_id_members_id_family_id_fk" FOREIGN KEY ("created_by_member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_shares" ADD CONSTRAINT "gallery_shares_collection_id_family_id_collection_owner_member_id_gallery_collections_id_family_id_owner_member_id_fk" FOREIGN KEY ("collection_id","family_id","collection_owner_member_id") REFERENCES "public"."gallery_collections"("id","family_id","owner_member_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_share_drawings_unique" ON "gallery_share_drawings" USING btree ("share_id","drawing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_share_drawings_position_unique" ON "gallery_share_drawings" USING btree ("share_id","position");--> statement-breakpoint
CREATE INDEX "gallery_share_drawings_page_idx" ON "gallery_share_drawings" USING btree ("share_id","position","drawing_id");--> statement-breakpoint
CREATE INDEX "gallery_share_sessions_share_idx" ON "gallery_share_sessions" USING btree ("share_id","expires_at");--> statement-breakpoint
CREATE INDEX "gallery_shares_family_created_idx" ON "gallery_shares" USING btree ("family_id","created_at" DESC NULLS LAST);--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'family_utils_backup_reader') THEN
    GRANT SELECT ON public.gallery_shares,
      public.gallery_share_drawings,
      public.gallery_share_sessions,
      public.audit_events
      TO family_utils_backup_reader;
  END IF;
END $$;
