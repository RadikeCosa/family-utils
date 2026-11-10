-- Additive migration; the legacy contract and its hashes are never rewritten.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE FUNCTION public.training_diary_content_valid(content jsonb, kind text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE k text; n numeric;
BEGIN
 IF content IS NULL THEN RETURN true; END IF;
 IF jsonb_typeof(content) <> 'object' OR (content - ARRAY['title','text','blocks','durationSeconds','effort']) <> '{}'::jsonb THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['title','text'] LOOP
   IF content ? k AND (jsonb_typeof(content->k) <> 'string' OR char_length(content->>k) > CASE WHEN k='title' THEN 120 ELSE 2000 END) THEN RETURN false; END IF;
 END LOOP;
 IF kind='rest' THEN RETURN NOT (content ?| ARRAY['blocks','durationSeconds','effort']); END IF;
 IF kind <> 'training' THEN RETURN false; END IF;
 IF content ? 'blocks' AND content->'blocks' <> '[]'::jsonb AND NOT public.training_blocks_valid(content->'blocks') THEN RETURN false; END IF;
 IF content ? 'blocks' AND jsonb_typeof(content->'blocks') <> 'array' THEN RETURN false; END IF;
 IF coalesce(btrim(content->>'title'),'')='' AND coalesce(btrim(content->>'text'),'')='' AND coalesce(jsonb_array_length(content->'blocks'),0)=0 THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['durationSeconds','effort'] LOOP
   IF content ? k AND content->k <> 'null'::jsonb THEN
     IF jsonb_typeof(content->k) <> 'number' THEN RETURN false; END IF;
     n := (content->>k)::numeric;
     IF n<>trunc(n) OR n<1 OR n>(CASE WHEN k='effort' THEN 10 ELSE 86400 END) THEN RETURN false; END IF;
   END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE TABLE "training_diary_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"owner_member_id" uuid NOT NULL,
	"operation_key" uuid NOT NULL,
	"hash" varchar(64) NOT NULL,
	"entry_id" uuid NOT NULL,
	"action" text NOT NULL,
	"confirmed_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_diary_operation_hash" CHECK ("training_diary_operations"."hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "training_diary_revisions" (
	"owner_member_id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_diary_state" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"transitioned_at" timestamp with time zone,
	CONSTRAINT "training_diary_singleton" CHECK ("training_diary_state"."singleton" = true)
);
--> statement-breakpoint
CREATE TABLE "training_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"owner_member_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"plan" jsonb,
	"result" jsonb,
	"disposition" text DEFAULT 'open' NOT NULL,
	"source_routine_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"search_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_entries_date" CHECK ("training_entries"."date" BETWEEN DATE '1900-01-01' AND DATE '2200-12-31'),
	CONSTRAINT "training_entries_kind" CHECK ("training_entries"."kind" IN ('training','rest')),
	CONSTRAINT "training_entries_content" CHECK (("training_entries"."plan" IS NOT NULL OR "training_entries"."result" IS NOT NULL) AND public.training_diary_content_valid("training_entries"."plan","training_entries"."kind") AND public.training_diary_content_valid("training_entries"."result","training_entries"."kind")),
	CONSTRAINT "training_entries_disposition" CHECK ("training_entries"."disposition" IN ('open','skipped') AND ("training_entries"."disposition"='open' OR ("training_entries"."plan" IS NOT NULL AND "training_entries"."result" IS NULL))),
	CONSTRAINT "training_entries_version" CHECK ("training_entries"."version">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "training_entries_identity_unique" ON "training_entries" USING btree ("id","owner_member_id","family_id");--> statement-breakpoint
ALTER TABLE "training_diary_operations" ADD CONSTRAINT "training_diary_operations_entry_id_owner_member_id_family_id_training_entries_id_owner_member_id_family_id_fk" FOREIGN KEY ("entry_id","owner_member_id","family_id") REFERENCES "public"."training_entries"("id","owner_member_id","family_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_diary_revisions" ADD CONSTRAINT "training_diary_revisions_owner_member_id_family_id_members_id_family_id_fk" FOREIGN KEY ("owner_member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_entries" ADD CONSTRAINT "training_entries_owner_member_id_family_id_members_id_family_id_fk" FOREIGN KEY ("owner_member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_entries" ADD CONSTRAINT "training_entries_source_routine_id_owner_member_id_family_id_training_routines_id_owner_member_id_family_id_fk" FOREIGN KEY ("source_routine_id","owner_member_id","family_id") REFERENCES "public"."training_routines"("id","owner_member_id","family_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "training_diary_operation_unique" ON "training_diary_operations" USING btree ("owner_member_id","operation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "training_entries_rest_unique" ON "training_entries" USING btree ("owner_member_id","family_id","date") WHERE "training_entries"."kind"='rest' AND "training_entries"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "training_entries_page_idx" ON "training_entries" USING btree ("owner_member_id","family_id","date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "training_entries_search_idx" ON "training_entries" USING gin ("search_text" gin_trgm_ops);
--> statement-breakpoint
INSERT INTO training_diary_state(singleton) VALUES(true);
--> statement-breakpoint
CREATE FUNCTION public.training_legacy_content(s public.training_sessions) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('title',s.name,'text',s.note,'blocks',s.blocks,'durationSeconds',s.duration_seconds,'effort',s.effort);
$$;
--> statement-breakpoint
CREATE FUNCTION public.training_entry_projection() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE content jsonb; parts text := ''; transitioned boolean;
BEGIN
 INSERT INTO public.training_diary_revisions(owner_member_id,family_id) VALUES(NEW.owner_member_id,NEW.family_id) ON CONFLICT DO NOTHING;
 PERFORM revision FROM public.training_diary_revisions WHERE owner_member_id=NEW.owner_member_id FOR UPDATE;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.owner_member_id,NEW.family_id) IS DISTINCT FROM (OLD.id,OLD.owner_member_id,OLD.family_id) THEN RAISE EXCEPTION 'Immutable diary identity' USING ERRCODE='23514'; END IF;
 SELECT transitioned_at IS NOT NULL INTO transitioned FROM public.training_diary_state WHERE singleton=true;
 IF transitioned AND NEW.archived_at IS NULL AND (TG_OP='INSERT' OR OLD.archived_at IS NOT NULL OR NEW.date<>OLD.date) THEN
   IF (SELECT count(*) FROM public.training_entries WHERE owner_member_id=NEW.owner_member_id AND family_id=NEW.family_id AND date=NEW.date AND archived_at IS NULL AND id<>NEW.id)>=100 THEN RAISE EXCEPTION 'DAY_FULL' USING ERRCODE='P3002'; END IF;
 END IF;
 IF NEW.kind='rest' THEN parts := 'descanso '; END IF;
 FOREACH content IN ARRAY ARRAY[NEW.plan,NEW.result] LOOP
   IF content IS NOT NULL THEN
     parts := parts || ' ' || coalesce(content->>'title','') || ' ' || coalesce(content->>'text','') || ' ' ||
       jsonb_path_query_array(content,'$.blocks[*].name')::text || ' ' || jsonb_path_query_array(content,'$.blocks[*].exercises[*].name')::text;
   END IF;
 END LOOP;
 NEW.search_text := public.normalize_name_v1(parts);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER training_entry_projection BEFORE INSERT OR UPDATE ON training_entries FOR EACH ROW EXECUTE FUNCTION public.training_entry_projection();
--> statement-breakpoint
CREATE FUNCTION public.training_entries_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 UPDATE public.training_diary_revisions r SET revision=r.revision+1
 FROM (SELECT DISTINCT owner_member_id,family_id FROM changed_entries) c
 WHERE r.owner_member_id=c.owner_member_id AND r.family_id=c.family_id;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER training_entries_insert_revision AFTER INSERT ON training_entries REFERENCING NEW TABLE AS changed_entries FOR EACH STATEMENT EXECUTE FUNCTION public.training_entries_revision();
--> statement-breakpoint
CREATE TRIGGER training_entries_update_revision AFTER UPDATE ON training_entries REFERENCING NEW TABLE AS changed_entries FOR EACH STATEMENT EXECUTE FUNCTION public.training_entries_revision();
--> statement-breakpoint
CREATE FUNCTION public.training_legacy_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE transitioned timestamptz;
BEGIN
 SELECT transitioned_at INTO transitioned FROM public.training_diary_state WHERE singleton=true FOR SHARE;
 IF transitioned IS NOT NULL THEN RAISE EXCEPTION 'CLIENT_UPDATE_REQUIRED' USING ERRCODE='P3001'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.training_legacy_mirror() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO public.training_entries(id,family_id,owner_member_id,date,kind,result,source_routine_id,version,created_at,updated_at)
 VALUES(NEW.id,NEW.family_id,NEW.owner_member_id,NEW.performed_on,'training',public.training_legacy_content(NEW),NEW.source_routine_id,NEW.version,NEW.created_at,NEW.updated_at)
 ON CONFLICT(id) DO UPDATE SET date=EXCLUDED.date,result=EXCLUDED.result,source_routine_id=EXCLUDED.source_routine_id,version=EXCLUDED.version,updated_at=EXCLUDED.updated_at;
 RETURN NEW;
END $$;
--> statement-breakpoint
-- Migrator transaction holds this lock through trigger installation and backfill.
LOCK TABLE training_sessions IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM training_sessions WHERE performed_on NOT BETWEEN DATE '1900-01-01' AND DATE '2200-12-31') THEN RAISE EXCEPTION 'Legacy dates outside diary range; no dates have been adjusted'; END IF;
END $$;
--> statement-breakpoint
CREATE TRIGGER training_legacy_guard BEFORE INSERT OR UPDATE OR DELETE ON training_sessions FOR EACH ROW EXECUTE FUNCTION public.training_legacy_guard();
--> statement-breakpoint
CREATE TRIGGER training_legacy_mirror AFTER INSERT OR UPDATE ON training_sessions FOR EACH ROW EXECUTE FUNCTION public.training_legacy_mirror();
--> statement-breakpoint
INSERT INTO training_entries(id,family_id,owner_member_id,date,kind,result,source_routine_id,version,created_at,updated_at)
SELECT id,family_id,owner_member_id,performed_on,'training',public.training_legacy_content(training_sessions),source_routine_id,version,created_at,updated_at FROM training_sessions;
--> statement-breakpoint
-- Administrative cutover: flag evaluation alone never calls this function.
CREATE FUNCTION public.training_diary_transition() RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM singleton FROM public.training_diary_state WHERE singleton=true FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.training_diary_state WHERE transitioned_at IS NOT NULL) THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.training_sessions s LEFT JOIN public.training_entries e ON e.id=s.id
   WHERE e.id IS NULL OR (e.family_id,e.owner_member_id,e.date,e.version,e.source_routine_id,e.result,e.plan,e.archived_at,e.disposition,e.kind)
   IS DISTINCT FROM (s.family_id,s.owner_member_id,s.performed_on,s.version,s.source_routine_id,public.training_legacy_content(s),NULL::jsonb,NULL::timestamptz,'open'::text,'training'::text))
   OR (SELECT count(*) FROM public.training_sessions)<>(SELECT count(*) FROM public.training_entries) THEN RAISE EXCEPTION 'Legacy diary correspondence failed'; END IF;
 UPDATE public.training_diary_state SET transitioned_at=clock_timestamp() WHERE singleton=true;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.training_diary_transition() FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['PUBLIC','anon','authenticated'] LOOP
   IF r='PUBLIC' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
     EXECUTE format('REVOKE ALL ON TABLE public.training_entries,public.training_diary_state,public.training_diary_revisions,public.training_diary_operations FROM %s',CASE WHEN r='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(r) END);
   END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='family_utils_backup_reader') THEN
   GRANT SELECT ON training_entries,training_diary_state,training_diary_revisions,training_diary_operations TO family_utils_backup_reader;
 END IF;
END $$;
