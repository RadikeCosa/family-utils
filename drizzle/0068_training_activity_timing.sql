-- Additive activity timing support. Existing durations and content remain untouched.
CREATE FUNCTION public.training_diary_content_without_timing_valid(content jsonb, kind text) RETURNS boolean
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
CREATE FUNCTION public.training_activity_timing_valid(timing jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE started timestamptz; finished timestamptz; zone text; first_day date; last_day date; seconds numeric;
BEGIN
 IF timing IS NULL OR jsonb_typeof(timing)<>'object' OR (timing-ARRAY['startAt','endAt','timeZone'])<>'{}'::jsonb OR NOT (timing ?& ARRAY['startAt','endAt','timeZone']) THEN RETURN false; END IF;
 IF jsonb_typeof(timing->'startAt')<>'string' OR jsonb_typeof(timing->'endAt')<>'string' OR jsonb_typeof(timing->'timeZone')<>'string' THEN RETURN false; END IF;
 IF timing->>'startAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$' OR timing->>'endAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$' THEN RETURN false; END IF;
 started:=(timing->>'startAt')::timestamptz; finished:=(timing->>'endAt')::timestamptz; zone:=timing->>'timeZone';
 IF to_char(started AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS')<>left(timing->>'startAt',19) OR to_char(finished AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS')<>left(timing->>'endAt',19) THEN RETURN false; END IF;
 IF zone<>'UTC' AND position('/' IN zone)=0 THEN RETURN false; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name=zone) THEN RETURN false; END IF;
 first_day:=(started AT TIME ZONE zone)::date; last_day:=(finished AT TIME ZONE zone)::date;
 seconds:=extract(epoch FROM finished-started);
 RETURN first_day BETWEEN DATE '1900-01-01' AND DATE '2200-12-31' AND last_day BETWEEN first_day AND least(first_day+1,DATE '2200-12-31') AND seconds>0 AND seconds<=86400 AND seconds=trunc(seconds);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.training_diary_content_valid(content jsonb, kind text) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
BEGIN
 IF content IS NULL THEN RETURN true; END IF;
 IF kind='rest' AND content ? 'timing' THEN RETURN false; END IF;
 IF NOT public.training_diary_content_without_timing_valid(content-'timing',kind) THEN RETURN false; END IF;
 IF content ? 'timing' THEN
   IF content->'timing'='null'::jsonb THEN RETURN coalesce(content->'durationSeconds','null'::jsonb)='null'::jsonb; END IF;
   RETURN public.training_activity_timing_valid(content->'timing') AND coalesce((content->>'durationSeconds')::numeric=extract(epoch FROM (content->'timing'->>'endAt')::timestamptz-(content->'timing'->>'startAt')::timestamptz),false);
 END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.training_activity_date_valid(day date, plan jsonb, result jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE timing jsonb:=coalesce(result,plan)->'timing';
BEGIN
 IF timing IS NULL OR timing='null'::jsonb THEN RETURN true; END IF;
 RETURN public.training_activity_timing_valid(timing) AND ((timing->>'startAt')::timestamptz AT TIME ZONE (timing->>'timeZone'))::date=day;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
ALTER TABLE public.training_entries ADD CONSTRAINT training_activity_date CHECK (public.training_activity_date_valid(date,plan,result));
--> statement-breakpoint
CREATE FUNCTION public.training_activity_write_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE target text; timing jsonb; previous_timing jsonb; zone text;
BEGIN
 FOREACH target IN ARRAY ARRAY['plan','result'] LOOP
   timing:=(CASE WHEN target='plan' THEN NEW.plan ELSE NEW.result END)->'timing';
   previous_timing:=NULL;
   IF TG_OP='UPDATE' THEN previous_timing:=(CASE WHEN target='plan' THEN OLD.plan ELSE OLD.result END)->'timing'; END IF;
   IF timing IS NOT NULL AND timing<>'null'::jsonb AND timing IS DISTINCT FROM previous_timing THEN
     IF NOT public.training_activity_timing_valid(timing) THEN RAISE EXCEPTION 'Invalid timing' USING ERRCODE='P3004'; END IF;
     SELECT time_zone INTO zone FROM public.families WHERE id=NEW.family_id;
     IF timing->>'timeZone'<>zone OR (target='result' AND (timing->>'endAt')::timestamptz>statement_timestamp()) THEN RAISE EXCEPTION 'Invalid timing zone or future result' USING ERRCODE='P3004'; END IF;
   END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER training_activity_guard BEFORE INSERT OR UPDATE ON public.training_entries FOR EACH ROW EXECUTE FUNCTION public.training_activity_write_guard();
