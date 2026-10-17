-- Access is for the trusted application database owner, never PUBLIC/anon.
-- Non-owner runtime roles must receive an explicit grant to the session API.
REVOKE ALL ON FUNCTION public.sports_football_predictions_api(text,uuid,text,text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.sports_football_choice_view(p_event public.sports_events, p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_closed timestamptz; v_own text; v_choices jsonb := '[]'::jsonb; v_actor record;
BEGIN
  SELECT * INTO v_actor FROM public.sports_football_session_actor(p_token);
  IF NOT FOUND OR v_actor.family_id <> p_event.family_id THEN RETURN NULL; END IF;
  SELECT closed_at INTO v_closed FROM public.sports_football_closures WHERE event_id=p_event.id;
  SELECT choice INTO v_own FROM public.sports_football_predictions WHERE event_id=p_event.id AND member_id=v_actor.member_id;
  IF v_closed IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('memberId',p.member_id,'name',m.name,'choice',p.choice) ORDER BY p.member_id),'[]'::jsonb)
      INTO v_choices FROM public.sports_football_predictions p JOIN public.members m ON m.id=p.member_id AND m.family_id=p.family_id
      WHERE p.event_id=p_event.id AND p.family_id=p_event.family_id;
  END IF;
  RETURN jsonb_build_object('eventId',p_event.id,'closesAt',COALESCE(v_closed,p_event.starts_at),
    'closed',v_closed IS NOT NULL,
    'canPredict',public.sports_football_choice_open(p_event.starts_at,v_closed,p_event.status,clock_timestamp())
      AND p_event.first_team_id IS NOT NULL AND p_event.second_team_id IS NOT NULL
      AND length(btrim(p_event.first_participant))>0 AND length(btrim(p_event.second_participant))>0,
    'ownChoice',v_own,'choices',v_choices);
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.sports_football_predictions_api(p_token text, p_event uuid, p_action text DEFAULT 'read', p_choice text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor record; v_event public.sports_events; v_closed timestamptz;
  v_view jsonb; v_before text; v_changed boolean := false;
BEGIN
  SELECT * INTO v_actor FROM public.sports_football_session_actor(p_token);
  IF NOT FOUND THEN RETURN jsonb_build_object('status',403,'data',jsonb_build_object('error','Ingresá a tu familia.')); END IF;
  SELECT * INTO v_event FROM public.sports_events WHERE id=p_event AND family_id=v_actor.family_id
    AND kind='football_match' AND football_category='champions' AND hidden=false AND source_absent_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'data',jsonb_build_object('error','No encontramos este partido.')); END IF;
  PERFORM public.sports_football_materialize_close(v_event.family_id,v_event.id,v_event.starts_at,v_event.status);
  IF p_action IS NULL OR p_action NOT IN ('read','put','delete') OR (p_action='put' AND (p_choice IS NULL OR p_choice NOT IN ('home','draw','away'))) THEN
    RETURN jsonb_build_object('status',400,'data',jsonb_build_object('error','Pronóstico inválido.'));
  END IF;
  IF p_action <> 'read' THEN
    SELECT closed_at INTO v_closed FROM public.sports_football_closures WHERE event_id=p_event;
    IF NOT public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      OR v_event.first_team_id IS NULL OR v_event.second_team_id IS NULL
      OR length(btrim(v_event.first_participant))=0 OR length(btrim(v_event.second_participant))=0 THEN
      RETURN jsonb_build_object('status',409,'data',jsonb_build_object('error','El partido no admite cambios de pronóstico.'));
    END IF;
    SELECT choice INTO v_before FROM public.sports_football_predictions WHERE event_id=p_event AND member_id=v_actor.member_id;
    IF p_action='put' THEN
      INSERT INTO public.sports_football_predictions(family_id,event_id,member_id,choice)
      SELECT v_actor.family_id,p_event,v_actor.member_id,p_choice
      WHERE public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      ON CONFLICT(event_id,member_id) DO UPDATE SET choice=excluded.choice,updated_at=clock_timestamp()
      WHERE public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      RETURNING true INTO v_changed;
    ELSE
      DELETE FROM public.sports_football_predictions WHERE event_id=p_event AND member_id=v_actor.member_id
        AND public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      RETURNING true INTO v_changed;
    END IF;
    IF NOT COALESCE(v_changed,false) AND (p_action='put' OR v_before IS NOT NULL OR NOT public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())) THEN
      PERFORM public.sports_football_materialize_close(v_event.family_id,v_event.id,v_event.starts_at,v_event.status);
      RETURN jsonb_build_object('status',409,'data',jsonb_build_object('error','El partido no admite cambios de pronóstico.'));
    END IF;
    IF (p_action='put' AND v_before IS DISTINCT FROM p_choice) OR (p_action='delete' AND v_before IS NOT NULL) THEN
      INSERT INTO public.audit_events(family_id,actor_member_id,entity_type,entity_id,action,"after")
      VALUES(v_actor.family_id,v_actor.member_id,'sports_football_prediction',p_event,
        CASE WHEN p_action='delete' THEN 'deleted' WHEN v_before IS NULL THEN 'saved' ELSE 'changed' END,
        jsonb_build_object('eventId',p_event));
    END IF;
  END IF;
  -- A read or a successful mutation may have crossed kickoff; persist before disclosure.
  PERFORM public.sports_football_materialize_close(v_event.family_id,v_event.id,v_event.starts_at,v_event.status);
  v_view := public.sports_football_choice_view(v_event,p_token);
  IF v_view IS NULL THEN RETURN jsonb_build_object('status',403,'data',jsonb_build_object('error','Ingresá a tu familia.')); END IF;
  RETURN jsonb_build_object('status',200,'data',v_view);
END;
$$;

--> statement-breakpoint
DROP FUNCTION public.sports_football_choice_view(public.sports_events,uuid);
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sports_football_choice_view(public.sports_events,text) FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE v_function record;
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    FOR v_function IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname LIKE 'sports_football_%' AND p.prosecdef
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon',v_function.signature);
    END LOOP;
  END IF;
END;
$$;
