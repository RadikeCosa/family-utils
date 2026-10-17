-- Atomic, idempotent activation. Never remove closures as an application rollback.
ALTER TABLE public.sports_events ADD COLUMN IF NOT EXISTS ufc_prediction_closes_at timestamptz;
ALTER TABLE public.sports_events ADD COLUMN IF NOT EXISTS ufc_prediction_closed_at timestamptz;
ALTER TABLE public.sports_events ADD COLUMN IF NOT EXISTS ufc_prediction_transition_at timestamptz;
ALTER TABLE public.sports_fights ADD COLUMN IF NOT EXISTS prode_eligible boolean NOT NULL DEFAULT true;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.sports_ufc_scheduled_close(p public.sports_events)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT CASE (SELECT f.bout_block FROM public.sports_fights f
 WHERE f.event_id=p.id AND f.family_id=p.family_id AND f.removed_at IS NULL
 AND NOT EXISTS (SELECT 1 FROM public.sports_fight_results r WHERE r.fight_id=f.id AND r.outcome='cancelled')
 ORDER BY CASE f.bout_block WHEN 'early_preliminaries' THEN 0 WHEN 'preliminaries' THEN 1 ELSE 2 END LIMIT 1)
 WHEN 'early_preliminaries' THEN p.early_preliminaries_starts_at
 WHEN 'preliminaries' THEN p.preliminary_starts_at WHEN 'main' THEN p.main_card_starts_at END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS sports_ufc_event_close ON public.sports_events;
UPDATE public.sports_events e SET
 ufc_prediction_closes_at=public.sports_ufc_scheduled_close(e),
 ufc_prediction_closed_at=COALESCE(e.ufc_prediction_closed_at,(SELECT min(v) FROM (
 SELECT public.sports_ufc_scheduled_close(e) v
 UNION ALL SELECT closed_at FROM public.sports_block_closures WHERE event_id=e.id AND family_id=e.family_id
 UNION ALL SELECT prediction_closed_at FROM public.sports_fights WHERE event_id=e.id AND family_id=e.family_id
 ) candidates WHERE v<=clock_timestamp())),
 ufc_prediction_transition_at=COALESCE(e.ufc_prediction_transition_at,clock_timestamp())
WHERE e.kind='ufc_card';
DO $$ DECLARE cards integer; closed integer; votes integer; BEGIN
 SELECT count(*),count(ufc_prediction_closed_at) INTO cards,closed FROM public.sports_events WHERE kind='ufc_card';
 SELECT count(*) INTO votes FROM public.sports_predictions;
 RAISE NOTICE 'UFC closure activation: % cards, % closed, % preserved predictions',cards,closed,votes;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.sports_ufc_event_close_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE previous_close timestamptz; scheduled timestamptz;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.kind='ufc_card' AND (NEW.kind<>OLD.kind OR NEW.id<>OLD.id OR NEW.family_id<>OLD.family_id) THEN
   RAISE EXCEPTION 'UFC event identity is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.ufc_prediction_closes_at IS DISTINCT FROM OLD.ufc_prediction_closes_at
   OR NEW.ufc_prediction_closed_at IS DISTINCT FROM OLD.ufc_prediction_closed_at
   OR NEW.ufc_prediction_transition_at IS DISTINCT FROM OLD.ufc_prediction_transition_at THEN
   RAISE EXCEPTION 'UFC closure columns are database managed' USING ERRCODE='23514'; END IF;
 ELSIF NEW.ufc_prediction_closes_at IS NOT NULL OR NEW.ufc_prediction_closed_at IS NOT NULL OR NEW.ufc_prediction_transition_at IS NOT NULL THEN
  RAISE EXCEPTION 'UFC closure columns are database managed' USING ERRCODE='23514';
 END IF;
 IF NEW.kind<>'ufc_card' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  previous_close:=COALESCE(OLD.ufc_prediction_closed_at,OLD.ufc_prediction_closes_at);
  IF previous_close<=clock_timestamp() THEN NEW.ufc_prediction_closed_at:=previous_close; END IF;
 END IF;
 scheduled:=public.sports_ufc_scheduled_close(NEW);
 NEW.ufc_prediction_closes_at:=scheduled;
 IF NEW.ufc_prediction_closed_at IS NULL AND scheduled<=clock_timestamp() THEN NEW.ufc_prediction_closed_at:=scheduled; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sports_ufc_event_close BEFORE INSERT OR UPDATE ON public.sports_events
