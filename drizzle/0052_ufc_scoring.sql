-- Append-only migration. Existing predictions/results and closure migration stay intact.
ALTER TABLE public.sports_events ADD COLUMN IF NOT EXISTS ufc_scoring_version integer;
ALTER TABLE public.sports_events ADD COLUMN IF NOT EXISTS ufc_main_fight_id uuid;
ALTER TABLE public.sports_events ADD COLUMN IF NOT EXISTS ufc_co_main_fight_id uuid;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.sports_ufc_scoring_roles(p_family uuid,p_event uuid)
RETURNS TABLE(main_fight_id uuid,co_main_fight_id uuid)
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT
 (SELECT f.id FROM public.sports_fights f WHERE f.family_id=p_family AND f.event_id=p_event
  AND f.prode_eligible AND f.is_main_event
  ORDER BY f.bout_order,(f.removed_at IS NOT NULL),f.id LIMIT 1),
 (SELECT f.id FROM public.sports_fights f WHERE f.family_id=p_family AND f.event_id=p_event
  AND f.prode_eligible AND NOT f.is_main_event AND f.bout_block='main'
  ORDER BY f.bout_order,(f.removed_at IS NOT NULL),f.id LIMIT 1)
$$;
--> statement-breakpoint
-- Nullable columns, fill only uninitialized rows, then activate management.
-- This is deliberately repeatable without resetting already frozen identities.
DROP TRIGGER IF EXISTS sports_ufc_scoring ON public.sports_events;
UPDATE public.sports_events e SET
 ufc_scoring_version=CASE WHEN e.event_date>=DATE '2026-10-17' THEN 2 ELSE 1 END,
 ufc_main_fight_id=(SELECT main_fight_id FROM public.sports_ufc_scoring_roles(e.family_id,e.id)),
 ufc_co_main_fight_id=(SELECT co_main_fight_id FROM public.sports_ufc_scoring_roles(e.family_id,e.id))
WHERE e.kind='ufc_card' AND e.ufc_scoring_version IS NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.sports_ufc_scoring_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.ufc_scoring_version IS DISTINCT FROM OLD.ufc_scoring_version
   OR NEW.ufc_main_fight_id IS DISTINCT FROM OLD.ufc_main_fight_id
   OR NEW.ufc_co_main_fight_id IS DISTINCT FROM OLD.ufc_co_main_fight_id THEN
   RAISE EXCEPTION 'UFC scoring columns are database managed' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NEW.ufc_scoring_version IS NOT NULL OR NEW.ufc_main_fight_id IS NOT NULL OR NEW.ufc_co_main_fight_id IS NOT NULL THEN
   RAISE EXCEPTION 'UFC scoring columns are database managed' USING ERRCODE='23514';
  END IF;
  IF NEW.kind='ufc_card' THEN
   NEW.ufc_scoring_version:=CASE WHEN NEW.event_date>=DATE '2026-10-17' THEN 2 ELSE 1 END;
  END IF;
 END IF;
 IF NEW.kind<>'ufc_card' THEN RETURN NEW; END IF;
 -- The earlier sports_ufc_event_close trigger has already evaluated the real clock.
 -- Fight writes refresh the event BEFORE changing composition, so this records
 -- the old identities exactly when a previously scheduled deadline has elapsed.
 IF TG_OP='INSERT' OR OLD.ufc_prediction_closed_at IS NULL THEN
  SELECT main_fight_id,co_main_fight_id INTO NEW.ufc_main_fight_id,NEW.ufc_co_main_fight_id
   FROM public.sports_ufc_scoring_roles(NEW.family_id,NEW.id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sports_ufc_scoring BEFORE INSERT OR UPDATE ON public.sports_events
 FOR EACH ROW EXECUTE FUNCTION public.sports_ufc_scoring_guard();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sports_ufc_scoring_roles(uuid,uuid),public.sports_ufc_scoring_guard() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.sports_ufc_scoring_roles(uuid,uuid),public.sports_ufc_scoring_guard() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
