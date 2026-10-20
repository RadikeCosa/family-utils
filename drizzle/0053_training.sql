-- Validate nested JSONB independently of the API; never execute caller-provided SQL.
CREATE FUNCTION public.training_blocks_valid(blocks jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE b jsonb; e jsonb; n numeric;
BEGIN
 IF jsonb_typeof(blocks) <> 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(blocks) NOT BETWEEN 1 AND 20 THEN RETURN false; END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(blocks) LOOP
  IF jsonb_typeof(b) <> 'object' THEN RETURN false; END IF;
  IF NOT (b ?& ARRAY['name','rounds','exercises']) OR (b - ARRAY['name','rounds','exercises']) <> '{}'::jsonb THEN RETURN false; END IF;
  IF jsonb_typeof(b->'name') <> 'string' OR char_length(b->>'name') > 80 OR jsonb_typeof(b->'rounds') <> 'number' THEN RETURN false; END IF;
  n := (b->>'rounds')::numeric;
  IF n <> trunc(n) OR n NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
  IF jsonb_typeof(b->'exercises') <> 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(b->'exercises') NOT BETWEEN 1 AND 30 THEN RETURN false; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(b->'exercises') LOOP
   IF jsonb_typeof(e) <> 'object' THEN RETURN false; END IF;
   IF jsonb_typeof(e->'name') IS DISTINCT FROM 'string' OR char_length(btrim(e->>'name')) NOT BETWEEN 1 AND 120 THEN RETURN false; END IF;
   IF e->>'mode' = 'repetitions' THEN
    IF NOT (e ?& ARRAY['name','mode','repetitions']) OR (e - ARRAY['name','mode','repetitions']) <> '{}'::jsonb OR jsonb_typeof(e->'repetitions') <> 'number' THEN RETURN false; END IF;
    n := (e->>'repetitions')::numeric;
    IF n <> trunc(n) OR n NOT BETWEEN 1 AND 1000 THEN RETURN false; END IF;
   ELSIF e->>'mode' = 'time' THEN
    IF NOT (e ?& ARRAY['name','mode','seconds']) OR (e - ARRAY['name','mode','seconds']) <> '{}'::jsonb OR jsonb_typeof(e->'seconds') <> 'number' THEN RETURN false; END IF;
    n := (e->>'seconds')::numeric;
    IF n <> trunc(n) OR n NOT BETWEEN 1 AND 14400 THEN RETURN false; END IF;
   ELSE RETURN false;
   END IF;
  END LOOP;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE TABLE "training_routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"owner_member_id" uuid NOT NULL,
	"name" text NOT NULL,
	"blocks" jsonb NOT NULL,
	"operation_key" uuid NOT NULL,
	"creation_hash" varchar(64) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_routines_name" CHECK (char_length(btrim("training_routines"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "training_routines_blocks" CHECK (public.training_blocks_valid("training_routines"."blocks")),
	CONSTRAINT "training_routines_version" CHECK ("training_routines"."version" > 0),
	CONSTRAINT "training_routines_hash" CHECK ("training_routines"."creation_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "training_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"owner_member_id" uuid NOT NULL,
	"source_routine_id" uuid NOT NULL,
	"name" text NOT NULL,
	"blocks" jsonb NOT NULL,
	"performed_on" date NOT NULL,
	"duration_seconds" integer NOT NULL,
	"effort" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"operation_key" uuid NOT NULL,
	"creation_hash" varchar(64) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_sessions_name" CHECK (char_length(btrim("training_sessions"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "training_sessions_blocks" CHECK (public.training_blocks_valid("training_sessions"."blocks")),
	CONSTRAINT "training_sessions_duration" CHECK ("training_sessions"."duration_seconds" BETWEEN 1 AND 86400),
	CONSTRAINT "training_sessions_effort" CHECK ("training_sessions"."effort" BETWEEN 1 AND 10),
	CONSTRAINT "training_sessions_note" CHECK (char_length("training_sessions"."note") <= 2000),
	CONSTRAINT "training_sessions_date" CHECK ("training_sessions"."performed_on" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
	CONSTRAINT "training_sessions_version" CHECK ("training_sessions"."version" > 0),
	CONSTRAINT "training_sessions_hash" CHECK ("training_sessions"."creation_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "training_routines_owner_operation_unique" ON "training_routines" USING btree ("owner_member_id","operation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "training_routines_identity_unique" ON "training_routines" USING btree ("id","owner_member_id","family_id");--> statement-breakpoint
CREATE INDEX "training_routines_active_page_idx" ON "training_routines" USING btree ("owner_member_id","family_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "training_routines"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "training_routines_archived_page_idx" ON "training_routines" USING btree ("owner_member_id","family_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "training_routines"."archived_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "training_sessions_owner_operation_unique" ON "training_sessions" USING btree ("owner_member_id","operation_key");--> statement-breakpoint
CREATE INDEX "training_sessions_page_idx" ON "training_sessions" USING btree ("owner_member_id","family_id","performed_on" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
ALTER TABLE "training_routines" ADD CONSTRAINT "training_routines_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_routines" ADD CONSTRAINT "training_routines_owner_member_id_family_id_members_id_family_id_fk" FOREIGN KEY ("owner_member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_owner_member_id_family_id_members_id_family_id_fk" FOREIGN KEY ("owner_member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_source_routine_id_owner_member_id_family_id_training_routines_id_owner_member_id_family_id_fk" FOREIGN KEY ("source_routine_id","owner_member_id","family_id") REFERENCES "public"."training_routines"("id","owner_member_id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
--> statement-breakpoint
-- No public/Data API grants, including managed PostgreSQL defaults.
REVOKE ALL ON public.training_routines, public.training_sessions FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.training_blocks_valid(jsonb) FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE role_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON public.training_routines, public.training_sessions FROM %I', role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION public.training_blocks_valid(jsonb) FROM %I', role_name);
  END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='family_utils_backup_reader') THEN
  GRANT SELECT ON public.training_routines, public.training_sessions TO family_utils_backup_reader;
 END IF;
END $$;