FOR EACH ROW EXECUTE FUNCTION public.sports_ufc_event_close_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.sports_ufc_refresh_close(p_family uuid,p_event uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM 1 FROM public.sports_events WHERE id=p_event AND family_id=p_family AND kind='ufc_card' FOR UPDATE;
 UPDATE public.sports_events SET updated_at=updated_at WHERE id=p_event AND family_id=p_family AND kind='ufc_card';
END $$;
CREATE OR REPLACE FUNCTION public.sports_ufc_fight_close_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE e public.sports_events; family uuid; event uuid;
BEGIN
 IF TG_OP='INSERT' THEN family:=NEW.family_id; event:=NEW.event_id; ELSE family:=OLD.family_id; event:=OLD.event_id; END IF;
 IF TG_OP='UPDATE' AND (NEW.family_id<>family OR NEW.event_id<>event OR NEW.id<>OLD.id
  OR NOT ((NEW.first_fighter_id=OLD.first_fighter_id AND NEW.second_fighter_id=OLD.second_fighter_id)
   OR (NEW.first_fighter_id=OLD.second_fighter_id AND NEW.second_fighter_id=OLD.first_fighter_id))
  OR NEW.prode_eligible IS DISTINCT FROM OLD.prode_eligible) THEN
  RAISE EXCEPTION 'Fight identity and prode eligibility are immutable' USING ERRCODE='23514'; END IF;
 PERFORM public.sports_ufc_refresh_close(family,event);
 SELECT * INTO e FROM public.sports_events WHERE id=event AND family_id=family;
 IF TG_OP='INSERT' THEN NEW.prode_eligible:=e.ufc_prediction_closed_at IS NULL; RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.sports_ufc_fight_close_after()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN PERFORM public.sports_ufc_refresh_close(OLD.family_id,OLD.event_id);
 ELSE PERFORM public.sports_ufc_refresh_close(NEW.family_id,NEW.event_id); END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sports_ufc_fight_close_before ON public.sports_fights;
CREATE TRIGGER sports_ufc_fight_close_before BEFORE INSERT OR UPDATE OR DELETE ON public.sports_fights FOR EACH ROW EXECUTE FUNCTION public.sports_ufc_fight_close_guard();
DROP TRIGGER IF EXISTS sports_ufc_fight_close_after ON public.sports_fights;
CREATE TRIGGER sports_ufc_fight_close_after AFTER INSERT OR UPDATE OR DELETE ON public.sports_fights FOR EACH ROW EXECUTE FUNCTION public.sports_ufc_fight_close_after();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.sports_ufc_vote_close_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE family uuid; event uuid; e public.sports_events; f public.sports_fights;
BEGIN
 IF TG_OP='INSERT' THEN family:=NEW.family_id; event:=NEW.event_id; ELSE family:=OLD.family_id; event:=OLD.event_id; END IF;
 IF TG_OP='DELETE' AND NOT EXISTS (SELECT 1 FROM public.families WHERE id=family) THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND (NEW.family_id<>family OR NEW.event_id<>event OR NEW.fight_id<>OLD.fight_id OR NEW.member_id<>OLD.member_id) THEN
  RAISE EXCEPTION 'Prediction identity is immutable' USING ERRCODE='23514'; END IF;
 PERFORM public.sports_ufc_refresh_close(family,event);
 SELECT * INTO e FROM public.sports_events WHERE id=event AND family_id=family;
 SELECT * INTO f FROM public.sports_fights WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.fight_id ELSE NEW.fight_id END AND family_id=family AND event_id=event;
 IF e.id IS NULL OR f.id IS NULL THEN RAISE EXCEPTION 'Invalid prediction scope' USING ERRCODE='23503'; END IF;
 -- Suppress writes instead of raising, retaining the frozen closure on rejection.
 IF e.ufc_prediction_closed_at IS NOT NULL OR e.ufc_prediction_closes_at IS NULL OR e.ufc_prediction_closes_at<=clock_timestamp()
  OR e.hidden OR e.source_absent_at IS NOT NULL OR e.status='cancelled' OR NOT f.prode_eligible OR f.removed_at IS NOT NULL
  OR EXISTS (SELECT 1 FROM public.sports_fight_results WHERE fight_id=f.id) THEN RETURN NULL; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.members WHERE id=NEW.member_id AND family_id=family)
  OR NEW.winner_id NOT IN (f.first_fighter_id,f.second_fighter_id) THEN
  RAISE EXCEPTION 'Invalid prediction participant' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sports_ufc_vote_close ON public.sports_predictions;
CREATE TRIGGER sports_ufc_vote_close BEFORE INSERT OR UPDATE OR DELETE ON public.sports_predictions FOR EACH ROW EXECUTE FUNCTION public.sports_ufc_vote_close_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.sports_ufc_result_close_before()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN PERFORM public.sports_ufc_refresh_close(OLD.family_id,OLD.event_id); RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND (NEW.event_id<>OLD.event_id OR NEW.family_id<>OLD.family_id OR NEW.fight_id<>OLD.fight_id) THEN
  RAISE EXCEPTION 'Result identity is immutable' USING ERRCODE='23514'; END IF;
 PERFORM public.sports_ufc_refresh_close(NEW.family_id,NEW.event_id);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sports_ufc_result_close_before ON public.sports_fight_results;
CREATE TRIGGER sports_ufc_result_close_before BEFORE INSERT OR UPDATE OR DELETE ON public.sports_fight_results FOR EACH ROW EXECUTE FUNCTION public.sports_ufc_result_close_before();
DROP TRIGGER IF EXISTS sports_ufc_result_close_after ON public.sports_fight_results;
CREATE TRIGGER sports_ufc_result_close_after AFTER INSERT OR UPDATE OR DELETE ON public.sports_fight_results FOR EACH ROW EXECUTE FUNCTION public.sports_ufc_fight_close_after();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sports_ufc_scheduled_close(public.sports_events),public.sports_ufc_event_close_guard(),public.sports_ufc_refresh_close(uuid,uuid),public.sports_ufc_fight_close_guard(),public.sports_ufc_fight_close_after(),public.sports_ufc_vote_close_guard(),public.sports_ufc_result_close_before() FROM PUBLIC;
REVOKE ALL ON public.sports_predictions,public.sports_block_closures,public.sports_fight_results FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON public.sports_predictions,public.sports_block_closures,public.sports_fight_results FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION public.sports_ufc_scheduled_close(public.sports_events),public.sports_ufc_event_close_guard(),public.sports_ufc_refresh_close(uuid,uuid),public.sports_ufc_fight_close_guard(),public.sports_ufc_fight_close_after(),public.sports_ufc_vote_close_guard(),public.sports_ufc_result_close_before() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
